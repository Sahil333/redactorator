"""Writes the phase 1 fixture PDFs into fixtures/ by hand, byte by byte.

Every fixture is synthetic. Each builder can also write a "cleaned" variant, made
the way a correct redaction should come out, which the checker's own tests use to
show that each check passes on a clean file and fails on an unclean one.

Run: uv run --project tests/oracle python tests/oracle/make_fixtures.py
"""

import base64
import zlib
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"

# Helvetica advance widths (AFM, 1/1000 em) for the characters the fixtures mark.
HELVETICA = {" ": 278, ",": 278, "a": 556, "e": 556, "n": 556, "o": 556, "k": 500, "w": 722,
             "r": 333, "D": 722, "J": 500, "R": 722, "O": 778, "A": 667, "c": 500, "u": 556,
             "t": 278, "h": 556, "l": 222, "d": 556, ":": 278, "m": 833,
             "T": 611, "g": 556, "H": 722, "P": 667, "i": 222, "C": 722, "p": 556, "L": 556, "y": 500,
             "F": 611, "S": 667, "b": 556, **{digit: 556 for digit in "0123456789"}}


def width(text: str, size: float) -> float:
    return sum(HELVETICA[c] for c in text) * size / 1000


def stream(entries: str, data: bytes, compress: bool = False) -> bytes:
    if compress:
        data = zlib.compress(data)
        entries += " /Filter /FlateDecode"
    return b"<< " + entries.encode() + b" /Length %d >>\nstream\n" % len(data) + data + b"\nendstream"


def write_pdf(objects: list[bytes], trailer: str) -> bytes:
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d %s >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, trailer.encode(), xref)
    return bytes(out)


def append_revision(pdf: bytes, number: int, body: bytes, size: int, trailer: str) -> bytes:
    """An incremental update that replaces object `number`, as an editor saving in place would."""
    previous = int(pdf.rsplit(b"startxref", 1)[1].split()[0])
    out = bytearray(pdf)
    offset = len(out)
    out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 1\n0000000000 65535 f \n%d 1\n%010d 00000 n \n" % (number, offset)
    out += b"trailer\n<< /Size %d /Prev %d %s >>\nstartxref\n%d\n%%%%EOF\n" % (size, previous, trailer.encode(), xref)
    return bytes(out)


def page_objects(page: str, content: bytes, resources: str = "/Font << /F1 4 0 R >>") -> list[bytes]:
    """Objects 1 to 5: catalog, pages, the page, Helvetica, and the page's content."""
    return [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R {page} /Resources << {resources} >> /Contents 5 0 R >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        content,
    ]


def line(x: float, y: float, size: float, text: str) -> str:
    return f"BT /F1 {size} Tf {x} {y} Td ({text}) Tj ET\n"


def cleaned_line(x: float, y: float, size: float, before: str, word: str, after: str) -> str:
    """The line with `word` deleted, the rest kept in place, and a filled box where it was."""
    left = x + width(before, size)
    box = f"0 g {left:.2f} {y - 0.3 * size:.2f} {width(word, size):.2f} {1.3 * size:.2f} re f\n"
    gap = sum(HELVETICA[c] for c in word)
    return f"BT /F1 {size} Tf {x} {y} Td [({before}) -{gap} ({after})] TJ ET\n" + box


# one-word.pdf: "Jane Roe" once in the page text, between neighbours on its line,
# and again in Info, in XMP and in an incremental update of Info.
ONE_WORD_LINES = [(72, 700, 12, "Claim reference 7731, for the attention of the claimant."),
                  (72, 660, 12, "We will reply within ten working days.")]
ONE_WORD = ("Dear ", "Jane Roe", ", thank you for writing to us.")
XMP = (b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
       b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
       b'<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Jane Roe</rdf:li>'
       b'</rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>')


def one_word(cleaned: bool = False) -> bytes:
    text = "".join(line(*spec) for spec in ONE_WORD_LINES)
    text += cleaned_line(72, 680, 12, *ONE_WORD) if cleaned else line(72, 680, 12, "".join(ONE_WORD))
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", text.encode(), compress=True))
    if cleaned:
        return write_pdf(objects, "/Root 1 0 R")
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R /Metadata 7 0 R >>"
    objects.append(b"<< /Title (Letter to Jane Roe) /Author (Jane Roe) >>")
    objects.append(stream("/Type /Metadata /Subtype /XML", XMP))
    pdf = write_pdf(objects, "/Root 1 0 R /Info 6 0 R")
    return append_revision(pdf, 6, b"<< /Title (Letter to Jane Roe, revised) /Author (Jane Roe) >>",
                           len(objects) + 1, "/Root 1 0 R /Info 6 0 R")


# tj-strings.pdf: one-word.pdf's lines, with the line holding "Jane Roe" drawn as a TJ array
# whose first string runs on past the name, and a kerning number later in the line. Removing a
# word from the middle of a TJ string must leave the rest of the line where it was.
def tj_strings() -> bytes:
    text = "".join(line(*spec) for spec in ONE_WORD_LINES)
    text += f"BT /F1 12 Tf 72 680 Td [({''.join(ONE_WORD)[:-11]}) 20 ({''.join(ONE_WORD)[-11:]})] TJ ET\n"
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", text.encode(), compress=True)), "/Root 1 0 R")


# image.pdf: a 64 x 48 RGB image drawn at user space [100 400 356 592], 4 points a pixel.
IMAGE_SIZE = (64, 48)
IMAGE_RECT = (100, 400, 356, 592)
# The half a test blanks: the image's left 32 pixel columns, user space [100 400 228 592].
IMAGE_BLANKED = (100, 400, 228, 592)


def image_pixels(blank_left_columns: int = 0) -> bytes:
    w, h = IMAGE_SIZE
    return bytes(
        value
        for y in range(h)
        for x in range(w)
        for value in ((0, 0, 0) if x < blank_left_columns else (x * 4, y * 5, 128 + (x + y) % 64))
    )


def image(cleaned: bool = False) -> bytes:
    x0, y0, x1, y1 = IMAGE_RECT
    content = line(100, 620, 14, "Applicant photograph") + f"q {x1 - x0} 0 0 {y1 - y0} {x0} {y0} cm /Im1 Do Q\n"
    pixels = image_pixels(32 if cleaned else 0)
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()),
                           "/Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >>")
    w, h = IMAGE_SIZE
    objects.append(stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} "
                          "/ColorSpace /DeviceRGB /BitsPerComponent 8", pixels, compress=True))
    return write_pdf(objects, "/Root 1 0 R")


# rotated-cropped.pdf: /Rotate 90 and a CropBox inset 36 points from the MediaBox.
ROTATED_LINES = [(100, 470, 14, "Sort code 40-12-77")]
ROTATED_WORD = ("Account holder: Amara ", "Okonkwo", "")


def rotated_cropped(cleaned: bool = False) -> bytes:
    text = "".join(line(*spec) for spec in ROTATED_LINES)
    text += cleaned_line(100, 500, 14, *ROTATED_WORD) if cleaned else line(100, 500, 14, "".join(ROTATED_WORD))
    objects = page_objects("/MediaBox [0 0 612 792] /CropBox [36 36 576 756] /Rotate 90", stream("", text.encode()))
    return write_pdf(objects, "/Root 1 0 R")


# cross-page.pdf: "Jane" ends page 1 and "Roe," starts page 2. Each page draws its running
# header after the body, as many generators do, and a page-number footer. Page 2 also has two
# short side-by-side columns, and page 3 closes the letter.
CROSS_PAGE_HEADER = (72, 760, 9, "Agreement 2026")
CROSS_PAGE = [
    [(72, 700, 12, "Claim reference 7731 for the claimant."), (72, 680, 12, "The agreement was signed by Jane")],
    [(72, 700, 12, "Roe, on behalf of the claimant."),
     (72, 640, 12, "Left column one"), (72, 625, 12, "Left column two"),
     (320, 640, 12, "Right column one"), (320, 625, 12, "Right column two")],
    [(72, 700, 12, "Closing words of the claim.")],
]


def cross_page() -> bytes:
    contents = []
    for number, body in enumerate(CROSS_PAGE, start=1):
        text = "".join(line(*spec) for spec in body) + line(*CROSS_PAGE_HEADER) + line(72, 40, 9, f"Page {number} of 3")
        contents.append(stream("", text.encode()))
    page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents %d 0 R >>"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
        (page % 7).encode(),
        (page % 8).encode(),
        (page % 9).encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        *contents,
    ]
    return write_pdf(objects, "/Root 1 0 R")


def mask_pixels(blank_left_columns: int = 0) -> bytes:
    """A filled circle: the shape a soft mask can carry on its own, like a signature's."""
    w, h = IMAGE_SIZE
    return bytes(255 if x < blank_left_columns or (x - 24) ** 2 + (y - 24) ** 2 < 18 ** 2 else 0
                 for y in range(h) for x in range(w))


