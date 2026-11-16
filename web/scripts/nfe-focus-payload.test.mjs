import test from "node:test";
import assert from "node:assert/strict";
import { buildFocusNfePayload, emissionBlockers, focusFileUrl, HOMOLOG_RECIPIENT_NAME } from "../lib/focus/nfe-payload.ts";

const company = {
  legal_name: "JVG Comercio Ltda",
  trade_name: "JVG",
  cnpj: "45.887.221/0001-61",
  state_registration: "177.582.345.110",
  address: {
    street: "Rua Pedro Alvares",
    number: "100",
    district: "Centro",
    city: "Birigui",
    state: "SP",
    postalCode: "16200001",
    cityCode: "3506508",
  },
};

const payload = {
  nature: "Venda de mercadoria",
  recipient: {
    documentType: "cnpj",
    documentNumber: "11444777000161",
    address: {
      street: "Av Afonso Pena",
      number: "1000",
      district: "Centro",
      city: "Belo Horizonte",
      state: "MG",
      postalCode: "30130005",
    },
  },
  items: [{
    sku: "SAP-1",
    description: "Sapato",
    ncm: "64039900",
    origin: "0",
    unit: "UN",
    quantity: 2,
    unitPriceCents: 15000,
    subtotalCents: 30000,
    cfop: "6102",
    csosn: "102",
  }],
};

test("bloqueia CFOP interno quando o destino é outro estado", () => {
  const wrong = structuredClone(payload);
  wrong.items[0].cfop = "5102";
  const issues = emissionBlockers(company, wrong);
  assert.ok(issues.some((issue) => issue.includes("interestadual")));
});

test("payload de homologação não numera a nota e troca o nome do destinatário", () => {
  assert.deepEqual(emissionBlockers(company, payload), []);
  const body = buildFocusNfePayload(company, payload, "2026-11-16T00:20:00-03:00");
  assert.equal(body.nome_destinatario, HOMOLOG_RECIPIENT_NAME);
  assert.equal(body.local_destino, "2");
  assert.equal(body.modalidade_frete, "9");
  assert.equal(body.uf_emitente, "SP");
  assert.equal("numero" in body, false);
  assert.equal("serie" in body, false);
  assert.equal(body.items[0].icms_situacao_tributaria, "102");
  assert.equal(body.items[0].cfop, "6102");
  assert.equal(body.valor_total, "300.00");
  assert.equal(JSON.stringify(body).includes("api.focusnfe.com.br"), false);
});

test("link de DANFE só aceita o host de homologação", () => {
  assert.equal(focusFileUrl("/arquivos/danfe.html"), "https://homologacao.focusnfe.com.br/arquivos/danfe.html");
  assert.equal(focusFileUrl("https://api.focusnfe.com.br/arquivos/danfe.html"), null);
  assert.equal(focusFileUrl("https://homologacao.focusnfe.com.br/arquivos/x"), "https://homologacao.focusnfe.com.br/arquivos/x");
});
