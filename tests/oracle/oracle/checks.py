"""The checks. Each returns a list of reasons it failed; an empty list is a pass.

Coordinates are PDF user space as pdfminer lays a page out: points, origin
bottom-left, page rotation applied the way pdfminer applies it. Input and output
are always read the same way, so a check never depends on the app's box convention.
"""

import io
import re
import zlib
from collections.abc import Iterator

from pdfminer.high_level import extract_pages, extract_text
from pdfminer.layout import LTChar, LTComponent, LTCurve, LTFigure, LTImage, LTLayoutContainer, LTLine, LTPage, LTRect
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfparser import PDFParser
from pdfminer.pdftypes import PDFStream, resolve1
from pdfminer.psparser import PSLiteral
import pypdfium2
from PIL import Image, ImageChops

from . import raw
from .structure import FULL_NAMES, structure  # noqa: F401  (structure: a check, run by name from __main__)

Box = tuple[float, float, float, float]
TOLERANCE = 0.5


def squash(text: str) -> str:
    return re.sub(r"\s+", "", text)


def walk(item: LTComponent) -> Iterator[LTComponent]:
    yield item
    if isinstance(item, LTLayoutContainer) or hasattr(item, "_objs"):
        for child in item:
            yield from walk(child)


def pages(pdf: bytes) -> list[LTPage]:
    return list(extract_pages(io.BytesIO(pdf)))


def chars(page: LTPage) -> list[LTChar]:
    return [item for item in walk(page) if isinstance(item, LTChar)]


def find_word(pdf: bytes, word: str) -> tuple[int, Box]:
    """The page index and bbox of the first run of characters spelling `word`, spaces ignored."""
    target = squash(word)
    for index, page in enumerate(pages(pdf)):
        glyphs = [glyph for glyph in chars(page) if glyph.get_text().strip()]
        text = "".join(glyph.get_text() for glyph in glyphs)
        at = text.find(target)
        if at != -1:
            run = glyphs[at : at + len(target)]
            return index, (min(g.x0 for g in run), min(g.y0 for g in run), max(g.x1 for g in run), max(g.y1 for g in run))
    raise LookupError(f"{word!r} is not in the input")


def overlaps(a: Box, b: Box) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def contains(outer: Box, inner: Box) -> bool:
    return (outer[0] <= inner[0] + TOLERANCE and outer[1] <= inner[1] + TOLERANCE
            and outer[2] >= inner[2] - TOLERANCE and outer[3] >= inner[3] - TOLERANCE)


def absent(output: bytes, values: list[str]) -> list[str]:
    reasons = []
    layer = squash(extract_text(io.BytesIO(output)))
    scanned = [squash(text) for text in raw.texts(output)]
    for value in values:
        if squash(value) in layer:
            reasons.append(f"{value!r} is in the output's text layer")
        if any(squash(value) in text for text in scanned):
            reasons.append(f"{value!r} is in the output's raw bytes (a stream, string or metadata)")
    return reasons


def kept(output: bytes, values: list[str]) -> list[str]:
    """Each value is still somewhere in the output's bytes: a value kept by decision ("What
    preparation promises") is recorded where it stays, so a change in what is kept is seen."""
    scanned = [squash(text) for text in raw.texts(output)]
    return [f"{value!r} is no longer in the output" for value in values if not any(squash(value) in text for text in scanned)]


def region_boxes(regions: list[dict]) -> list[tuple[int, Box]]:
    """`{"page": n, "box": [x0, y0, x1, y1]}` regions as (0-based page, box) pairs."""
    return [(region["page"] - 1, tuple(region["box"])) for region in regions]


def glyphs_absent(output: bytes, regions: list[dict]) -> list[str]:
    """No glyph is drawn inside a region, judged by where its box's centre lies, so text whose
    letters have no Unicode map is judged too."""
    reasons = []
    for index, page in enumerate(pages(output)):
        for glyph in (each for each in chars(page) if each.get_text().strip()):
            x, y = (glyph.x0 + glyph.x1) / 2, (glyph.y0 + glyph.y1) / 2
            for at, box in region_boxes(regions):
                if at == index and box[0] <= x <= box[2] and box[1] <= y <= box[3]:
                    reasons.append(f"a glyph {glyph.get_text()!r} is still drawn at {tuple(round(v, 1) for v in glyph.bbox)} on page {index + 1}")
    return reasons