def masked_image(cleaned: bool = False) -> bytes:
    """image.pdf's image and place, with a soft mask whose circle crosses the left half."""
    x0, y0, x1, y1 = IMAGE_RECT
    content = line(100, 620, 14, "Applicant signature") + f"q {x1 - x0} 0 0 {y1 - y0} {x0} {y0} cm /Im1 Do Q\n"
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()),
                           "/Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >>")
    w, h = IMAGE_SIZE
    objects.append(stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} "
                          "/ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 7 0 R",
                          image_pixels(32 if cleaned else 0), compress=True))
    objects.append(stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} "
                          "/ColorSpace /DeviceGray /BitsPerComponent 8", mask_pixels(32 if cleaned else 0), compress=True))
    return write_pdf(objects, "/Root 1 0 R")


# table.pdf: a two-column table drawn row by row, so reading order runs across each row
# before the next. Text above and below it starts left of the table's cells, and one cell
# ends with a short line, as in real documents.
TABLE = [("Engagement", ["Design and build"]),
         ("Duration", ["Three months from the start,", "in four parts"]),
         ("Monthly fee", ["Fifty thousand rupees each month"])]


# long.pdf: nine pages with one line each, for tests that scroll through more pages than the
# app keeps drawn at full detail.
LONG_PAGES = 9


def long_document() -> bytes:
    first_content = 3 + LONG_PAGES + 1
    page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
    kids = " ".join(f"{3 + n} 0 R" for n in range(LONG_PAGES))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {LONG_PAGES} >>".encode(),
        *[(page % (3 + LONG_PAGES, first_content + n)).encode() for n in range(LONG_PAGES)],
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        *[stream("", line(72, 700, 12, f"Page {n + 1} of {LONG_PAGES}").encode()) for n in range(LONG_PAGES)],
    ]
    return write_pdf(objects, "/Root 1 0 R")


def table() -> bytes:
    text = line(64, 730, 12, "Terms of the engagement")
    for row, (left, right) in enumerate(TABLE):
        y = 700 - 32 * row
        text += line(72, y, 12, left) + "".join(line(320, y - 14 * n, 12, part) for n, part in enumerate(right))
    text += line(64, 590, 12, "Fees are payable monthly.")
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", text.encode())), "/Root 1 0 R")


# letter-a.pdf and letter-b.pdf: two letters in one project, naming the same person and account.
# B writes them in other case, spacing, line breaks and number grouping, and has "Monroe", which
# "Roe" must not match, and "91234 5678", which "1234 5678" must not match.
LETTER_A = [(700, "Jane Roe wrote to us about the claim."), (680, "1234 5678 is the account she named."),
            (660, "Roe signed the form in person."), (640, "We will reply within ten working days.")]
LETTER_B = [(700, "Statement by JANE  ROE about the claim."),
            (680, "Her account 1234-5678 was closed, and 1234.5678 too."),
            (660, "She lives on Monroe Street."), (640, "The form was signed by Jane"), (626, "Roe in person."),
            (600, "Ref 91234 5678 is not hers.")]


def letter_text(lines: list[tuple[int, str]]) -> str:
    return "".join(line(72, y, 12, words) for y, words in lines)


def letter(lines: list[tuple[int, str]]) -> bytes:
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", letter_text(lines).encode())), "/Root 1 0 R")


# line-feed-glyph.pdf: a font that names byte 10's glyph uni000A, so a line break is drawn as a
# glyph with a box, as some typesetters do. It follows "Jane Roe" on one line.
LINE_FEED = [(700, "Dear Jane Roe\\n thank you for writing to us."), (680, "We will reply within ten working days.")]


def line_feed_glyph() -> bytes:
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", letter_text(LINE_FEED).encode()))
    objects[3] = (b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding"
                  b" << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [10 /uni000A] >> >>")
    return write_pdf(objects, "/Root 1 0 R")


# logo-a.pdf and logo-b.pdf: one logo, drawn whole in A and copied about B, for spreading a box
# over part of an image. B draws the same pixels at half size and again a quarter turned, a
# copy re-saved as a JPEG, and a different image of the same size. It also draws the logo off the
# page, where it shows nothing and so gets no box.
LOGO_SIZE = (96, 64)
LOGO_A = (100, 500, 388, 692)
LOGO_B_HALF = "144 0 0 96 100 550"
LOGO_B_TURNED = "0 144 -96 0 400 550"
LOGO_B_RESAVED = (100, 250, 388, 442)
LOGO_B_OTHER = (420, 300, 564, 396)


# The left 90% of the logo, 86.4 of its 96 columns, as a box spread from A blanks it: every
# column the box touches.
LOGO_BLANKED_COLUMNS = 87


def logo_pixels(other: bool = False, blank_left_columns: int = 0) -> bytes:
    """Red rings and a bar on cream; with `other`, red diagonal stripes and a band instead."""
    w, h = LOGO_SIZE

    def red(x: int, y: int) -> bool:
        if other:
            return (x + y) % 16 < 8 or 20 < y < 30
        return int(((x - 30) ** 2 + (y - 32) ** 2) ** 0.5 / 6) % 2 == 0 or (60 < x < 88 and 12 < y < 52)

    def colour(x: int, y: int) -> tuple[int, int, int]:
        if x < blank_left_columns:
            return (0, 0, 0)
        return (200, 30, 40) if red(x, y) else (240, 240, 230)

    return bytes(value for y in range(h) for x in range(w) for value in colour(x, y))


def logo_jpeg() -> bytes:
    import io

    from PIL import Image

    out = io.BytesIO()
    # Without chroma subsampling, so Pillow and MuPDF decode it to the same pixels.
    Image.frombytes("RGB", LOGO_SIZE, logo_pixels()).save(out, "JPEG", quality=75, subsampling=0)
    return out.getvalue()


def image_stream(pixels: bytes, size: tuple[int, int] = LOGO_SIZE) -> bytes:
    return stream(f"/Type /XObject /Subtype /Image /Width {size[0]} /Height {size[1]} "
                  "/ColorSpace /DeviceRGB /BitsPerComponent 8", pixels, compress=True)


def placed(rect: tuple[int, int, int, int]) -> str:
    x0, y0, x1, y1 = rect
    return f"{x1 - x0} 0 0 {y1 - y0} {x0} {y0}"


def logo_a() -> bytes:
    content = (line(100, 720, 14, "Acme Ltd") + f"q {placed(LOGO_A)} cm /Im1 Do Q\n"
               + line(100, 450, 12, "Reference 4471"))
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()),
                           "/Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >>")
    objects.append(image_stream(logo_pixels()))
    return write_pdf(objects, "/Root 1 0 R")


def logo_b(cleaned: bool = False) -> bytes:
    """With `cleaned`, the shared logo's left 90% is blanked, as at both its places."""
    content = (line(100, 720, 14, "Acme Ltd invoice") + f"q {LOGO_B_HALF} cm /Im1 Do Q\nq {LOGO_B_TURNED} cm /Im1 Do Q\n"
               + f"q {placed(LOGO_B_RESAVED)} cm /Im2 Do Q\nq {placed(LOGO_B_OTHER)} cm /Im3 Do Q\n"
               + "q 144 0 0 96 700 900 cm /Im1 Do Q\n")
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()),
                           "/Font << /F1 4 0 R >> /XObject << /Im1 6 0 R /Im2 7 0 R /Im3 8 0 R >>")
    w, h = LOGO_SIZE
    objects += [image_stream(logo_pixels(blank_left_columns=LOGO_BLANKED_COLUMNS if cleaned else 0)),
                stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB "
                       "/BitsPerComponent 8 /Filter /DCTDecode", logo_jpeg()),
                image_stream(logo_pixels(other=True))]
    return write_pdf(objects, "/Root 1 0 R")


# signatures.pdf: a signature drawn as a stencil mask (ImageMask), as scanned signatures often
# are, and a black logo whose shape lives in its soft mask; page 1 draws each whole, page 2 at
# half size elsewhere.
SIGNATURE_PAGE_1 = ("192 0 0 128 100 500", "192 0 0 128 100 200")
SIGNATURE_PAGE_2 = ("96 0 0 64 300 600", "96 0 0 64 300 300")


def signatures() -> bytes:
    w, h = LOGO_SIZE
    shape = logo_pixels()
    inked = [shape[i * 3] == 200 for i in range(w * h)]
    # One bit a pixel, rows padded to a byte; a 0 is painted.
    stencil = bytes(sum((0 if inked[y * w + x + bit] else 1) << (7 - bit) for bit in range(8))
                    for y in range(h) for x in range(0, w, 8))
    page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Sig 5 0 R /Logo 6 0 R >> >> /Contents %d 0 R >>"
    draw = "q 0 0 0.6 rg {} cm /Sig Do Q\nq {} cm /Logo Do Q\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        (page % 8).encode(),
        (page % 9).encode(),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /ImageMask true /BitsPerComponent 1", stencil, compress=True),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 7 0 R",
               bytes(w * h * 3), compress=True),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceGray /BitsPerComponent 8",
               bytes(255 if ink else 0 for ink in inked), compress=True),
        stream("", draw.format(*SIGNATURE_PAGE_1).encode()),
        stream("", draw.format(*SIGNATURE_PAGE_2).encode()),
    ]
    return write_pdf(objects, "/Root 1 0 R")


