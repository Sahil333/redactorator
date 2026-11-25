// Cutting the metadata out of an image's encoded bytes, without decoding its pixels
// (docs/designs/pdf-leak-suite.md, Appendix A.2). Each returns the bytes to keep, the same array
// when nothing was cut, or undefined when the data can't be walked, which refuses the document.

const be16 = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const be32 = (bytes: Uint8Array, at: number) => (be16(bytes, at) * 0x10000 + be16(bytes, at + 2)) >>> 0;

const join = (parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  return joined;
};

/** One part of an image's data: where it ends, whether it stays, and whether it is the last that counts. */
interface Part {
  readonly end: number;
  readonly kept: boolean;
  readonly last?: boolean;
}

/**
 * The parts of `bytes` from `at` on, as `partAt` reads each, to the last: the bytes kept, and
 * whether any were cut, bytes after the last part included. Undefined when one can't be read.
 */
function keptParts(bytes: Uint8Array, at: number, partAt: (at: number) => Part | undefined): { readonly kept: Uint8Array[]; readonly cut: boolean } | undefined {
  const kept: Uint8Array[] = [];
  let cut = false;
  while (at < bytes.length) {
    const part = partAt(at);
    if (part === undefined || part.end <= at) return undefined;
    if (part.kept) kept.push(bytes.subarray(at, part.end));
    else cut = true;
    at = part.end;
    if (part.last) return { kept, cut: cut || at < bytes.length };
  }
  return { kept, cut };
}

const ADOBE = [0x41, 0x64, 0x6f, 0x62, 0x65];
const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;
const isApp = (marker: number) => marker >= 0xe0 && marker <= 0xef;
// The segments that draw the image: frames (SOFn), tables (DHT, DAC, DQT), scans (SOS) and their
// line and restart settings (DNL, DRI) and hierarchical marks (DHP, EXP). APPn, comments and the
// JPGn extensions, which decoders skip, are cut; any other marker can't be walked.
const isImageSegment = (marker: number) => (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc8) || (marker >= 0xda && marker <= 0xdf);
const isSkipped = (marker: number) => isApp(marker) || marker === 0xfe || (marker >= 0xf0 && marker <= 0xfd);
// Adobe's APP14 is "Adobe", a version, two flags and a transform: 12 bytes, a length of 14.
const ADOBE_LENGTH = 14;

/** Where a scan's entropy-coded data ends: at the next marker that is not a stuffed zero or a restart. */
function scanEnd(bytes: Uint8Array, at: number): number {
  while (at < bytes.length && (bytes[at] !== 0xff || bytes[at + 1] === 0 || isRestart(bytes[at + 1] ?? 0))) at += bytes[at] === 0xff ? 2 : 1;
  return at;
}

/**
 * The JPEG part at `at`: a marker, or a marker segment, and a scan's data with its header.
 * Only Adobe's APP14 stays among the APPn segments, and no comment does. The end-of-image marker
 * ends the data: what follows it is never decoded, so it goes.
 */
function jpegPart(bytes: Uint8Array, at: number): Part | undefined {
  if (bytes[at] !== 0xff) return undefined;
  const marker = bytes[at + 1] ?? 0;
  // A fill byte before a marker, a restart, or a marker with no segment.
  if (marker === 0xff) return { end: at + 1, kept: true };
  if (marker === 0x01 || isRestart(marker)) return { end: at + 2, kept: true };
  if (marker === 0xd9) return { end: at + 2, kept: true, last: true };
  const end = at + 2 + be16(bytes, at + 2);
  return end < at + 4 || end > bytes.length ? undefined : jpegSegment(bytes, at, marker, end);
}

/** A JPEG marker segment that runs from `at` to `end`, and for a scan its data after it. */
function jpegSegment(bytes: Uint8Array, at: number, marker: number, end: number): Part | undefined {
  if (marker === 0xee && ADOBE.every((byte, index) => bytes[at + 4 + index] === byte)) {
    // It decides how the colours decode, so one holding more than its fields can't be cut.
    return be16(bytes, at + 2) === ADOBE_LENGTH ? { end, kept: true } : undefined;
  }
  if (isSkipped(marker)) return { end, kept: false };
  return isImageSegment(marker) ? { end: marker === 0xda ? scanEnd(bytes, end) : end, kept: true } : undefined;
}

/** A JPEG with only Adobe's APP14 among its APPn segments, no comment segments, and nothing after its end, through every scan. */
export function cutJpeg(bytes: Uint8Array): Uint8Array | undefined {
  if (be16(bytes, 0) !== 0xffd8) return undefined;
  const parts = keptParts(bytes, 2, (at) => jpegPart(bytes, at));
  // A JPEG with no end-of-image marker can't be told from a damaged one.
  if (parts === undefined || be16(parts.kept.at(-1) ?? new Uint8Array(), 0) !== 0xffd9) return undefined;
  return parts.cut ? join([bytes.subarray(0, 2), ...parts.kept]) : bytes;
}

const COM = 0xff64;
const SOT = 0xff90;
const SOD = 0xff93;
const EOC = 0xffd9;

/** The header segment at `at` in a J2K codestream; a comment does not stay. */
function codestreamSegment(bytes: Uint8Array, at: number, limit: number): Part | undefined {
  const marker = be16(bytes, at);
  const end = at + 2 + be16(bytes, at + 2);
  return (marker & 0xff00) !== 0xff00 || end > limit ? undefined : { end, kept: marker !== COM };
}

