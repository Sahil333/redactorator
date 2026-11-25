"""Writes the phase 1 fixture PDFs into fixtures/ by hand, byte by byte.

Every fixture is synthetic. Each builder can also write a "cleaned" variant, made
the way a correct redaction should come out, which the checker's own tests use to
show that each check passes on a clean file and fails on an unclean one.

Run: uv run --project tests/oracle python tests/oracle/make_fixtures.py
"""

import zlib
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"

# Helvetica advance widths (AFM, 1/1000 em) for the characters the fixtures mark.
HELVETICA = {" ": 278, ",": 278, "a": 556, "e": 556, "n": 556, "o": 556, "k": 500, "w": 722,
             "r": 333, "D": 722, "J": 500, "R": 722, "O": 778, "A": 667, "c": 500, "u": 556,
             "t": 278, "h": 556, "l": 222, "d": 556, ":": 278, "m": 833,
             "T": 611, "g": 556, "H": 722, "P": 667, "i": 222, "C": 722, "p": 556, "L": 556, "y": 500,
             "F": 611, "S": 667, **{digit: 556 for digit in "0123456789"}}


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


if __name__ == "__main__":
    for name, build in [("one-word", one_word), ("image", image), ("rotated-cropped", rotated_cropped),
                        ("encrypted", encrypted), ("cross-page", cross_page), ("masked-image", masked_image),
                        ("table", table), ("long", long_document),
                        ("letter-a", lambda: letter(LETTER_A)), ("letter-b", lambda: letter(LETTER_B)),
                        ("line-feed-glyph", line_feed_glyph), ("tj-strings", tj_strings),
                        ("logo-a", logo_a), ("logo-b", logo_b), ("unmatchable-images", unmatchable_images),
                        ("signatures", signatures), ("edit-locked", edit_locked),
                        ("image-spaces", image_spaces), ("marked-text", marked_text), ("layer-rules", layer_rules),
                        ("content-strings", content_strings)]:
        (FIXTURES / f"{name}.pdf").write_bytes(build())
        print(f"wrote fixtures/{name}.pdf")