# unmatchable-images.pdf: two pages drawing the same three images, none of which a box spreads
# from: one over the whole page, as a scan does; a patterned one 24 pixels a side; and a plain one.
SCAN_SIZE = (102, 132)
TINY_SIZE = (24, 24)
PLAIN_SIZE = (64, 64)


def unmatchable_images() -> bytes:
    w, h = SCAN_SIZE
    scan = bytes(value for y in range(h) for x in range(w)
                 for value in ((40, 40, 40) if 10 < x < 92 and y % 12 < 3 else (250, 250, 250)))
    tiny = bytes(value for y in range(24) for x in range(24) for value in ((200, 30, 40) if (x + y) % 8 < 4 else (240, 240, 230)))
    plain = bytes(value for _ in range(64 * 64) for value in (180, 180, 180))
    page = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            "/Resources << /XObject << /Scan 5 0 R /Tiny 6 0 R /Plain 7 0 R >> >> /Contents 8 0 R >>")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        page.encode(),
        page.encode(),
        image_stream(scan, SCAN_SIZE),
        image_stream(tiny, TINY_SIZE),
        image_stream(plain, PLAIN_SIZE),
        stream("", b"q 612 0 0 792 0 0 cm /Scan Do Q\nq 96 0 0 96 100 600 cm /Tiny Do Q\nq 128 0 0 128 300 600 cm /Plain Do Q\n"),
    ]
    return write_pdf(objects, "/Root 1 0 R")


# image-spaces.pdf: one page of 32 x 24 images, 4 points a pixel, in the colour spaces image
# redaction converts each its own way: CMYK (blanked to 0, as it is subtractive), Indexed
# (blanked in its base RGB), Separation (blanked in CMYK, its alternate), and a 1 x 1 RGB image
# whose shape lives in a 32 x 24 soft mask, where redaction blanks the mask, not the image.
# Below them, a 32 x 24 RGB inline image.
SPACES_SIZE = (32, 24)
SPACES_RECTS = {"Cmyk": (100, 600, 228, 696), "Indexed": (300, 600, 428, 696),
                "Separation": (100, 400, 228, 496), "OnePixel": (300, 400, 428, 496)}
INLINE_RECT = (300, 200, 428, 296)
SEPARATION = "[/Separation /Spot /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 0.2 0] /N 1 >>]"
# Four colours, then white for a blanked pixel.
PALETTE = bytes([200, 30, 40, 30, 120, 200, 240, 200, 40, 20, 20, 20, 255, 255, 255])


def space_samples(space: str, blank_left_columns: int) -> bytes:
    """The samples of one image; with `blank_left_columns`, those columns are white in its space."""
    w, h = SPACES_SIZE

    def sample(x: int, y: int) -> tuple[int, ...]:
        blank = x < blank_left_columns
        if space == "Cmyk":
            return (0, 0, 0, 0) if blank else (x * 8, y * 10, 40 + (x + y) % 50, 20)
        if space == "Indexed":
            return (4,) if blank else ((x // 4 + y // 4) % 4,)
        if space == "Separation":
            return (0,) if blank else (40 + x * 6,)
        if space == "Inline":
            return (255, 255, 255) if blank else (x * 8, y * 10, 90)
        # The soft mask: opaque where blanked, as image redaction leaves a mask.
        return (255,) if blank else ((x * 7 + y * 11) % 256,)

    return bytes(value for y in range(h) for x in range(w) for value in sample(x, y))


def image_spaces(cleaned: bool = False) -> bytes:
    w, h = SPACES_SIZE
    blank = w // 2 if cleaned else 0
    content = "".join(f"q {placed(rect)} cm /{name} Do Q\n" for name, rect in SPACES_RECTS.items())
    content += (f"q {placed(INLINE_RECT)} cm BI /W {w} /H {h} /CS /RGB /BPC 8 /F /AHx ID "
                f"{space_samples('Inline', blank).hex()}> EI Q\n")
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()),
                           "/XObject << /Cmyk 6 0 R /Indexed 7 0 R /Separation 8 0 R /OnePixel 9 0 R >>")
    head = f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8"
    objects += [
        stream(f"{head} /ColorSpace /DeviceCMYK", space_samples("Cmyk", blank), compress=True),
        stream(f"{head} /ColorSpace [/Indexed /DeviceRGB 4 <{PALETTE.hex()}>]", space_samples("Indexed", blank), compress=True),
        stream(f"{head} /ColorSpace {SEPARATION}", space_samples("Separation", blank), compress=True),
        stream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB "
               "/SMask 10 0 R", bytes([30, 60, 160])),
        stream(f"{head} /ColorSpace /DeviceGray", space_samples("Mask", blank), compress=True),
    ]
    return write_pdf(objects, "/Root 1 0 R")


# marked-text.pdf: one account number a line, each inside a different construct that text
# redaction carries through the content filter: marked content with a property list, a marked
# point, a clip, a layer that is on, and a form XObject.
MARKED_LINES = [
    ("Tagged ", "4400 1111", " here", "/Span <</Lang (en-GB)>> BDC\n{}EMC\n"),
    ("Header ", "4400 2222", " here", "/Artifact BMC\n{}EMC\n"),
    ("Point ", "4400 3333", " here", "/Pt <</Note (n)>> DP /Pt MP\n{}"),
    ("Clipped ", "4400 4444", " here", "q 60 {clip} 420 30 re W n\n{}Q\n"),
    ("Layer ", "4400 5555", " here", "/OC /On BDC\n{}EMC\n"),
]
MARKED_FORM = ("Form ", "4400 6666", " here")
MARKED_TOP = 700


def marked_text(cleaned: bool = False) -> bytes:
    def drawn(y: int, before: str, value: str, after: str) -> str:
        return cleaned_line(72, y, 12, before, value, after) if cleaned else line(72, y, 12, before + value + after)

    content = ""
    for index, (before, value, after, wrap) in enumerate(MARKED_LINES):
        y = MARKED_TOP - 20 * index
        content += wrap.replace("{clip}", str(y - 10)).format(drawn(y, before, value, after))
    content += "q /Fm Do Q\n"
    form_y = MARKED_TOP - 20 * len(MARKED_LINES)
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()),
                           "/Font << /F1 4 0 R >> /XObject << /Fm 6 0 R >> /Properties << /On 7 0 R >>")
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R] /D << /ON [7 0 R] >> >> >>"
    objects += [
        stream("/Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >>",
               drawn(form_y, *MARKED_FORM).encode()),
        b"<< /Type /OCG /Name (On) >>",
    ]
    return write_pdf(objects, "/Root 1 0 R")


# layer-rules.pdf: content on layer rules (optional content membership dictionaries) over one
# layer that is on and one that is off. Page 1's rule is /AnyOff, which is met because one layer
# is off, so its line is shown. Page 2's rule is /AllOn, which is not met, so its line is hidden;
# page 2 also draws a line on no layer, above it.
LAYER_PAGE_TWO = (72, 740, 12, "Page two")
LAYER_SHOWN = ("Statement ", "4400 7777", " here")
LAYER_HIDDEN = ("Hidden ", "4400 8888", " here")


def layer_rules(cleaned: bool = False) -> bytes:
    shown = cleaned_line(72, 700, 12, *LAYER_SHOWN) if cleaned else line(72, 700, 12, "".join(LAYER_SHOWN))
    page = ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> "
            "/Properties << /Rule %d 0 R >> >> /Contents %d 0 R >>")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [8 0 R 9 0 R] /D << /ON [8 0 R] /OFF [9 0 R] >> >> >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        (page % (10, 6)).encode(),
        (page % (11, 7)).encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", f"/OC /Rule BDC\n{shown}EMC\n".encode()),
        stream("", f"{line(*LAYER_PAGE_TWO)}/OC /Rule BDC\n{line(72, 700, 12, ''.join(LAYER_HIDDEN))}EMC\n".encode()),
        b"<< /Type /OCG /Name (On) >>",
        b"<< /Type /OCG /Name (Off) >>",
        b"<< /Type /OCMD /OCGs [8 0 R 9 0 R] /P /AnyOff >>",
        b"<< /Type /OCMD /OCGs [8 0 R 9 0 R] /P /AllOn >>",
    ]
    return write_pdf(objects, "/Root 1 0 R")


