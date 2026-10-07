cd "C:\Users\skhart\Documents\Codex\2026-06-24\cl\work\simple-saas-solutions"

supabase migration up --local

supabase db query --local --file "supabase/snippets/legacy_accounting_import_local.sql"

supabase db query --local --file "supabase/snippets/legacy_cash_disbursement_import.sql"

supabase db query --local --file "supabase/snippets/legacy_profit_loss_lines_import_local.sql"

supabase db query --local --file "supabase/snippets/legacy_profit_loss_import_local.sql"