begin;

-- Cozinha Viva: versioned recipes, traceable XML purchase costs, stock counts,
-- losses, and idempotent restaurant consumption. All writes stay server-side.

create table if not exists public.jvg_restaurant_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  menu_product_id uuid not null,
  version_no integer not null check (version_no > 0),
  yield_quantity numeric(18,4) not null check (yield_quantity > 0),
  yield_unit text not null check (char_length(btrim(yield_unit)) between 1 and 12),
  minimum_margin_percent numeric(5,2) check (minimum_margin_percent is null or minimum_margin_percent between 0 and 100),
  notes text not null default '' check (char_length(notes) <= 500),
  is_current boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (company_id, menu_product_id, version_no),
  foreign key (tenant_id, company_id, menu_product_id)
    references public.jvg_products(tenant_id, company_id, id) on delete restrict
);
create unique index if not exists jvg_restaurant_recipe_current_uidx
  on public.jvg_restaurant_recipe_versions(tenant_id, company_id, menu_product_id)
  where is_current;
create index if not exists jvg_restaurant_recipe_history_idx
  on public.jvg_restaurant_recipe_versions(tenant_id, company_id, menu_product_id, version_no desc);

create table if not exists public.jvg_restaurant_recipe_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  recipe_version_id uuid not null,
  position integer not null check (position between 1 and 100),
  ingredient_product_id uuid not null,
  quantity_per_yield numeric(18,6) not null check (quantity_per_yield > 0),
  unit text not null check (char_length(btrim(unit)) between 1 and 12),
  conversion_to_stock_unit numeric(18,8) not null check (conversion_to_stock_unit > 0 and conversion_to_stock_unit <= 1000000),
  created_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (recipe_version_id, position),
  unique (recipe_version_id, ingredient_product_id),
  foreign key (tenant_id, company_id, recipe_version_id)
    references public.jvg_restaurant_recipe_versions(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, ingredient_product_id)
    references public.jvg_products(tenant_id, company_id, id) on delete restrict
);
create index if not exists jvg_restaurant_recipe_items_version_idx
  on public.jvg_restaurant_recipe_items(tenant_id, company_id, recipe_version_id, position);

create table if not exists public.jvg_restaurant_ingredient_cost_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  ingredient_product_id uuid not null,
  inbound_nfe_id uuid not null,
  inbound_nfe_item_number integer not null check (inbound_nfe_item_number > 0),
  supplier_party_id uuid not null,
  supplier_name_snapshot text not null,
  invoice_number_snapshot text not null,
  source_quantity numeric(18,6) not null check (source_quantity > 0),
  source_unit text not null,
  source_unit_cost numeric(18,6) not null check (source_unit_cost >= 0),
  conversion_to_stock_unit numeric(18,8) not null check (conversion_to_stock_unit > 0 and conversion_to_stock_unit <= 1000000),
  stock_unit text not null,
  stock_unit_cost numeric(18,6) not null check (stock_unit_cost >= 0),
  lot_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(lot_snapshot) = 'array'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (company_id, inbound_nfe_id, inbound_nfe_item_number),
  foreign key (tenant_id, company_id, ingredient_product_id)
    references public.jvg_products(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, inbound_nfe_id)
    references public.jvg_inbound_nfe_documents(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, supplier_party_id)
    references public.jvg_parties(tenant_id, company_id, id) on delete restrict
);
create index if not exists jvg_restaurant_ingredient_cost_recent_idx
  on public.jvg_restaurant_ingredient_cost_history(tenant_id, company_id, ingredient_product_id, created_at desc);

create table if not exists public.jvg_restaurant_inventory_count_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  label text not null check (char_length(btrim(label)) between 2 and 80),
  status text not null default 'open' check (status in ('open','closed')),
  opened_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, company_id, id),
  foreign key (tenant_id, company_id)
    references public.jvg_companies(tenant_id, id) on delete restrict
);
create unique index if not exists jvg_restaurant_count_one_open_uidx
  on public.jvg_restaurant_inventory_count_sessions(tenant_id, company_id)
  where status = 'open';
create index if not exists jvg_restaurant_count_recent_idx
  on public.jvg_restaurant_inventory_count_sessions(tenant_id, company_id, opened_at desc);

create table if not exists public.jvg_restaurant_inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  session_id uuid not null,
  ingredient_product_id uuid not null,
  expected_at_open numeric(18,4) not null,
  expected_at_count numeric(18,4),
  counted_quantity numeric(18,4) check (counted_quantity is null or counted_quantity >= 0),
  counted_at timestamptz,
  expected_at_close numeric(18,4),
  variance numeric(18,4),
  classification text check (classification is null or classification in ('loss','overproduction','count_error','adjustment','other')),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  unique (session_id, ingredient_product_id),
  foreign key (tenant_id, company_id, session_id)
    references public.jvg_restaurant_inventory_count_sessions(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, ingredient_product_id)
    references public.jvg_products(tenant_id, company_id, id) on delete restrict
);
create index if not exists jvg_restaurant_count_items_session_idx
  on public.jvg_restaurant_inventory_count_items(tenant_id, company_id, session_id, ingredient_product_id);

create table if not exists public.jvg_restaurant_prep_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  company_id uuid not null,
  menu_product_id uuid not null,
  recipe_version_id uuid not null,
  shift_name text not null check (char_length(btrim(shift_name)) between 2 and 60),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  prepared_quantity numeric(18,4) not null check (prepared_quantity > 0),
  remaining_quantity numeric(18,4) not null check (remaining_quantity >= 0 and remaining_quantity <= prepared_quantity),
  notes text not null default '' check (char_length(notes) <= 300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, company_id, id),
  check (ends_at > starts_at),
  foreign key (tenant_id, company_id, menu_product_id)
    references public.jvg_products(tenant_id, company_id, id) on delete restrict,
  foreign key (tenant_id, company_id, recipe_version_id)
    references public.jvg_restaurant_recipe_versions(tenant_id, company_id, id) on delete restrict
);
create index if not exists jvg_restaurant_prep_runs_recent_idx
  on public.jvg_restaurant_prep_runs(tenant_id, company_id, starts_at desc);