# content-strings.pdf: values hidden in a page's content stream, where no reader shows them:
# marked-content properties (ActualText, Alt, E), a marked point's properties, an extra key in
# an inline image's dictionary, a comment, and the operand of an unknown operator inside BX/EX.
# The cleaned variant is the content as a correct clean writes it.
CONTENT_STRINGS = {"actual-text": "4400 9001", "alt": "4400 9002", "expansion": "4400 9003",
                   "point": "4400 9004", "inline-key": "4400 9005", "comment": "4400 9006",
                   "unknown-operand": "4400 9007"}


def content_strings(cleaned: bool = False) -> bytes:
    v = CONTENT_STRINGS

    def marked(tag: str, key: str, value: str) -> str:
        return f"/{tag} BMC\n" if cleaned else f"/{tag} <</{key} ({value})>> BDC\n"

    note = "" if cleaned else f" /Note ({v['inline-key']})"
    content = "".join([
        marked("Span", "ActualText", v["actual-text"]), line(72, 700, 12, "Shown line one"), "EMC\n",
        marked("Figure", "Alt", v["alt"]), "0 0 1 rg 72 640 40 20 re f\nEMC\n",
        marked("Span", "E", v["expansion"]), line(72, 600, 12, "Shown abbreviation"), "EMC\n",
        "/Pt MP\n" if cleaned else f"/Pt <</Note ({v['point']})>> DP\n",
        f"q 40 0 0 40 72 520 cm BI /W 2 /H 2 /CS /G /BPC 8{note} /F /AHx ID 00ff80c0> EI Q\n",
        "" if cleaned else f"% {v['comment']}\n",
        "BX EX\n" if cleaned else f"BX ({v['unknown-operand']}) Frob EX\n",
        line(72, 480, 12, "Shown line two"),
    ])
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", content.encode())), "/Root 1 0 R")


def encrypted() -> bytes:
    import io

    import pikepdf

    pdf = pikepdf.open(io.BytesIO(write_pdf(
        page_objects("/MediaBox [0 0 612 792]", stream("", line(72, 700, 12, "Sealed file").encode())),
        "/Root 1 0 R")))
    out = io.BytesIO()
    pdf.save(out, encryption=pikepdf.Encryption(user="sealed-user", owner="sealed-owner", R=6))
    return out.getvalue()


def edit_locked() -> bytes:
    """one-word.pdf locked against editing and copying by an owner password, with an empty
    password to open it: any reader opens it, and only asks apps to respect the lock."""
    import io

    import pikepdf

    pdf = pikepdf.open(io.BytesIO(one_word()))
    out = io.BytesIO()
    pdf.save(out, encryption=pikepdf.Encryption(
        user="", owner="locked-owner", R=4, aes=True,
        allow=pikepdf.Permissions(extract=False, modify_annotation=False, modify_assembly=False,
                                  modify_form=False, modify_other=False)))
    return out.getvalue()


# Preparation's fixtures (docs/designs/pdf-leak-suite.md, part 1): values held where preparation
# removes or rewrites them. Each value is 4400 9nnn, unique to its carrier, so the outside
# checker's `absent` names the one left behind. Where a value stays visible, as a flattened form
# value, the test marks it.


def appearance(bbox: tuple[int, int], content: str) -> bytes:
    """An annotation's normal appearance: a form XObject drawing `content` with Helvetica."""
    return stream(f"/Type /XObject /Subtype /Form /BBox [0 0 {bbox[0]} {bbox[1]}] /Resources << /Font << /F1 4 0 R >> >>",
                  content.encode())


def note(text: str) -> str:
    return f"BT /F1 12 Tf 4 10 Td ({text}) Tj ET"


# annotations.pdf: comments that show are flattened into the page; the rest are deleted first, as
# flattening would show them. Rects are user space.
ANNOTATIONS = {"shown": "4400 9101", "contents": "4400 9102", "author": "4400 9103", "hidden": "4400 9104",
               "no-view": "4400 9105", "off-layer": "4400 9106", "note": "4400 9107", "overlay": "4400 9108",
               "link": "4400 9109", "attachment": "4400 9110"}


def annotations() -> bytes:
    v = ANNOTATIONS
    free_text = "/Type /Annot /Subtype /FreeText /DA (/Helv 12 Tf 0 g)"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [20 0 R] /D << /OFF [20 0 R] >> >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> "
        b"/Contents 5 0 R /Annots [6 0 R 7 0 R 8 0 R 9 0 R 10 0 R 11 0 R 12 0 R 13 0 R 19 0 R] >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", line(72, 740, 12, "Notes page").encode()),
        f"<< {free_text} /Rect [72 600 300 630] /F 4 /Contents ({v['contents']}) /T (Author {v['author']}) /AP << /N 14 0 R >> >>".encode(),
        f"<< {free_text} /Rect [72 550 300 580] /F 2 /AP << /N 15 0 R >> >>".encode(),
        f"<< {free_text} /Rect [72 500 300 530] /F 32 /AP << /N 16 0 R >> >>".encode(),
        f"<< {free_text} /Rect [72 450 300 480] /F 4 /OC 20 0 R /AP << /N 17 0 R >> >>".encode(),
        f"<< /Type /Annot /Subtype /Text /Rect [320 600 340 620] /F 4 /Contents ({v['note']}) /Popup 11 0 R /AP << /N 18 0 R >> >>".encode(),
        b"<< /Type /Annot /Subtype /Popup /Rect [350 520 550 620] /Parent 10 0 R >>",
        f"<< /Type /Annot /Subtype /Redact /Rect [72 400 300 430] /OverlayText ({v['overlay']}) >>".encode(),
        f"<< /Type /Annot /Subtype /Link /Rect [72 734 150 752] /Border [0 0 0] /A << /S /URI /URI (https://example.invalid/{v['link']}) >> >>".encode(),
        appearance((228, 30), note(f"Note {v['shown']}")),
        appearance((228, 30), note(f"Hidden {v['hidden']}")),
        appearance((228, 30), note(f"NoView {v['no-view']}")),
        appearance((228, 30), note(f"Layer {v['off-layer']}")),
        appearance((20, 20), "1 1 0 rg 0 0 20 20 re f"),
        f"<< /Type /Annot /Subtype /FileAttachment /Rect [320 560 340 580] /F 4 /AP << /N 22 0 R >> "
        f"/FS << /Type /Filespec /F (a.txt) /EF << /F 21 0 R >> >> >>".encode(),
        b"<< /Type /OCG /Name (Off) >>",
        stream("/Type /EmbeddedFile", f"Attached {v['attachment']}".encode()),
        appearance((20, 20), "0 0 1 rg 0 0 20 20 re f"),
    ]
    return write_pdf(objects, "/Root 1 0 R")


# form.pdf: a filled text field, a hidden one, and a signed signature, as CUJs 1 and 2 have them.
FORM = {"tooltip": "4400 9201", "default": "4400 9202", "name": "4400 9203", "hidden": "4400 9204",
        "signer": "4400 9206", "stamp": "4400 9207", "certificate": "4400 9208"}


def form() -> bytes:
    v = FORM
    widget = "/Type /Annot /Subtype /Widget /P 3 0 R /DA (/F1 12 Tf 0 g)"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R 7 0 R 8 0 R] /DR << /Font << /F1 4 0 R >> >> "
        b"/DA (/F1 12 Tf 0 g) /SigFlags 3 >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> "
        b"/Contents 5 0 R /Annots [6 0 R 7 0 R 8 0 R] >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", line(72, 740, 12, "Client name:").encode()),
        f"<< {widget} /FT /Tx /T (client_name {v['name']}) /TU (Tooltip {v['tooltip']}) /DV ({v['default']}) /V (Jane Roe) "
        f"/Rect [160 734 360 754] /F 4 /AP << /N 9 0 R >> >>".encode(),
        f"<< {widget} /FT /Tx /T (hidden_field) /V ({v['hidden']}) /Rect [160 690 360 710] /F 2 /AP << /N 10 0 R >> >>".encode(),
        f"<< {widget} /FT /Sig /T (signature) /V 11 0 R /Rect [72 600 300 640] /F 4 /AP << /N 12 0 R >> >>".encode(),
        appearance((200, 20), "/Tx BMC BT /F1 12 Tf 2 6 Td (Jane Roe) Tj ET EMC"),
        appearance((200, 20), f"/Tx BMC BT /F1 12 Tf 2 6 Td ({v['hidden']}) Tj ET EMC"),
        f"<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (Signer {v['signer']}) "
        f"/M (D:20261125000000Z) /ByteRange [0 0 0 0] /Contents <{('Certificate ' + v['certificate']).encode().hex()}> >>".encode(),
        appearance((228, 40), f"BT /F1 12 Tf 4 14 Td (Signed {v['stamp']}) Tj ET"),
    ]
    return write_pdf(objects, "/Root 1 0 R")


