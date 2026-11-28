import copy

from validate import problems

VALID = {
    "schema_version": 1,
    "document": {
        "source": "synthetic: phase 1 test",
        "licence": "CC0-1.0",
        "country": "UK",
        "format": "born-digital-pdf",
        "split": "development",
        "sha256": "0" * 64,
        "box_unit": "pt",
    },
    "entities": [
        {"id": "e1", "type": "person", "value": "Jane Roe", "link_id": "jane"},
        {"id": "e2", "type": "person", "value": "J. Roe", "link_id": "jane"},
        {"id": "e3", "type": "signature"},
        {"id": "e4", "type": "custom:matter number", "value": "M-0041"},
    ],
    "occurrences": [
        {"entity_id": "e1", "page": 0, "start": 5, "end": 13, "boxes": [{"x0": 101.3, "y0": 99.1, "x1": 152.7, "y1": 115.6}]},
        {"entity_id": "e3", "page": 1, "boxes": [{"x0": 72, "y0": 400, "x1": 220, "y1": 460}]},
    ],
    "hidden_occurrences": [{"entity_id": "e1", "carrier": "metadata", "location": "Info/Author"}],
}


def changed(edit):
    truth = copy.deepcopy(VALID)
    edit(truth)
    return problems(truth)


def test_a_valid_file_has_no_problems():
    assert problems(VALID) == []


def test_an_unknown_type_is_rejected_but_a_custom_one_is_not():
    assert changed(lambda t: t["entities"][0].update(type="name")) != []
    assert changed(lambda t: t["entities"][0].update(type="custom:")) != []


def test_an_identifier_type_and_india_are_accepted():
    def identifier_from_india(truth):
        truth["document"].update(country="IN")
        truth["entities"][0].update(type="in-aadhaar", value="1234 5678 9012")

    assert changed(identifier_from_india) == []
    assert changed(lambda t: t["entities"][0].update(type="us-ssn")) == []
    assert changed(lambda t: t["document"].update(country="IND")) != []


def test_ids_must_be_unique_and_referenced():
    assert changed(lambda t: t["entities"][1].update(id="e1")) == ["entities: id 'e1' is used twice"]
    assert changed(lambda t: t["occurrences"][0].update(entity_id="nope")) == [
        "occurrences/0: entity_id 'nope' names no entity"]
    assert changed(lambda t: t["hidden_occurrences"][0].update(entity_id="nope")) == [
        "hidden_occurrences/0: entity_id 'nope' names no entity"]


def test_offsets_come_in_order_and_in_pairs():
    assert changed(lambda t: t["occurrences"][0].update(start=13)) == ["occurrences/0: start must be before end"]
    assert changed(lambda t: t["occurrences"][0].pop("end")) != []


def test_boxes_are_well_formed_and_present_for_pdfs():
    assert changed(lambda t: t["occurrences"][0]["boxes"][0].update(x1=90)) == [
        "occurrences/0/boxes/0: x0 must be below x1 and y0 below y1"]
    assert changed(lambda t: t["occurrences"][1].update(boxes=[])) == ["occurrences/1: needs at least one box"]


def test_box_unit_follows_format():
    assert changed(lambda t: t["document"].update(box_unit="px")) == [
        "document: box_unit 'px' does not fit format 'born-digital-pdf'"]


def test_text_documents_use_offsets_not_boxes():
    def to_text(truth):
        truth["document"].update(format="text", box_unit="none")
        truth["occurrences"] = [{"entity_id": "e1", "page": 0, "start": 0, "end": 8, "boxes": []}]

    assert changed(to_text) == []
    assert changed(lambda t: (to_text(t), t["occurrences"][0].update(boxes=[{"x0": 0, "y0": 0, "x1": 1, "y1": 1}]))) == [
        "occurrences/0: a text document's occurrences have no boxes"]
