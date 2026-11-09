alter table public.jvg_parties
  add column if not exists registration_number bigint;

create table if not exists public.jvg_party_counters (
  company_id uuid primary key references public.jvg_companies(id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0)
);

with numbered as (
  select id, row_number() over (partition by company_id order by created_at, id) as number
  from public.jvg_parties
  where registration_number is null
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

drop trigger if exists jvg_parties_assign_registration_number on public.jvg_parties;
create trigger jvg_parties_assign_registration_number
before insert on public.jvg_parties
for each row execute function public.jvg_assign_party_registration_number();

create unique index if not exists jvg_parties_company_registration_number_uidx
  on public.jvg_parties (company_id, registration_number);
