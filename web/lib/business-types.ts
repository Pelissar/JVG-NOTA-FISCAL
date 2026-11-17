export const BUSINESS_TYPES = [
  { code: "comercio", label: "Comércio e loja" },
  { code: "restaurante", label: "Restaurante, bar e lanchonete" },
  { code: "mercado", label: "Mercado e supermercado" },
  { code: "farmacia", label: "Farmácia e drogaria" },
  { code: "distribuidora", label: "Distribuidora e atacado" },
  { code: "industria", label: "Indústria e fabricação" },
  { code: "logistica", label: "Logística e transportadora" },
  { code: "tecnologia", label: "Tecnologia e informática" },
  { code: "assistencia_tecnica", label: "Assistência técnica e manutenção" },
  { code: "servicos", label: "Prestação de serviços" },
  { code: "saude", label: "Clínica e saúde" },
  { code: "construcao", label: "Construção e materiais" },
  { code: "agronegocio", label: "Agronegócio" },
  { code: "hotelaria", label: "Hotelaria e hospedagem" },
  { code: "petshop", label: "Pet shop e veterinária" },
  { code: "educacao", label: "Educação" },
  { code: "beleza", label: "Salão e beleza" },
  { code: "outros", label: "Outro segmento" },
] as const;

export type BusinessTypeCode = (typeof BUSINESS_TYPES)[number]["code"];

export function businessTypeLabel(code: string): string {
  return BUSINESS_TYPES.find((item) => item.code === code)?.label ?? "Outro segmento";
}
