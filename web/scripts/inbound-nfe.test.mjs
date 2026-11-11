import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAuthorizedInboundNfe } from "../lib/fiscal/inbound-nfe.ts";

const accessKey = "35261112345678000195550010000000011000000010";
const page = readFileSync(new URL("../public/erp/inbound-nfe.html", import.meta.url), "utf8");
function xml(status = "100", model = "55", destination = "99887766000155") {
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<nfeProc versao="4.00"><NFe><infNFe Id="NFe' + accessKey + '">' +
    '<ide><mod>' + model + '</mod><tpAmb>1</tpAmb><nNF>42</nNF><serie>1</serie><dhEmi>2026-11-10T10:00:00-03:00</dhEmi></ide>' +
    '<emit><CNPJ>12345678000195</CNPJ><xNome>Fornecedor de teste LTDA</xNome><xFant>Fornecedor teste</xFant><IE>123456789</IE><email>fiscal@fornecedor.test</email><enderEmit><xLgr>Rua Um</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3549904</cMun><xMun>São Paulo</xMun><UF>SP</UF><CEP>01001000</CEP></enderEmit></emit>' +
    '<dest><CNPJ>' + destination + '</CNPJ><xNome>Empresa destinatária</xNome><enderDest><xLgr>Rua Dois</xLgr><nro>20</nro><xBairro>Centro</xBairro><cMun>3549904</cMun><xMun>São Paulo</xMun><UF>SP</UF></enderDest></dest>' +
    '<det nItem="1"><prod><cProd>FORN-1</cProd><cEAN>7891234567895</cEAN><xProd>Produto de teste</xProd><NCM>12345678</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>6.250000</vUnCom><vProd>12.50</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS></imposto></det>' +
    '<total><ICMSTot><vProd>12.50</vProd><vICMS>0.00</vICMS><vNF>12.50</vNF></ICMSTot></total><transp><modFrete>0</modFrete><transporta><CNPJ>98765432000110</CNPJ><xNome>Transportadora teste</xNome><IE>987654321</IE><xEnder>Av. Transporte, 1</xEnder><xMun>São Paulo</xMun><UF>SP</UF></transporta></transp></infNFe></NFe>' +
    '<protNFe><infProt><chNFe>' + accessKey + '</chNFe><cStat>' + status + '</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>';
}

test("compras interestaduais pedem conferência de ST sem copiar regra do fornecedor para saída", () => {
  assert.match(page, /Compra de fora do estado: confira a classificação fiscal/);
  assert.match(page, /CST\/CSOSN do fornecedor no XML não preenche automaticamente a regra de venda da JVG/);
});

test("lê NF-e processada autorizada e preserva valores do item", () => {
  const parsed = parseAuthorizedInboundNfe(xml(), "99.887.766/0001-55");
  assert.equal(parsed.accessKey, accessKey);
  assert.equal(parsed.invoiceNumber, "42");
  assert.equal(parsed.issuerDocument, "12345678000195");
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].quantity, 2);
  assert.equal(parsed.items[0].total, 12.5);
  assert.equal(parsed.items[0].taxes.ICMS.ICMSSN102.CSOSN, "102");
  assert.equal(parsed.fiscalData.infNFe.total.ICMSTot.vICMS, "0.00");
  assert.equal(parsed.issuer.name, "Fornecedor teste");
  assert.equal(parsed.issuer.stateRegistration, "123456789");
  assert.equal(parsed.issuer.address.street, "Rua Um");
  assert.equal(parsed.carrier.document, "98765432000110");
  assert.equal(parsed.carrier.name, "Transportadora teste");
  assert.equal(parsed.total, 12.5);
});

test("recusa XML sem protocolo, modelo diferente, nota não autorizada ou destinatário de outra empresa", () => {
  assert.throws(() => parseAuthorizedInboundNfe(xml().replace(/<protNFe>[\s\S]*?<\/protNFe>/, ""), "99887766000155"), /protocolo/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml("100", "65"), "99887766000155"), /modelo 55/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml("110"), "99887766000155"), /não consta autorizada/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml("100", "55", "11111111000111"), "99887766000155"), /não corresponde/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml().replace("<emit><CNPJ>12345678000195</CNPJ>", "<emit><CNPJ>11222333000181</CNPJ>"), "99887766000155"), /CNPJ do emitente difere/i);
});

