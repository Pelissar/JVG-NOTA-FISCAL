import { JvgBackendError } from "./jvg-errors";

const STATES = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));

const txt = (value: unknown, max: number): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const digits = (value: unknown): string => String(value ?? "").replace(/\D/g, "");

export { fiscalMissing, validCnpj } from "./fiscal-company-profile";

export function fiscalAddress(data: Record<string, unknown>): Record<string, string> {
  const address = {
    street: txt(data.street, 160),
    number: txt(data.number, 20),
    complement: txt(data.complement, 100),
    district: txt(data.district, 100),
    city: txt(data.city, 100),
    state: txt(data.state, 2).toUpperCase(),
    postalCode: digits(data.postalCode),
    cityCode: digits(data.cityCode),
  };
  if (address.state && !STATES.has(address.state)) throw new JvgBackendError("UF do endereço inválida.", 400);
  if (address.postalCode && address.postalCode.length !== 8) throw new JvgBackendError("CEP deve ter 8 dígitos.", 400);
  if (address.cityCode && address.cityCode.length !== 7) throw new JvgBackendError("Código IBGE do município deve ter 7 dígitos.", 400);
  return address;
}

export function fiscalInteger(value: unknown, label: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max || value === "") {
    throw new JvgBackendError(`${label} deve estar entre ${min} e ${max}.`, 400);
  }
  return number;
}

