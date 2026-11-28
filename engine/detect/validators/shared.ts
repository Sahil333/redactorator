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