test("recusa ambiente de homologação e campos essenciais ausentes", () => {
  assert.throws(() => parseAuthorizedInboundNfe(xml().replace("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>"), "99887766000155"), /produção/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml().replace("<nNF>42</nNF>", "<nNF></nNF>"), "99887766000155"), /número da NF-e/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml().replace(' nItem="1"', ""), "99887766000155"), /número de item/i);
  const repeatedLine = xml().replace(
    "</det><total>",
    "</det><det nItem=\"1\"><prod><xProd>Outro item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>1</vUnCom><vProd>1</vProd></prod></det><total>",
  );
  assert.throws(() => parseAuthorizedInboundNfe(repeatedLine, "99887766000155"), /repetido/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml().replace("<vNF>12.50</vNF>", ""), "99887766000155"), /valor total/i);
});

test("recusa DTD e entidades externas antes de parsear", () => {
  const hostile = '<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///secret">]>' + xml();
  assert.throws(() => parseAuthorizedInboundNfe(hostile, "99887766000155"), /DTD|entidade/i);
});

test("a API protege dados por empresa e a confirmação de estoque é atômica", () => {
  const route = readFileSync(new URL("../app/api/inbound-nfe/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20261110_jvg_inbound_nfe.sql", import.meta.url), "utf8");
  assert.match(route, /isSameOrigin\(request\)/);
  assert.match(route, /getJvgUser\(\)/);
  assert.match(route, /supplier_party_id/);
  assert.match(route, /checkedOfficialStatus !== true/);
  assert.match(route, /Marque ao menos um item para lançar no estoque/);
  assert.match(route, /jvg_reopen_empty_inbound_nfe/);
  assert.match(route, /receivedWithoutStock/);
  assert.match(route, /jvg_confirm_inbound_nfe/);
  assert.match(migration, /unique \(company_id, access_key\)/);
  assert.match(migration, /movement_type, reason, inbound_nfe_id, inbound_nfe_item_number/);
  assert.match(migration, /for update/);
  assert.match(migration, /begin[\s\S]*insert into public\.jvg_inventory_movements[\s\S]*update public\.jvg_inbound_nfe_documents[\s\S]*end;/i);
  const recoveryMigration = readFileSync(new URL("../../supabase/migrations/20261111_jvg_inbound_nfe_stock_guard_recovery.sql", import.meta.url), "utf8");
  assert.match(recoveryMigration, /if v_count = 0 then\s+raise exception/i);
  assert.match(recoveryMigration, /function public\.jvg_reopen_empty_inbound_nfe/i);
  assert.match(recoveryMigration, /inbound_nfe_id = p_document_id/i);
});

