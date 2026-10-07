create table if not exists public.legacy_profit_loss_lines (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  category text not null,
  detail text,
  amount numeric(14,2) not null default 0,
  source_workbook text not null,
  source_sheet text not null,
  source_row integer not null check (source_row > 0),
  import_batch text not null,
  created_at timestamptz not null default now(),
  unique (source_workbook, source_sheet, source_row, period_start, import_batch)
);

create index if not exists legacy_profit_loss_lines_period_idx
  on public.legacy_profit_loss_lines (period_start desc, category);

alter table public.legacy_profit_loss_lines enable row level security;

drop policy if exists "legacy pnl lines sensitive read" on public.legacy_profit_loss_lines;
create policy "legacy pnl lines sensitive read"
  on public.legacy_profit_loss_lines
  for select to authenticated
  using (app_private.can_view_sensitive_operations(auth.uid()));

grant select on public.legacy_profit_loss_lines to authenticated;
grant all on public.legacy_profit_loss_lines to service_role;

comment on table public.legacy_profit_loss_lines is
  'Read-only detailed imported P&L rows; never treated as live workflow data.';
