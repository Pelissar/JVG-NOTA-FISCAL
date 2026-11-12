import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAuthorizedIssuedNfe } from "../lib/fiscal/issued-nfe-import.ts";

const accessKey = "35261112345678000195550010000000011000000010";
function xml(status = "100", model = "55", environment = "1") {
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    '<nfeProc versao="4.00"><NFe><infNFe Id="NFe' + accessKey + '">' +
    '<ide><mod>' + model + '</mod><tpAmb>' + environment + '</tpAmb><nNF>1</nNF><serie>1</serie><dhEmi>2026-11-10T10:00:00-03:00</dhEmi></ide>' +
    '<emit><CNPJ>12345678000195</CNPJ><xNome>JVG Teletrônica LTDA</xNome><IE>123456789</IE></emit>' +
    '<dest><CNPJ>99887766000155</CNPJ><xNome>Cliente de teste LTDA</xNome><email>cliente@example.test</email><enderDest><xLgr>Rua Um</xLgr><nro>10</nro><xMun>São Paulo</xMun><UF>SP</UF></enderDest></dest>' +
    '<det nItem="1"><prod><cProd>SKU-1</cProd><cEAN>SEM GTIN</cEAN><xProd>Produto de teste</xProd><NCM>12345678</NCM><CEST>1234567</CEST><CFOP>5102</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>6.250000</vUnCom><vProd>12.50</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS></imposto></det>' +
    '<total><ICMSTot><vProd>12.50</vProd><vICMS>0.00</vICMS><vNF>12.50</vNF></ICMSTot></total>' +
    '<transp><transporta><CNPJ>98765432000110</CNPJ><xNome>Transportadora teste</xNome><IE>987654321</IE><xEnder>Av. Transporte, 1</xEnder><xMun>São Paulo</xMun><UF>SP</UF></transporta></transp>' +
    '</infNFe></NFe><protNFe><infProt><chNFe>' + accessKey + '</chNFe><cStat>' + status + '</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><nProt>135260000000001</nProt><dhRecbto>2026-11-10T10:02:00-03:00</dhRecbto></infProt></protNFe></nfeProc>';
}

test("importa no parser apenas NF-e de produção autorizada emitida pela empresa ativa", () => {
  const parsed = parseAuthorizedIssuedNfe(xml(), "12.345.678/0001-95");
  assert.equal(parsed.accessKey, accessKey);
  assert.equal(parsed.invoiceNumber, "1");
  assert.equal(parsed.series, "1");
  assert.equal(parsed.issuerDocument, "12345678000195");
  assert.equal(parsed.recipient.document, "99887766000155");
  assert.equal(parsed.recipient.name, "Cliente de teste LTDA");
  assert.equal(parsed.carrier?.document, "98765432000110");
  assert.equal(parsed.total, 12.5);
  assert.equal(parsed.cfop, "5102");
  assert.equal(parsed.items[0].cest, "1234567");
  assert.equal(parsed.items[0].taxes?.ICMS?.ICMSSN102?.CSOSN, "102");
  assert.equal(parsed.fiscalData.infNFe.total.ICMSTot.vICMS, "0.00");
  assert.equal(parsed.protocol, "135260000000001");
});

test("recusa XML sem autorização, emitente divergente, homologação ou chave incoerente", () => {
  assert.throws(() => parseAuthorizedIssuedNfe(xml("110"), "12345678000195"), /não consta autorizada/i);
  assert.throws(() => parseAuthorizedIssuedNfe(xml("100", "55", "2"), "12345678000195"), /produção/i);
  assert.throws(() => parseAuthorizedIssuedNfe(xml().replace("<CNPJ>12345678000195</CNPJ>", "<CNPJ>11222333000181</CNPJ>"), "12345678000195"), /não corresponde/i);
  assert.throws(() => parseAuthorizedIssuedNfe(xml().replace("<nNF>1</nNF>", "<nNF>2</nNF>"), "12345678000195"), /não corresponde à chave/i);
  assert.throws(() => parseAuthorizedIssuedNfe(xml().replace("<serie>1</serie>", "<serie>2</serie>"), "12345678000195"), /não corresponde à chave/i);
  assert.throws(() => parseAuthorizedIssuedNfe(xml().replace(' Id="NFe' + accessKey + '"', ""), "12345678000195"), /identificador infNFe/i);
});

test("bloqueia DTD e mantém escopo local sem transmitir XML à Focus", () => {
  const hostile = '<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///secret">]>' + xml();
  assert.throws(() => parseAuthorizedIssuedNfe(hostile, "12345678000195"), /DTD|entidade/i);
  const route = readFileSync(new URL("../app/api/fiscal/nfe-imports/route.ts", import.meta.url), "utf8");
  assert.match(route, /isSameOrigin\(request\)/);
  assert.match(route, /confirmedOfficialStatus/);
  assert.match(route, /environment: "producao"/);
  assert.match(route, /imported_xml: xml/);
  assert.doesNotMatch(route, /emitFocusNfe|inutilizeFocusNfe/);
});

test("a lista implementa filtros, seleção individual e em lote, e inutilização usa apenas homologação", () => {
  const page = readFileSync(new URL("../public/erp/nfe-issued.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../public/erp/nfe-issued.js", import.meta.url), "utf8");
  const listRoute = readFileSync(new URL("../app/api/fiscal/history/route.ts", import.meta.url), "utf8");
  const invalidateRoute = readFileSync(new URL("../app/api/fiscal/nfe-number-inutilizations/route.ts", import.meta.url), "utf8");
  const focus = readFileSync(new URL("../lib/focus/client.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20261112_jvg_nfe_issued_management.sql", import.meta.url), "utf8");
  assert.match(page, /name="number"/);
  assert.match(page, /name="customer"/);
  assert.match(page, /name="cfop"/);
  assert.match(page, /id="selectIssuedPage"/);
  assert.match(page, /Importar XML autorizado/);
  assert.match(page, /Inutilizar numeração/);
  assert.match(script, /selected\.add\(doc\.id\)/);
  assert.match(script, /exportSelected/);
  assert.match(listRoute, /documentType/);
  assert.match(listRoute, /fiscal_payload=cs/);
  assert.match(listRoute, /tenant_id=.*company_id=/);
  assert.match(invalidateRoute, /JVG_FOCUS_PILOT_COMPANY_ID/);
  assert.match(invalidateRoute, /outcome_unknown/);
  assert.match(invalidateRoute, /number_start=lte/);
  assert.match(focus, /FOCUS_HOMOLOGACAO \+ "\/v2\/nfe\/inutilizacao"/);
  assert.match(migration, /environment text not null default 'homologacao' check \(environment = 'homologacao'\)/);
  assert.match(migration, /imported_xml text/);
  assert.match(migration, /grant all privileges on public\.jvg_fiscal_number_inutilizations to service_role/);
});