def part_bounds(part: LTCurve) -> Box:
    """A drawing part's bounds: every point of its path, control points included, grown by half its
    line width when it is stroked."""
    points = [(x, y) for segment in part.original_path or [] for x, y in segment[1:]] or [(part.x0, part.y0), (part.x1, part.y1)]
    grow = part.linewidth / 2 if part.stroke else 0
    return (min(x for x, _ in points) - grow, min(y for _, y in points) - grow,
            max(x for x, _ in points) + grow, max(y for _, y in points) + grow)


def drawings(output: bytes, boxes: list[dict]) -> list[str]:
    """No drawing part lies wholly under a box, and a part a box covers only in part is a single
    rectangle or straight line. A part is one subpath, as each move starts one; a filled rectangle
    the size of a box is the box drawn over what was removed."""
    reasons = []
    for index, page in enumerate(pages(output)):
        for part in (item for item in walk(page) if isinstance(item, LTCurve)):
            bounds = part_bounds(part)
            for at, box in region_boxes(boxes):
                if at != index or not overlaps(box, bounds):
                    continue
                where = f"on page {index + 1} at {tuple(round(v, 1) for v in bounds)}"
                if isinstance(part, LTRect) and part.fill and all(abs(a - b) <= TOLERANCE for a, b in zip(part.bbox, box)):
                    continue
                if contains(box, bounds):
                    reasons.append(f"a drawing part {where} is wholly under a box")
                elif not isinstance(part, (LTRect, LTLine)):
                    reasons.append(f"a drawing part {where} is partly under a box and is not a single rectangle or line")
    return reasons


def present(output: bytes, text: str) -> list[str]:
    return [] if squash(text) in squash(extract_text(io.BytesIO(output))) else [f"{text!r} is not in the output's text layer"]


def metadata(output: bytes) -> list[str]:
    reasons = []
    document = PDFDocument(PDFParser(io.BytesIO(output)))
    # An encrypted output hides its streams from the raw-bytes scan in `absent`.
    if document.encryption is not None:
        reasons.append("the output is encrypted")
    if any(info for info in document.info):
        reasons.append("the output has an Info dictionary")
    if "Metadata" in document.catalog:
        reasons.append("the output's catalog has XMP Metadata")
    if any(re.search(r"/Type\s*/Metadata|<x:xmpmeta", text) for text in raw.texts(output)):
        reasons.append("the output holds an XMP metadata stream")
    revisions = output.count(b"startxref")
    if revisions != 1 or output.count(b"%%EOF") != 1:
        reasons.append(f"the output has {revisions} revisions, not 1")
    return reasons


def covered(source: bytes, output: bytes, word: str) -> list[str]:
    index, box = find_word(source, word)
    fills = [item for item in walk(pages(output)[index]) if isinstance(item, LTCurve) and item.fill]
    if any(contains(fill.bbox, box) for fill in fills):
        return []
    return [f"no filled box in the output covers {word!r} at {tuple(round(v, 1) for v in box)}"]


def positions(source: bytes, output: bytes, words: list[str]) -> list[str]:
    removed = [find_word(source, word) for word in words]
    reasons = []
    for index, (before, after) in enumerate(zip(pages(source), pages(output), strict=True)):
        kept = [(g.get_text(), g.bbox) for g in chars(after)]
        for glyph in chars(before):
            if not glyph.get_text().strip():
                continue
            if any(page == index and overlaps(glyph.bbox, box) for page, box in removed):
                continue
            if not any(text == glyph.get_text() and all(abs(a - b) <= TOLERANCE for a, b in zip(bbox, glyph.bbox))
                       for text, bbox in kept):
                reasons.append(f"{glyph.get_text()!r} on page {index + 1} moved or went missing")
    return reasons


MODES = {1: "L", 3: "RGB", 4: "CMYK"}
# With the short names an inline image may use.
DEVICE_COMPONENTS = {"DeviceGray": 1, "DeviceRGB": 3, "DeviceCMYK": 4, "G": 1, "RGB": 3, "CMYK": 4}
# An inline image's dictionary may use short keys.
INLINE_KEYS = {"W": "Width", "H": "Height", "CS": "ColorSpace", "BPC": "BitsPerComponent", "IM": "ImageMask"}


def components(space: object) -> int:
    """The number of components of a device or ICC-based colour space."""
    space = resolve1(space)
    if isinstance(space, list) and resolve1(space[0]).name == "ICCBased":
        return resolve1(space[1]).attrs["N"]
    return DEVICE_COMPONENTS[space.name]


