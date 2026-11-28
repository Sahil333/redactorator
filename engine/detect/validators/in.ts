import { luhn, verhoeff } from "./shared";

const isPalindrome = (value: string): boolean => value === [...value].reverse().join("");

/** An Aadhaar number: 12 digits, the first 2 to 9, not a palindrome, passing the Verhoeff check (python-stdnum, `in_.aadhaar`). */
export const aadhaar = (value: string): boolean => /^[2-9]\d{11}$/.test(value) && !isPalindrome(value) && verhoeff(value);

/** An Aadhaar Virtual ID: 16 digits, the first 2 to 9, not a palindrome, passing the Verhoeff check (python-stdnum, `in_.vid`). */
export const aadhaarVid = (value: string): boolean => /^[2-9]\d{15}$/.test(value) && !isPalindrome(value) && verhoeff(value);

const base36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A GSTIN's check character: Luhn over base 36, as python-stdnum's `in_.gstin` computes it with `luhn.checksum(number, alphabet)`. */
export function gstin(value: string): boolean {
  const values = [...value.toUpperCase()].reverse().map((c) => base36.indexOf(c));
  if (value.length !== 15 || values.includes(-1)) return false;
  const sum = values.reduce((total, v, place) => total + (place % 2 === 1 ? Math.floor((v * 2) / 36) + ((v * 2) % 36) : v), 0);
  return sum % 36 === 0;
}

/** A voter ID (EPIC): 3 letters and 7 digits, the digits passing the Luhn check (python-stdnum, `in_.epic`). */
export const epic = (value: string): boolean => /^[A-Za-z]{3}\d{7}$/.test(value) && luhn(value.slice(3));
