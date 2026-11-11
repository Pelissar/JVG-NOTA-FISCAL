import { reviewNfeDocument, reviewFocusNfePayload } from "./nfe-document-review.ts";

type Json = Record<string, unknown>;

export type NfeHomologationGate = {
  ready: boolean;
  issues: string[];
  focusRequestPreview: Json;
  reviewCount: number;
};

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
 * homologação. Não trata estimativas como imposto e não habilita produção.
 */
export function reviewNfeHomologationGate(value: unknown): NfeHomologationGate {
  const payload = obj(value);
  const documentReview = reviewNfeDocument(payload);
  const focusReview = reviewFocusNfePayload(payload);
  const issues: string[] = [];
  const add = (message: string) => { if (message && !issues.includes(message)) issues.push(message); };

  // A estimativa interna não é enviada à Focus; os valores fiscais enviados
  // devem vir das regras da operação revisadas e passar no mapa estrutural.
  for (const check of documentReview.checks) {
    if (!check.ok && check.key !== "taxPreview" && check.key !== "transmission")
      add(`${check.label}: ${check.detail}`);
  }
  for (const check of focusReview.checks) {
    if (!check.ok) add(`${check.label}: ${check.detail}`);
  }

  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  for (const item of pending) if (typeof item === "string" && item.trim()) add(item.trim());

  const items = Array.isArray(payload.items) ? payload.items : [];
  items.forEach((raw, index) => {
    const item = obj(raw);
    const profile = obj(item.taxProfile);
    if (profile.reviewStatus !== "reviewed") add(`Item ${index + 1}: regra fiscal não está revisada.`);
    if (profile.operationRuleConfigured !== true) add(`Item ${index + 1}: falta uma regra aprovada para a operação deste rascunho.`);
    if (profile.accountantReviewDeclared !== true) add(`Item ${index + 1}: registre a declaração de revisão contábil do perfil fiscal.`);
    if (!item.taxRules || typeof item.taxRules !== "object" || Array.isArray(item.taxRules))
      add(`Item ${index + 1}: os campos fiscais da regra não estão disponíveis.`);
  });

  return {
    ready: issues.length === 0,
    issues: issues.slice(0, 100),
    focusRequestPreview: focusReview.requestPreview,
    reviewCount: focusReview.checks.length,
  };
}
