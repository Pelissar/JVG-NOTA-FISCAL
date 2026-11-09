const STATES = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const txt = (value: unknown, max: number): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const digits = (value: unknown): string => String(value ?? "").replace(/\D/g, "");

export function validCnpj(value: unknown): boolean {
  const cnpj = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  for (let size = 12; size < 14; size++) {
    const weights = size === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const remainder = weights.reduce((sum, weight, index) => sum + (cnpj.charCodeAt(index) - 48) * weight, 0) % 11;
    const checkDigit = remainder < 2 ? 0 : 11 - remainder;
    if (Number(cnpj[size]) !== checkDigit) return false;
  }
  return true;
}

export function fiscalMissing(company: Record<string, unknown>): string[] {
  const address = company.address && typeof company.address === "object" && !Array.isArray(company.address)
    ? company.address as Record<string, unknown> : {};
  const municipalRegistration = txt(company.municipal_registration, 40);
  const cnae = digits(company.cnae);
  const checks: Array<[string, boolean]> = [
    ["Razão social definitiva", Boolean(txt(company.legal_name, 160)) && txt(company.legal_name, 160) !== "Empresa Piloto JVG"],
    ["CNPJ válido", validCnpj(company.cnpj)],
    ["Inscrição Estadual", Boolean(txt(company.state_registration, 40))],
    ["CNAE (obrigatório com inscrição municipal)", !municipalRegistration || /^\d{7}$/.test(cnae)],
    ["Inscrição Municipal (obrigatória com CNAE)", !cnae || Boolean(municipalRegistration)],
    ["Logradouro", Boolean(txt(address.street, 160))],
    ["Número", Boolean(txt(address.number, 20))],
    ["Bairro", Boolean(txt(address.district, 100))],
    ["Município", Boolean(txt(address.city, 100))],
    ["UF", STATES.has(String(address.state ?? ""))],
    ["CEP", /^\d{8}$/.test(String(address.postalCode ?? ""))],
    ["Código IBGE do município", /^\d{7}$/.test(String(address.cityCode ?? ""))],
  ];
  return checks.filter(([, done]) => !done).map(([name]) => name);
}