alter table public.jvg_inventory_movements
  add column if not exists restaurant_order_id uuid,
  add column if not exists restaurant_order_item_index integer,
  add column if not exists restaurant_recipe_version_id uuid,
  add column if not exists restaurant_count_session_id uuid,
  add column if not exists restaurant_count_item_id uuid,
  add column if not exists unit_cost_snapshot numeric(18,6),
  add column if not exists inbound_conversion_to_stock_unit numeric(18,8),
  add column if not exists inbound_unit_cost_snapshot numeric(18,6),
  add column if not exists inbound_lot_snapshot jsonb not null default '[]'::jsonb;

alter table public.jvg_inventory_movements
  drop constraint if exists jvg_inventory_movements_movement_type_check;
alter table public.jvg_inventory_movements
  add constraint jvg_inventory_movements_movement_type_check
  check (movement_type in ('opening','purchase','sale','return','adjustment','transfer_in','transfer_out','loss'));
alter table public.jvg_inventory_movements
  add constraint jvg_inventory_movements_restaurant_order_fk
  foreign key (tenant_id, company_id, restaurant_order_id)
  references public.jvg_restaurant_orders(tenant_id, company_id, id) on delete restrict;
alter table public.jvg_inventory_movements
  add constraint jvg_inventory_movements_restaurant_recipe_fk
  foreign key (tenant_id, company_id, restaurant_recipe_version_id)
  references public.jvg_restaurant_recipe_versions(tenant_id, company_id, id) on delete restrict;
alter table public.jvg_inventory_movements
  add constraint jvg_inventory_movements_restaurant_count_session_fk
  foreign key (tenant_id, company_id, restaurant_count_session_id)
  references public.jvg_restaurant_inventory_count_sessions(tenant_id, company_id, id) on delete restrict;
alter table public.jvg_inventory_movements
  add constraint jvg_inventory_movements_restaurant_count_item_fk
  foreign key (tenant_id, company_id, restaurant_count_item_id)
  references public.jvg_restaurant_inventory_count_items(tenant_id, company_id, id) on delete restrict;
alter table public.jvg_inventory_movements
  add constraint jvg_inventory_movements_restaurant_order_item_check
  check ((restaurant_order_id is null and restaurant_order_item_index is null) or
         (restaurant_order_id is not null and restaurant_order_item_index between 1 and 100));
alter table public.jvg_inventory_movements
  add constraint jvg_inventory_movements_restaurant_cost_check
  check (unit_cost_snapshot is null or unit_cost_snapshot >= 0);
create unique index if not exists jvg_inventory_restaurant_consumption_uidx
  on public.jvg_inventory_movements(tenant_id, company_id, restaurant_order_id, restaurant_order_item_index, product_id)
  where restaurant_order_id is not null;
create unique index if not exists jvg_inventory_restaurant_count_adjustment_uidx
  on public.jvg_inventory_movements(tenant_id, company_id, restaurant_count_item_id)
  where restaurant_count_item_id is not null;

alter table public.jvg_restaurant_recipe_versions enable row level security;
alter table public.jvg_restaurant_recipe_items enable row level security;
alter table public.jvg_restaurant_ingredient_cost_history enable row level security;
alter table public.jvg_restaurant_inventory_count_sessions enable row level security;
alter table public.jvg_restaurant_inventory_count_items enable row level security;
alter table public.jvg_restaurant_prep_runs enable row level security;
revoke all on public.jvg_restaurant_recipe_versions, public.jvg_restaurant_recipe_items,
  public.jvg_restaurant_ingredient_cost_history, public.jvg_restaurant_inventory_count_sessions,
  public.jvg_restaurant_inventory_count_items, public.jvg_restaurant_prep_runs from public, anon, authenticated;
grant select, insert, update on public.jvg_restaurant_recipe_versions, public.jvg_restaurant_recipe_items,
  public.jvg_restaurant_ingredient_cost_history, public.jvg_restaurant_inventory_count_sessions,
  public.jvg_restaurant_inventory_count_items, public.jvg_restaurant_prep_runs to service_role;
grant select, insert, update on public.jvg_inventory_movements to service_role;

