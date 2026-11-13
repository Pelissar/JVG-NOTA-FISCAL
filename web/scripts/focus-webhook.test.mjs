import test from "node:test";
import assert from "node:assert/strict";
import { focusWebhookEventKey, normalizeFocusWebhookStatus, safeFocusWebhookPayload } from "../lib/focus/webhook.ts";

test("normalizes Focus status notifications for NF-e and NFS-e", () => {
  assert.equal(normalizeFocusWebhookStatus("autorizado"), "authorized");
  assert.equal(normalizeFocusWebhookStatus("erro_autorizacao"), "rejected");
  assert.equal(normalizeFocusWebhookStatus("cancelado"), "cancelled");
  assert.equal(normalizeFocusWebhookStatus("processando_autorizacao"), "processing");
  assert.equal(normalizeFocusWebhookStatus("unknown"), null);
});

test("keeps only approved Focus response fields and sanitizes event values", () => {
  const response = safeFocusWebhookPayload({
    ref: "JVGABC123", status: "autorizado", chave_nfe: "123", serie_dps: 3, numero_dps: 42,
    caminho_pdf_nota_fiscal: "https://focus.invalid/pdf",
    eventos: [{ status: "autorizado", protocolo: "P1", nested: { token: "ignore" } }],
    token: "never persist", ibs_cbs: { value: 123 },
  });
  assert.equal(response.ref, "JVGABC123");
  assert.equal("token" in response, false);
  assert.equal("ibs_cbs" in response, false);
  assert.equal(response.serie_dps, 3);
  assert.equal(response.numero_dps, 42);
  assert.equal(response.caminho_pdf_nota_fiscal, "https://focus.invalid/pdf");
  assert.deepEqual(response.eventos, [{ status: "autorizado", protocolo: "P1" }]);
});

test("derives the same idempotency key when JSON properties arrive in another order", () => {
  const first = safeFocusWebhookPayload({ ref: "JVGABC123", status: "autorizado", numero: 2 });
  const second = safeFocusWebhookPayload({ numero: 2, status: "autorizado", ref: "JVGABC123" });
  assert.equal(focusWebhookEventKey("JVGABC123", first), focusWebhookEventKey("JVGABC123", second));
  assert.notEqual(focusWebhookEventKey("JVGABC123", first), focusWebhookEventKey("JVGABC123", { ...second, numero: 3 }));
});