def colour_image(space: object, bits: int, size: tuple[int, int], data: bytes) -> Image.Image:
    """An image's samples in its colour space, as a Pillow image."""
    space = resolve1(space)
    family = resolve1(space[0]).name if isinstance(space, list) else None
    if bits == 1 and family is None and components(space) == 1:
        # One bit a pixel, rows padded to a byte, as Pillow's "1" mode packs them.
        return Image.frombytes("1", size, data)
    if bits != 8:
        raise LookupError(f"only 8-bit images are read, not {bits}-bit")
    if family == "Indexed":
        base, lookup = resolve1(space[1]), resolve1(space[3])
        table = lookup.get_data() if hasattr(lookup, "get_data") else lookup
        n = components(base)
        return Image.frombytes(MODES[n], size, b"".join(table[i * n:(i + 1) * n] for i in data))
    if family == "Separation":
        alternate, tint = resolve1(space[2]), resolve1(space[3])
        # Only the exponential tint transform (type 2): C0 + t^N (C1 - C0).
        if resolve1(tint["FunctionType"]) != 2:
            raise LookupError("only a type 2 tint transform is read")
        c0, c1, n = resolve1(tint["C0"]), resolve1(tint["C1"]), resolve1(tint["N"])
        values = bytes(round(255 * (a + (t / 255) ** n * (b - a))) for t in data for a, b in zip(c0, c1))
        return Image.frombytes(MODES[components(alternate)], size, values)
    return Image.frombytes(MODES[components(space)], size, data)


Matrix = tuple[float, float, float, float, float, float]


def placed_images(pdf: bytes) -> list[tuple[Matrix, LTImage]]:
    """Every image drawn in the file, each with the matrix that places its unit square on the page."""
    return [(item.matrix, child) for page in pages(pdf) for item in walk(page)
            if isinstance(item, LTFigure) for child in item if isinstance(child, LTImage)]


def image_of(pdf: bytes, mask: bool = False, at: Box | None = None) -> tuple[Matrix, Image.Image]:
    """The image drawn over `at`, or the file's one image, and its matrix; with `mask`, its soft mask (SMask)."""
    found = placed_images(pdf)
    if at is not None:
        found = [(matrix, item) for matrix, item in found if all(abs(a - b) <= TOLERANCE for a, b in zip(item.bbox, at))]
    if len(found) != 1:
        raise LookupError(f"expected one image, found {len(found)}")
    matrix, item = found[0]
    stream = resolve1(item.stream.attrs["SMask"]) if mask else item.stream
    attrs = {INLINE_KEYS.get(key, key): value for key, value in stream.attrs.items()}
    size = (resolve1(attrs["Width"]), resolve1(attrs["Height"]))
    filters = stream.get_filters()
    if any(name.name in ("DCTDecode", "DCT") for name, _ in filters):
        picture = Image.open(io.BytesIO(stream.get_rawdata()))
    elif resolve1(attrs.get("ImageMask", False)):
        # A stencil mask has no colour space: one bit a pixel, where to paint.
        picture = Image.frombytes("1", size, stream.get_data())
    else:
        picture = colour_image(attrs["ColorSpace"], resolve1(attrs.get("BitsPerComponent", 8)), size, stream.get_data())
    return matrix, picture.convert("RGB")


def pixel_box(matrix: Matrix, x: int, y: int, size: tuple[int, int]) -> Box:
    """Where pixel (x, y) lands on the page. An image's first row is at the top of its unit square."""
    a, b, c, d, e, f = matrix
    width, height = size
    corners = [(u / width, 1 - v / height) for u in (x, x + 1) for v in (y, y + 1)]
    xs = [a * u + c * v + e for u, v in corners]
    ys = [b * u + d * v + f for u, v in corners]
    return min(xs), min(ys), max(xs), max(ys)


def differs(before: tuple[int, ...], after: tuple[int, ...]) -> bool:
    return max(abs(a - b) for a, b in zip(before, after)) > 8


def pixels(source: bytes, output: bytes, region: Box, mask: bool = False, at: Box | None = None) -> list[str]:
    """Pixels wholly inside `region` are one colour; pixels wholly outside it are unchanged.

    With `mask`, the image's soft mask is judged instead: a shape can live in the mask alone.
    With `at`, the image drawn over that box is judged, where a file draws several."""
    matrix, before = image_of(source, mask, at)
    _, after = image_of(output, mask, at)
    if after.size != before.size:
        after = after.resize(before.size)
    width, height = before.size
    inside, changed = set(), 0
    for y in range(height):
        for x in range(width):
            pixel = pixel_box(matrix, x, y, before.size)
            if contains(region, pixel):
                inside.add(after.getpixel((x, y)))
            elif not overlaps(region, pixel) and differs(before.getpixel((x, y)), after.getpixel((x, y))):
                changed += 1
    reasons = []
    if len(inside) != 1:
        reasons.append(f"the image under the box still has {len(inside)} colours")
    if changed:
        reasons.append(f"{changed} image pixels outside the box changed")
    return reasons


