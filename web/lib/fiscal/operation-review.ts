/**
 * Checagens estruturais de operação para rascunhos NF-e modelo 55.
 * Nunca decide CFOP, CST, alíquotas ou autorização de emissão.
 */
const UF = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);

export type OperationReview = {
  operation: "interna" | "interestadual" | "indeterminada";
  pending: string[];
};

export function reviewNfeOperation(issuerUfRaw: unknown, recipientUfRaw: unknown, cfop: string, itemNumber: number): OperationReview {
  const issuerUf = typeof issuerUfRaw === "string" ? issuerUfRaw.trim().toUpperCase() : "";
  const recipientUf = typeof recipientUfRaw === "string" ? recipientUfRaw.trim().toUpperCase() : "";
  const pending: string[] = [];
  const prefix = `Item ${itemNumber}: `;
  if (!UF.has(issuerUf)) pending.push("UF do emitente ausente ou inválida");
  if (!UF.has(recipientUf)) pending.push("UF do destinatário ausente ou inválida");
  // The user-selected CFOP is the item-level operation suggestion. Party UFs
  // alone cannot identify the delivery destination or the full tax treatment.
  const operation = cfop[0] === "5" ? "interna" : cfop[0] === "6" ? "interestadual" : "indeterminada";
  if (cfop) {
    if (!["5","6","7"].includes(cfop[0])) {
      pending.push(prefix + "CFOP de entrada não deve ser usado automaticamente em uma NF-e de saída");
    }
    if (cfop[0] === "7") pending.push(prefix + "CFOP de exterior exige conferência específica de exportação");
  }
  return { operation, pending };
}
