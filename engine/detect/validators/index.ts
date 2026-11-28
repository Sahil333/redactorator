import { card } from "./universal";

/** A check on a value's letters and digits: true when it passes. It looks nothing up. */
export type Validator = (value: string) => boolean;

/** Every validator a rule can name. */
export const validators: Readonly<Record<string, Validator>> = { card };