def renders(pdf: bytes) -> list[Image.Image]:
    """Each page as PDFium draws it for printing, annotations and form fields included, at 72 dpi."""
    document = pypdfium2.PdfDocument(pdf)
    # Without its form environment PDFium draws no form field.
    document.init_forms()
    return [page.render(scale=1, draw_annots=True, optimize_mode="print").to_pil().convert("RGB") for page in document]


def rendered(source: bytes, output: bytes, exceptions: list[dict]) -> list[str]:
    """Every page looks as it did, within 8 levels a channel, outside the `exceptions`.

    An exception is `{"page": n, "box": [x0, y0, x1, y1]}`: a 1-based page and a box in points
    from the drawn page's bottom-left corner."""
    before, after = renders(source), renders(output)
    if len(before) != len(after):
        return [f"the output has {len(after)} pages, not {len(before)}"]
    reasons = []
    for number, (old, new) in enumerate(zip(before, after, strict=True), start=1):
        if old.size != new.size:
            reasons.append(f"page {number} is drawn at {new.size}, not {old.size}")
            continue
        changed = ImageChops.difference(old, new).point(lambda level: 255 if level > 8 else 0).convert("L")
        changed = changed.point(lambda level: 255 if level else 0)
        height = old.size[1]
        for exception in exceptions:
            if exception["page"] == number:
                x0, y0, x1, y1 = exception["box"]
                changed.paste(0, (int(x0), int(height - y1), int(x1) + 1, int(height - y0) + 1))
        count = changed.histogram()[255]
        if count:
            reasons.append(f"{count} pixels of page {number} are drawn differently")
    return reasons


def unchanged(source: bytes, output: bytes, at: Box) -> list[str]:
    """The image drawn over `at` looks as it did."""
    _, before = image_of(source, at=at)
    _, after = image_of(output, at=at)
    if after.size != before.size:
        return [f"the image at {at} changed size"]
    width, height = before.size
    changed = sum(differs(before.getpixel((x, y)), after.getpixel((x, y))) for y in range(height) for x in range(width))
    return [f"{changed} pixels of the image at {at} changed"] if changed else []


IMAGE_FILTERS = ("DCTDecode", "JPXDecode")


# The lossless filters that can sit before an image filter, undone with pdfminer's decoders
# (review answer 5). Flate's predictor is not undone: a predicted JPEG is judged unreadable.
UNDO = {"FlateDecode": zlib.decompress, **raw.DECODERS}


def image_streams(pdf: bytes) -> Iterator[tuple[int, str, bytes | None]]:
    """Every JPEG or JPEG 2000 image stream in the file, by object number: its image filter and its
    encoded bytes, with the lossless filters before it undone; None for the bytes when another
    filter follows the image filter, or one before it is not lossless, so they can't be read as an image."""
    document = PDFDocument(PDFParser(io.BytesIO(pdf)))
    seen = set()
    for xref in document.xrefs:
        for number in xref.get_objids():
            if number in seen:
                continue
            seen.add(number)
            try:
                stream = document.getobj(number)
            except Exception:
                continue
            if not isinstance(stream, PDFStream):
                continue
            # MuPDF reads an inline image's abbreviated /F on any stream too.
            filters = resolve1(stream.attrs.get("Filter", stream.attrs.get("F")))
            if not isinstance(filters, (list, PSLiteral)):
                filters = None
            names = [resolve1(f).name for f in (filters if isinstance(filters, list) else [filters] if filters else [])]
            names = [FULL_NAMES.get(name, name) for name in names if isinstance(name, str)]
            found = [name for name in names if name in IMAGE_FILTERS]
            if not found:
                continue
            if names[-1] not in IMAGE_FILTERS:
                yield number, found[0], None
                continue
            data = stream.rawdata
            for name in names[:-1]:
                if name not in UNDO:
                    yield number, names[-1], None
                    break
                data = UNDO[name](data)
            else:
                yield number, names[-1], data


