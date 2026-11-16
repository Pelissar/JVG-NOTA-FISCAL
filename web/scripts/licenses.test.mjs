import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const admin = readFileSync(new URL("../app/api/admin/licenses/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20261116_jvg_client_licenses.sql", import.meta.url), "utf8");
const transmit = readFileSync(new URL("../app/api/fiscal/nfe-drafts/transmit/route.ts", import.meta.url), "utf8");
const licensing = readFileSync(new URL("../lib/licensing.ts", import.meta.url), "utf8");

test("o administrador libera plano, token e documentos sem devolver o token", () => {
  assert.match(admin, /platform_admin/);
  assert.match(admin, /isSameOrigin\(request\)/);
  assert.match(admin, /hint: hint\(token\)/);
  assert.doesNotMatch(admin, /return apiJson\(\{ ok: true, focus: \{ configured: true, hint: hint\(token\), homolog_token/);
  assert.match(admin, /mensal/);
  assert.match(admin, /trimestral/);
  assert.match(admin, /semestral/);
  assert.match(admin, /anual/);
});

test("a migration cria os quatro períodos e esconde o token do navegador", () => {
  for (const plan of ["mensal", "trimestral", "semestral", "anual"]) assert.match(migration, new RegExp(`'${plan}'`));
  assert.match(migration, /revoke all on public\.jvg_company_focus_credentials from public, anon, authenticated/);
  assert.match(migration, /cartao_cnpj/);
  assert.match(migration, /certificado_focus/);
});

test("a transmissão respeita a licença e prefere o token da empresa", () => {
  assert.match(transmit, /licenseView\(account\)/);
  assert.match(transmit, /homologationToken\(account, siteToken\)/);
  assert.match(licensing, /allowsSiteToken: !commercial/);
  assert.match(licensing, /Falta cadastrar o token da Focus desta empresa/);
});
