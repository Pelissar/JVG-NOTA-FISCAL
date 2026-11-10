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
  const known = UF.has(issuerUf) && UF.has(recipientUf);
  const operation = !known ? "indeterminada" : issuerUf === recipientUf ? "interna" : "interestadual";
  if (cfop) {
    if (!["5","6","7"].includes(cfop[0])) {
      pending.push(prefix + "CFOP de entrada não deve ser usado automaticamente em uma NF-e de saída");
    } else if (operation === "interna" && cfop[0] !== "5") {
      pending.push(prefix + "CFOP não corresponde a saída interna; confira operação e destino");
    } else if (operation === "interestadual" && cfop[0] !== "6") {
      pending.push(prefix + "CFOP não corresponde a saída interestadual; confira operação e destino");
    } else if (operation === "indeterminada") {
      pending.push(prefix + "confirme o CFOP após cadastrar as UFs do emitente e destinatário");
    }
    if (cfop[0] === "7") pending.push(prefix + "CFOP de exterior exige conferência específica de exportação");
  }
  return { operation, pending };
}

export function reviewProfileConsistency(
  profileRules: Record<string, unknown> | undefined,
  cfop: string,
  csosn: string,
  itemNumber: number,
  operation: OperationReview["operation"],
): string[] {
  const pending: string[] = [];
  if (!profileRules) {
    pending.push(`Item ${itemNumber}: perfil sem regra configurada para operação ${operation}`);
    return pending;
  }
  if (profileRules.regime && profileRules.regime !== "simples_nacional")
    pending.push(`Item ${itemNumber}: regime do perfil não corresponde ao piloto Simples Nacional`);
  if (profileRules.cfop && profileRules.cfop !== cfop)
    pending.push(`Item ${itemNumber}: CFOP do rascunho difere do perfil fiscal vinculado`);
  if (profileRules.csosn && profileRules.csosn !== csosn)
    pending.push(`Item ${itemNumber}: CSOSN do rascunho difere do perfil fiscal vinculado`);
  if (!profileRules.pisCst || !profileRules.cofinsCst)
    pending.push(`Item ${itemNumber}: classificação PIS/Cofins pendente no perfil`);
  if (!profileRules.cstIbsCbs || !profileRules.classTrib)
    pending.push(`Item ${itemNumber}: CST ou classificação IBS/CBS pendente no perfil`);
  return pending;
}
