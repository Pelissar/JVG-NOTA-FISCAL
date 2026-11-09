import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const api = read('../app/api/sales/route.ts');
const sql = read('../../supabase/migrations/20261109_jvg_confirm_sale.sql');
const page = read('../public/erp/sales.html');
const client = read('../public/erp/sales.js');
const navigation = read('../public/erp/index.html');

test('vendas exigem usuário autenticado e escopo da empresa', () => {
  assert.match(api, /getJvgUser\(\)/);
  assert.match(api, /getSiteAccount\(user\)/);
  assert.match(api, /account\.role === "viewer"/);
  assert.match(api, /isSameOrigin\(request\)/);
  assert.match(api, /p_tenant_id: account\.tenant_id/);
  assert.match(api, /p_company_id: account\.company_id/);
});

test('vendas são confirmadas somente pela transação do banco', () => {
  assert.match(api, /\/rest\/v1\/rpc\/jvg_confirm_sale/);
  assert.doesNotMatch(api, /\/rest\/v1\/jvg_inventory_movements.*method:\s*"POST"/);
  assert.match(sql, /for update/i);
  assert.match(sql, /Estoque insuficiente/i);
  assert.match(sql, /current_user <> 'service_role'/);
  assert.match(sql, /revoke all on function public\.jvg_confirm_sale/);
});

test('interface usa somente APIs reais e apresenta histórico', () => {
  assert.match(page, /id="saleForm"/);
  assert.match(navigation, /href="\/erp\/sales\.html"/);
  assert.match(client, /request\('\/api\/records'\)/);
  assert.match(client, /request\('\/api\/sales'/);
  assert.doesNotMatch(client, /localStorage|dados fictícios|vendas demonstrativas/i);
});

test('formulário impede mais de 100 itens e valida centavos', () => {
  assert.match(client, /rows\.length>100/);
  assert.match(client, /length>=100/);
  assert.match(client, /Math\.abs\(Math\.round\(x\.unitPrice\*100\)-x\.unitPrice\*100\)>1e-7/);
  assert.match(api, /Math\.abs\(Math\.round\(price \* 100\) - price \* 100\) > 1e-7/);
});

test('falha na confirmação não permite reenvio cego', () => {
  assert.match(client, /writable=false;\s*notice\(error\.message/);
  assert.match(client, /Verifique o histórico e atualize a página/);
  assert.match(client, /writable=false;\s*\$\('items'\)\.replaceChildren/);
});

test('seletor de clientes não inclui somente fornecedores ou transportadoras', () => {
  assert.match(client, /clients\.filter\(x=>x\.active && x\.isCustomer === true && x\.type !== 'EXT'\)/);
});
