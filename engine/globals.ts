// The platform globals the engine uses, for configs without the DOM library. Node 20 and
// later, Bun and browsers provide all three. A .ts file, not a .d.ts, so the typecheck
// reads these declarations instead of skipping them under skipLibCheck.
declare global {
  const crypto: {
    randomUUID(): string;
    readonly subtle: { digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer> };
  };

  class TextDecoder {
    decode(input?: Uint8Array): string;
  }
}

export {};
