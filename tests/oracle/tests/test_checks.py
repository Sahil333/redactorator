"""Each check passes on a hand-made clean file and fails on the uncleaned fixture."""

import make_fixtures as fx
from oracle import checks


def test_absent_finds_the_value_in_text_raw_streams_and_metadata():
    assert len(checks.absent(fx.one_word(), ["Jane Roe"])) == 2
    assert checks.absent(fx.one_word(cleaned=True), ["Jane Roe"]) == []


def test_absent_finds_a_value_only_in_metadata():
    unclean = fx.write_pdf(
        fx.page_objects("/MediaBox [0 0 612 792]", fx.stream("", fx.line(72, 700, 12, "Hello").encode()))
        + [b"<< /Author <FEFF004A0061006E006500200052006F0065> >>"],
        "/Root 1 0 R /Info 6 0 R",
    )
    assert checks.absent(unclean, ["Jane Roe"]) == ["'Jane Roe' is in the output's raw bytes (a stream, string or metadata)"]


def test_absent_joins_a_value_split_across_a_tj_array():
    split = fx.write_pdf(
        fx.page_objects("/MediaBox [0 0 612 792]",
                        fx.stream("", b"BT /F1 12 Tf 72 700 Td [(Ja) -20 (ne R) 10 (oe)] TJ ET", compress=True)),
        "/Root 1 0 R",
    )
    assert "'Jane Roe' is in the output's raw bytes (a stream, string or metadata)" in checks.absent(split, ["Jane Roe"])


def test_metadata_reports_info_xmp_and_revisions():
    assert checks.metadata(fx.one_word()) == [
        "the output has an Info dictionary",
        "the output's catalog has XMP Metadata",
        "the output holds an XMP metadata stream",
        "the output has 2 revisions, not 1",
    ]
    assert checks.metadata(fx.one_word(cleaned=True)) == []


def test_covered_needs_a_filled_box_over_the_word():
    assert checks.covered(fx.one_word(), fx.one_word(cleaned=True), "Jane Roe") == []
    assert checks.covered(fx.one_word(), fx.one_word(), "Jane Roe") != []


def test_covered_on_a_rotated_cropped_page():
    source = fx.rotated_cropped()
    assert checks.covered(source, fx.rotated_cropped(cleaned=True), "Okonkwo") == []
    assert checks.covered(source, source, "Okonkwo") != []
    assert checks.absent(fx.rotated_cropped(cleaned=True), ["Okonkwo"]) == []


def test_positions_keeps_neighbours_in_place():
    assert checks.positions(fx.one_word(), fx.one_word(cleaned=True), ["Jane Roe"]) == []
    shifted = fx.write_pdf(
        fx.page_objects("/MediaBox [0 0 612 792]", fx.stream("", fx.line(72, 680, 12, "Dear , thank you for writing to us.").encode())),
        "/Root 1 0 R",
    )
    assert checks.positions(fx.one_word(), shifted, ["Jane Roe"]) != []


def test_pixels_blank_inside_and_unchanged_outside():
    assert checks.pixels(fx.image(), fx.image(cleaned=True), fx.IMAGE_BLANKED) == []
    assert checks.pixels(fx.image(), fx.image(), fx.IMAGE_BLANKED)[0].startswith("the image under the box still has")
    assert checks.pixels(fx.image(), fx.image(cleaned=True), (100, 400, 150, 592))[-1].endswith(
        "image pixels outside the box changed")


def test_present_reads_the_text_layer():
    assert checks.present(fx.one_word(), "Jane Roe") == []
    assert checks.present(fx.one_word(cleaned=True), "[PERSON]") != []


def test_pixels_judges_the_soft_mask_on_its_own():
    assert checks.pixels(fx.masked_image(), fx.masked_image(cleaned=True), fx.IMAGE_BLANKED, mask=True) == []
    assert checks.pixels(fx.masked_image(), fx.masked_image(), fx.IMAGE_BLANKED, mask=True)[0].startswith(
        "the image under the box still has")
