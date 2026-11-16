-- Histórico da assistência. Permanece mesmo se a OS for removida.

create table if not exists public.jvg_service_order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  service_order_id uuid,
  os_number bigint not null check (os_number >= 0),
  event_type text not null check (event_type in ('opened', 'claimed', 'updated', 'removed', 'whatsapp')),
  actor_user_id uuid,
  actor_name text not null check (char_length(btrim(actor_name)) between 1 and 80),
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists jvg_service_order_events_company_idx
  on public.jvg_service_order_events (tenant_id, company_id, created_at desc);

alter table public.jvg_service_order_events enable row level security;
revoke all on public.jvg_service_order_events from public, anon, authenticated;
grant select, insert on public.jvg_service_order_events to service_role;
