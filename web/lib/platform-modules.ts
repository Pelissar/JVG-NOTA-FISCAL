export const PLATFORM_MODULES = [
  { key: "core", label: "Painel e configurações", description: "Painel, perfil e dados gerais da empresa." },
  { key: "cadastros", label: "Cadastros", description: "Produtos, clientes, fornecedores e serviços." },
  { key: "comercial", label: "Comercial", description: "Orçamentos, pedidos e vendas." },
  { key: "estoque", label: "Estoque e entradas", description: "Saldos, movimentações e entrada de XML." },
  { key: "assistencia", label: "Assistência técnica", description: "Ordens de serviço e histórico técnico." },
  { key: "fiscal_nfe", label: "NF-e e histórico fiscal", description: "Preparação, emissão e consulta de NF-e." },
  { key: "nfce", label: "NFC-e", description: "Preparação e histórico de NFC-e." },
  { key: "contabilidade", label: "Contabilidade", description: "Consulta fiscal e relatórios para contador." },
  { key: "restaurante", label: "Restaurante", description: "Mesas, cozinha, pedidos e cardápio por QR Code." },
  { key: "restaurante_online", label: "Site e pedidos online do restaurante", description: "Site público, cardápio compartilhado e pedidos por QR Code/retirada." },
] as const;

export type PlatformModuleKey = (typeof PLATFORM_MODULES)[number]["key"];

export function isPlatformModuleKey(value: string): value is PlatformModuleKey {
  return PLATFORM_MODULES.some((item) => item.key === value);
}

export function defaultLegacyModuleEntitlements(): Record<PlatformModuleKey, boolean> {
  return Object.fromEntries(PLATFORM_MODULES.map(({ key }) => [key, true])) as Record<PlatformModuleKey, boolean>;
}
