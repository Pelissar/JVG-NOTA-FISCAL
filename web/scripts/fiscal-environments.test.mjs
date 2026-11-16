import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildNfceHomologacaoPayload } from "../lib/fiscal/nfce-payload.ts";

const client = readFileSync(new URL("../lib/focus/client.ts", import.meta.url), "utf8");
const nfce = readFileSync(new URL("../app/api/fiscal/nfce-drafts/transmit/route.ts", import.meta.url), "utf8");
const nfsePage = readFileSync(new URL("../public/erp/nfse.html", import.meta.url), "utf8");

test("NFC-e só conversa com a homologação da Focus e a nota de serviço saiu do sistema", () => {
  assert.match(client, /FOCUS_HOMOLOGACAO \+ "\/v2\/nfce\?ref="/);
  assert.match(nfce, /confirmHomologation !== true/);
  assert.match(nfce, /document_type=eq\.nfce&environment=eq\.homologacao/);
  assert.match(nfsePage, /somente no portal/);
  assert.doesNotMatch(nfsePage, /Enviar teste|Preparar NFS-e/);
  assert.doesNotMatch(client + nfce, /api\.focusnfe\.com\.br/);
});

test("a NFC-e de teste exige Simples confirmado e não inventa CFOP", () => {
  const blocked = buildNfceHomologacaoPayload({
    company: { cnpj: "12345678000199", tax_regime: "lucro_presumido", tax_regime_confirmed: true, legal_name: "Empresa", address: { street: "Rua", city: "Birigui", state: "SP" } },
    items: [{ sku: "1", name: "Item", ncm: "12345678", cfop: "", unit: "UN", origin: "0", quantity: 1, unitPrice: 10 }],
    cpf: "", paymentMethod: "01", naturezaOperacao: "VENDA AO CONSUMIDOR",
  });
  assert.ok(blocked.issues.some((issue) => issue.includes("Simples Nacional")));
  assert.ok(blocked.issues.some((issue) => issue.includes("CFOP")));
});
