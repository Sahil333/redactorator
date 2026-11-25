"""A raw scan of a PDF file's bytes: every stream decoded, every string and name decoded.

It finds streams, their filters and strings with its own code, not pdfminer's parser, so a value
pdfminer's reading misses can still be caught here, wherever in the file it sits. It shares its
stream decoders with pdfminer (review answer 5): Flate with predictors, LZW, ASCII85, ASCIIHex,
RunLength, and chains of these. A decoder stops at its own end of data, and the bytes after it,
which no reader decodes, stay in the file: so each stream is kept with the output of every
filter in its chain, with the bytes after its zlib data's end, and, when zlib can't inflate it,
as its undecoded bytes.
"""

import re
import zlib

from pdfminer.ascii85 import ascii85decode, asciihexdecode
from pdfminer.lzw import lzwdecode
from pdfminer.runlength import rldecode
from pdfminer.utils import PDFDocEncoding, apply_png_predictor, apply_tiff_predictor

from .structure import FULL_NAMES

STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.DOTALL)
ESCAPES = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f", b"(": b"(", b")": b")", b"\\": b"\\"}
NAME_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")
DELIMITERS = b"()<>[]{}/%"
WHITE = b"\0\t\n\f\r "


def unescape(name: bytes) -> bytes:
    return NAME_ESCAPE.sub(lambda match: bytes([int(match.group(1), 16)]), name)


NUMBER = re.compile(rb"[+-]?(\d+\.?\d*|\.\d+)$")


class Ref:
    """An indirect reference, `n g R`: its object is not followed, so it reads as no value."""


def string_end(data: bytes, at: int) -> int:
    """Where the literal string opened at `at` ends, past its closing parenthesis."""
    depth, at = 1, at + 1
    while at < len(data) and depth:
        if data[at : at + 1] == b"\\":
            at += 2
            continue
        depth += {b"(": 1, b")": -1}.get(data[at : at + 1], 0)
        at += 1
    return at


def tokens(data: bytes) -> list[object]:
    """Objects as nested lists: a dictionary or an array is a list (a dictionary's keys and values
    alternate), a name is a str, a number a float, `null` None, a string bytes, `n g R` a Ref."""
    stack: list[list[object]] = [[]]
    at = 0
    while at < len(data):
        byte = data[at : at + 1]
        if data.startswith(b"<<", at) or byte == b"[":
            stack.append([])
            at += 1 if byte == b"[" else 2
        elif data.startswith(b">>", at) or byte == b"]":
            inner = stack.pop() if len(stack) > 1 else []
            stack[-1].append(inner)
            at += 1 if byte == b"]" else 2
        elif byte == b"(":
            end = string_end(data, at)
            stack[-1].append(data[at:end])
            at = end
        elif byte == b"<":
            end = data.find(b">", at) + 1 or len(data)
            stack[-1].append(data[at:end])
            at = end
        elif byte == b"%":
            at = len(data) if (end := re.search(rb"[\r\n]", data[at:])) is None else at + end.end()
        elif data[at] in WHITE:
            at += 1
        else:
            end = at + 1
            while end < len(data) and data[end] not in WHITE and data[end] not in DELIMITERS:
                end += 1
            word, at = data[at:end], end
            if word.startswith(b"/"):
                stack[-1].append(unescape(word[1:]).decode("latin-1"))
            elif NUMBER.match(word):
                stack[-1].append(float(word))
            elif word == b"R" and len(stack[-1]) >= 2 and all(isinstance(v, float) for v in stack[-1][-2:]):
                del stack[-1][-2:]
                stack[-1].append(Ref())
            elif word == b"null":
                stack[-1].append(None)
    return stack[0]


def dictionary(data: bytes) -> dict[str, object]:
    """The dictionary a `stream` keyword at the end of `data` follows: the last one after the last `obj`."""
    found = [value for value in tokens(data[data.rfind(b"obj") + 1 :]) if isinstance(value, list) and value and isinstance(value[0], str)]
    entries = found[-1] if found else []
    return {key: value for key, value in zip(entries[::2], entries[1::2], strict=False) if isinstance(key, str)}


def predicted(data: bytes, parms: object) -> bytes:
    if not isinstance(parms, list):
        return data
    values = dict(zip(parms[::2], parms[1::2], strict=False))
    predictor, colors = int(values.get("Predictor", 1) or 1), int(values.get("Colors", 1) or 1)
    columns, bits = int(values.get("Columns", 1) or 1), int(values.get("BitsPerComponent", 8) or 8)
    if predictor == 2:
        return apply_tiff_predictor(colors, columns, bits, data)
    if predictor >= 10:
        return apply_png_predictor(predictor, colors, columns, bits, data)
    return data


DECODERS = {"LZWDecode": lzwdecode, "ASCII85Decode": ascii85decode, "ASCIIHexDecode": asciihexdecode, "RunLengthDecode": rldecode}


