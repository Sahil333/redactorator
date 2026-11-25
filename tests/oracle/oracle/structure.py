"""The checker's own allowlist: every key in the output must be one the PDF needs to draw its pages.

It reads the Arlington PDF Model (vendor/arlington, the same TSVs the app's role table is generated
from) with a walker of its own, and keeps its own decisions below, written from the design's rules
(docs/designs/pdf-leak-suite.md, Appendix A.1). It shares no code with the app.
"""

import csv
import io
import re
from functools import cache
from pathlib import Path

from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfparser import PDFParser
from pdfminer.pdftypes import PDFObjRef, PDFStream
from pdfminer.psparser import PSLiteral

MODEL = Path(__file__).resolve().parents[3] / "vendor/arlington/tsv/latest"

DESCRIPTOR = {"Type", "FontName", "FontFamily", "FontStretch", "FontWeight", "Flags", "FontBBox", "ItalicAngle", "Ascent",
              "Descent", "Leading", "CapHeight", "XHeight", "StemV", "StemH", "AvgWidth", "MaxWidth", "MissingWidth"}
SIMPLE_FONT = {"Type", "Subtype", "BaseFont", "FirstChar", "LastChar", "Widths", "FontDescriptor", "Encoding", "ToUnicode"}
CID_FONT = {"Type", "Subtype", "BaseFont", "CIDSystemInfo", "FontDescriptor", "DW", "W", "DW2", "W2", "CIDToGIDMap", "ToUnicode"}
SHADING = {"ShadingType", "ColorSpace", "Background", "BBox", "AntiAlias", "Coords", "Domain", "Function", "Extend", "Matrix",
           "BitsPerCoordinate", "BitsPerComponent", "BitsPerFlag", "Decode", "VerticesPerRow"}
FUNCTION = {"FunctionType", "Domain", "Range", "Size", "BitsPerSample", "Order", "Encode", "Decode", "C0", "C1", "N", "Functions", "Bounds"}
PARMS = {"Predictor", "Colors", "BitsPerComponent", "Columns", "EarlyChange", "K", "EndOfLine", "EncodedByteAlign", "Rows",
         "EndOfBlock", "BlackIs1", "DamagedRowsBeforeError", "JBIG2Globals", "ColorTransform"}
HALFTONE = {"Type", "HalftoneType", "Frequency", "Angle", "SpotFunction", "AccurateScreens", "TransferFunction", "Width", "Height",
            "Width2", "Height2", "Xsquare", "Ysquare"}
IMAGE = {"Type", "Subtype", "Width", "Height", "ColorSpace", "BitsPerComponent", "Intent", "ImageMask", "Mask", "Decode", "Interpolate",
         "SMask", "SMaskInData", "Matte"}
PAGE_TREE = {"Type", "Parent", "Kids", "Count", "Resources", "MediaBox", "CropBox", "Rotate"}