# carriers.pdf: what the allowlist deletes from the catalog, the page and an image, and an earlier
# revision of the page's content.
CARRIERS = {"bookmark": "4400 9301", "embedded-file": "4400 9302", "javascript": "4400 9303", "named-destination": "4400_9304",
            "open-action": "4400 9305", "page-label": "4400 9306", "structure-alt": "4400 9307", "info": "4400 9308",
            "xmp": "4400 9309", "piece-info": "4400 9310", "thumbnail": "4400 9311", "old-revision": "4400 9312",
            "viewer-preferences": "4400 9313", "document-action": "4400 9314", "page-xmp": "4400 9315",
            "image-xmp": "4400 9316", "page-action": "4400 9317"}


def carriers() -> bytes:
    v = CARRIERS
    w, h = SPACES_SIZE
    pixels = bytes((x * 8 + y * 3) % 256 for y in range(h) for x in range(w) for _ in range(3))
    shown = line(72, 740, 12, "Carriers page") + f"q {w * 4} 0 0 {h * 4} 72 500 cm /Im1 Do Q\n"
    objects = [
        f"<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R /Metadata 12 0 R /StructTreeRoot 11 0 R /MarkInfo << /Marked true >> "
        f"/Names << /EmbeddedFiles << /Names [(f.txt) 8 0 R] >> /JavaScript << /Names [(js) 10 0 R] >> "
        f"/Dests << /Names [(Dest{v['named-destination']}) [3 0 R /Fit]] >> >> "
        f"/OpenAction << /S /JavaScript /JS (app.alert\\('{v['open-action']}'\\)) >> "
        f"/AA << /WC << /S /JavaScript /JS (app.alert\\('{v['document-action']}'\\)) >> >> "
        f"/PageLabels << /Nums [0 << /P (Label {v['page-label']}) >>] >> /ViewerPreferences << /Direction /L2R /Private ({v['viewer-preferences']}) >> >>".encode(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 15 0 R >> >> "
        f"/Contents 5 0 R /Thumb 13 0 R /Metadata 14 0 R /StructParents 0 /PieceInfo << /App << /Private ({v['piece-info']}) "
        f"/LastModified (D:20261125000000Z) >> >> /AA << /O << /S /JavaScript /JS (app.alert\\('{v['page-action']}'\\)) >> >> >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", (shown + line(72, 700, 12, f"Old {v['old-revision']}")).encode()),
        b"<< /Type /Outlines /First 7 0 R /Last 7 0 R /Count 1 >>",
        f"<< /Title (Bookmark {v['bookmark']}) /Parent 6 0 R /Dest [3 0 R /Fit] >>".encode(),
        b"<< /Type /Filespec /F (f.txt) /EF << /F 9 0 R >> >>",
        stream("/Type /EmbeddedFile", f"Embedded {v['embedded-file']}".encode(), compress=True),
        f"<< /S /JavaScript /JS (app.alert\\('{v['javascript']}'\\)) >>".encode(),
        f"<< /Type /StructTreeRoot /K << /S /Figure /Alt (Alt {v['structure-alt']}) >> >>".encode(),
        stream("/Type /Metadata /Subtype /XML", f"<x:xmpmeta xmlns:x='adobe:ns:meta/'>{v['xmp']}</x:xmpmeta>".encode()),
        stream("/Width 9 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", v["thumbnail"].encode()),
        stream("/Type /Metadata /Subtype /XML", f"<x:xmpmeta xmlns:x='adobe:ns:meta/'>{v['page-xmp']}</x:xmpmeta>".encode()),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Metadata 16 0 R",
               pixels, compress=True),
        stream("/Type /Metadata /Subtype /XML", f"<x:xmpmeta xmlns:x='adobe:ns:meta/'>{v['image-xmp']}</x:xmpmeta>".encode()),
        f"<< /Author (Author {v['info']}) >>".encode(),
    ]
    first = write_pdf(objects, "/Root 1 0 R /Info 17 0 R")
    # Saved again in place, without the old line: the earlier revision still holds it.
    return append_revision(first, 5, stream("", shown.encode()), len(objects) + 1, "/Root 1 0 R /Info 17 0 R")


# hidden-content.pdf: content on a layer that is off, text beyond the crop box and the media box,
# and image pixels past the page's edge and outside a clip. The media box is wider than the crop
# box, so the page shows x 0 to 612.
HIDDEN = {"layer-text": "4400 9401", "layer-form": "4400 9402", "outside-media": "4400 9403", "outside-crop": "4400 9404"}
PAST_EDGE = (500, 600, 628, 696)
CLIPPED = (100, 400, 228, 496)


def hidden_content() -> bytes:
    v = HIDDEN
    w, h = SPACES_SIZE
    pixels = bytes(value for y in range(h) for x in range(w) for value in (x * 8, y * 10, 160))
    content = "".join([
        line(72, 740, 12, "Hidden content page"),
        f"/OC /Off BDC\n{line(72, 700, 12, f'Layer {v['layer-text']}')}EMC\n",
        "/Fm Do\n",
        line(900, 700, 12, f"Far {v['outside-media']}"),
        line(630, 660, 12, f"Gap {v['outside-crop']}"),
        f"q {placed(PAST_EDGE)} cm /Im1 Do Q\n",
        f"q {CLIPPED[0]} {CLIPPED[1]} 64 96 re W n {placed(CLIPPED)} cm /Im2 Do Q\n",
    ])
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /OFF [6 0 R] >> >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 792] /CropBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> /Properties << /Off 6 0 R >> /XObject << /Fm 7 0 R /Im1 8 0 R /Im2 9 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", content.encode()),
        b"<< /Type /OCG /Name (Off) >>",
        stream("/Type /XObject /Subtype /Form /BBox [0 0 612 792] /OC 6 0 R /Resources << /Font << /F1 4 0 R >> >>",
               line(72, 680, 12, f"Form {v['layer-form']}").encode()),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8", pixels, compress=True),
        # An image of its own, unlike the first: pixels one placement shows are kept for every
        # placement of an image, and images with the same data count as one.
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8", pixels[::-1], compress=True),
    ]
    return write_pdf(objects, "/Root 1 0 R")


# image-data.pdf: metadata inside images' own bytes: a JPEG with every kind of segment the
# allowlist cuts, a JPEG under a Flate layer, a JPEG 2000 file with metadata boxes and a comment,
# and a raw JPEG 2000 codestream with a comment.
IMAGE_DATA = {"exif": "4400 9501", "jfxx": "4400 9502", "comment": "4400 9503", "iptc": "4400 9504",
              "after-end": "4400 9505", "flate-exif": "4400 9506", "jpx-xml": "4400 9507", "jpx-uuid": "4400 9508",
              "jpx-comment": "4400 9509", "j2k-comment": "4400 9510"}
IMAGE_DATA_RECTS = {"Jpeg": (100, 600, 228, 696), "Flated": (300, 600, 428, 696), "Jp2": (100, 400, 228, 496), "J2k": (300, 400, 428, 496)}


def segment(marker: int, body: bytes) -> bytes:
    return bytes([0xFF, marker]) + (len(body) + 2).to_bytes(2, "big") + body


def encoded(kind: str, **options: object) -> bytes:
    import io

    from PIL import Image

    w, h = SPACES_SIZE
    out = io.BytesIO()
    Image.frombytes("RGB", (w, h), bytes(value for y in range(h) for x in range(w) for value in (x * 8, y * 10, 90))).save(out, kind, **options)
    return out.getvalue()


def with_metadata(jpeg: bytes, exif: str, extra: bool) -> bytes:
    """`jpeg` with an EXIF segment after its start, and with `extra`, JFXX, IPTC, Adobe and comment segments and bytes after its end."""
    added = segment(0xE1, b"Exif\x00\x00" + exif.encode())
    if extra:
        v = IMAGE_DATA
        added += segment(0xE0, b"JFXX\x00\x10" + v["jfxx"].encode())
        added += segment(0xED, b"Photoshop 3.0\x00" + v["iptc"].encode())
        added += segment(0xEE, b"Adobe\x00\x64\x00\x00\x00\x00\x01")
        added += segment(0xFE, v["comment"].encode())
    body = jpeg[:2] + added + jpeg[2:]
    return body + (IMAGE_DATA["after-end"].encode() if extra else b"")


def with_codestream_comment(codestream: bytes, comment: str) -> bytes:
    """A J2K codestream with a COM segment after its SIZ segment, in its main header."""
    siz = codestream.index(b"\xff\x51")
    after = siz + 2 + int.from_bytes(codestream[siz + 2 : siz + 4], "big")
    return codestream[:after] + segment(0x64, b"\x00\x01" + comment.encode()) + codestream[after:]


def jp2_box(kind: bytes, body: bytes) -> bytes:
    return (len(body) + 8).to_bytes(4, "big") + kind + body


