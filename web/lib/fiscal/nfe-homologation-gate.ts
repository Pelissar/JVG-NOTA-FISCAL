import { reviewNfeDocument, reviewFocusNfePayload } from "./nfe-document-review.ts";

type Json = Record<string, unknown>;

export type NfeHomologationGate = {
  ready: boolean;
  issues: string[];
  focusRequestPreview: Json;
  reviewCount: number;
};

// Optional profile administration check. This helper is not called by the
// NF-e draft or transmission gates; profile review never authorizes emission.
export function reviewApprovedTaxProfile(value: unknown): { ready: boolean; issue: string | null } {
  const profile = obj(value);
  const rules = obj(profile.rules);
  const approval = obj(rules.accountantReview);
  const name = typeof approval.name === "string" ? approval.name.trim() : "";
  const declaredBy = typeof approval.declaredBy === "string" ? approval.declaredBy.trim() : "";
  const declaredAt = typeof approval.declaredAt === "string" ? Date.parse(approval.declaredAt) : Number.NaN;
  const sameReviewer = declaredBy.length > 0 && declaredBy === profile.reviewed_by;
  const ready = profile.review_status === "reviewed" && name.length >= 3 && name.length <= 120 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(declaredBy) &&
    Number.isFinite(declaredAt) && sameReviewer && rules.requiresAccountantReview === false;
  return { ready, issue: ready ? null : "a declaração registrada de revisão contábil está ausente ou desatualizada." };
}

const obj = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

/**
 * Gate de preparação para uma transmissão explicitamente confirmada em
 * homologação. Não exige perfil tributário nem declaração de contador.
 * Não trata estimativas como imposto e não habilita produção.
 */
export function reviewNfeHomologationGate(value: unknown): NfeHomologationGate {
  const payload = obj(value);
  const documentReview = reviewNfeDocument(payload);
  const focusReview = reviewFocusNfePayload(payload);
  const issues: string[] = [];
  const add = (message: string) => { if (message && !issues.includes(message)) issues.push(message); };

  if (payload.schemaVersion !== 7)
    add("Este rascunho foi criado com uma estrutura fiscal anterior. Crie um novo rascunho para transmitir em homologação.");

  // A estimativa interna não é enviada à Focus; os valores fiscais enviados
  // devem vir do próprio item e passar no mapa estrutural.
  for (const check of documentReview.checks) {
    if (!check.ok && check.key !== "taxPreview" && check.key !== "transmission")
      add(`${check.label}: ${check.detail}`);
  }
  for (const check of focusReview.checks) {
    if (!check.ok) add(`${check.label}: ${check.detail}`);
  }

  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  for (const item of pending) if (typeof item === "string" && item.trim()) add(item.trim());

  return {
    ready: issues.length === 0,
    issues: issues.slice(0, 100),
    focusRequestPreview: focusReview.requestPreview,
    reviewCount: focusReview.checks.length,
  };
}