# What each type keeps; a type not here keeps nothing, and every stream keeps Length, Filter and
# DecodeParms. Arrays and file-named maps keep every entry.
KEEP: dict[str, set[str]] = {
    "FileTrailer": {"Size", "Root", "ID"},
    "Catalog": {"Type", "Pages", "Version"},
    "PageTreeNodeRoot": PAGE_TREE - {"Parent"},
    "PageTreeNode": PAGE_TREE,
    "PageObject": {"Type", "Parent", "Resources", "MediaBox", "CropBox", "Rotate", "Contents", "Group", "UserUnit"},
    # A content stream: how it is stored, and nothing else. A ToUnicode CMap keeps the
    # specification's own CMap keys too (owner, 25 Nov 2026). A PostScript XObject is not kept.
    "Stream": set(), "ToUnicodeCMapStream": {"Type", "CMapName", "CIDSystemInfo", "WMode", "UseCMap"},
    "Resource": {"ExtGState", "ColorSpace", "Pattern", "Shading", "XObject", "Font", "ProcSet"},
    "XObjectImage": IMAGE, "XObjectImageMask": IMAGE, "XObjectImageSoftMask": IMAGE,
    "XObjectFormType1": {"Type", "Subtype", "FormType", "BBox", "Matrix", "Resources", "Group"},
    "GroupAttributes": {"Type", "S", "CS", "I", "K"},
    "FontType1": SIMPLE_FONT, "FontTrueType": SIMPLE_FONT, "FontMultipleMaster": SIMPLE_FONT,
    "FontType3": SIMPLE_FONT - {"BaseFont"} | {"FontBBox", "FontMatrix", "CharProcs", "Resources"},
    "FontType0": {"Type", "Subtype", "BaseFont", "Encoding", "DescendantFonts", "ToUnicode"},
    "FontCIDType0": CID_FONT, "FontCIDType2": CID_FONT,
    "FontDescriptorType1": DESCRIPTOR | {"FontFile", "FontFile3", "CharSet"},
    "FontDescriptorTrueType": DESCRIPTOR | {"FontFile", "FontFile2", "FontFile3"},
    "FontDescriptorType3": DESCRIPTOR,
    "FontDescriptorCIDType0": DESCRIPTOR | {"FontFile", "FontFile3", "Style", "FD", "CIDSet"},
    "FontDescriptorCIDType2": DESCRIPTOR | {"FontFile", "FontFile2", "FontFile3", "Style", "FD", "CIDSet"},
    "CIDFontDescriptorMetrics": DESCRIPTOR - {"FontFamily", "FontStretch", "FontWeight"} | {"CharSet"},
    **{name: {"Length1", "Length2", "Length3", "Subtype"} for name in
       ("FontFile", "FontFile2", "FontFile3Type1", "FontFile3CIDType0", "FontFile3OpenType", "FontFileType1")},
    "Encoding": {"Type", "BaseEncoding", "Differences"},
    "CMapStream": {"Type", "CMapName", "CIDSystemInfo", "WMode", "UseCMap"},
    "CIDSystemInfo": {"Registry", "Ordering", "Supplement"},
    "StyleDict": {"Panose"},
    **{f"ShadingType{n}": SHADING for n in range(1, 8)},
    **{f"FunctionType{n}": FUNCTION for n in (0, 2, 3, 4)},
    **{name: PARMS for name in ("FilterCCITTFaxDecode", "FilterDCTDecode", "FilterFlateDecode", "FilterJBIG2Decode", "FilterLZWDecode")},
    **{name: HALFTONE for name in ("HalftoneType1", "HalftoneType6", "HalftoneType10", "HalftoneType16")},
    # A type-5 halftone's other keys are its colorants' halftones, named by the file.
    "HalftoneType5": {"Type", "HalftoneType", "Default"},
    "ColorSpaceMap": {"DefaultGray", "DefaultRGB", "DefaultCMYK"},
    "SoftMaskAlpha": {"Type", "S", "G", "BC", "TR"}, "SoftMaskLuminosity": {"Type", "S", "G", "BC", "TR"},
    "PatternType1": {"Type", "PatternType", "PaintType", "TilingType", "BBox", "XStep", "YStep", "Resources", "Matrix"},
    # A shading pattern's ExtGState is never applied when it is drawn, so what it holds is never seen.
    "PatternType2": {"Type", "PatternType", "Shading", "Matrix"},
    "GraphicsStateParameter": {"Type", "LW", "LC", "LJ", "ML", "D", "RI", "OP", "op", "OPM", "Font", "BG", "BG2", "UCR", "UCR2", "TR",
                               "TR2", "HT", "FL", "SM", "SA", "BM", "SMask", "CA", "ca", "AIS", "TK", "UseBlackPtComp"},
    "ICCProfileStream": {"N", "Alternate", "Range"},
    "CalGrayDict": {"WhitePoint", "BlackPoint", "Gamma"}, "CalRGBDict": {"WhitePoint", "BlackPoint", "Gamma", "Matrix"},
    "LabDict": {"WhitePoint", "BlackPoint", "Range"},
    "DeviceNDict": {"Subtype", "Colorants", "Process"}, "DeviceNProcess": {"ColorSpace", "Components"},
}
STREAM = {"Length", "Filter", "DecodeParms"}
# The abbreviated filter names PDF defines for inline images; readers take them on any stream.
FULL_NAMES = {"AHx": "ASCIIHexDecode", "A85": "ASCII85Decode", "LZW": "LZWDecode", "Fl": "FlateDecode", "RL": "RunLengthDecode",
              "CCF": "CCITTFaxDecode", "DCT": "DCTDecode"}
TELLS_APART = ("Type", "Subtype", "Subtype2", "S", "FunctionType", "ShadingType", "PatternType", "HalftoneType", "0")


def strip_fn(text: str) -> str:
    """A model entry without its `fn:` wrappers: `fn:SinceVersion(1.2,FontType0)` is `FontType0`."""
    while text.startswith("fn:"):
        text = re.split(r",(?![^(]*\))", text[text.index("(") + 1 : text.rindex(")")])[-1].strip()
    return text


