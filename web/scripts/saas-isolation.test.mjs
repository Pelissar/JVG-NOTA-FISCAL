import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const backend = read('../lib/jvg-backend.ts');
const migration = read('../../supabase/migrations/20261110_jvg_saas_security_and_subscriptions.sql');

test('conta da API exige vínculo ativo no tenant e tenant não suspenso', () => {
  const resolver = backend.split('export async function getSiteAccount')[1]?.split('\nexport async function ')[0];
  assert.ok(resolver, 'resolvedor de conta existe');
  assert.match(resolver, /jvg_company_memberships/);
  assert.match(resolver, /rpc\/jvg_resolve_site_account/);
  assert.match(resolver, /jvg_tenant_memberships/);
  assert.match(resolver, /active=eq\.true/);
  assert.match(resolver, /jvg_tenants/);
  assert.match(resolver, /status=in\.\(pilot,active\)/);
  assert.match(resolver, /activeTenantIds\.has\(membership\.tenant_id\)/);
  assert.match(resolver, /availableTenantIds\.has\(membership\.tenant_id\)/);
});

test('migration bloqueia acesso PostgREST direto e mantém filtro RLS por empresa', () => {
  assert.match(migration, /revoke all privileges on table public\.%I from public, anon, authenticated/i);
  assert.match(migration, /grant all privileges on table public\.%I to service_role/i);
  assert.match(migration, /alter table public\.%I enable row level security/i);
  assert.match(migration, /create policy jvg_saas_member_select on public\.%I for select to authenticated/i);
  assert.match(migration, /cm\.tenant_id = %I\.tenant_id[\s\S]*cm\.company_id = %I\.company_id[\s\S]*cm\.user_id = \(select auth\.uid\(\)\)[\s\S]*cm\.active/i);
  assert.match(migration, /grant select on public\.jvg_tenant_memberships, public\.jvg_company_memberships to authenticated/i);
  assert.match(migration, /revoke all privileges on function %s from public, anon, authenticated/i);
});

test('assinatura pertence ao tenant e o cadastro cria a conta piloto', () => {
  assert.match(migration, /tenant_id uuid not null unique references public\.jvg_tenants\(id\)/i);
  assert.match(migration, /plan_code text not null references public\.jvg_subscription_plans\(code\)/i);
  assert.match(migration, /check \(status in \('trialing','active','past_due','paused','canceled','incomplete'\)\)/i);
  assert.match(migration, /insert into public\.jvg_subscriptions \(tenant_id, plan_code, status, billing_provider\)[\s\S]*values \(new\.id, 'pilot', 'trialing', 'manual'\)/i);
  assert.match(migration, /create or replace function public\.jvg_resolve_site_account\(p_user_id uuid\)/i);
  assert.match(migration, /join public\.jvg_tenant_memberships tm[\s\S]*tm\.active[\s\S]*t\.status in \('pilot','active'\)/i);
  assert.match(migration, /on conflict \(tenant_id\) do nothing/i);
});
