do $$
begin
  if exists (
    select 1
    from public.customers
    where nullif(regexp_replace(tin_number, '\D', '', 'g'), '') is not null
    group by regexp_replace(tin_number, '\D', '', 'g')
    having count(*) > 1
  ) then
    raise exception 'Duplicate customer TIN values exist. Update duplicates before applying unique TIN restriction.';
  end if;
end $$;

create unique index if not exists customers_tin_number_normalized_key
on public.customers ((regexp_replace(tin_number, '\D', '', 'g')))
where nullif(regexp_replace(tin_number, '\D', '', 'g'), '') is not null;
