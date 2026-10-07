insert into public.legacy_profit_loss_monthly (
  period_start,
  service_revenue,
  direct_materials,
  gross_revenue,
  operating_expenses,
  net_profit,
  source_workbook,
  source_sheet,
  import_batch
)
values
  ('2026-01-01', 1815458.77, 974520.81, 840937.96, 1369585.58, -528647.62, 'ACI PROFIT AND LOSS 2026.xlsx', 'Sheet1', 'ACI-2026-legacy-v1'),
  ('2026-02-01', 2301048.71, 478184.27, 1822864.44, 1595486.79, 227377.65, 'ACI PROFIT AND LOSS 2026.xlsx', 'Sheet1', 'ACI-2026-legacy-v1'),
  ('2026-03-01', 1767645.82, 569286.23, 1198359.59, 1178546.33, 19813.26, 'ACI PROFIT AND LOSS 2026.xlsx', 'Sheet1', 'ACI-2026-legacy-v1')
on conflict (period_start, source_workbook, source_sheet, import_batch) do nothing;