def parts(column: str) -> list[str]:
    """A column's `;`-separated parts, outside brackets and parentheses."""
    out, depth, word = [], 0, ""
    for c in column:
        depth += (c in "([") - (c in ")]")
        if c == ";" and depth == 0:
            out.append(word)
            word = ""
        else:
            word += c
    return out + [word]


def bracketed(part: str) -> list[str]:
    inner = part.strip()[1:-1]
    out, depth, word = [], 0, ""
    for c in inner:
        depth += (c in "([") - (c in ")]")
        if c == "," and depth == 0:
            out.append(word)
            word = ""
        else:
            word += c
    return [strip_fn(each.strip()) for each in out + [word] if each.strip()]


KINDS = {"array": "array", "rectangle": "array", "matrix": "array", "dictionary": "dict", "number-tree": "dict", "name-tree": "dict",
         "stream": "stream", "name": "name", "string": "string", "string-text": "string", "string-byte": "string",
         "string-ascii": "string", "date": "string", "integer": "number", "number": "number", "bitmask": "number",
         "boolean": "boolean", "null": "null"}
# A rectangle is four numbers and a matrix six; the model links them nowhere.
SHAPES = {"rectangle": 4, "matrix": 6}
PAGE_TREE_TYPES = ("PageTreeNode", "PageTreeNodeRoot")


@cache
def model(name: str) -> dict[str, dict[str, object]] | None:
    """A model type's keys: for each, the types it links to by container kind, and its fixed values."""
    path = MODEL / f"{name}.tsv"
    if not path.exists():
        return None
    keys = {}
    with path.open(newline="") as file:
        for row in csv.DictReader(file, delimiter="\t"):
            types = [strip_fn(each.strip()) for each in parts(row["Type"])]
            links = [bracketed(each) for each in parts(row["Link"])] if row["Link"].strip() else []
            to: dict[str, list[str]] = {}
            for index, kind in enumerate(types):
                to.setdefault(KINDS[kind], []).extend([kind] if kind in SHAPES else links[index] if index < len(links) else [])
            fixed = next((values for values in (bracketed(each) for each in parts(row["PossibleValues"]) if each.strip())
                          if values and all(re.fullmatch(r"[A-Za-z0-9_.\-]+", v) for v in values)), None)
            keys[row["Key"]] = {"types": set(types), "to": to, "fixed": fixed}
    return keys


def value_kind(value: object) -> str:
    if isinstance(value, PDFStream):
        return "stream"
    if isinstance(value, dict):
        return "dict"
    if isinstance(value, list):
        return "array"
    if isinstance(value, PSLiteral):
        return "name"
    if isinstance(value, bytes):
        return "string"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "null"


def is_shape(value: object, shape: str) -> bool:
    return isinstance(value, list) and len(value) == SHAPES[shape] and all(
        isinstance(each, (int, float)) and not isinstance(each, bool) for each in value)


def fixed_of(value: object, key: str) -> str | None:
    found = value.attrs.get(key) if isinstance(value, PDFStream) else value.get(key) if isinstance(value, dict) else (
        value[int(key)] if isinstance(value, list) and key.isdigit() and int(key) < len(value) else None)
    if isinstance(found, PSLiteral):
        return found.name
    if isinstance(found, (int, float)) and not isinstance(found, bool):
        return str(int(found)) if float(found).is_integer() else str(found)
    return None


def pick(candidates: list[str], value: object) -> str | None:
    """The candidate whose fixed values the value matches most, when exactly one does best."""
    scored = []
    for candidate in candidates:
        keys = model(candidate)
        if keys is None:
            continue
        matched, fits = 0, True
        for key in TELLS_APART:
            fixed = keys.get(key, {}).get("fixed")
            found = fixed_of(value, key)
            if fixed is None or found is None:
                continue
            if found not in fixed:
                fits = False
            matched += 1
        if fits:
            scored.append((matched, candidate))
    best = [c for m, c in scored if m == max((m for m, _ in scored), default=0)]
    return best[0] if len(best) == 1 else None