/** A tile-part from its SOT on, without comments in its header, with its length (Psot) fixed to match. */
function tilePart(bytes: Uint8Array, at: number): { readonly end: number; readonly bytes: Uint8Array } | undefined {
  // Psot counts from SOT itself; 0 runs to the end of the codestream.
  const psot = be32(bytes, at + 6);
  const end = psot === 0 ? bytes.length - 2 : at + psot;
  if (end > bytes.length || be16(bytes, at + 2) !== 10) return undefined;
  let data = at + 12;
  while (data < end && be16(bytes, data) !== SOD) {
    const segment = codestreamSegment(bytes, data, end);
    if (segment === undefined) return undefined;
    data = segment.end;
  }
  const headers = bytes.subarray(at + 12, data);
  const header = keptParts(headers, 0, (inner) => codestreamSegment(headers, inner, headers.length));
  if (header === undefined || data >= end) return undefined;
  if (!header.cut) return { end, bytes: bytes.subarray(at, end) };
  const sot = bytes.slice(at, at + 12);
  const rest = [...header.kept, bytes.subarray(data, end)];
  if (psot !== 0) new DataView(sot.buffer).setUint32(6, rest.reduce((sum, part) => sum + part.length, sot.length));
  return { end, bytes: join([sot, ...rest]) };
}

/** A JPEG 2000 codestream with its comment (COM) marker segments dropped, from its main header and each tile-part's. */
function cutCodestream(bytes: Uint8Array): Uint8Array | undefined {
  if (be16(bytes, 0) !== 0xff4f) return undefined;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at < bytes.length && be16(bytes, at) !== EOC) {
    const part = be16(bytes, at) === SOT ? tilePart(bytes, at) : codestreamSegment(bytes, at, bytes.length);
    if (part === undefined) return undefined;
    if ("bytes" in part) kept.push(part.bytes);
    else if (part.kept) kept.push(bytes.subarray(at, part.end));
    at = part.end;
  }
  if (be16(bytes, at) !== EOC) return undefined;
  const cut = join([...kept, bytes.subarray(at, at + 2)]);
  // Bytes after the end of the codestream are never decoded, so they go too.
  return cut.length === bytes.length && cut.every((byte, index) => byte === bytes[index]) ? bytes : cut;
}

const box = (type: string, body: Uint8Array): Uint8Array => {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, 8 + body.length);
  head.set([...type].map((c) => c.charCodeAt(0)), 4);
  return join([head, body]);
};

interface Box {
  readonly type: string;
  readonly body: Uint8Array;
}

/** The box at `at`, and where it ends; undefined when it runs past the end. */
function boxAt(bytes: Uint8Array, at: number): (Box & { readonly end: number }) | undefined {
  const size = be32(bytes, at);
  // A size of 1 has a 64-bit size after the type; 0 runs to the end.
  const start = at + (size === 1 ? 16 : 8);
  const sizes: Record<number, number> = { 0: bytes.length - at, 1: be32(bytes, at + 8) * 2 ** 32 + be32(bytes, at + 12) };
  const end = at + (sizes[size] ?? size);
  if (end > bytes.length || end < start) return undefined;
  return { type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), body: bytes.subarray(start, end), end };
}

/** The boxes in `bytes`; undefined when one runs past the end. */
function boxesOf(bytes: Uint8Array): Box[] | undefined {
  const found: Box[] = [];
  for (let at = 0; at < bytes.length; ) {
    const next = boxAt(bytes, at);
    if (next === undefined) return undefined;
    found.push(next);
    at = next.end;
  }
  return found;
}

const KEPT_BOXES = new Set(["jP  ", "ftyp", "jp2h", "jp2c"]);
// `cdef` says which channel is opacity, so it draws the image too.
const KEPT_HEADER_BOXES = new Set(["ihdr", "colr", "bpcc", "pclr", "cmap", "cdef"]);

/** A kept box's body with what it holds cut: the header's other boxes, and the codestream's comments. */
function cutBox({ type, body }: Box): Uint8Array | undefined {
  if (type === "jp2c") return cutCodestream(body);
  if (type !== "jp2h") return body;
  const inner = boxesOf(body);
  const header = inner?.filter((each) => KEPT_HEADER_BOXES.has(each.type));
  if (inner === undefined || header === undefined) return undefined;
  return header.length === inner.length ? body : join(header.map((each) => box(each.type, each.body)));
}

/** A JPEG 2000 image, JP2 file or raw codestream, with only the boxes that draw it and no comment segments. */
export function cutJpx(bytes: Uint8Array): Uint8Array | undefined {
  if (be16(bytes, 0) === 0xff4f) return cutCodestream(bytes);
  const boxes = boxesOf(bytes);
  if (boxes?.[0]?.type !== "jP  ") return undefined;
  // Only the first codestream draws the image: a second one is a carrier.
  const codestream = boxes.findIndex(({ type }) => type === "jp2c");
  // A JP2 file with no codestream box draws nothing we can check, as one with a fragment table.
  if (codestream === -1) return undefined;
  const kept = boxes.filter(({ type }, index) => KEPT_BOXES.has(type) && (type !== "jp2c" || index === codestream));
  const bodies = kept.map(cutBox);
  if (bodies.some((body) => body === undefined)) return undefined;
  const cut = kept.length < boxes.length || bodies.some((body, index) => body !== kept[index]?.body);
  return cut ? join(kept.map(({ type }, index) => box(type, bodies[index] ?? new Uint8Array()))) : bytes;
}
