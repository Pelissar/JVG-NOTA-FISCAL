-- Configurable, data-backed featured section for the public restaurant menu.
-- The values remain scoped to the existing tenant/company settings row.
begin;

alter table public.jvg_restaurant_settings
  add column if not exists public_highlight_mode text not null default 'popular',
  add column if not exists public_highlight_title text not null default 'Mais pedidos',
  add column if not exists public_highlight_product_ids uuid[] not null default '{}'::uuid[];

alter table public.jvg_restaurant_settings
  drop constraint if exists jvg_restaurant_settings_public_highlight_mode_check,
  drop constraint if exists jvg_restaurant_settings_public_highlight_title_check,
  drop constraint if exists jvg_restaurant_settings_public_highlight_product_ids_check;

alter table public.jvg_restaurant_settings
  add constraint jvg_restaurant_settings_public_highlight_mode_check
    check (public_highlight_mode in ('popular', 'promotions', 'manual')),
  add constraint jvg_restaurant_settings_public_highlight_title_check
    check (char_length(btrim(public_highlight_title)) between 2 and 60),
  add constraint jvg_restaurant_settings_public_highlight_product_ids_check
    check (cardinality(public_highlight_product_ids) <= 12);

create or replace function public.jvg_restaurant_public_menu_popularity(
  p_tenant_id uuid,
  p_company_id uuid,
  p_since timestamptz
) returns table(product_id uuid, quantity numeric)
language sql
stable
security invoker
set search_path = ''
as $function$
  with parsed_items as (
    select
      case
        when coalesce(line.item ->> 'product_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (line.item ->> 'product_id')::uuid
        else null
      end as product_id,
      case
        when coalesce(line.item ->> 'quantity', '') ~ '^[0-9]+(\.[0-9]+)?$'
        then (line.item ->> 'quantity')::numeric
        else 0::numeric
      end as quantity
    from public.jvg_restaurant_orders as orders
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(orders.items) = 'array' then orders.items else '[]'::jsonb end
    ) as line(item)
    where orders.tenant_id = p_tenant_id
      and orders.company_id = p_company_id
      and orders.status = 'delivered'
      and orders.created_at >= p_since
  )
  select parsed_items.product_id, sum(parsed_items.quantity)
  from parsed_items
  where parsed_items.product_id is not null and parsed_items.quantity > 0
  group by parsed_items.product_id
  order by sum(parsed_items.quantity) desc, parsed_items.product_id
  limit 8;
$function$;

revoke all on function public.jvg_restaurant_public_menu_popularity(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.jvg_restaurant_public_menu_popularity(uuid, uuid, timestamptz) to service_role;

commit;

-- Rollback: drop the three constraints above and the public_highlight_mode,
-- public_highlight_title, and public_highlight_product_ids columns.
-- Also drop function public.jvg_restaurant_public_menu_popularity(uuid, uuid, timestamptz).
