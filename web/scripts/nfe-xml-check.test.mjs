import assert from "node:assert/strict";
import test from "node:test";
import { checkNfeXml } from "../lib/fiscal/nfe-xml-check.ts";

function digit(base) {
  let weight = 2;
  let sum = 0;
  for (let index = base.length - 1; index >= 0; index -= 1) {
    sum += Number(base[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return String(rest < 2 ? 0 : 11 - rest);
}

const base = "3526111234567800019555001000000001112345678";
const accessKey = base + digit(base);

function xml(patch = "") {
  return '<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe><infNFe Id="NFe' + accessKey + '">' +
    "<ide><cUF>35</cUF><mod>55</mod><serie>1</serie><nNF>1</nNF><tpAmb>2</tpAmb><dhEmi>2026-11-10T10:00:00-03:00</dhEmi></ide>" +
    "<emit><CNPJ>12345678000195</CNPJ><xNome>Empresa Teste</xNome></emit>" +
    "<dest><CNPJ>99887766000155</CNPJ><xNome>Cliente Teste</xNome></dest>" +
    '<det nItem="1"><prod><xProd>Produto</xProd><NCM>12345678</NCM><uCom>UN</uCom><qCom>1</qCom><vProd>10.00</vProd></prod></det>' +
    "<total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe>" +
    "<protNFe><infProt><chNFe>" + accessKey + "</chNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>"
      .replace(patch[0] || "___none___", patch[1] || "___none___");
}

test("aceita XML de homologação sem gravar e confere a chave", () => {
  const report = checkNfeXml(xml(), "12345678000195");
  assert.equal(report.ok, true);
  assert.equal(report.environment, "homologacao");
  assert.equal(report.accessKey, accessKey);
  assert.equal(report.issues.length, 0);
});

test("aponta emitente diferente e dígito inválido sem aceitar o arquivo", () => {
  const broken = xml(["<cStat>100</cStat>", "<cStat>110</cStat>"]).replaceAll(accessKey, accessKey.slice(0, 43) + (accessKey.endsWith("0") ? "1" : "0"));
  const report = checkNfeXml(broken, "11222333000181");
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.includes("autorização")));
  assert.ok(report.issues.some((issue) => issue.includes("dígito")));
  assert.ok(report.issues.some((issue) => issue.includes("empresa ativa")));
});