-- The inbound XML receipt accepts an explicitly confirmed unit conversion.
-- Its stock movement remains the sole purchase movement; cost application is
-- a separate, human-confirmed action in Cozinha Viva.
create or replace function public.jvg_confirm_inbound_nfe(
  p_tenant_id uuid, p_company_id uuid, p_document_id uuid, p_actor_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_doc public.jvg_inbound_nfe_documents%rowtype;
  v_item jsonb; v_item_number integer; v_product record; v_conversion numeric;
  v_quantity numeric; v_unit_cost numeric; v_location_id uuid; v_count integer := 0;
  v_lots jsonb;
begin
  if current_user <> 'service_role' then raise exception 'Operacao somente de servidor' using errcode = '42501'; end if;
  select * into v_doc from public.jvg_inbound_nfe_documents
  where tenant_id=p_tenant_id and company_id=p_company_id and id=p_document_id for update;
  if not found then raise exception 'Documento nao encontrado nesta empresa'; end if;
  if v_doc.status='received' then return jsonb_build_object('received',true,'alreadyReceived',true); end if;
  if v_doc.status<>'draft' then raise exception 'Documento nao esta pendente'; end if;
  if v_doc.supplier_party_id is null then raise exception 'Selecione o fornecedor antes de receber a NF-e'; end if;
  select id into v_location_id from public.jvg_locations
  where tenant_id=p_tenant_id and company_id=p_company_id and code='PRINCIPAL' and active;
  if not found then raise exception 'Deposito principal nao localizado'; end if;

  for v_item in select value from jsonb_array_elements(v_doc.items) as lines(value) loop
    if coalesce((v_item->>'trackStock')::boolean,false) then
      if coalesce(v_item->>'productId','')='' then raise exception 'Associe um produto a cada item que movimentara estoque'; end if;
      v_item_number := (v_item->>'lineNumber')::integer;
      if v_item_number < 1 or coalesce((v_item->>'quantity')::numeric,0) <= 0 then raise exception 'Item ou quantidade invalida'; end if;
      select id,unit,cost_price,tracks_stock into v_product from public.jvg_products
      where tenant_id=p_tenant_id and company_id=p_company_id and id=(v_item->>'productId')::uuid and active for update;
      if not found or v_product.tracks_stock is not true then raise exception 'Produto indisponivel para controle de estoque'; end if;
      if coalesce(v_item->>'conversionToStockUnit','')='' then
        if upper(btrim(v_product.unit))<>upper(btrim(coalesce(v_item->>'unit',''))) then
          raise exception 'Item %: confirme o fator de conversao entre % e % antes de receber',v_item_number,coalesce(v_item->>'unit',''),v_product.unit;
        end if;
        v_conversion := 1;
      else
        v_conversion := (v_item->>'conversionToStockUnit')::numeric;
      end if;
      if v_conversion<=0 or v_conversion>1000000 then raise exception 'Item %: fator de conversao invalido',v_item_number; end if;
      if upper(btrim(v_product.unit))=upper(btrim(coalesce(v_item->>'unit',''))) and v_conversion<>1 then
        raise exception 'Item %: unidades iguais precisam usar conversao 1',v_item_number;
      end if;
      v_quantity := round((v_item->>'quantity')::numeric*v_conversion,4);
      v_unit_cost := round(coalesce((v_item->>'unitPrice')::numeric,0)/v_conversion,6);
      v_lots := case when jsonb_typeof(v_item->'batches')='array' then v_item->'batches' else '[]'::jsonb end;
      insert into public.jvg_inventory_movements(
        tenant_id,company_id,product_id,location_id,quantity_delta,movement_type,reason,
        inbound_nfe_id,inbound_nfe_item_number,inbound_conversion_to_stock_unit,inbound_unit_cost_snapshot,inbound_lot_snapshot
      ) values (
        p_tenant_id,p_company_id,v_product.id,v_location_id,v_quantity,'purchase',
        'Entrada NF-e '||v_doc.invoice_number||' · '||v_doc.access_key,
        v_doc.id,v_item_number,v_conversion,v_unit_cost,v_lots
      );
      v_count := v_count+1;
    end if;
  end loop;
  update public.jvg_inbound_nfe_documents set status='received',received_by=p_actor_user_id,
    received_at=now(),updated_at=now() where tenant_id=p_tenant_id and company_id=p_company_id and id=v_doc.id;
  insert into public.jvg_audit_events(tenant_id,company_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_tenant_id,p_company_id,p_actor_user_id,'inbound_nfe_received','inbound_nfe',v_doc.id,
    jsonb_build_object('accessKey',v_doc.access_key,'invoiceNumber',v_doc.invoice_number,'stockLines',v_count));
  return jsonb_build_object('received',true,'stockLines',v_count);
end;
$function$;
revoke all on function public.jvg_confirm_inbound_nfe(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.jvg_confirm_inbound_nfe(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.jvg_restaurant_update_count_item(
  p_tenant_id uuid,p_company_id uuid,p_session_id uuid,p_item_id uuid,
  p_counted_quantity numeric,p_classification text,p_note text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare v_session public.jvg_restaurant_inventory_count_sessions%rowtype; v_item public.jvg_restaurant_inventory_count_items%rowtype;
  v_expected numeric; v_counted_at timestamptz;
begin
  if current_user<>'service_role' then raise exception 'Operacao restrita ao servidor' using errcode='42501'; end if;
  if p_counted_quantity is null or p_counted_quantity<0 or p_counted_quantity>999999999 then raise exception 'Contagem fisica invalida'; end if;
  if p_classification is not null and p_classification not in ('loss','overproduction','count_error','adjustment','other') then raise exception 'Classificacao de diferenca invalida'; end if;
  if char_length(coalesce(p_note,''))>500 then raise exception 'Observacao acima do limite'; end if;
  select * into v_session from public.jvg_restaurant_inventory_count_sessions
  where tenant_id=p_tenant_id and company_id=p_company_id and id=p_session_id for update;
  if not found or v_session.status<>'open' then raise exception 'Contagem nao encontrada ou ja encerrada'; end if;
  select * into v_item from public.jvg_restaurant_inventory_count_items
  where tenant_id=p_tenant_id and company_id=p_company_id and session_id=p_session_id and id=p_item_id for update;
  if not found then raise exception 'Ingrediente nao pertence a esta contagem'; end if;
  v_counted_at := clock_timestamp();
  select coalesce(sum(quantity_delta),0) into v_expected from public.jvg_inventory_movements
  where tenant_id=p_tenant_id and company_id=p_company_id and product_id=v_item.ingredient_product_id
    and created_at<=v_counted_at;
  update public.jvg_restaurant_inventory_count_items set counted_quantity=p_counted_quantity,
    counted_at=v_counted_at,expected_at_count=v_expected,variance=p_counted_quantity-v_expected,
    classification=nullif(p_classification,''),note=left(btrim(coalesce(p_note,'')),500),updated_at=now()
  where id=v_item.id and tenant_id=p_tenant_id and company_id=p_company_id;
  return jsonb_build_object('saved',true);
end;
$function$;

create or replace function public.jvg_restaurant_record_prep_run(
  p_tenant_id uuid,p_company_id uuid,p_menu_product_id uuid,p_shift_name text,
  p_starts_at timestamptz,p_ends_at timestamptz,p_prepared_quantity numeric,
  p_remaining_quantity numeric,p_notes text,p_actor_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare v_recipe public.jvg_restaurant_recipe_versions%rowtype; v_id uuid;
begin
  if current_user<>'service_role' then raise exception 'Operacao restrita ao servidor' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_shift_name,''))) not between 2 and 60 then raise exception 'Informe o nome do turno'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'Confira inicio e fim do turno'; end if;
  if p_prepared_quantity is null or p_prepared_quantity<=0 or p_remaining_quantity is null or p_remaining_quantity<0 or p_remaining_quantity>p_prepared_quantity then raise exception 'Quantidade preparada ou sobra invalida'; end if;
  select * into v_recipe from public.jvg_restaurant_recipe_versions
  where tenant_id=p_tenant_id and company_id=p_company_id and menu_product_id=p_menu_product_id and is_current for share;
  if not found then raise exception 'Cadastre uma ficha tecnica antes de registrar o preparo'; end if;
  insert into public.jvg_restaurant_prep_runs(
    tenant_id,company_id,menu_product_id,recipe_version_id,shift_name,starts_at,ends_at,prepared_quantity,remaining_quantity,notes,created_by
  ) values (
    p_tenant_id,p_company_id,p_menu_product_id,v_recipe.id,left(btrim(p_shift_name),60),p_starts_at,p_ends_at,
    p_prepared_quantity,p_remaining_quantity,left(btrim(coalesce(p_notes,'')),300),p_actor_user_id
  ) returning id into v_id;
  return jsonb_build_object('id',v_id,'recipeVersionId',v_recipe.id,'recipeVersion',v_recipe.version_no);
end;
$function$;

create or replace function public.jvg_restaurant_inventory_balances(
  p_tenant_id uuid,p_company_id uuid
) returns table(product_id uuid,balance numeric)
language plpgsql security invoker set search_path = ''
as $function$
begin
  if current_user<>'service_role' then raise exception 'Operacao restrita ao servidor' using errcode='42501'; end if;
  return query
  select p.id,coalesce(sum(m.quantity_delta),0)::numeric
  from public.jvg_products p
  left join public.jvg_inventory_movements m on m.tenant_id=p.tenant_id and m.company_id=p.company_id and m.product_id=p.id
  where p.tenant_id=p_tenant_id and p.company_id=p_company_id and p.active and p.tracks_stock
  group by p.id;
end;
$function$;

create or replace function public.jvg_restaurant_save_recipe(
  p_tenant_id uuid,
  p_company_id uuid,
  p_menu_product_id uuid,
  p_yield_quantity numeric,
  p_yield_unit text,
  p_minimum_margin_percent numeric,
  p_notes text,
  p_items jsonb,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_product record;
  v_item jsonb;
  v_ingredient record;
  v_version_id uuid;
  v_version_no integer;
  v_position integer := 0;
  v_count integer := 0;
begin
  if current_user <> 'service_role' then raise exception 'Operacao restrita ao servidor' using errcode = '42501'; end if;
  if p_yield_quantity is null or p_yield_quantity <= 0 or p_yield_quantity > 1000000 then raise exception 'Rendimento invalido'; end if;
  if p_minimum_margin_percent is not null and (p_minimum_margin_percent < 0 or p_minimum_margin_percent > 100) then raise exception 'Margem minima deve estar entre 0 e 100'; end if;
  if char_length(btrim(coalesce(p_yield_unit,''))) not between 1 and 12 then raise exception 'Informe a unidade do rendimento'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'A ficha precisa ter de 1 a 100 ingredientes'; end if;
  select id into v_product from public.jvg_products
  where tenant_id=p_tenant_id and company_id=p_company_id and id=p_menu_product_id and active
  for update;
  if not found then raise exception 'Prato nao encontrado nesta empresa'; end if;
  select coalesce(max(version_no),0)+1 into v_version_no from public.jvg_restaurant_recipe_versions
  where tenant_id=p_tenant_id and company_id=p_company_id and menu_product_id=p_menu_product_id;
  update public.jvg_restaurant_recipe_versions set is_current=false
  where tenant_id=p_tenant_id and company_id=p_company_id and menu_product_id=p_menu_product_id and is_current;
  insert into public.jvg_restaurant_recipe_versions (
    tenant_id,company_id,menu_product_id,version_no,yield_quantity,yield_unit,minimum_margin_percent,notes,is_current,created_by
  ) values (
    p_tenant_id,p_company_id,p_menu_product_id,v_version_no,p_yield_quantity,btrim(p_yield_unit),p_minimum_margin_percent,left(btrim(coalesce(p_notes,'')),500),true,p_actor_user_id
  ) returning id into v_version_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_position := v_position + 1;
    if coalesce(v_item->>'ingredientProductId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raise exception 'Ingrediente invalido'; end if;
    if coalesce((v_item->>'quantityPerYield')::numeric,0) <= 0 or coalesce((v_item->>'quantityPerYield')::numeric,0) > 100000000 then raise exception 'Quantidade de ingrediente invalida'; end if;
    if coalesce((v_item->>'conversionToStockUnit')::numeric,0) <= 0 or coalesce((v_item->>'conversionToStockUnit')::numeric,0) > 1000000 then raise exception 'Conversao para unidade de estoque invalida'; end if;
    select id,unit into v_ingredient from public.jvg_products
    where tenant_id=p_tenant_id and company_id=p_company_id and id=(v_item->>'ingredientProductId')::uuid and active and tracks_stock
    for update;
    if not found then raise exception 'Ingrediente precisa ser ativo e controlar estoque'; end if;
    if char_length(btrim(coalesce(v_item->>'unit',''))) not between 1 and 12 then raise exception 'Informe a unidade usada na ficha'; end if;
    insert into public.jvg_restaurant_recipe_items (
      tenant_id,company_id,recipe_version_id,position,ingredient_product_id,quantity_per_yield,unit,conversion_to_stock_unit
    ) values (
      p_tenant_id,p_company_id,v_version_id,v_position,v_ingredient.id,(v_item->>'quantityPerYield')::numeric,
      btrim(v_item->>'unit'),(v_item->>'conversionToStockUnit')::numeric
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('id',v_version_id,'version',v_version_no,'itemCount',v_count);
end;
$function$;

create or replace function public.jvg_restaurant_apply_inbound_cost(
  p_tenant_id uuid,
  p_company_id uuid,
  p_document_id uuid,
  p_line_number integer,
  p_product_id uuid,
  p_conversion_to_stock_unit numeric,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_doc public.jvg_inbound_nfe_documents%rowtype;
  v_item jsonb;
  v_product record;
  v_supplier record;
  v_source_unit text;
  v_source_quantity numeric;
  v_source_cost numeric;
  v_stock_cost numeric;
  v_history_id uuid;
  v_received_conversion numeric;
  v_lots jsonb;
begin
  if current_user <> 'service_role' then raise exception 'Operacao restrita ao servidor' using errcode = '42501'; end if;
  if p_line_number < 1 or p_conversion_to_stock_unit is null or p_conversion_to_stock_unit <= 0 or p_conversion_to_stock_unit > 1000000 then raise exception 'Linha ou conversao invalida'; end if;
  select * into v_doc from public.jvg_inbound_nfe_documents
  where tenant_id=p_tenant_id and company_id=p_company_id and id=p_document_id for update;
  if not found or v_doc.status <> 'received' then raise exception 'A compra precisa estar recebida no estoque'; end if;
  select lines.value into v_item from jsonb_array_elements(v_doc.items) as lines(value)
  where (lines.value->>'lineNumber')::integer = p_line_number;
  if v_item is null then raise exception 'Item da compra nao encontrado'; end if;
  if coalesce((v_item->>'trackStock')::boolean,false) is not true or coalesce(v_item->>'productId','') <> p_product_id::text then raise exception 'Confirme primeiro o vinculo do item ao produto e ao estoque'; end if;
  v_source_unit := upper(btrim(coalesce(v_item->>'unit','')));
  v_source_quantity := coalesce((v_item->>'quantity')::numeric,0);
  v_source_cost := coalesce((v_item->>'unitPrice')::numeric,0);
  if v_source_unit = '' or v_source_quantity <= 0 or v_source_cost < 0 then raise exception 'Compra sem unidade, quantidade ou custo de item valido'; end if;
  select id,unit,tracks_stock into v_product from public.jvg_products
  where tenant_id=p_tenant_id and company_id=p_company_id and id=p_product_id and active for update;
  if not found or v_product.tracks_stock is not true then raise exception 'Ingrediente indisponivel para controle de estoque'; end if;
  select inbound_conversion_to_stock_unit into v_received_conversion
  from public.jvg_inventory_movements
  where tenant_id=p_tenant_id and company_id=p_company_id and inbound_nfe_id=p_document_id
    and inbound_nfe_item_number=p_line_number and product_id=p_product_id and movement_type='purchase';
  if not found then raise exception 'Movimento de estoque da linha nao foi localizado'; end if;
  if v_received_conversion is distinct from p_conversion_to_stock_unit then raise exception 'Use o fator de conversao confirmado no recebimento da NF-e'; end if;
  if upper(btrim(v_product.unit)) = v_source_unit and p_conversion_to_stock_unit <> 1 then raise exception 'Unidades iguais precisam usar conversao 1'; end if;
  if upper(btrim(v_product.unit)) <> v_source_unit and p_conversion_to_stock_unit = 1 then raise exception 'Unidades diferentes exigem fator de conversao confirmado'; end if;
  select id,display_name into v_supplier from public.jvg_parties
  where tenant_id=p_tenant_id and company_id=p_company_id and id=v_doc.supplier_party_id;
  v_stock_cost := round(v_source_cost / p_conversion_to_stock_unit,6);
  v_lots := case when jsonb_typeof(v_item->'batches')='array' then v_item->'batches' else '[]'::jsonb end;
  insert into public.jvg_restaurant_ingredient_cost_history (
    tenant_id,company_id,ingredient_product_id,inbound_nfe_id,inbound_nfe_item_number,supplier_party_id,
    supplier_name_snapshot,invoice_number_snapshot,source_quantity,source_unit,source_unit_cost,
    conversion_to_stock_unit,stock_unit,stock_unit_cost,lot_snapshot,created_by
  ) values (
    p_tenant_id,p_company_id,p_product_id,p_document_id,p_line_number,v_doc.supplier_party_id,
    coalesce(v_supplier.display_name,v_doc.issuer_name),v_doc.invoice_number,v_source_quantity,v_source_unit,v_source_cost,
    p_conversion_to_stock_unit,v_product.unit,v_stock_cost,v_lots,p_actor_user_id
  ) on conflict (company_id,inbound_nfe_id,inbound_nfe_item_number) do nothing returning id into v_history_id;
  if v_history_id is null then raise exception 'O custo desta linha ja foi confirmado e nao pode ser reaplicado'; end if;
  update public.jvg_products set cost_price=v_stock_cost,updated_at=now()
  where tenant_id=p_tenant_id and company_id=p_company_id and id=p_product_id;
  return jsonb_build_object('historyId',v_history_id,'unitCost',v_stock_cost,'sourceUnit',v_source_unit,'stockUnit',v_product.unit);
end;
$function$;

create or replace function public.jvg_restaurant_record_loss(
  p_tenant_id uuid,p_company_id uuid,p_product_id uuid,p_quantity numeric,p_reason text,p_actor_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare v_product public.jvg_products%rowtype; v_location_id uuid; v_balance numeric;
begin
  if current_user <> 'service_role' then raise exception 'Operacao restrita ao servidor' using errcode = '42501'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 999999999 then raise exception 'Quantidade de perda invalida'; end if;
  if char_length(btrim(coalesce(p_reason,''))) not between 3 and 120 then raise exception 'Informe o motivo da perda'; end if;
  select * into v_product from public.jvg_products where tenant_id=p_tenant_id and company_id=p_company_id and id=p_product_id and active and tracks_stock for update;
  if not found then raise exception 'Ingrediente nao encontrado ou sem controle de estoque'; end if;
  select id into v_location_id from public.jvg_locations where tenant_id=p_tenant_id and company_id=p_company_id and code='PRINCIPAL' and active;
  if not found then raise exception 'Deposito principal nao localizado'; end if;
  select coalesce(sum(quantity_delta),0) into v_balance from public.jvg_inventory_movements where tenant_id=p_tenant_id and company_id=p_company_id and product_id=p_product_id;
  if p_quantity > v_balance then raise exception 'A perda supera o saldo disponivel'; end if;
  insert into public.jvg_inventory_movements(tenant_id,company_id,product_id,location_id,quantity_delta,movement_type,reason,created_by)
  values(p_tenant_id,p_company_id,p_product_id,v_location_id,-p_quantity,'loss',left(btrim(p_reason),120),p_actor_user_id);
  return jsonb_build_object('ok',true,'balance',v_balance-p_quantity);
end;
$function$;

create or replace function public.jvg_restaurant_open_inventory_count(
  p_tenant_id uuid,p_company_id uuid,p_label text,p_actor_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare v_session_id uuid; v_count integer;
begin
  if current_user <> 'service_role' then raise exception 'Operacao restrita ao servidor' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_label,''))) not between 2 and 80 then raise exception 'Informe o turno ou motivo da contagem'; end if;
  if exists(select 1 from public.jvg_restaurant_inventory_count_sessions where tenant_id=p_tenant_id and company_id=p_company_id and status='open') then raise exception 'Finalize a contagem aberta antes de iniciar outra'; end if;
  insert into public.jvg_restaurant_inventory_count_sessions(tenant_id,company_id,label,opened_by)
  values(p_tenant_id,p_company_id,btrim(p_label),p_actor_user_id) returning id into v_session_id;
  insert into public.jvg_restaurant_inventory_count_items(tenant_id,company_id,session_id,ingredient_product_id,expected_at_open)
  select p_tenant_id,p_company_id,v_session_id,p.id,coalesce(sum(m.quantity_delta),0)
  from public.jvg_products p
  left join public.jvg_inventory_movements m on m.tenant_id=p_tenant_id and m.company_id=p_company_id and m.product_id=p.id
  where p.tenant_id=p_tenant_id and p.company_id=p_company_id and p.active and p.tracks_stock
  group by p.id;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'Nenhum ingrediente ativo controla estoque nesta empresa'; end if;
  return jsonb_build_object('id',v_session_id,'itemCount',v_count);
end;
$function$;

create or replace function public.jvg_restaurant_close_inventory_count(
  p_tenant_id uuid,p_company_id uuid,p_session_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_session public.jvg_restaurant_inventory_count_sessions%rowtype;
  v_item record; v_location_id uuid; v_expected numeric; v_variance numeric; v_closed integer := 0;
begin
  if current_user <> 'service_role' then raise exception 'Operacao restrita ao servidor' using errcode = '42501'; end if;
  select * into v_session from public.jvg_restaurant_inventory_count_sessions where tenant_id=p_tenant_id and company_id=p_company_id and id=p_session_id for update;
  if not found then raise exception 'Contagem nao encontrada nesta empresa'; end if;
  if v_session.status='closed' then return jsonb_build_object('closed',true,'alreadyClosed',true); end if;
  select id into v_location_id from public.jvg_locations where tenant_id=p_tenant_id and company_id=p_company_id and code='PRINCIPAL' and active;
  if not found then raise exception 'Deposito principal nao localizado'; end if;
  -- Validate every row before writing any adjustment. Returning the product name
  -- lets the UI explain precisely what needs attention without partial updates.
  for v_item in
    select ci.*,p.name as product_name,p.active as product_active,p.tracks_stock as product_tracks_stock
    from public.jvg_restaurant_inventory_count_items ci
    left join public.jvg_products p on p.tenant_id=ci.tenant_id and p.company_id=ci.company_id and p.id=ci.ingredient_product_id
    where ci.tenant_id=p_tenant_id and ci.company_id=p_company_id and ci.session_id=p_session_id
    order by ci.ingredient_product_id for update of ci
  loop
    if v_item.counted_quantity is null then
      return jsonb_build_object('error','Informe a contagem física antes de fechar.','item',coalesce(v_item.product_name,v_item.ingredient_product_id::text));
    end if;
    if v_item.product_active is distinct from true or v_item.product_tracks_stock is distinct from true then
      return jsonb_build_object('error','Ative o controle de estoque deste ingrediente para fechar a contagem.','item',coalesce(v_item.product_name,v_item.ingredient_product_id::text));
    end if;
    if v_item.counted_at is null then
      return jsonb_build_object('error','Salve novamente a contagem física deste ingrediente.','item',coalesce(v_item.product_name,v_item.ingredient_product_id::text));
    end if;
    select coalesce(sum(quantity_delta),0) into v_expected from public.jvg_inventory_movements
    where tenant_id=p_tenant_id and company_id=p_company_id and product_id=v_item.ingredient_product_id
      and created_at<=v_item.counted_at;
    v_variance := v_item.counted_quantity - v_expected;
    if v_variance <> 0 and v_item.classification is null then
      return jsonb_build_object('error','Classifique a diferença física antes de fechar.','item',coalesce(v_item.product_name,v_item.ingredient_product_id::text),'difference',v_variance);
    end if;
    if v_variance <> 0 and v_item.classification='other' and char_length(btrim(v_item.note)) < 3 then
      return jsonb_build_object('error','Explique a causa escolhida como Outra.','item',coalesce(v_item.product_name,v_item.ingredient_product_id::text),'difference',v_variance);
    end if;
  end loop;
  for v_item in select * from public.jvg_restaurant_inventory_count_items where tenant_id=p_tenant_id and company_id=p_company_id and session_id=p_session_id order by ingredient_product_id for update loop
    if v_item.counted_quantity is null then raise exception 'Informe a contagem de cada ingrediente antes de fechar'; end if;
    perform 1 from public.jvg_products where tenant_id=p_tenant_id and company_id=p_company_id and id=v_item.ingredient_product_id and active and tracks_stock for update;
    if not found then raise exception 'Um ingrediente da contagem foi desativado ou perdeu o controle de estoque'; end if;
    if v_item.counted_at is null then raise exception 'Registre novamente a contagem de cada ingrediente antes de fechar'; end if;
    select coalesce(sum(quantity_delta),0) into v_expected from public.jvg_inventory_movements
    where tenant_id=p_tenant_id and company_id=p_company_id and product_id=v_item.ingredient_product_id
      and created_at<=v_item.counted_at;
    v_variance := v_item.counted_quantity - v_expected;
    if v_variance <> 0 and v_item.classification is null then raise exception 'Classifique cada diferenca antes de fechar a contagem'; end if;
    if v_item.classification='other' and char_length(btrim(v_item.note)) < 3 then raise exception 'Explique a causa classificada como outra'; end if;
    if v_variance <> 0 then
      insert into public.jvg_inventory_movements(tenant_id,company_id,product_id,location_id,quantity_delta,movement_type,reason,created_by,restaurant_count_session_id,restaurant_count_item_id)
      values(p_tenant_id,p_company_id,v_item.ingredient_product_id,v_location_id,v_variance,
        case when v_item.classification='loss' and v_variance<0 then 'loss' else 'adjustment' end,
        'Contagem '||v_session.label||': '||v_item.classification||case when v_item.note<>'' then ' - '||left(v_item.note,300) else '' end,
        p_actor_user_id,p_session_id,v_item.id);
    end if;
    update public.jvg_restaurant_inventory_count_items set expected_at_close=v_expected,variance=v_variance,updated_at=now()
    where id=v_item.id and tenant_id=p_tenant_id and company_id=p_company_id;
    v_closed := v_closed + 1;
  end loop;
  update public.jvg_restaurant_inventory_count_sessions set status='closed',closed_by=p_actor_user_id,closed_at=now()
  where id=p_session_id and tenant_id=p_tenant_id and company_id=p_company_id;
  return jsonb_build_object('closed',true,'items',v_closed);
end;
$function$;

create or replace function public.jvg_restaurant_set_order_status(
  p_tenant_id uuid,
  p_company_id uuid,
  p_order_id uuid,
  p_status text
) returns boolean
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_status text; v_total numeric; v_customer_id uuid; v_loyalty_awarded boolean;
  v_points_rate numeric(8,4); v_items jsonb; v_item jsonb; v_ingredient jsonb;
  v_order_number bigint; v_item_index integer; v_product_id uuid; v_quantity numeric;
  v_balance numeric; v_location_id uuid; v_yield numeric; v_conversion numeric;
  v_unit_cost numeric; v_recipe_version_id uuid; v_recipe jsonb;
  v_direct_cost numeric; v_direct_stock boolean; v_ordinal bigint;
begin
  if current_user <> 'service_role' then raise exception 'Operacao restrita ao servidor' using errcode = '42501'; end if;
  if p_status not in ('sent_to_kitchen', 'preparing', 'ready', 'delivered', 'cancelled') then raise exception 'Situacao de pedido invalida'; end if;
  select status,total,customer_id,loyalty_awarded,items,order_number into v_status,v_total,v_customer_id,v_loyalty_awarded,v_items,v_order_number
  from public.jvg_restaurant_orders where id=p_order_id and tenant_id=p_tenant_id and company_id=p_company_id for update;
  if v_status is null then return false; end if;
  if v_status=p_status then return true; end if;
  if not ((v_status='open' and p_status in ('sent_to_kitchen','cancelled')) or (v_status='sent_to_kitchen' and p_status in ('preparing','ready','cancelled')) or (v_status='preparing' and p_status in ('ready','cancelled')) or (v_status='ready' and p_status in ('delivered','cancelled'))) then
    raise exception 'Transicao de situacao do pedido nao permitida';
  end if;
  if p_status='delivered' then
    select id into v_location_id from public.jvg_locations where tenant_id=p_tenant_id and company_id=p_company_id and code='PRINCIPAL' and active;
    if not found then raise exception 'Deposito principal nao localizado'; end if;
    for v_item,v_ordinal in select value,ordinality from jsonb_array_elements(v_items) with ordinality as lines(value,ordinality) loop
      v_item_index := coalesce(nullif(v_item->>'orderItemIndex','')::integer,v_ordinal::integer);
      v_recipe := v_item->'recipeSnapshot';
      if jsonb_typeof(v_recipe)='object' and jsonb_typeof(v_recipe->'ingredients')='array' then
        v_yield := coalesce((v_recipe->>'yieldQuantity')::numeric,0);
        if v_yield <= 0 then raise exception 'Ficha tecnica do pedido possui rendimento invalido'; end if;
        v_recipe_version_id := nullif(v_recipe->>'versionId','')::uuid;
        for v_ingredient in select value from jsonb_array_elements(v_recipe->'ingredients') loop
          v_product_id := (v_ingredient->>'productId')::uuid;
          v_conversion := coalesce((v_ingredient->>'conversionToStockUnit')::numeric,1);
          v_quantity := round(((v_item->>'quantity')::numeric * (v_ingredient->>'quantityPerYield')::numeric * v_conversion / v_yield),4);
          if v_quantity <= 0 then raise exception 'Consumo calculado da ficha tecnica e invalido'; end if;
          perform 1 from public.jvg_products where tenant_id=p_tenant_id and company_id=p_company_id and id=v_product_id and active and tracks_stock for update;
          if not found then raise exception 'Reative o controle de estoque do ingrediente antes de concluir o pedido'; end if;
          select coalesce(sum(quantity_delta),0) into v_balance from public.jvg_inventory_movements where tenant_id=p_tenant_id and company_id=p_company_id and product_id=v_product_id;
          if v_balance < v_quantity then raise exception 'Saldo insuficiente do ingrediente % para concluir pedido #% (necessario %, disponivel %)',coalesce(v_ingredient->>'name',''),v_order_number,v_quantity,v_balance; end if;
          v_unit_cost := nullif(v_ingredient->>'unitCostAtSale','')::numeric;
          insert into public.jvg_inventory_movements(tenant_id,company_id,product_id,location_id,quantity_delta,movement_type,reason,restaurant_order_id,restaurant_order_item_index,restaurant_recipe_version_id,unit_cost_snapshot)
          values(p_tenant_id,p_company_id,v_product_id,v_location_id,-v_quantity,'sale','Consumo restaurante pedido #'||v_order_number,p_order_id,v_item_index,v_recipe_version_id,v_unit_cost);
        end loop;
      else
        -- Packaged products and other directly stocked menu items leave stock
        -- as a sale. A dish with a recipe consumes its ingredients instead.
        v_product_id := nullif(v_item->>'product_id','')::uuid;
        v_quantity := coalesce(nullif(v_item->>'quantity','')::numeric,0);
        select tracks_stock,cost_price into v_direct_stock,v_direct_cost
        from public.jvg_products where tenant_id=p_tenant_id and company_id=p_company_id and id=v_product_id and active for update;
        if not found then raise exception 'Produto do pedido nao esta ativo nesta empresa'; end if;
        if v_direct_stock then
          select coalesce(sum(quantity_delta),0) into v_balance from public.jvg_inventory_movements where tenant_id=p_tenant_id and company_id=p_company_id and product_id=v_product_id;
          if v_balance < v_quantity then raise exception 'Saldo insuficiente de % para concluir pedido #% (necessario %, disponivel %)',coalesce(v_item->>'description','produto'),v_order_number,v_quantity,v_balance; end if;
          insert into public.jvg_inventory_movements(tenant_id,company_id,product_id,location_id,quantity_delta,movement_type,reason,restaurant_order_id,restaurant_order_item_index,unit_cost_snapshot)
          values(p_tenant_id,p_company_id,v_product_id,v_location_id,-v_quantity,'sale','Venda restaurante pedido #'||v_order_number,p_order_id,v_item_index,nullif(v_item->>'unitCostAtSale','')::numeric);
        end if;
      end if;
    end loop;
  end if;
  update public.jvg_restaurant_orders set status=p_status,updated_at=now() where id=p_order_id and tenant_id=p_tenant_id and company_id=p_company_id;
  if p_status='delivered' and v_customer_id is not null and not v_loyalty_awarded then
    select loyalty_points_per_real into v_points_rate from public.jvg_restaurant_settings where tenant_id=p_tenant_id and company_id=p_company_id and loyalty_enabled;
    if v_points_rate is not null then
      update public.jvg_restaurant_customers set loyalty_points=loyalty_points+least(1000000,floor(v_total*v_points_rate)::integer),updated_at=now() where id=v_customer_id and tenant_id=p_tenant_id and company_id=p_company_id;
      update public.jvg_restaurant_orders set loyalty_awarded=true where id=p_order_id and tenant_id=p_tenant_id and company_id=p_company_id;
    end if;
  end if;
  return true;
end;
$function$;

revoke all on function public.jvg_restaurant_save_recipe(uuid,uuid,uuid,numeric,text,numeric,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.jvg_restaurant_apply_inbound_cost(uuid,uuid,uuid,integer,uuid,numeric,uuid) from public,anon,authenticated;
revoke all on function public.jvg_restaurant_record_loss(uuid,uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.jvg_restaurant_open_inventory_count(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.jvg_restaurant_close_inventory_count(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.jvg_restaurant_update_count_item(uuid,uuid,uuid,uuid,numeric,text,text) from public,anon,authenticated;
revoke all on function public.jvg_restaurant_record_prep_run(uuid,uuid,uuid,text,timestamptz,timestamptz,numeric,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.jvg_restaurant_inventory_balances(uuid,uuid) from public,anon,authenticated;
revoke all on function public.jvg_restaurant_set_order_status(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.jvg_restaurant_save_recipe(uuid,uuid,uuid,numeric,text,numeric,text,jsonb,uuid) to service_role;
grant execute on function public.jvg_restaurant_apply_inbound_cost(uuid,uuid,uuid,integer,uuid,numeric,uuid) to service_role;
grant execute on function public.jvg_restaurant_record_loss(uuid,uuid,uuid,numeric,text,uuid) to service_role;
grant execute on function public.jvg_restaurant_open_inventory_count(uuid,uuid,text,uuid) to service_role;
grant execute on function public.jvg_restaurant_close_inventory_count(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.jvg_restaurant_update_count_item(uuid,uuid,uuid,uuid,numeric,text,text) to service_role;
grant execute on function public.jvg_restaurant_record_prep_run(uuid,uuid,uuid,text,timestamptz,timestamptz,numeric,numeric,text,uuid) to service_role;
grant execute on function public.jvg_restaurant_inventory_balances(uuid,uuid) to service_role;
grant execute on function public.jvg_restaurant_set_order_status(uuid,uuid,uuid,text) to service_role;

commit;
