import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const api=readFileSync(new URL('../app/api/fiscal/tax-profiles/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../public/erp/tax-profiles.html',import.meta.url),'utf8');
const drafts=readFileSync(new URL('../app/api/fiscal/nfe-drafts/route.ts',import.meta.url),'utf8');
test('CSOSN is stored per operation and has no form default',()=>{assert.match(api,/operations: \{ \[parsed\.operation\]: parsed\.rule \}/);assert.match(drafts,/operationRules\[review\.operation\]/);assert.doesNotMatch(page,/name="csosn"[^>]*value=/);});
test('perfis fiscais sempre ficam em rascunho e sem transmissao',()=>{assert.match(api,/review_status: "draft"/);assert.match(api,/taxCalculationEnabled: false/);assert.match(api,/transmissionEnabled: false/);});
test('api protege tenant e company e exige permissao',()=>{assert.match(api,/tenant_id=/);assert.match(api,/company_id=/);assert.match(api,/canEdit\(a\)/);assert.match(api,/isSameOrigin\(request\)/);});
test('pagina possui orientacao fiscal e formulário',()=>{assert.match(page,/Solicite|contador/);assert.match(page,/id="profileForm"/);});
test('perfil exige regime confirmado e não assume Simples Nacional',()=>{assert.match(api,/getCompany\(a\)/);assert.match(api,/tax_regime_confirmed !== true/);assert.match(api,/regime: company\.tax_regime/);assert.doesNotMatch(api,/regime: "simples_nacional"/);assert.match(page,/não presume o regime/i);});
test('perfil guarda regras independentes por operação na tabela existente',()=>{assert.match(api,/operations: \{ \[parsed\.operation\]: parsed\.rule \}/);assert.match(api,/operations: \{ \.\.\.configured, \[parsed\.operation\]: parsed\.rule \}/);assert.match(page,/name="operation"/);assert.match(page,/interestadual/);});
test('revisão contábil é declarada e nunca habilita transmissão',()=>{assert.match(api,/register-accountant-review/);assert.match(api,/reviewed_by: user\.userId/);assert.match(api,/transmissionEnabled: false/);assert.match(page,/não autentica a identidade/i);});

