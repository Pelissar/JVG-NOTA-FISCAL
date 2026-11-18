-- Platform administration: explicit per-company module grants, request history,
-- manual payment confirmation evidence, and fiscal usage aggregates.
-- Apply through the reviewed Supabase migration workflow; never from the app.

create table if not exists public.jvg_company_module_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  module_key text not null check (module_key in (
    'core','cadastros','comercial','estoque','assistencia','fiscal_nfe','nfce','contabilidade','restaurante'
  )),
  enabled boolean not null,
  source text not null check (source in ('additional','manual')),
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, module_key),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete restrict
);
create index if not exists jvg_company_module_overrides_scope_idx
  on public.jvg_company_module_overrides(tenant_id, company_id, module_key);
alter table public.jvg_company_module_overrides enable row level security;
revoke all on public.jvg_company_module_overrides from public, anon, authenticated;
grant all on public.jvg_company_module_overrides to service_role;

-- Existing plans retain the modules customers could use before entitlements
-- existed. Administrators can then deliberately remove or grant modules.
update public.jvg_subscription_plans p
set features = coalesce(p.features, '{}'::jsonb) || jsonb_build_object(
  'modules',
  jsonb_build_object(
    'core', true, 'cadastros', true, 'comercial', true, 'estoque', true,
    'assistencia', true, 'fiscal_nfe', true, 'nfce', true,
    'contabilidade', true, 'restaurante', true
  ) || case when jsonb_typeof(p.features->'modules') = 'object' then p.features->'modules' else '{}'::jsonb end
), updated_at = now();

alter table public.jvg_onboarding_requests
  add column if not exists assigned_admin_id uuid references auth.users(id) on delete set null,
  add column if not exists assigned_admin_name text not null default '';

create table if not exists public.jvg_onboarding_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.jvg_onboarding_requests(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null default '',
  event_type text not null check (event_type in ('created','updated','assigned','status_changed','note_changed')),
  previous_value jsonb not null default '{}'::jsonb check (jsonb_typeof(previous_value) = 'object'),
  new_value jsonb not null default '{}'::jsonb check (jsonb_typeof(new_value) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists jvg_onboarding_request_events_recent_idx
  on public.jvg_onboarding_request_events(request_id, created_at desc);
alter table public.jvg_onboarding_request_events enable row level security;
revoke all on public.jvg_onboarding_request_events from public, anon, authenticated;
grant all on public.jvg_onboarding_request_events to service_role;
grant usage, select on sequence public.jvg_onboarding_request_events_id_seq to service_role;

alter table public.jvg_billing_charges
  add column if not exists manually_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists manual_confirmation_note text not null default '';

create or replace function public.jvg_platform_fiscal_metrics(
  p_company_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with outgoing as (
    select d.company_id, d.document_type, d.status
    from public.jvg_fiscal_documents d
    where (p_company_id is null or d.company_id = p_company_id)
      and (p_from is null or d.created_at >= p_from)
      and (p_to is null or d.created_at < p_to)
      and d.document_type in ('nfe','nfce')
  ), incoming as (
    select d.company_id
    from public.jvg_inbound_nfe_documents d
    where (p_company_id is null or d.company_id = p_company_id)
      and (p_from is null or d.created_at >= p_from)
      and (p_to is null or d.created_at < p_to)
  ), by_company as (
    select company_id,
      count(*) filter (where document_type = 'nfe' and status = 'authorized') as nfe_issued,
      count(*) filter (where document_type = 'nfe' and status = 'cancelled') as nfe_cancelled,
      count(*) filter (where document_type = 'nfe' and status in ('rejected','denied')) as nfe_rejected,
      count(*) filter (where document_type = 'nfce' and status = 'authorized') as nfce_issued,
      count(*) filter (where document_type = 'nfce' and status = 'cancelled') as nfce_cancelled,
      count(*) filter (where document_type = 'nfce' and status in ('rejected','denied')) as nfce_rejected
    from outgoing group by company_id
  ), incoming_by_company as (
    select company_id, count(*) as inbound_imported from incoming group by company_id
  )
  select jsonb_build_object(
    'nfeIssued', coalesce((select sum(nfe_issued) from by_company), 0),
    'nfeCancelled', coalesce((select sum(nfe_cancelled) from by_company), 0),
    'nfeRejected', coalesce((select sum(nfe_rejected) from by_company), 0),
    'nfceIssued', coalesce((select sum(nfce_issued) from by_company), 0),
    'nfceCancelled', coalesce((select sum(nfce_cancelled) from by_company), 0),
    'nfceRejected', coalesce((select sum(nfce_rejected) from by_company), 0),
    'inboundImported', coalesce((select sum(inbound_imported) from incoming_by_company), 0),
    'byCompany', coalesce((
      select jsonb_agg(jsonb_build_object(
        'companyId', coalesce(o.company_id, i.company_id),
        'nfeIssued', coalesce(o.nfe_issued, 0),
        'nfeCancelled', coalesce(o.nfe_cancelled, 0),
        'nfeRejected', coalesce(o.nfe_rejected, 0),
        'nfceIssued', coalesce(o.nfce_issued, 0),
        'nfceCancelled', coalesce(o.nfce_cancelled, 0),
        'nfceRejected', coalesce(o.nfce_rejected, 0),
        'inboundImported', coalesce(i.inbound_imported, 0)
      ))
      from by_company o full join incoming_by_company i using (company_id)
    ), '[]'::jsonb)
  );
$function$;
revoke all on function public.jvg_platform_fiscal_metrics(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.jvg_platform_fiscal_metrics(uuid,timestamptz,timestamptz) to service_role;
