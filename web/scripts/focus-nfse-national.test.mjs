import test from "node:test";
import assert from "node:assert/strict";
import { buildFocusNfseNationalPayload } from "../lib/focus/nfse-national.ts";

const fixture = () => ({
  documentId: "11111111-1111-4111-8111-111111111111",
  company: {
    cnpj: "12345678000195", legal_name: "Empresa de exemplo", municipal_registration: "IM-123",
    fiscal_email: "fiscal@example.invalid", fiscal_phone: "1133334444",
    address: { cityCode: "3502804", postalCode: "16900000", street: "Rua A", number: "10", district: "Centro" },
  },
  customer: {
    id: "22222222-2222-4222-8222-222222222222", document_type: "cnpj", document_number: "98765432000198",
    legal_name: "Tomador de exemplo", display_name: "Tomador de exemplo", email: "tomador@example.invalid",
    phone: "11999990000", address: { cityCode: "3502804", postalCode: "16900000", street: "Rua B", number: "20" },
  },
  service: {
    id: "33333333-3333-4333-8333-333333333333", name: "Manutenção de equipamento",
    description: "Serviço técnico", lc116: "14.01", national_taxation_code: "140101", nbs: "123456789",
  },
  serviceOrder: {
    os_number: 42, customer_id: "22222222-2222-4222-8222-222222222222", status: "delivered",
    customer_approved: true, estimated_value: 250, diagnosis: "Reparo concluído", reported_issue: "Falha relatada",
  },
  serviceValue: 250,
  approvedTaxRules: {
    reviewStatus: "reviewed", codigoOpcaoSimplesNacional: "3",
    regimeEspecialTributacao: "0", tributacaoIss: "1", regimeTributarioSimplesNacional: "1",
  },
  dps: {
    serie: "1", numero: "78", finalidadeEmissao: "0", dataEmissao: "2026-11-12T12:00:00-03:00",
    consumidorFinal: "0", indicadorDestinatario: "0",
    dataCompetencia: "2026-11-12", codigoMunicipioPrestacao: "3502804",
  },
});

test("maps a reviewed OS to the National DPS fields without guessing from LC 116", () => {
  const result = buildFocusNfseNationalPayload(fixture());
  assert.equal(result.reference, "JVG11111111111141118111111111111111");
  assert.deepEqual(result.issues, []);
  assert.equal(result.payload.codigo_tributacao_nacional_iss, "140101");
  assert.equal(result.payload.codigo_nbs, "123456789");
  assert.equal(result.payload.valor_servico, 250);
  assert.equal(result.payload.finalidade_emissao, 0);
  assert.equal(result.payload.consumidor_final, 0);
  assert.equal(result.payload.indicador_destinatario, 0);
  assert.equal("pedido_compra" in result.payload, false);
  assert.equal(result.payload.cnpj_prestador, "12345678000195");
  assert.equal(result.payload.cnpj_tomador, "98765432000198");
  assert.equal(result.payload.codigo_municipio_emissora, 3502804);
  assert.equal(result.payload.codigo_municipio_prestador, 3502804);
  assert.equal(result.payload.codigo_municipio_tomador, 3502804);
  assert.equal(result.payload.codigo_municipio_prestacao, "3502804");
  assert.match(String(result.payload.descricao_servico), /Serviço técnico/);
  assert.doesNotMatch(String(result.payload.descricao_servico), /Reparo concluído|Falha relatada/);
  assert.equal(Object.keys(result.payload).some(key => /^(ibs|cbs)_/i.test(key)), false);
  assert.ok(result.warnings.some(warning => warning.includes("LC 116")));
});

test("blocks absent reviewed fiscal choices and DPS sequence instead of applying defaults", () => {
  const source = fixture();
  source.approvedTaxRules = { reviewStatus: "draft" };
  source.dps = { dataCompetencia: "2026-11-12", codigoMunicipioPrestacao: "3502804" };
  const result = buildFocusNfseNationalPayload(source);
  assert.ok(result.issues.some(issue => issue.includes("Perfil de NFS-e")));
  assert.ok(result.issues.some(issue => issue.toLowerCase().includes("tributação do iss")));
  assert.ok(result.issues.some(issue => issue.includes("Número da DPS")));
  assert.ok(result.issues.some(issue => issue.includes("Finalidade da emissão")));
  assert.ok(result.issues.some(issue => issue.includes("consumidor final")));
  assert.ok(result.issues.some(issue => issue.includes("destinatário")));
  assert.equal("codigo_opcao_simples_nacional" in result.payload, false);
  assert.equal("regime_especial_tributacao" in result.payload, false);
  assert.equal("tributacao_iss" in result.payload, false);
  assert.equal("consumidor_final" in result.payload, false);
  assert.equal("indicador_destinatario" in result.payload, false);
  assert.equal(Object.keys(result.payload).some(key => /^(ibs|cbs)_/i.test(key)), false);
});

test("requires the OS to match the customer and be delivered and approved", () => {
  const source = fixture();
  source.serviceOrder.status = "in_progress";
  source.serviceOrder.customer_approved = false;
  source.serviceOrder.customer_id = "44444444-4444-4444-8444-444444444444";
  const result = buildFocusNfseNationalPayload(source);
  assert.ok(result.issues.some(issue => issue.includes("entregue")));
  assert.ok(result.issues.some(issue => issue.includes("aprovação do cliente")));
  assert.ok(result.issues.some(issue => issue.includes("não corresponde")));
});

test("does not reuse the OS estimate as the invoice service value", () => {
  const source = fixture();
  delete source.serviceValue;
  const result = buildFocusNfseNationalPayload(source);
  assert.ok(result.issues.some(issue => issue.includes("valor final do serviço")));
  assert.equal("valor_servico" in result.payload, false);
});

test("blocks a different service recipient until recipient data is supported", () => {
  const source = fixture();
  source.dps.indicadorDestinatario = "1";
  const result = buildFocusNfseNationalPayload(source);
  assert.ok(result.issues.some(issue => issue.includes("destinatário diferente")));
  assert.equal("indicador_destinatario" in result.payload, false);
});
