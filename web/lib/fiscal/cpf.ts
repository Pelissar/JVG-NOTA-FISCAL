/** Valida CPF brasileiro pelo cálculo oficial dos dois dígitos verificadores. */
export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const checkDigit = (length: number): number => {
    const sum = Array.from({ length }, (_, index) => Number(value[index]) * (length + 1 - index))
      .reduce((total, part) => total + part, 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return checkDigit(9) === Number(value[9]) && checkDigit(10) === Number(value[10]);
}
