"""The checks. Each returns a list of reasons it failed; an empty list is a pass.

Coordinates are PDF user space as pdfminer lays a page out: points, origin
bottom-left, page rotation applied the way pdfminer applies it. Input and output
are always read the same way, so a check never depends on the app's box convention.
"""

import io
import re
from collections.abc import Iterator

from pdfminer.high_level import extract_pages, extract_text
from pdfminer.layout import LTChar, LTComponent, LTCurve, LTFigure, LTImage, LTLayoutContainer, LTPage
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfparser import PDFParser
from pdfminer.pdftypes import resolve1
import pypdfium2
from PIL import Image, ImageChops

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
    """Each page as PDFium draws it for printing, annotations included, at 72 dpi."""
    document = pypdfium2.PdfDocument(pdf)
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
