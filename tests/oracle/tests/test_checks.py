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


def test_metadata_reports_an_encrypted_output():
    assert "the output is encrypted" in checks.metadata(fx.edit_locked())
    assert "the output is encrypted" not in checks.metadata(fx.one_word())


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


def left_half(rect: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    x0, y0, x1, y1 = rect
    return (x0, y0, (x0 + x1) // 2, y1)


def test_pixels_reads_cmyk_indexed_separation_and_inline_images():
    for at in (fx.SPACES_RECTS["Cmyk"], fx.SPACES_RECTS["Indexed"], fx.SPACES_RECTS["Separation"], fx.INLINE_RECT):
        assert checks.pixels(fx.image_spaces(), fx.image_spaces(cleaned=True), left_half(at), at=at) == []
        assert checks.pixels(fx.image_spaces(), fx.image_spaces(), left_half(at), at=at)[0].startswith(
            "the image under the box still has")


def test_pixels_judges_the_soft_mask_of_a_one_pixel_image():
    at = fx.SPACES_RECTS["OnePixel"]
    assert checks.pixels(fx.image_spaces(), fx.image_spaces(cleaned=True), left_half(at), mask=True, at=at) == []
    assert checks.pixels(fx.image_spaces(), fx.image_spaces(), left_half(at), mask=True, at=at) != []


def test_absent_and_positions_on_the_marked_text_and_layer_rule_fixtures():
    for build, values in ((fx.marked_text, [value for _, value, _, _ in fx.MARKED_LINES] + [fx.MARKED_FORM[1]]),
                          (fx.layer_rules, [fx.LAYER_SHOWN[1]])):
        assert checks.absent(build(cleaned=True), values) == []
        assert len(checks.absent(build(), values)) == 2 * len(values)
        assert checks.positions(build(), build(cleaned=True), values) == []


def test_absent_finds_values_hidden_in_a_content_stream():
    values = list(fx.CONTENT_STRINGS.values())
    assert checks.absent(fx.content_strings(cleaned=True), values) == []
    assert len(checks.absent(fx.content_strings(), values)) == len(values)
    assert checks.rendered(fx.content_strings(), fx.content_strings(cleaned=True), []) == []


def test_rendered_compares_every_page_as_drawn():
    assert checks.rendered(fx.one_word(), fx.one_word(), []) == []
    # The cleaned file draws a box where "Jane Roe" was.
    assert checks.rendered(fx.one_word(), fx.one_word(cleaned=True), [])[0].endswith("pixels of page 1 are drawn differently")
    assert checks.rendered(fx.one_word(), fx.one_word(cleaned=True), [{"page": 1, "box": [95, 670, 160, 700]}]) == []
    assert checks.rendered(fx.one_word(), fx.cross_page(), []) == ["the output has 3 pages, not 1"]


# Where logo-b.pdf draws each image, in user space.
LOGO_HALF = (100, 550, 244, 646)
LOGO_TURNED = (304, 550, 400, 694)
LOGO_OTHER = (420, 300, 564, 396)


def test_pixels_judges_the_image_drawn_at_a_place_turned_or_not():
    # Turned, the logo's left 90% runs up the page, so a reading that ignored the turn fails.
    left_90 = {LOGO_HALF: (100, 550, 229.6, 646), LOGO_TURNED: (304, 550, 400, 679.6)}
    for at, region in left_90.items():
        assert checks.pixels(fx.logo_b(), fx.logo_b(cleaned=True), region, at=at) == []
        assert checks.pixels(fx.logo_b(), fx.logo_b(), region, at=at)[0].startswith("the image under the box still has")


def test_unchanged_needs_every_pixel_as_it_was():
    assert checks.unchanged(fx.logo_b(), fx.logo_b(cleaned=True), LOGO_OTHER) == []
    assert checks.unchanged(fx.logo_b(), fx.logo_b(cleaned=True), LOGO_HALF)[0].endswith("changed")
