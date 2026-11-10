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
  assert.match(client, /request\('\/api\/records\?scope=sales'\)/);
  assert.match(client, /request\('\/api\/sales\?page='/);
  assert.doesNotMatch(client, /localStorage|dados fictícios|vendas demonstrativas/i);
});

test('formulário impede mais de 100 itens e valida centavos', () => {
  assert.match(client, /rows\.length>100/);
  assert.match(client, /length>=100/);
  assert.match(client, /Math\.abs\(Math\.round\(x\.unitPrice\*100\)-x\.unitPrice\*100\)>1e-7/);
  assert.match(api, /Math\.abs\(Math\.round\(price \* 100\) - price \* 100\) > 1e-7/);
});

test('falha na confirmação não permite reenvio cego', () => {
  assert.match(client, /writable=true;\s*notice\(error\.message/);
  assert.match(client, /pendingPayload \|\|= \{requestId:pendingRequestId/);
  assert.match(client, /body:JSON\.stringify\(pendingPayload\)/);
  assert.match(client, /querySelectorAll\('input,select,textarea,\.remove'\)/);
  assert.match(client, /writable=false;[\s\S]*\$\('items'\)\.replaceChildren/);
});

test('seletor de clientes não inclui somente fornecedores ou transportadoras', () => {
  assert.match(client, /clients\.filter\(x=>x\.active && x\.isCustomer === true && x\.type !== 'EXT'\)/);
});

const idemSql = read('../../supabase/migrations/20261109_jvg_sale_idempotency.sql');
test('venda idempotente usa chave UUID e bloqueio transacional', () => {
  assert.match(api, /const requestId = uuid\(data\.requestId\)/);
  assert.match(api, /p_request_id: requestId/);
  assert.match(client, /pendingRequestId \|\|= crypto\.randomUUID\(\)/);
  assert.match(client, /requestId:pendingRequestId/);
  assert.match(idemSql, /primary key \(tenant_id, company_id, request_id\)/i);
  assert.match(idemSql, /on conflict do nothing/i);
  assert.match(idemSql, /for update/i);
  assert.match(idemSql, /v_existing_sale is not null then return v_existing_sale/i);
  assert.match(idemSql, /v_existing_hash is distinct from v_payload_hash/i);
});

test('histórico de vendas permite pesquisar, filtrar e exportar dados reais', () => {
  assert.match(page, /id="salesSearch"/);
  assert.match(page, /id="salesStatus"/);
  assert.match(page, /id="exportSales"/);
  assert.match(client, /function filteredSales\(\)/);
  assert.match(client, /function exportSales\(\)/);
  assert.match(client, /salesHistory = Array\.isArray\(data\.sales\)/);
  assert.match(client, /URL\.createObjectURL\(blob\)/);
  assert.doesNotMatch(client, /localStorage|dados fictícios|vendas demonstrativas/i);
});

test('histórico tem paginação por empresa com limite por página', () => {
  assert.match(api, /export async function GET\(request: Request\)/);
  assert.match(api, /const pageSize = 50/);
  assert.match(api, /\^\[1-9\]\\d\{0,5\}\$/);
  assert.match(api, /offset=\$\{offset\}/);
  assert.match(api, /hasMore: rows\.length > pageSize/);
  assert.match(page, /id="salesPrevious"/);
  assert.match(page, /id="salesNext"/);
  assert.match(client, /loadSales\(salesPage\+1\)/);
  assert.match(client, /loadSales\(salesPage-1\)/);
});

test('CSV de vendas neutraliza fórmulas e usa separadores reais', () => {
  assert.match(client, /const protectedText =/);
  assert.match(client, /\[=\+@-\]/);
  assert.match(client, /protectedText\.replace/);
  assert.match(client, /join\('\\r\\n'\)/);
  assert.match(client, /new Blob\(\['\\uFEFF'/);
});

test('PDF de venda inclui os itens persistidos e usa os dados do emitente', () => {
  const documents = read('../public/erp/commercial-documents.js');
  assert.match(api, /items:jvg_sale_items\(description_snapshot,unit_snapshot,quantity,unit_price,line_total\)/);
  assert.match(api, /unitPrice: Number\(item\.unit_price\)/);
  assert.match(api, /lineTotal: Number\(item\.line_total\)/);
  assert.match(page, /commercial-documents\.js/);
  assert.match(client, /class="btn sale-print"/);
  assert.match(client, /print\('sale'/);
  assert.match(documents, /COMPROVANTE DE VENDA/);
  assert.match(documents, /'VENDA-'\s*\+\s*idShort/);
  assert.match(documents, /api\/company\/logo/);
  assert.match(documents, /CNPJ\/CPF/);
  assert.match(documents, /Documento comercial sem validade fiscal/);
});

test('PDF da OS preserva o formato de duas vias e sinaliza texto resumido', () => {
  const documents = read('../public/erp/commercial-documents.js');
  assert.match(documents, /compactDescription\(data\.reported_issue, 300\)/);
  assert.match(documents, /compactDescription\(data\.diagnosis, 380\)/);
  assert.match(documents, /continua na ficha digital/);
  assert.match(documents, /height:134mm;min-height:134mm/);
  assert.match(documents, /VIA DO CLIENTE/);
  assert.match(documents, /VIA DA EMPRESA/);
});
