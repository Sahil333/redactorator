"""A raw scan of a PDF file's bytes: every stream inflated, every string decoded.

Shares nothing with pdfminer or MuPDF, so a value one extractor misses can still
be caught here, wherever in the file it sits.
"""

import re
import zlib

STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.DOTALL)
ESCAPES = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f", b"(": b"(", b")": b")", b"\\": b"\\"}


def segments(pdf: bytes) -> list[bytes]:
    """The file outside streams, then each stream's bytes, inflated when they inflate, with any bytes
    after the compressed data's end, which no reader decodes but which stay in the file."""
    found = [STREAM.sub(b"stream endstream", pdf)]
    for match in STREAM.finditer(pdf):
        data = match.group(1)
        inflater = zlib.decompressobj()
        try:
            found.append(inflater.decompress(data))
            found.append(inflater.unused_data)
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


def decode(string: bytes) -> str:
    if string.startswith(b"\xfe\xff"):
        return string[2:].decode("utf-16-be", "replace")
    if string.startswith(b"\xef\xbb\xbf"):
        return string[3:].decode("utf-8", "replace")
    return string.decode("latin-1")


def texts(pdf: bytes) -> list[str]:
    """Each segment as text, and the concatenation of its strings, so text split across a TJ array joins up."""
    found = []
    for segment in segments(pdf):
        found.append(segment.decode("latin-1"))
        found.append(segment.decode("utf-8", "replace"))
        strings = literal_strings(segment) + hex_strings(segment)
        found.append("".join(decode(string) for string in strings))
        found.extend(decode(string) for string in strings)
    return found