class Walk:
    def __init__(self, document: PDFDocument):
        self.document = document
        self.seen: set[tuple[int, str]] = set()
        self.parents: list[tuple[object, str]] = []
        self.reasons: list[str] = []

    def resolve(self, value: object) -> tuple[object, int | None]:
        number = None
        while isinstance(value, PDFObjRef):
            number = value.objid
            value = self.document.getobj(value.objid)
        return value, number

    def value(self, value: object, links: dict[str, list[str]], path: str, named: list[str] | None = None) -> None:
        """A kept key's value, of a type the model allows there; `named` gives its type, or its
        elements' in turn, where the context decides it: a stream's decode parameters follow its filters."""
        resolved, _ = self.resolve(value)
        kind = value_kind(resolved)
        candidates = links.get(kind)
        if candidates is None:
            self.reasons.append(f"{path} is a {kind} where the model has none")
            return
        if kind not in ("array", "dict", "stream"):
            return
        shapes = [c for c in candidates if c in SHAPES]
        if shapes:
            if not any(is_shape(resolved, shape) for shape in shapes):
                self.reasons.append(f"{path} is not the {' or '.join(shapes)} the model has there")
            return
        first = (named or [None])[0]
        if first is not None and kind == "dict" and first not in candidates:
            # A filter that takes no parameters: an empty dictionary holds nothing.
            if resolved:
                self.reasons.append(f"{path} holds parameters for a filter that takes none")
            return
        role = first if first in candidates else pick(candidates, resolved)
        if role is None:
            self.reasons.append(f"{path} fits no type the model allows there")
        else:
            self.object(value, role, path, named or [])

    def object(self, value: object, role: str, path: str, named: list[str] | None = None) -> None:
        resolved, number = self.resolve(value)
        if number is not None:
            if (number, role) in self.seen:
                return
            self.seen.add((number, role))
        keys = model(role)
        if keys is None or (role not in KEEP and not isinstance(resolved, list) and set(keys) != {"*"}):
            self.reasons.append(f"{path} is a {role}, which the cleaned file must not hold")
            return
        if isinstance(resolved, list):
            for index, each in enumerate(resolved):
                entry = keys.get(str(index)) or keys.get("*")
                if entry is None:
                    self.reasons.append(f"{path}[{index}] is an element the model has no place for")
                else:
                    self.value(each, entry["to"], f"{path}[{index}]", (named or [])[index : index + 1])
            return
        attrs = resolved.attrs if isinstance(resolved, PDFStream) else resolved
        filters, _ = self.resolve(attrs.get("Filter"))
        names = [f"Filter{FULL_NAMES.get(name, name)}" for name in (getattr(self.resolve(f)[0], 'name', '') for f in (filters if isinstance(filters, list) else [filters] if filters else []))]
        # A type's own keys keep only what KEEP lists; a key the file chooses, where the type has
        # `*`, is kept. KEEP's shared sets are read against each type's own keys in the model, so a
        # key a type does not have is outside.
        kept = KEEP.get(role, set()) | (STREAM if isinstance(resolved, PDFStream) else set())
        # A soft mask's colour space is rewritten as the name DeviceGray, or the file refused.
        if role == "XObjectImageSoftMask" and isinstance(self.resolve(attrs.get("ColorSpace"))[0], list):
            self.reasons.append(f"{path}/ColorSpace is an array, where a soft mask keeps only a name")
        parms, _ = self.resolve(attrs.get("DecodeParms"))
        if any(self.resolve(each)[0] is not None for each in (parms if isinstance(parms, list) else [parms])[len(names):]):
            self.reasons.append(f"{path}/DecodeParms holds parameters with no filter at their place")
        for key, each in attrs.items():
            entry = keys.get(key) if key in keys else keys.get("*")
            if entry is None or (key in keys and key not in kept):
                self.reasons.append(f"{path}/{key} is outside the allowlist")
                continue
            # A page's or node's parent is the node that reached it, checked once the walk is done.
            if key == "Parent":
                self.parents.append((each, f"{path}/{key}"))
                continue
            self.value(each, entry["to"], f"{path}/{key}", names if key == "DecodeParms" else None)

    def check_parents(self) -> None:
        for parent, path in self.parents:
            number = parent.objid if isinstance(parent, PDFObjRef) else None
            if number is None or not any((number, role) in self.seen for role in PAGE_TREE_TYPES):
                self.reasons.append(f"{path} is not a page-tree node of this file")


def structure(output: bytes) -> list[str]:
    """Every key reachable from the output's trailer is one its type keeps."""
    document = PDFDocument(PDFParser(io.BytesIO(output)))
    walk = Walk(document)
    trailer = {}
    for xref in document.xrefs:
        trailer.update(xref.get_trailer())
    walk.object(trailer, "FileTrailer", "trailer")
    walk.check_parents()
    return walk.reasons
