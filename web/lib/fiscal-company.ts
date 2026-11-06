import { JvgBackendError } from "./jvg-errors";

const STATES = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));

const txt = (value: unknown, max: number): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const digits = (value: unknown): string => String(value ?? "").replace(/\D/g, "");

export function validCnpj(value: unknown): boolean {
  const cnpj = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  for (let size = 12; size < 14; size++) {
    const weights = size === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    // Receita Federal (2026): valor do caractere = codigo ASCII - 48.
    const remainder = weights.reduce((sum, weight, index) => sum + (cnpj.charCodeAt(index) - 48) * weight, 0) % 11;
    const checkDigit = remainder < 2 ? 0 : 11 - remainder;
    if (Number(cnpj[size]) !== checkDigit) return false;
  }
  return true;
}

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

export function fiscalMissing(company: Record<string, unknown>): string[] {
  const a = company.address && typeof company.address === "object" && !Array.isArray(company.address)
    ? company.address as Record<string, unknown> : {};
  const checks: Array<[string, boolean]> = [
    ["Razão social definitiva", Boolean(txt(company.legal_name, 160)) && txt(company.legal_name, 160) !== "Empresa Piloto JVG"],
    ["CNPJ válido", validCnpj(company.cnpj)],
    ["Inscrição Estadual", Boolean(txt(company.state_registration, 40))],
    ["CNAE", /^\d{7}$/.test(String(company.cnae ?? ""))],
    ["Logradouro", Boolean(txt(a.street, 160))],
    ["Número", Boolean(txt(a.number, 20))],
    ["Bairro", Boolean(txt(a.district, 100))],
    ["Município", Boolean(txt(a.city, 100))],
    ["UF", STATES.has(String(a.state ?? ""))],
    ["CEP", /^\d{8}$/.test(String(a.postalCode ?? ""))],
    ["Código IBGE do município", /^\d{7}$/.test(String(a.cityCode ?? ""))],
    ["Série de NF-e em homologação", Number(company.nfe_series_homologacao) >= 1],
    ["Próximo número de NF-e em homologação", Number(company.nfe_next_number_homologacao) >= 1],
  ];
  return checks.filter(([, done]) => !done).map(([name]) => name);
}
