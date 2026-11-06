import catalogue from "../../data/cfop-official-2026.json";

export type CfopRecord = (typeof catalogue.records)[number];
export const cfopMetadata = {
  source: catalogue.source,
  sourceUrl: catalogue.sourceUrl,
  document: catalogue.document,
  publishedOn: catalogue.publishedOn,
  sourceSha256: catalogue.sourceSha256,
};
export const cfopRecords: ReadonlyArray<CfopRecord> = catalogue.records;
const validCodes = new Set(cfopRecords.map(record => record.code));

/** A personalização nunca pode adicionar um CFOP fictício. */
export function isOfficialCfopCode(code: string): boolean {
  return validCodes.has(code);
}

export function validCfopLabel(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const label = input.trim().replace(/\s+/g, " ");
  if (label.length < 2 || label.length > 140 || /[\u0000-\u001f\u007f]/.test(label)) return null;
  return label;
}
