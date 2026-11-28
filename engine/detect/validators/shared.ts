/** Whether a string of digits passes the Luhn check: from the right, every second digit doubled, digits summed, a multiple of 10. */
export function luhn(digits: string): boolean {
  let sum = 0;
  for (const [place, digit] of [...digits].reverse().entries()) {
    const value = Number(digit);
    const weighted = place % 2 === 1 ? value * 2 : value;
    sum += weighted > 9 ? weighted - 9 : weighted;
  }
  return digits !== "" && sum % 10 === 0;
}

// The tables of the Verhoeff check, as python-stdnum's `verhoeff` module gives them.
const multiplication = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const permutation = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Whether a string of digits passes the Verhoeff check: from the right, through the tables above, ending at 0. */
export function verhoeff(digits: string): boolean {
  let check = 0;
  for (const [place, digit] of [...digits].reverse().entries()) {
    check = multiplication[check]?.[permutation[place % 8]?.[Number(digit)] ?? 0] ?? 0;
  }
  return /^\d+$/.test(digits) && check === 0;
}

/** The remainder of a string of digits, read as one number, divided by 97: ISO 7064 MOD 97-10 without its big numbers. */
export function mod97(digits: string): number {
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder;
}

/** The sum of each digit times the weight at its place, from the left; weights past the last one count nothing. */
export const weightedSum = (digits: string, weights: readonly number[]): number =>
  [...digits].reduce((sum, digit, place) => sum + Number(digit) * (weights[place] ?? 0), 0);
