create table if not exists public.legacy_profit_loss_monthly (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  service_revenue numeric(14,2) not null default 0 check (service_revenue >= 0),
  direct_materials numeric(14,2) not null default 0 check (direct_materials >= 0),
  gross_revenue numeric(14,2) not null,
  operating_expenses numeric(14,2) not null default 0 check (operating_expenses >= 0),
  net_profit numeric(14,2) not null,
  source_workbook text not null,
  source_sheet text not null,
  import_batch text not null,
  created_at timestamptz not null default now(),
  unique (period_start, source_workbook, source_sheet, import_batch)
);

create index if not exists legacy_profit_loss_monthly_period_idx
  on public.legacy_profit_loss_monthly (period_start desc);

alter table public.legacy_profit_loss_monthly enable row level security;

drop policy if exists "legacy pnl sensitive read" on public.legacy_profit_loss_monthly;
create policy "legacy pnl sensitive read"
  on public.legacy_profit_loss_monthly
  for select to authenticated
  using (app_private.can_view_sensitive_operations(auth.uid()));

grant select on public.legacy_profit_loss_monthly to authenticated;
grant all on public.legacy_profit_loss_monthly to service_role;

comment on table public.legacy_profit_loss_monthly is
  'Read-only reporting source for imported historical P&L summaries; never treated as live workflow data.';
