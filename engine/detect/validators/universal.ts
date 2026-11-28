import { luhn } from "./shared";

/** A payment card number: 14 to 19 digits that pass the Luhn check (Microsoft Purview, credit card number). */
export const card = (value: string): boolean => /^\d{14,19}$/.test(value) && luhn(value);