def jpeg_metadata(data: bytes) -> list[str]:
    """What a JPEG holds besides its image: APPn segments other than Adobe's APP14, comments, and bytes after its end."""
    found = []
    at = 2
    while at + 2 <= len(data):
        if data[at] != 0xFF:
            return found + ["its markers can't be walked"]
        marker = data[at + 1]
        if marker == 0xFF:
            at += 1
            continue
        if marker == 0xD9:
            if at + 2 < len(data):
                found.append(f"{len(data) - at - 2} bytes after its end")
            return found
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            at += 2
            continue
        length = int.from_bytes(data[at + 2 : at + 4], "big")
        body = data[at + 4 : at + 2 + length]
        # Adobe's APP14 draws the image only as its 12 bytes: "Adobe", a version, two flags, a transform.
        if 0xE0 <= marker <= 0xEF:
            if not (marker == 0xEE and body.startswith(b"Adobe") and length == 14):
                found.append(f"an APP{marker - 0xE0} segment")
        elif marker == 0xFE:
            found.append("a comment segment")
        elif 0xF0 <= marker <= 0xFD:
            found.append(f"a JPG{marker - 0xF0} segment")
        elif not (0xC0 <= marker <= 0xCF and marker != 0xC8 or 0xDA <= marker <= 0xDF):
            found.append(f"an unknown marker 0x{marker:02X}")
        at += 2 + length
        if marker == 0xDA:
            while at < len(data) and not (data[at] == 0xFF and data[at + 1 : at + 2] not in (b"\x00", *(bytes([m]) for m in range(0xD0, 0xD8)))):
                at += 1
    return found + ["no end-of-image marker"]


def codestream_comments(data: bytes) -> list[str]:
    """Comment (COM) marker segments in a J2K codestream's main header and each tile-part's header."""
    found, at = [], 2
    while at + 4 <= len(data):
        marker = int.from_bytes(data[at : at + 2], "big")
        if marker == 0xFFD9:
            break
        if marker == 0xFF90:
            # A tile-part: Psot counts from SOT; its header runs to SOD, then data to its end.
            psot = int.from_bytes(data[at + 6 : at + 10], "big")
            end = len(data) - 2 if psot == 0 else at + psot
            inner = at + 12
            while inner + 4 <= end and int.from_bytes(data[inner : inner + 2], "big") != 0xFF93:
                if int.from_bytes(data[inner : inner + 2], "big") == 0xFF64:
                    found.append("a codestream comment")
                inner += 2 + int.from_bytes(data[inner + 2 : inner + 4], "big")
            at = end
            continue
        if marker == 0xFF64:
            found.append("a codestream comment")
        at += 2 + int.from_bytes(data[at + 2 : at + 4], "big")
    if int.from_bytes(data[at : at + 2], "big") == 0xFFD9 and len(data) > at + 2:
        found.append(f"{len(data) - at - 2} bytes after its end of codestream")
    return found


JP2_KEPT = {b"jP  ", b"ftyp", b"jp2h", b"jp2c"}
JP2H_KEPT = {b"ihdr", b"colr", b"bpcc", b"pclr", b"cmap", b"cdef"}


def boxes(data: bytes) -> Iterator[tuple[bytes, bytes]]:
    at = 0
    while at + 8 <= len(data):
        size, kind = int.from_bytes(data[at : at + 4], "big"), data[at + 4 : at + 8]
        start = at + 8
        if size == 1:
            size, start = int.from_bytes(data[at + 8 : at + 16], "big"), at + 16
        end = len(data) if size == 0 else at + size
        # A box shorter than its own header can't be walked past; what follows is not read.
        if end < start:
            return
        yield kind, data[start:end]
        at = end


def jpx_metadata(data: bytes) -> list[str]:
    """What a JPEG 2000 image holds besides its image: boxes other than those that draw it, and codestream comments."""
    if data.startswith(b"\xff\x4f"):
        return codestream_comments(data)
    found = []
    if sum(1 for kind, _ in boxes(data) if kind == b"jp2c") > 1:
        found.append("a second 'jp2c' box")
    for kind, body in boxes(data):
        if kind not in JP2_KEPT:
            found.append(f"a {kind.decode('latin-1')!r} box")
        elif kind == b"jp2h":
            found += [f"a {inner.decode('latin-1')!r} box in its header" for inner, _ in boxes(body) if inner not in JP2H_KEPT]
        elif kind == b"jp2c":
            found += codestream_comments(body)
    return found


def image_metadata(output: bytes) -> list[str]:
    """No JPEG or JPEG 2000 image in the output holds metadata in its own data."""
    reasons = []
    for number, kind, data in image_streams(output):
        if data is None:
            reasons.append(f"image object {number} has a filter after {kind}, or one before it that is not lossless, so its image data can't be judged")
            continue
        found = jpeg_metadata(data) if kind == "DCTDecode" else jpx_metadata(data)
        reasons += [f"image object {number} holds {each}" for each in found]
    return reasons