test("confirmação vazia é bloqueada e uma NF-e recebida sem movimentos pode ser corrigida", () => {
  const route = readFileSync(new URL("../app/api/inbound-nfe/route.ts", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/erp/inbound-nfe.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../public/erp/inbound-nfe.html", import.meta.url), "utf8");
  assert.match(route, /reopen-empty/);
  assert.match(route, /!hasStockItems\(items\)/);
  assert.match(script, /receivedWithoutStock/);
  assert.match(script, /Reabrir e lançar no estoque/);
  assert.match(script, /Cadastrar produto deste XML/);
  assert.match(script, /kind:'product'/);
  assert.ok(script.includes(String.raw`var ncm=/^\d{8}$/`));
  assert.ok(script.includes(String.raw`var cest=/^\d{7}$/`));
  assert.match(script, /cost:Number\(item\.unitPrice\|\|0\)/);
  assert.match(script, /price:Number\(salePrice\.value\)/);
  assert.match(script, /CFOP e perfil fiscal não serão presumidos/);
  assert.ok(script.includes("Preencher NCM/CEST disponíveis no XML"));
  assert.ok(script.includes("NCM/CEST ausentes preenchidos com os valores do XML"));
  assert.match(script, /data-fill-classification/);
  assert.match(script, /Para confirmar a entrada, selecione o produto e marque “Lançar no estoque” em pelo menos um item/);
  assert.match(page, /Confirmar entrada grava os movimentos de compra de forma única/);
});

test("vínculo de produto criado é salvo antes da confirmação de estoque", () => {
  const script = readFileSync(new URL("../public/erp/inbound-nfe.js", import.meta.url), "utf8");
  assert.match(script, /async function persistReviewDraft/);
  assert.match(script, /await persistReviewDraft\(\)/);
  assert.match(script, /Vínculo do produto e seleção de estoque salvos no rascunho/);
  assert.match(script, /Vínculos salvos no rascunho/);
});

test("cancelamento preserva a NF-e e estorna movimentos sem duplicidade", () => {
  const route = readFileSync(new URL("../app/api/inbound-nfe/route.ts", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/erp/inbound-nfe.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../public/erp/inbound-nfe.html", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20261111_jvg_inbound_nfe_cancel_reversal.sql", import.meta.url), "utf8");
  assert.match(route, /data\.action === "cancel"/);
  assert.match(route, /jvg_cancel_inbound_nfe/);
  assert.match(route, /reopen-cancelled/);
  assert.match(script, /Cancelar lançamento no ERP/);
  assert.match(script, /Estornar entrada no estoque/);
  assert.match(page, /nota do fornecedor não é cancelada na SEFAZ/);
  assert.match(migration, /status in \('draft', 'received', 'cancelled'\)/);
  assert.match(migration, /reversal_of_movement_id/);
  assert.match(migration, /-v_move\.quantity_delta/);
  assert.match(migration, /v_balance < v_move\.quantity_delta/);
  assert.match(migration, /sourceNfePreserved/);
});

test("importação localiza ou cria fornecedor por documento e guarda tributos e totais originais", () => {
  const route = readFileSync(new URL("../app/api/inbound-nfe/route.ts", import.meta.url), "utf8");
  const parser = readFileSync(new URL("../lib/fiscal/inbound-nfe.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20261110_jvg_fiscal_document_history.sql", import.meta.url), "utf8");
  assert.match(route, /findParty\(account, documentType, snapshot\.document\)/);
  assert.match(route, /document_number=.*filterEq\(document\)/);
  assert.match(route, /is_supplier: existing\.is_supplier === true \|\| role === "supplier"/);
  assert.match(route, /supplier_party_id: supplier\.id/);
  assert.match(route, /carrier_party_id: carrier\.id/);
  assert.match(route, /fiscal_data: parsed\.fiscalData/);
  assert.match(parser, /taxes: line\.imposto/);
  assert.match(migration, /insert into public\.jvg_parties[\s\S]*on conflict \(company_id, document_type, document_number\)/i);
  assert.match(migration, /set supplier_party_id = p\.id/i);
  assert.match(migration, /references public\.jvg_parties\(tenant_id, company_id, id\)/i);
});

test("histórico filtra partes e datas dentro da empresa e inclui entrada e saída", () => {
  const route = readFileSync(new URL("../app/api/fiscal/history/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../public/erp/fiscal-history.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/erp/fiscal-history.js", import.meta.url), "utf8");
  assert.match(route, /tenant_id=.*company_id=/);
  assert.match(route, /partyFilter\(partyId, \["supplier_party_id", "carrier_party_id"\]\)/);
  assert.match(route, /partyFilter\(partyId, \["recipient_party_id", "carrier_party_id"\]\)/);
  assert.match(route, /jvg_inbound_nfe_documents/);
  assert.match(route, /jvg_fiscal_documents/);
  assert.match(route, /direction: "incoming"/);
  assert.match(route, /direction: "outgoing"/);
  assert.match(page, /Cliente, fornecedor ou transportadora/);
  assert.match(script, /Baixar XML original/);
});