def filters_of(head: dict[str, object]) -> list[str | None]:
    """A stream's filter names in full; None for a filter that is not a name."""
    filters = head.get("Filter")
    filters = filters if isinstance(filters, list) else [filters] if isinstance(filters, str) else []
    return [FULL_NAMES.get(name, name) if isinstance(name, str) else None for name in filters]


def decoded(data: bytes, head: dict[str, object]) -> list[bytes]:
    """The output of each filter of the stream's chain in turn, and after a Flate layer the bytes
    past its zlib data's end. It stops at a filter it does not decode, or one that fails."""
    filters = filters_of(head)
    parms = head.get("DecodeParms")
    # An array of parameters, one per filter, or one dictionary, the first filter's (a dictionary's list starts with a key).
    parms = parms if isinstance(parms, list) and not (parms and isinstance(parms[0], str)) else [parms]
    stages = []
    for index, name in enumerate(filters):
        try:
            if name == "FlateDecode":
                inflater = zlib.decompressobj()
                data, after = inflater.decompress(data), inflater.unused_data
                stages.append(after)
            elif name in DECODERS:
                data = DECODERS[name](data)
            else:
                break
            data = predicted(data, parms[index] if index < len(parms) else None)
        except Exception:
            break
        stages.append(data)
    return stages


def segments(pdf: bytes) -> list[bytes]:
    """The file outside streams, then for each stream: the output of each filter of its chain, and
    its bytes inflated with what follows its zlib data's end when they inflate, whatever its filters
    say, or its undecoded bytes when they don't, where the bytes after another decoder's end lie."""
    found = [STREAM.sub(b"stream endstream", pdf)]
    previous = 0
    for match in STREAM.finditer(pdf):
        data = match.group(1)
        head = dictionary(pdf[previous : match.start()])
        previous = match.end()
        stages = decoded(data, head)
        found += stages
        # A chain that starts with Flate and inflates has had its zlib pass already.
        if stages and filters_of(head)[:1] == ["FlateDecode"]:
            continue
        inflater = zlib.decompressobj()
        try:
            found += [inflater.decompress(data), inflater.unused_data]
        except zlib.error:
            found.append(data)
    return found


def literal_strings(data: bytes) -> list[bytes]:
    """Every (literal) string, with escapes and balanced parentheses handled."""
    strings, i = [], 0
    while (start := data.find(b"(", i)) != -1:
        out, depth, i = bytearray(), 1, start + 1
        while i < len(data) and depth:
            byte = data[i : i + 1]
            if byte == b"\\":
                following = data[i + 1 : i + 2]
                octal = re.match(rb"[0-7]{1,3}", data[i + 1 : i + 4])
                if octal:
                    out.append(int(octal.group(), 8) & 0xFF)
                    i += 1 + len(octal.group())
                    continue
                out += ESCAPES.get(following, b"" if following in (b"\n", b"\r") else following)
                i += 2
                continue
            depth += {b"(": 1, b")": -1}.get(byte, 0)
            if depth:
                out += byte
            i += 1
        strings.append(bytes(out))
    return strings


def hex_strings(data: bytes) -> list[bytes]:
    found = []
    for match in re.finditer(rb"<([0-9A-Fa-f\s]+)>", data):
        digits = re.sub(rb"\s", b"", match.group(1))
        found.append(bytes.fromhex((digits + b"0" * (len(digits) % 2)).decode()))
    return found


def decodings(string: bytes) -> list[str]:
    """A string read every way a PDF may hold text: UTF-16 with or without a byte-order mark,
    UTF-8 with one, PDFDocEncoding, and Latin-1."""
    if string.startswith(b"\xfe\xff"):
        return [string[2:].decode("utf-16-be", "replace")]
    if string.startswith(b"\xff\xfe"):
        return [string[2:].decode("utf-16-le", "replace")]
    if string.startswith(b"\xef\xbb\xbf"):
        return [string[3:].decode("utf-8", "replace")]
    found = [string.decode("latin-1"), "".join(PDFDocEncoding[byte] for byte in string)]
    if len(string) % 2 == 0:
        found += [string.decode("utf-16-be", "replace"), string.decode("utf-16-le", "replace")]
    return found


def texts(pdf: bytes) -> list[str]:
    """Each segment as text, with its names' `#xx` escapes undone, and its strings each way they
    can be read, alone and joined, so text split across a TJ array joins up."""
    found = []
    for segment in segments(pdf):
        found += [segment.decode("latin-1"), segment.decode("utf-8", "replace"), unescape(segment).decode("latin-1")]
        strings = literal_strings(segment) + hex_strings(segment)
        read = [decodings(string) for string in strings]
        found += ["".join(each[way] if way < len(each) else each[0] for each in read) for way in range(max(map(len, read), default=0))]
        found += [text for each in read for text in each]
    return found
