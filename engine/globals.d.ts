// The platform globals the engine uses, for configs without the DOM library. Node 20 and
// later, Bun and browsers provide all three.
declare const crypto: {
  randomUUID(): string;
  readonly subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
};

declare class TextDecoder {
  decode(input?: Uint8Array): string;
}
