alter table public.jvg_parties
  add column if not exists registration_number bigint;

create table if not exists public.jvg_party_counters (
  company_id uuid primary key references public.jvg_companies(id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0)
);

with existing as (
  select company_id, coalesce(max(registration_number), 0) as last_number
  from public.jvg_parties
  group by company_id
), numbered as (
  select p.id,
    coalesce(e.last_number, 0) + row_number() over (partition by p.company_id order by p.created_at, p.id) as number
  from public.jvg_parties p
  left join existing e on e.company_id = p.company_id
  where p.registration_number is null
)
update public.jvg_parties p
set registration_number = n.number
from numbered n
where p.id = n.id;

insert into public.jvg_party_counters (company_id, last_number)
select company_id, max(registration_number)
from public.jvg_parties
group by company_id
on conflict (company_id) do update
set last_number = greatest(public.jvg_party_counters.last_number, excluded.last_number);

alter table public.jvg_party_counters enable row level security;
revoke all on table public.jvg_party_counters from anon, authenticated;

create or replace function public.jvg_assign_party_registration_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.registration_number is null then
    insert into public.jvg_party_counters (company_id, last_number)
    values (new.company_id, 1)
    on conflict (company_id) do update
      set last_number = public.jvg_party_counters.last_number + 1
    returning last_number into new.registration_number;
  end if;
  return new;
end;
$$;

revoke all on function public.jvg_assign_party_registration_number() from public, anon, authenticated;

drop trigger if exists jvg_parties_assign_registration_number on public.jvg_parties;
create trigger jvg_parties_assign_registration_number
before insert on public.jvg_parties
for each row execute function public.jvg_assign_party_registration_number();

create unique index if not exists jvg_parties_company_registration_number_uidx
  on public.jvg_parties (company_id, registration_number);
