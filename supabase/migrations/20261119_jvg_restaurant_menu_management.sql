-- Restaurant menu management. Apply only after reviewing this migration.
-- All records are scoped to both tenant_id and company_id.

alter table public.jvg_restaurant_settings
  add column if not exists public_name text,
  add column if not exists public_description text,
  add column if not exists logo_path text,
  add column if not exists cover_path text,
  add column if not exists brand_color text,
  add column if not exists opening_hours jsonb not null default '{}'::jsonb;

create table if not exists public.jvg_restaurant_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete cascade
);

create unique index if not exists jvg_restaurant_categories_company_name_idx
  on public.jvg_restaurant_categories(tenant_id, company_id, lower(name));
create index if not exists jvg_restaurant_categories_company_order_idx
  on public.jvg_restaurant_categories(tenant_id, company_id, active, sort_order, name);

create table if not exists public.jvg_restaurant_menu_items (
  tenant_id uuid not null,
  company_id uuid not null,
  product_id uuid not null,
  image_path text,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  is_combo boolean not null default false,
  combo_components jsonb not null default '[]'::jsonb check (jsonb_typeof(combo_components) = 'array'),
  promotion jsonb check (promotion is null or jsonb_typeof(promotion) = 'object'),
  public_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, company_id, product_id),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete cascade,
  foreign key (tenant_id, company_id, product_id)
    references public.jvg_products(tenant_id, company_id, id) on delete cascade
);
create index if not exists jvg_restaurant_menu_items_company_order_idx
  on public.jvg_restaurant_menu_items(tenant_id, company_id, public_active, sort_order);

alter table public.jvg_restaurant_categories enable row level security;
alter table public.jvg_restaurant_menu_items enable row level security;
revoke all on public.jvg_restaurant_categories, public.jvg_restaurant_menu_items
  from public, anon, authenticated;
grant select, insert, update, delete on public.jvg_restaurant_categories,
  public.jvg_restaurant_menu_items to service_role;

create or replace function public.jvg_restaurant_rename_category(
  p_tenant_id uuid,
  p_company_id uuid,
  p_category_id uuid,
  p_new_name text,
  p_delete boolean default false
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_name text;
  v_new_name text := btrim(coalesce(p_new_name, ''));
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;

  select name into v_old_name
  from public.jvg_restaurant_categories
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_category_id
  for update;
  if v_old_name is null then return false; end if;

  if p_delete then
    if exists (
      select 1 from public.jvg_products
      where tenant_id = p_tenant_id and company_id = p_company_id and category = v_old_name
    ) then
      raise exception 'A categoria ainda esta vinculada a produtos.' using errcode = '23503';
    end if;
    delete from public.jvg_restaurant_categories
    where tenant_id = p_tenant_id and company_id = p_company_id and id = p_category_id;
    return true;
  end if;

  if char_length(v_new_name) not between 2 and 60 then
    raise exception 'O nome da categoria deve ter de 2 a 60 caracteres.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.jvg_restaurant_categories
    where tenant_id = p_tenant_id and company_id = p_company_id and lower(name) = lower(v_new_name) and id <> p_category_id
  ) then
    raise exception 'Ja existe uma categoria com esse nome.' using errcode = '23505';
  end if;

  update public.jvg_products
  set category = v_new_name, updated_at = now()
  where tenant_id = p_tenant_id and company_id = p_company_id and category = v_old_name;
  update public.jvg_restaurant_categories
  set name = v_new_name, updated_at = now()
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_category_id;
  return true;
end;
$$;

revoke all on function public.jvg_restaurant_rename_category(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_rename_category(uuid, uuid, uuid, text, boolean)
  to service_role;

create or replace function public.jvg_restaurant_save_menu_item(
  p_tenant_id uuid,
  p_company_id uuid,
  p_product_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_sale_price numeric,
  p_options jsonb,
  p_is_combo boolean,
  p_combo_components jsonb,
  p_promotion jsonb,
  p_public_active boolean,
  p_sort_order integer default 0
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Operacao restrita ao servidor' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 160
     or p_sale_price is null or p_sale_price < 0
     or coalesce(jsonb_typeof(p_options), '') <> 'array'
     or coalesce(jsonb_typeof(p_combo_components), '') <> 'array'
     or coalesce(jsonb_typeof(p_promotion), 'null') not in ('object', 'null') then
    raise exception 'Dados do cardapio invalidos.' using errcode = '22023';
  end if;

  update public.jvg_products
  set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''),
      category = nullif(btrim(coalesce(p_category, '')), ''), sale_price = p_sale_price,
      updated_at = now()
  where tenant_id = p_tenant_id and company_id = p_company_id and id = p_product_id;
  if not found then return false; end if;

  insert into public.jvg_restaurant_menu_items (
    tenant_id, company_id, product_id, options, is_combo, combo_components,
    promotion, public_active, sort_order, updated_at
  ) values (
    p_tenant_id, p_company_id, p_product_id, p_options, p_is_combo, p_combo_components,
    nullif(p_promotion, 'null'::jsonb), p_public_active, greatest(0, least(10000, coalesce(p_sort_order, 0))), now()
  ) on conflict (tenant_id, company_id, product_id) do update set
    options = excluded.options,
    is_combo = excluded.is_combo,
    combo_components = excluded.combo_components,
    promotion = excluded.promotion,
    public_active = excluded.public_active,
    sort_order = excluded.sort_order,
    updated_at = now();
  return true;
end;
$$;

revoke all on function public.jvg_restaurant_save_menu_item(uuid, uuid, uuid, text, text, text, numeric, jsonb, boolean, jsonb, jsonb, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.jvg_restaurant_save_menu_item(uuid, uuid, uuid, text, text, text, numeric, jsonb, boolean, jsonb, jsonb, boolean, integer)
  to service_role;

comment on table public.jvg_restaurant_categories is
  'Categorias do cardapio publico, isoladas por tenant e empresa.';
comment on table public.jvg_restaurant_menu_items is
  'Fotos, adicionais, combos e promocoes do cardapio, associados aos produtos existentes.';