def with_jp2_metadata(jp2: bytes) -> bytes:
    """A JP2 file with XML and UUID boxes before its codestream box, and a comment inside it."""
    v = IMAGE_DATA
    boxes, at = [], 0
    while at < len(jp2):
        size = int.from_bytes(jp2[at : at + 4], "big")
        boxes.append((jp2[at + 4 : at + 8], jp2[at + 8 : at + size]))
        at += size
    out = b""
    for kind, body in boxes:
        if kind == b"jp2c":
            out += jp2_box(b"xml ", f"<metadata>{v['jpx-xml']}</metadata>".encode())
            out += jp2_box(b"uuid", b"\x00" * 16 + v["jpx-uuid"].encode())
            body = with_codestream_comment(body, v["jpx-comment"])
        out += jp2_box(kind, body)
    return out


def image_data() -> bytes:
    v = IMAGE_DATA
    w, h = SPACES_SIZE
    content = "".join(f"q {placed(rect)} cm /{name} Do Q\n" for name, rect in IMAGE_DATA_RECTS.items())
    head = f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace /DeviceRGB"
    jpeg = encoded("JPEG", quality=90, subsampling=0)
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()),
                           "/XObject << /Jpeg 6 0 R /Flated 7 0 R /Jp2 8 0 R /J2k 9 0 R >>")
    objects += [
        stream(f"{head} /Filter /DCTDecode", with_metadata(jpeg, v["exif"], extra=True)),
        stream(f"{head} /Filter [/FlateDecode /DCTDecode]", zlib.compress(with_metadata(jpeg, v["flate-exif"], extra=False))),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /Filter /JPXDecode", with_jp2_metadata(encoded("JPEG2000"))),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /Filter /JPXDecode",
               with_codestream_comment(encoded("JPEG2000", no_jp2=True), v["j2k-comment"])),
    ]
    return write_pdf(objects, "/Root 1 0 R")



def xfa_form() -> bytes:
    """A form whose catalog names an XFA form, which preparation refuses when the file is added."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] /XFA 6 0 R >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", line(72, 740, 12, "Please wait...").encode()),
        stream("", b"<xdp:xdp xmlns:xdp='http://ns.adobe.com/xdp/'><template/></xdp:xdp>"),
    ]
    return write_pdf(objects, "/Root 1 0 R")


def hybrid_xfa() -> bytes:
    """A form with a filled text field, which MuPDF draws, and an XFA stream beside it whose datasets hold a value
    the page never shows."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [6 0 R] /DR << /Font << /F1 4 0 R >> >> /DA (/F1 12 Tf 0 g) /XFA 8 0 R >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", line(72, 740, 12, "Client name:").encode()),
        b"<< /Type /Annot /Subtype /Widget /P 3 0 R /DA (/F1 12 Tf 0 g) /FT /Tx /T (client_name) /V (Jane Roe) "
        b"/Rect [160 734 360 754] /F 4 /AP << /N 7 0 R >> >>",
        appearance((200, 20), "/Tx BMC BT /F1 12 Tf 2 6 Td (Jane Roe) Tj ET EMC"),
        stream("", b"<xdp:xdp xmlns:xdp='http://ns.adobe.com/xdp/'><xfa:datasets xmlns:xfa='http://www.xfa.org/schema/xfa-data/1.0/'>"
                   b"<xfa:data><form><account>4400 9904</account></form></xfa:data></xfa:datasets></xdp:xdp>"),
    ]
    return write_pdf(objects, "/Root 1 0 R")


def visibility_expression() -> bytes:
    """An annotation on a layer rule written as a /VE expression, which preparation refuses rather than guess at."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R] /D << /ON [7 0 R] >> >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", line(72, 740, 12, "Rule page").encode()),
        b"<< /Type /Annot /Subtype /FreeText /Rect [72 600 300 630] /F 4 /DA (/Helv 12 Tf 0 g) /OC 8 0 R /AP << /N 9 0 R >> >>",
        b"<< /Type /OCG /Name (On) >>",
        b"<< /Type /OCMD /VE [/Not 7 0 R] >>",
        appearance((228, 30), note("On a rule")),
    ]
    return write_pdf(objects, "/Root 1 0 R")



# structure-keys.pdf: keys the allowlist must read as the model's alone. /constructor and /toString
# name an Object built-in in JavaScript, and a type-5 halftone's own /HalftoneName sits beside the
# colorant names the file chooses.
STRUCTURE_KEYS = {"built-in-key": "Client4400_9601", "built-in-key-page": "Client4400_9602", "halftone-name": "4400 9603"}


def structure_keys() -> bytes:
    v = STRUCTURE_KEYS
    objects = [
        f"<< /Type /Catalog /Pages 2 0 R /constructor /{v['built-in-key']} >>".encode(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /toString /{v['built-in-key-page']} "
        f"/Resources << /Font << /F1 4 0 R >> /ExtGState << /GS1 << /Type /ExtGState /HT 6 0 R >> >> >> /Contents 5 0 R >>".encode(),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        stream("", ("/GS1 gs\n" + line(72, 740, 12, "Structure keys page")).encode()),
        f"<< /Type /Halftone /HalftoneType 5 /HalftoneName (Screen {v['halftone-name']}) /Default 7 0 R /Cyan 7 0 R >>".encode(),
        b"<< /Type /Halftone /HalftoneType 1 /Frequency 60 /Angle 45 /SpotFunction /Round >>",
    ]
    return write_pdf(objects, "/Root 1 0 R")


def wrong_array() -> bytes:
    """A page whose media box holds a string: a rectangle must be four numbers, so preparation deletes the key."""
    return write_pdf(page_objects("/MediaBox [0 0 (4400 9604) 792]", stream("", line(72, 740, 12, "Wrong array").encode())), "/Root 1 0 R")


def stray_parent() -> bytes:
    """A page whose /Parent is a node outside the page tree, carrying a value of its own: preparation refuses the file."""
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", line(72, 740, 12, "Stray parent").encode()))
    objects[2] = objects[2].replace(b"/Parent 2 0 R", b"/Parent 6 0 R")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 /Note (4400 9605) >>")
    return write_pdf(objects, "/Root 1 0 R")


def null_elements() -> bytes:
    """Explicit nulls where the model allows them: an image's decode parameters for a filter with none, and
    values in the page's resources, its annotations and the catalog's layers."""
    w, h = SPACES_SIZE
    pixels = bytes((x * 8 + y * 3) % 256 for y in range(h) for x in range(w))
    data = zlib.compress(pixels).hex().encode() + b">"
    image = (f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceGray /BitsPerComponent 8 "
             f"/Filter [/ASCIIHexDecode /FlateDecode] /DecodeParms [null << /Predictor 1 >>] /Note null /Length {len(data)} >>\nstream\n").encode() + data + b"\nendstream"
    shown = line(72, 740, 12, "Null elements") + f"q {w * 4} 0 0 {h * 4} 72 500 cm /Im1 Do Q\n"
    resources = ("/Font << /F1 4 0 R /F9 null >> /XObject << /Im1 6 0 R /Im9 null >> /ExtGState << /G9 null >> "
                 "/Properties << /P9 null >> /Pattern << /P9 null >>")
    objects = page_objects("/MediaBox [0 0 612 792] /Annots [null]", stream("", shown.encode()), resources) + [image]
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [null] /D << /ON [null] /OFF [null] >> >> >>"
    return write_pdf(objects, "/Root 1 0 R")


# image-filter-names.pdf: JPEGs with EXIF under the abbreviated filter name /DCT, which MuPDF reads
# on any stream, alone and under a Flate layer.
IMAGE_FILTER_NAMES = {"abbreviated": "4400 9511", "flate-abbreviated": "4400 9512", "flate-predictor": "4400 9518"}
IMAGE_FILTER_RECTS = {"Abbr": (100, 600, 228, 696), "FlateAbbr": (300, 600, 428, 696), "Predicted": (100, 450, 228, 546)}


def image_filter_names() -> bytes:
    v = IMAGE_FILTER_NAMES
    w, h = SPACES_SIZE
    head = f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace /DeviceRGB"
    jpeg = encoded("JPEG", quality=90, subsampling=0)
    content = "".join(f"q {placed(rect)} cm /{name} Do Q\n" for name, rect in IMAGE_FILTER_RECTS.items())
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()), "/XObject << /Abbr 6 0 R /FlateAbbr 7 0 R /Predicted 8 0 R >>")
    # One row of PNG prediction (type 0, none) over the JPEG, which only the Flate layer's own parameters undo.
    predicted = with_metadata(jpeg, v["flate-predictor"], extra=False)
    objects += [
        stream(f"{head} /Filter /DCT /DecodeParms << /ColorTransform 1 >>", with_metadata(jpeg, v["abbreviated"], extra=False)),
        stream(f"{head} /Filter [/Fl /DCT] /DecodeParms [null << /ColorTransform 1 >>]",
               zlib.compress(with_metadata(jpeg, v["flate-abbreviated"], extra=False))),
        stream(f"{head} /Filter [/FlateDecode /DCTDecode] /DecodeParms << /Predictor 10 /Columns {len(predicted)} >>",
               zlib.compress(b"\x00" + predicted)),
    ]
    return write_pdf(objects, "/Root 1 0 R")


# jpx-data.pdf: JPEG 2000 data a reader never decodes: bytes after a raw codestream's end, and a
# JP2 file's second codestream box.
JPX_DATA = {"after-end": "4400 9514", "second-codestream": "4400 9515"}
JPX_DATA_RECTS = {"Raw": (100, 600, 228, 696), "Jp2": (300, 600, 428, 696)}


def without_comments(codestream: bytes) -> bytes:
    """A J2K codestream without the comment segments in its main header, as the encoder writes one there."""
    out, at = bytearray(codestream[:2]), 2
    while int.from_bytes(codestream[at : at + 2], "big") != 0xFF90:
        end = at + 2 + int.from_bytes(codestream[at + 2 : at + 4], "big")
        if int.from_bytes(codestream[at : at + 2], "big") != 0xFF64:
            out += codestream[at:end]
        at = end
    return bytes(out + codestream[at:])


def jpx_data() -> bytes:
    v = JPX_DATA
    w, h = SPACES_SIZE
    # With no comment to cut, only the bytes after its end tell the cut codestream from the original.
    raw = without_comments(encoded("JPEG2000", no_jp2=True))
    content = "".join(f"q {placed(rect)} cm /{name} Do Q\n" for name, rect in JPX_DATA_RECTS.items())
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()), "/XObject << /Raw 6 0 R /Jp2 7 0 R >>")
    objects += [
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /Filter /JPXDecode", raw + v["after-end"].encode()),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /Filter /JPXDecode",
               encoded("JPEG2000") + jp2_box(b"jp2c", raw + v["second-codestream"].encode())),
    ]
    return write_pdf(objects, "/Root 1 0 R")


def icc_under_dct() -> bytes:
    """An image whose ICC profile stream is stored under DCTDecode, as JPEG data with EXIF: JPEG data in a stream
    that is no image is cut nowhere, so preparation refuses the file."""
    w, h = SPACES_SIZE
    pixels = bytes((x * 8 + y * 3) % 256 for y in range(h) for x in range(w) for _ in range(3))
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", f"q {placed((100, 600, 228, 696))} cm /Im Do Q\n".encode()), "/XObject << /Im 6 0 R >>")
    objects += [
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace [/ICCBased 7 0 R]", pixels, compress=True),
        stream("/N 3 /Alternate /DeviceRGB /Filter /DCTDecode", with_metadata(encoded("JPEG", quality=90, subsampling=0), "4400 9516", extra=False)),
    ]
    return write_pdf(objects, "/Root 1 0 R")


def inline_jpeg() -> bytes:
    """A fully shown inline JPEG with EXIF in its data, which step 5's filter rewrites."""
    w, h = SPACES_SIZE
    data = with_metadata(encoded("JPEG", quality=90, subsampling=0), "4400 9517", extra=False)
    content = (f"{line(72, 740, 12, 'Inline JPEG')}q {placed((100, 600, 228, 696))} cm BI /W {w} /H {h} /BPC 8 /CS /RGB /F /DCT /L {len(data)} ID ").encode() + data + b"\nEI Q\n"
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", content)), "/Root 1 0 R")


