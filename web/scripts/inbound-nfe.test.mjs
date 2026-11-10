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
    '<emit><CNPJ>12345678000195</CNPJ><xNome>Fornecedor de teste</xNome></emit>' +
    '<dest><CNPJ>' + destination + '</CNPJ></dest>' +
    '<det nItem="1"><prod><cProd>FORN-1</cProd><cEAN>7891234567895</cEAN><xProd>Produto de teste</xProd><NCM>12345678</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>6.250000</vUnCom><vProd>12.50</vProd></prod></det>' +
    '<total><ICMSTot><vNF>12.50</vNF></ICMSTot></total></infNFe></NFe>' +
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
  assert.equal(parsed.total, 12.5);
});

test("recusa XML sem protocolo, modelo diferente, nota não autorizada ou destinatário de outra empresa", () => {
  assert.throws(() => parseAuthorizedInboundNfe(xml().replace(/<protNFe>[\s\S]*?<\/protNFe>/, ""), "99887766000155"), /protocolo/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml("100", "65"), "99887766000155"), /modelo 55/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml("110"), "99887766000155"), /não consta autorizada/i);
  assert.throws(() => parseAuthorizedInboundNfe(xml("100", "55", "11111111000111"), "99887766000155"), /não corresponde/i);
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
  assert.match(route, /jvg_confirm_inbound_nfe/);
  assert.match(migration, /unique \(company_id, access_key\)/);
  assert.match(migration, /movement_type, reason, inbound_nfe_id, inbound_nfe_item_number/);
  assert.match(migration, /for update/);
  assert.match(migration, /begin[\s\S]*insert into public\.jvg_inventory_movements[\s\S]*update public\.jvg_inbound_nfe_documents[\s\S]*end;/i);
});

