import { verhoeff } from "./shared";

/** An Aadhaar number: 12 digits, the first 2 to 9, not a palindrome, passing the Verhoeff check (python-stdnum, `in_.aadhaar`). */
export const aadhaar = (value: string): boolean => /^[2-9]\d{11}$/.test(value) && value !== [...value].reverse().join("") && verhoeff(value);
