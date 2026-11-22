"""The checks. Each returns a list of reasons it failed; an empty list is a pass.

Coordinates are PDF user space as pdfminer lays a page out: points, origin
bottom-left, page rotation applied the way pdfminer applies it. Input and output
are always read the same way, so a check never depends on the app's box convention.
"""

import io
import re
from collections.abc import Iterator

from pdfminer.high_level import extract_pages, extract_text
from pdfminer.layout import LTChar, LTComponent, LTCurve, LTImage, LTLayoutContainer, LTPage
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfparser import PDFParser
from pdfminer.pdftypes import resolve1
from PIL import Image

from . import raw

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


def colour_mode(space: object) -> str:
    """The Pillow mode for a device or ICC-based colour space, by its number of components."""
    space = resolve1(space)
    if isinstance(space, list) and resolve1(space[0]).name == "ICCBased":
        components = resolve1(space[1]).attrs["N"]
    else:
        components = {"DeviceRGB": 3, "DeviceGray": 1}[space.name]
    return {3: "RGB", 1: "L"}[components]


def image_of(pdf: bytes, mask: bool = False) -> tuple[Box, Image.Image]:
    """The page's one image and where it is drawn, or with `mask` its soft mask (SMask)."""
    found = [item for page in pages(pdf) for item in walk(page) if isinstance(item, LTImage)]
    if len(found) != 1:
        raise LookupError(f"expected one image, found {len(found)}")
    item = found[0]
    stream = resolve1(item.stream.attrs["SMask"]) if mask else item.stream
    attrs = stream.attrs
    size = (resolve1(attrs["Width"]), resolve1(attrs["Height"]))
    filters = stream.get_filters()
    if any(name.name == "DCTDecode" for name, _ in filters):
        picture = Image.open(io.BytesIO(stream.get_rawdata()))
    else:
        mode = colour_mode(attrs["ColorSpace"])
        # One bit a pixel, rows padded to a byte, as Pillow's "1" mode packs them.
        if mode == "L" and resolve1(attrs.get("BitsPerComponent", 8)) == 1:
            mode = "1"
        picture = Image.frombytes(mode, size, stream.get_data())
    return item.bbox, picture.convert("RGB")


def pixels(source: bytes, output: bytes, region: Box, mask: bool = False) -> list[str]:
    """Pixels wholly inside `region` are one colour; pixels wholly outside it are unchanged.

    With `mask`, the image's soft mask is judged instead: a shape can live in the mask alone."""
    bbox, before = image_of(source, mask)
    _, after = image_of(output, mask)
    if after.size != before.size:
        after = after.resize(before.size)
    width, height = before.size
    sx, sy = (bbox[2] - bbox[0]) / width, (bbox[3] - bbox[1]) / height
    inside, changed = set(), 0
    for y in range(height):
        for x in range(width):
            pixel = (bbox[0] + x * sx, bbox[3] - (y + 1) * sy, bbox[0] + (x + 1) * sx, bbox[3] - y * sy)
            if contains(region, pixel):
                inside.add(after.getpixel((x, y)))
            elif not overlaps(region, pixel):
                if max(abs(a - b) for a, b in zip(before.getpixel((x, y)), after.getpixel((x, y)))) > 8:
                    changed += 1
    reasons = []
    if len(inside) != 1:
        reasons.append(f"the image under the box still has {len(inside)} colours")
    if changed:
        reasons.append(f"{changed} image pixels outside the box changed")
    return reasons
