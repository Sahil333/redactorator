export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const isOffset = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export function parseAll<T>(values: unknown, parse: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const parsed: T[] = [];
  for (const value of values) {
    const one = parse(value);
    if (one === undefined) return undefined;
    parsed.push(one);
  }
  return parsed;
}

export const isText = (value: unknown): value is string => typeof value === "string";
