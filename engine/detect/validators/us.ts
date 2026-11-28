import { luhn, weightedSum } from "./shared";

/** An ABA routing number: 9 digits whose sum with the weights 3, 7, 1 repeated is a multiple of 10 (Presidio, `aba_routing_recognizer.py`; python-stdnum `us.rtn`). */
export const abaRouting = (value: string): boolean => /^\d{9}$/.test(value) && weightedSum(value, [3, 7, 1, 3, 7, 1, 3, 7, 1]) % 10 === 0;

/** An NPI: 10 digits, the first 1 or 2, passing the Luhn check with "80840" before them (Presidio, `us_npi_recognizer.py`). */
export const npi = (value: string): boolean => /^[12]\d{9}$/.test(value) && luhn(`80840${value}`);

/**
 * A DEA number: two letters, or a letter and a 9, then seven digits. The last digit is the ones
 * digit of the first, third and fifth digits plus twice the second, fourth and sixth (Oracle,
 * Siebel ePharma Handheld Guide, "Validating the DEA Number"; Wikipedia, "DEA number").
 */
export function deaNumber(value: string): boolean {
  const digits = value.slice(-7);
  return /^[A-Za-z][A-Za-z9]\d{7}$/.test(value) && weightedSum(digits, [1, 2, 1, 2, 1, 2]) % 10 === Number(digits[6]);
}
