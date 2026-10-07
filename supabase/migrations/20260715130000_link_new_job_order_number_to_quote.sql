-- New Job Orders inherit the source quotation's year and numeric suffix.
-- Existing Job Orders are not modified.

create or replace function public.assign_linked_job_order_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  source_quote_number text;
  preferred_number text;
begin
  select q.quote_number
    into source_quote_number
  from public.quotations q
  where q.id = new.quotation_id;

  if source_quote_number ~ '^QUO-[0-9]{4}-[0-9]{4}$' then
    preferred_number := regexp_replace(source_quote_number, '^QUO-', 'JO-');

    if not exists (
      select 1
      from public.job_orders j
      where j.job_number = preferred_number
    ) then
      new.job_number := preferred_number;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_assign_linked_job_order_number on public.job_orders;

create trigger trg_assign_linked_job_order_number
before insert on public.job_orders
for each row
execute function public.assign_linked_job_order_number();
