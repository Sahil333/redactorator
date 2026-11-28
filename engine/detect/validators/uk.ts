// The validators of the `uk` pack, each exported by the name its rules give in `validator`.
import { weightedSum } from "./shared";

/**
 * An NHS number: 10 digits; the first nine weighted 10 down to 2, and the check digit is 11 less
 * the sum modulo 11, 11 giving 0 and 10 never issued (NHS Data Dictionary, NHS Number). Weighting
 * the check digit by 1 folds that into one sum that is a multiple of 11 (python-stdnum, `gb.nhs`).
 */
export const nhsNumber = (value: string): boolean => /^\d{10}$/.test(value) && weightedSum(value, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) % 11 === 0;

/**
 * A 10-digit UTR: the first digit is the check digit, taken from "21987654321" at the weighted
 * sum of the other nine (6, 7, 8, 9, 10, 5, 4, 3, 2) modulo 11 (python-stdnum, `gb.utr`).
 */
export const utr = (value: string): boolean =>
  /^\d{10}$/.test(value) && value[0] === "21987654321"[weightedSum(value.slice(1), [6, 7, 8, 9, 10, 5, 4, 3, 2]) % 11];

/**
 * A UK VAT number of 9 digits, or 12 with a branch: the first nine weighted 8 down to 2, then 10
 * and 1, modulo 97, give 0; numbers from 100 0000 00 up may also give 42 or 55; the branch is not
 * checked (python-stdnum, `gb.vat`).
 */
export function vatNumber(value: string): boolean {
  const nine = /^(\d{9})(?:\d{3})?$/.exec(value)?.[1];
  if (nine === undefined) return false;
  const remainder = weightedSum(nine, [8, 7, 6, 5, 4, 3, 2, 10, 1]) % 97;
  return remainder === 0 || (Number(nine.slice(0, 3)) >= 100 && (remainder === 42 || remainder === 55));
}

/**
 * A UK VAT number of a government department (GD and 000 to 499) or a health authority (HA and
 * 500 to 999), alone or after 8888 with two check digits, the three digits modulo 97
 * (python-stdnum, `gb.vat`).
 */
export function vatDepartment(value: string): boolean {
  const [, kind, alone, long, check] = /^(GD|HA)(?:(\d{3})|8888(\d{3})(\d{2}))$/.exec(value) ?? [];
  const number = Number(alone ?? long);
  const inRange = kind === "GD" ? number < 500 : kind === "HA" && number >= 500;
  return inRange && (check === undefined || Number(check) === number % 97);
}

/**
 * A UK driving licence number's fields that can be checked: the surname's five places are letters
 * then 9s, the month (places 7 and 8) is 01 to 12, or 51 to 62, and the day (places 9 and 10) is
 * 01 to 31. The DVLA's check characters are not public (Presidio, `uk_driving_licence_recognizer.py`).
 */
export function drivingLicence(value: string): boolean {
  const month = Number(value.slice(6, 8));
  const day = Number(value.slice(8, 10));
  return /^[A-Z]+9*$/.test(value.slice(0, 5)) && ((month >= 1 && month <= 12) || (month >= 51 && month <= 62)) && day >= 1 && day <= 31;
}
