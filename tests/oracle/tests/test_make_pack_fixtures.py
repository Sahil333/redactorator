"""The pack fixture generator: the seven ways, the places it counts, its python-stdnum check, and
the text a reader gets from its PDF."""

import io

import pytest
from pdfminer.high_level import extract_text

import make_pack_fixtures as generator

CARD = {"id": "card", "identifier": "payment-card", "stdnum": "luhn",
        "examples": ["4000 0566 5566 5556"], "nearMisses": ["4000 0566 5566 5557"]}


def pack(*rules: dict) -> dict:
    return {"pack": "universal", "rules": list(rules)}


def test_a_number_in_groups_is_written_in_seven_ways_and_a_value_without_groups_once():
    assert generator.ways("1234 5678") == ["12345678", "1234 5678", "1234-5678", "1234.5678", "1234–5678", "1234−5678", "1234 5678"]
    assert generator.ways("HDFC0001234") == ["HDFC0001234"]
    assert generator.ways("jane.roe@example.com") == ["jane.roe@example.com"]
    assert generator.ways("192.168.0.1", as_written=True) == ["192.168.0.1"]


def test_each_value_is_one_truth_entry_whose_places_count_its_ways_and_its_companion_lines():
    ifsc = {"id": "ifsc", "identifier": "in-ifsc", "labels": ["IFSC"], "examples": ["HDFC0001234"], "nearMisses": ["HDFC1001234"]}
    account = {"id": "account", "identifier": "in-bank-account", "companion": {"rule": "ifsc"},
               "examples": [{"value": "50100023456789", "line": "Paid to {value} at {companion}"}], "nearMisses": ["123"]}
    lines, truth = generator.lines_and_truth({"pack": "in", "rules": [ifsc, account]})
    assert lines == ["IFSC: HDFC0001234", "IFSC: HDFC1001234", "Paid to 50100023456789 at HDFC0001234", "123"]
    assert truth["values"] == [{"text": "HDFC0001234", "identifier": "in-ifsc", "places": 2},
                               {"text": "50100023456789", "identifier": "in-bank-account", "places": 1}]
    assert truth["nearMisses"] == [{"text": "HDFC1001234"}, {"text": "123"}]


def test_an_example_that_fails_its_check_or_a_near_miss_that_passes_it_is_refused():
    generator.check_with_stdnum(pack(CARD))
    with pytest.raises(generator.FixtureError, match="example"):
        generator.check_with_stdnum(pack({**CARD, "examples": ["4000 0566 5566 5557"]}))
    with pytest.raises(generator.FixtureError, match="near-miss"):
        generator.check_with_stdnum(pack({**CARD, "nearMisses": ["4000 0566 5566 5556"]}))


def test_the_pdf_is_read_with_the_en_dash_the_minus_sign_and_the_no_break_space_as_written():
    lines = ["Card 4000–0566", "Card 4000−0566", "Card 4000 0566", "A (bracket) and a \\"]
    text = extract_text(io.BytesIO(generator.pack_pdf(lines)))
    for line in lines:
        assert line in text


def test_a_character_the_font_cannot_write_is_refused():
    with pytest.raises(generator.FixtureError):
        generator.pdf_string("café")