def jpeg_extension() -> bytes:
    """A JPEG with a JPG0 extension segment, which decoders skip, holding a value."""
    w, h = SPACES_SIZE
    jpeg = encoded("JPEG", quality=90, subsampling=0)
    data = jpeg[:2] + segment(0xF0, b"Extension 4400 9519") + jpeg[2:]
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", f"q {placed((100, 600, 228, 696))} cm /Im Do Q\n".encode()), "/XObject << /Im 6 0 R >>")
    objects.append(stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode", data))
    return write_pdf(objects, "/Root 1 0 R")


def jpeg_long_adobe() -> bytes:
    """A JPEG whose Adobe APP14 holds more than its 12 bytes: it decides how the colours decode, so preparation refuses the file."""
    w, h = SPACES_SIZE
    jpeg = encoded("JPEG", quality=90, subsampling=0)
    data = jpeg[:2] + segment(0xEE, b"Adobe\x00\x64\x00\x00\x00\x00\x01 4400 9520") + jpeg[2:]
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", f"q {placed((100, 600, 228, 696))} cm /Im Do Q\n".encode()), "/XObject << /Im 6 0 R >>")
    objects.append(stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode", data))
    return write_pdf(objects, "/Root 1 0 R")


def data_after_end() -> bytes:
    """An image whose Flate data is followed by bytes no reader decodes, holding a value."""
    w, h = SPACES_SIZE
    pixels = bytes((x * 8 + y * 3) % 256 for y in range(h) for x in range(w) for _ in range(3))
    data = zlib.compress(pixels) + b"Tail 4400 9901"
    image = (f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceRGB /BitsPerComponent 8 "
             f"/Filter /FlateDecode /Length {len(data)} >>\nstream\n").encode() + data + b"\nendstream"
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", f"q {placed((100, 600, 228, 696))} cm /Im Do Q\n".encode()), "/XObject << /Im 6 0 R >>")
    return write_pdf(objects + [image], "/Root 1 0 R")


# image-prefilters.pdf: a JPEG behind ASCII85 and a JP2 file behind ASCIIHex, each holding metadata.
IMAGE_PREFILTERS = {"ascii85-jpeg": "4400 9902", "asciihex-jpx": "4400 9903"}


def image_prefilters() -> bytes:
    v = IMAGE_PREFILTERS
    w, h = SPACES_SIZE
    jpeg = with_metadata(encoded("JPEG", quality=90, subsampling=0), v["ascii85-jpeg"], extra=False)
    jp2 = encoded("JPEG2000") + jp2_box(b"xml ", f"<x>{v['asciihex-jpx']}</x>".encode())
    content = f"q {placed((100, 600, 228, 696))} cm /A Do Q\nq {placed((300, 600, 428, 696))} cm /B Do Q\n"
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()), "/XObject << /A 6 0 R /B 7 0 R >>")
    objects += [
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace /DeviceRGB "
               "/Filter [/ASCII85Decode /DCTDecode]", base64.a85encode(jpeg) + b"~>"),
        stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /Filter [/AHx /JPXDecode]", jp2.hex().encode() + b">"),
    ]
    return write_pdf(objects, "/Root 1 0 R")


def grey_soft_masks() -> bytes:
    """Two RGB images whose soft masks have one-channel colour spaces other than DeviceGray: CalGray, and an
    ICC profile with /N 1 (its data a stand-in, so readers draw it by its /Alternate)."""
    w, h = SPACES_SIZE
    pixels = bytes((x * 8 + y * 3) % 256 for y in range(h) for x in range(w) for _ in range(3))
    mask = bytes(min(255, x * 8) for _ in range(h) for x in range(w))
    head = f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8"
    content = f"q {placed((100, 600, 228, 696))} cm /A Do Q\nq {placed((300, 600, 428, 696))} cm /B Do Q\n"
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()), "/XObject << /A 6 0 R /B 7 0 R >>")
    objects += [
        stream(f"{head} /ColorSpace /DeviceRGB /SMask 8 0 R", pixels, compress=True),
        stream(f"{head} /ColorSpace /DeviceRGB /SMask 9 0 R", pixels, compress=True),
        stream(f"{head} /ColorSpace [/CalGray << /WhitePoint [0.9505 1 1.089] >>]", mask, compress=True),
        stream(f"{head} /ColorSpace [/ICCBased 10 0 R]", mask, compress=True),
        stream("/N 1 /Alternate /DeviceGray", b"not a profile"),
    ]
    return write_pdf(objects, "/Root 1 0 R")


def shading_graphics_state() -> bytes:
    """A shading pattern whose graphics state's soft mask group holds text and an ActualText: a shading pattern's
    graphics state is never applied, so what it holds is never seen."""
    group = stream("/Type /XObject /Subtype /Form /BBox [0 0 612 792] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /Font << /F1 4 0 R >> >>",
                   b"/Span << /ActualText (4400 9913) >> BDC 1 g BT /F1 12 Tf 72 600 Td (Mask 4400 9914) Tj ET EMC")
    shading = ("/P1 << /Type /Pattern /PatternType 2 /Shading << /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 612 0] "
               "/Function << /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >> >> "
               "/ExtGState << /SMask << /Type /Mask /S /Luminosity /G 6 0 R >> >> >>")
    content = "/Pattern cs /P1 scn 72 500 200 200 re f\n" + line(72, 740, 12, "Shading page")
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()), f"/Font << /F1 4 0 R >> /Pattern << {shading} >>") + [group], "/Root 1 0 R")


