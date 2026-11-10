import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const api=readFileSync(new URL('../app/api/fiscal/tax-profiles/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../public/erp/tax-profiles.html',import.meta.url),'utf8');
test('perfis fiscais sempre ficam em rascunho e sem transmissao',()=>{assert.match(api,/review_status: "draft"/);assert.match(api,/taxCalculationEnabled: false/);assert.match(api,/transmissionEnabled: false/);});
test('api protege tenant e company e exige permissao',()=>{assert.match(api,/tenant_id=/);assert.match(api,/company_id=/);assert.match(api,/canEdit\(a\)/);assert.match(api,/isSameOrigin\(request\)/);});
test('pagina possui orientacao fiscal e formulário',()=>{assert.match(page,/Solicite|contador/);assert.match(page,/id="profileForm"/);});
test('perfil exige regime confirmado e não assume Simples Nacional',()=>{assert.match(api,/getCompany\(a\)/);assert.match(api,/tax_regime_confirmed !== true/);assert.match(api,/regime: company\.tax_regime/);assert.doesNotMatch(api,/regime: "simples_nacional"/);assert.match(page,/não presume o regime/i);});
