-- Pedidos comerciais criados a partir de orçamentos aceitos.
-- PENDENTE: executar em homologação antes de qualquer publicação. Não aplicado à produção.
create table if not exists public.jvg_orders (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 company_id uuid not null,
 quote_id uuid not null references public.jvg_quotes(id),
 customer_id uuid,
 status text not null default 'open' check (status in ('open','cancelled','fulfilled')),
 items jsonb not null check (jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 100),
 notes text not null default '',
 total numeric(18,2) not null check (total>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (tenant_id,company_id,quote_id)
);
create index if not exists jvg_orders_company_recent_idx
 on public.jvg_orders (tenant_id,company_id,created_at desc,id desc);
alter table public.jvg_orders enable row level security;
revoke all on public.jvg_orders from public,anon,authenticated;
grant select,insert,update on public.jvg_orders to service_role;

-- Uma transação atômica cria no máximo um pedido por orçamento, mesmo com cliques simultâneos.
create or replace function public.jvg_create_order_from_quote(
 p_tenant_id uuid,p_company_id uuid,p_quote_id uuid
) returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_order_id uuid;
begin
 if current_user <> 'service_role' then
   raise exception 'Operacao restrita ao servidor' using errcode='42501';
 end if;
 if not exists (
   select 1 from public.jvg_quotes
   where id=p_quote_id and tenant_id=p_tenant_id and company_id=p_company_id and status='accepted'
 ) then
   raise exception 'Orcamento nao encontrado ou nao aceito';
 end if;
 insert into public.jvg_orders(tenant_id,company_id,quote_id,customer_id,items,notes,total)
 select tenant_id,company_id,id,customer_id,items,notes,total
 from public.jvg_quotes
 where id=p_quote_id and tenant_id=p_tenant_id and company_id=p_company_id and status='accepted'
 on conflict (tenant_id,company_id,quote_id) do nothing
 returning id into v_order_id;
 if v_order_id is null then
   select id into v_order_id from public.jvg_orders
   where tenant_id=p_tenant_id and company_id=p_company_id and quote_id=p_quote_id;
 end if;
 return v_order_id;
end;
$$;
revoke all on function public.jvg_create_order_from_quote(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.jvg_create_order_from_quote(uuid,uuid,uuid) to service_role;
-- Criar pedido não movimenta estoque, não gera venda nem cobrança.