def abbreviated_stream_keys() -> bytes:
    """A JPEG XObject whose filter is named by the abbreviated /F of inline images, which MuPDF reads on any stream:
    preparation refuses the file."""
    w, h = SPACES_SIZE
    jpeg = with_metadata(encoded("JPEG", quality=90, subsampling=0), "4400 9915", extra=False)
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", f"q {placed((100, 600, 228, 696))} cm /Im Do Q\n".encode()), "/XObject << /Im 6 0 R >>")
    objects.append(stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace /DeviceRGB /F /DCTDecode", jpeg))
    return write_pdf(objects, "/Root 1 0 R")


def inherited_text_state() -> bytes:
    """A form XObject whose text inherits the page's text state: the page spaces its own text with 3.9 Tc, then
    resets it in an empty text object before drawing the form, which sets 0 Tc itself."""
    form = stream("/Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >>",
                  b"BT /F1 12 Tf 0 Tc 72 650 Td (Secret text) Tj ET")
    content = b"BT /F1 12 Tf 3.9 Tc 72 700 Td (Spaced) Tj ET BT 0 Tc ET /Fm Do"
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", content), "/Font << /F1 4 0 R >> /XObject << /Fm 6 0 R >>") + [form], "/Root 1 0 R")


# tight-lines.pdf: a name that wraps onto the next line, set so close that the second line's font
# height reaches into the first line's letters, as in a signature stamp. "Jane" ends a 6 pt line, and
# a 12 pt "Roe" below it ends where "Jane" starts, under the kept "to". Their ink does not touch.
def tight_lines() -> bytes:
    first = "Done to "
    jane = 72 + width(first, 6)
    roe = jane - width("Roe", 12)
    content = line(72, 700, 6, first + "Jane") + line(round(roe, 3), 689.5, 12, "Roe")
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", content.encode())), "/Root 1 0 R")


def image_filter_not_last() -> bytes:
    """A JPEG whose image filter is followed by another, so its data can't be cut: preparation refuses the file."""
    w, h = SPACES_SIZE
    jpeg = with_metadata(encoded("JPEG", quality=90, subsampling=0), "4400 9513", extra=False)
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", f"q {placed((100, 600, 228, 696))} cm /Im Do Q\n".encode()), "/XObject << /Im 6 0 R >>")
    objects.append(stream(f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace /DeviceRGB "
                          "/Filter [/DCTDecode /FlateDecode]", jpeg))
    return write_pdf(objects, "/Root 1 0 R")


def two_roles() -> bytes:
    """A grey image drawn on its own as /A, where an image keeps no /Matte, and as /B's soft mask, where
    /Matte is kept: whichever role the walk meets first, the two disagree, so preparation refuses the file."""
    w, h = SPACES_SIZE
    head = f"/Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8"
    content = f"q {placed((100, 600, 228, 696))} cm /A Do Q\nq {placed((300, 600, 428, 696))} cm /B Do Q\n"
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", content.encode()), "/XObject << /A 6 0 R /B 7 0 R >>")
    objects += [
        stream(f"{head} /ColorSpace /DeviceGray /Matte [0 0 0]", bytes((x * 8) % 256 for _ in range(h) for x in range(w)), compress=True),
        stream(f"{head} /ColorSpace /DeviceRGB /SMask 6 0 R", bytes((x * 8 + y * 3) % 256 for y in range(h) for x in range(w) for _ in range(3)), compress=True),
    ]
    return write_pdf(objects, "/Root 1 0 R")


# postscript-xobject.pdf: a PostScript XObject, which PDF 2.0 readers don't draw, carrying a value.
POSTSCRIPT = "4400 9801"


def postscript_xobject() -> bytes:
    shown = line(72, 740, 12, "PostScript page") + "/PS1 Do\n"
    objects = page_objects("/MediaBox [0 0 612 792]", stream("", shown.encode()), "/Font << /F1 4 0 R >> /XObject << /PS1 6 0 R >>")
    objects.append(stream("/Type /XObject /Subtype /PS", f"72 600 moveto (Client {POSTSCRIPT}) show".encode()))
    return write_pdf(objects, "/Root 1 0 R")


# marked-*.pdf: a marked-content property step 5 drops, each where only a scan beyond the page's
# own content, or one that reads names as the PDF lexer does, finds it to record its kind.
MARKED = {"pattern": "4400 9701", "type3": "4400 9702", "soft-mask": "4400 9703", "escaped-name": "4400 9704", "nul-delimiter": "4400 9705"}


def marked_elsewhere(where: str) -> bytes:
    value = MARKED[where]
    shown = line(72, 740, 12, "Marked elsewhere")
    resources = "/Font << /F1 4 0 R >>"
    extra: list[bytes] = []
    if where == "pattern":
        shown += "/Pattern cs /P1 scn 72 600 100 100 re f\n"
        resources += " /Pattern << /P1 6 0 R >>"
        extra.append(stream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10 /Resources << >>",
                            f"/Span << /ActualText ({value}) >> BDC 0 0 5 5 re f EMC".encode()))
    elif where == "type3":
        shown += "BT /F2 12 Tf 72 600 Td (a) Tj ET\n"
        resources = "/Font << /F1 4 0 R /F2 6 0 R >>"
        extra += [b"<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /a 7 0 R >> "
                  b"/Encoding << /Type /Encoding /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [1000] /Resources << >> >>",
                  stream("", f"1000 0 d0 /Span << /Alt ({value}) >> BDC 0 0 500 500 re f EMC".encode())]
    elif where == "soft-mask":
        shown += "q /GS1 gs 0 0 1 rg 72 600 100 100 re f Q\n"
        resources += " /ExtGState << /GS1 << /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G 6 0 R >> >> >>"
        extra.append(stream("/Type /XObject /Subtype /Form /BBox [0 0 612 792] /Group << /S /Transparency /CS /DeviceGray >> /Resources << >>",
                            f"/Span << /E ({value}) >> BDC 1 g 0 0 612 792 re f EMC".encode()))
    elif where == "escaped-name":
        # /Actual#54ext is /ActualText: #54 is "T".
        shown += f"/Span << /Actual#54ext ({value}) >> BDC 0 0 1 rg 72 600 100 100 re f EMC\n"
    else:
        # NUL is white space in PDF, so /ActualText ends at it.
        shown += f"/Span << /ActualText\0({value}) >> BDC 0 0 1 rg 72 600 100 100 re f EMC\n"
    return write_pdf(page_objects("/MediaBox [0 0 612 792]", stream("", shown.encode()), resources) + extra, "/Root 1 0 R")

if __name__ == "__main__":
    for name, build in [("one-word", one_word), ("image", image), ("rotated-cropped", rotated_cropped),
                        ("encrypted", encrypted), ("cross-page", cross_page), ("masked-image", masked_image),
                        ("table", table), ("long", long_document),
                        ("letter-a", lambda: letter(LETTER_A)), ("letter-b", lambda: letter(LETTER_B)),
                        ("line-feed-glyph", line_feed_glyph), ("tj-strings", tj_strings),
                        ("logo-a", logo_a), ("logo-b", logo_b), ("unmatchable-images", unmatchable_images),
                        ("signatures", signatures), ("edit-locked", edit_locked),
                        ("image-spaces", image_spaces), ("marked-text", marked_text), ("layer-rules", layer_rules),
                        ("content-strings", content_strings), ("annotations", annotations), ("form", form),
                        ("carriers", carriers), ("hidden-content", hidden_content), ("image-data", image_data),
                        ("xfa-form", xfa_form), ("visibility-expression", visibility_expression),
                        ("structure-keys", structure_keys), ("wrong-array", wrong_array), ("stray-parent", stray_parent),
                        ("null-elements", null_elements), ("postscript-xobject", postscript_xobject),
                        ("image-filter-names", image_filter_names), ("image-filter-not-last", image_filter_not_last),
                        ("two-roles", two_roles), ("jpx-data", jpx_data), ("data-after-end", data_after_end), ("tight-lines", tight_lines), ("inherited-text-state", inherited_text_state), ("shading-graphics-state", shading_graphics_state),
                        ("abbreviated-stream-keys", abbreviated_stream_keys), ("hybrid-xfa", hybrid_xfa), ("grey-soft-masks", grey_soft_masks), ("image-prefilters", image_prefilters), ("jpeg-extension", jpeg_extension), ("jpeg-long-adobe", jpeg_long_adobe), ("icc-under-dct", icc_under_dct), ("inline-jpeg", inline_jpeg),
                        *[(f"marked-{where}", lambda where=where: marked_elsewhere(where)) for where in MARKED]]:
        (FIXTURES / f"{name}.pdf").write_bytes(build())
        print(f"wrote fixtures/{name}.pdf")
