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
             "t": 278, "h": 556, "l": 222, "d": 556, ":": 278, "m": 833}


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


def encrypted() -> bytes:
    import io

    import pikepdf

    pdf = pikepdf.open(io.BytesIO(write_pdf(
        page_objects("/MediaBox [0 0 612 792]", stream("", line(72, 700, 12, "Sealed file").encode())),
        "/Root 1 0 R")))
    out = io.BytesIO()
    pdf.save(out, encryption=pikepdf.Encryption(user="sealed-user", owner="sealed-owner", R=6))
    return out.getvalue()


if __name__ == "__main__":
    for name, build in [("one-word", one_word), ("image", image), ("rotated-cropped", rotated_cropped),
                        ("encrypted", encrypted), ("cross-page", cross_page), ("masked-image", masked_image),
                        ("table", table), ("long", long_document),
                        ("letter-a", lambda: letter(LETTER_A)), ("letter-b", lambda: letter(LETTER_B)),
                        ("line-feed-glyph", line_feed_glyph), ("tj-strings", tj_strings)]:
        (FIXTURES / f"{name}.pdf").write_bytes(build())
        print(f"wrote fixtures/{name}.pdf")
