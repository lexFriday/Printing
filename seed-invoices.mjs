import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: jobs, error: jobsError } = await supabase.from('job_orders').select('id,job_number,customer_id,quotation_id,quoted_amount,tax_type,status,customer_contact_id,contact_name_snapshot,contact_department_snapshot,contact_phone_snapshot,contact_email_snapshot').order('created_at');
if (jobsError) throw jobsError;
const { data: existing, error: existingError } = await supabase.from('invoices').select('job_order_id,invoice_number');
if (existingError) throw existingError;
const { data: lineItems, error: lineItemsError } = await supabase.from('job_order_line_items').select('job_order_id');
if (lineItemsError) throw lineItemsError;
const lineItemJobs = new Set((lineItems ?? []).map((row) => row.job_order_id));
for (const job of jobs ?? []) {
  if (job.status !== 'completed' || lineItemJobs.has(job.id)) continue;
  const total = Number(job.quoted_amount ?? 0);
  const { error } = await supabase.from('job_order_line_items').insert({ job_order_id: job.id, description: 'Completed project services', pricing_mode: 'fixed', quantity: 1, unit_price: total, line_total: total, sort_order: 0 });
  if (error) throw new Error(`${job.job_number}: ${error.message}`);
}
const existingJobs = new Set((existing ?? []).map((row) => row.job_order_id));
let sequence = (existing ?? []).reduce((max, row) => Math.max(max, Number(String(row.invoice_number).match(/(\d+)$/)?.[1] ?? 0)), 0);
let added = 0;
for (const job of jobs ?? []) {
  if (job.status !== 'completed') continue;
  if (existingJobs.has(job.id)) continue;
  sequence += 1;
  const gross = Number(job.quoted_amount ?? 0);
  const taxType = job.tax_type ?? 'non_vat';
  const vat = taxType === 'vatable' ? gross * 12 / 112 : 0;
  const vatable = taxType === 'vatable' ? gross - vat : gross;
  const status = sequence % 4 === 0 ? 'paid' : sequence % 3 === 0 ? 'issued' : 'draft';
  const invoiceDate = new Date(Date.now() - sequence * 86400000).toISOString().slice(0, 10);
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const row = {
    invoice_number: `INV-2026-${String(sequence).padStart(4, '0')}`,
    job_order_id: job.id,
    customer_id: job.customer_id,
    quotation_id: job.quotation_id,
    customer_contact_id: job.customer_contact_id,
    contact_name_snapshot: job.contact_name_snapshot,
    contact_department_snapshot: job.contact_department_snapshot,
    contact_phone_snapshot: job.contact_phone_snapshot,
    contact_email_snapshot: job.contact_email_snapshot,
    invoice_date: invoiceDate,
    due_date: dueDate,
    invoice_amount: gross,
    status,
    paid_at: status === 'paid' ? new Date().toISOString() : null,
    payment_date: status === 'paid' ? invoiceDate : null,
    payment_remarks: status === 'paid' ? 'Demo payment received via bank transfer.' : null,
    tax_type: taxType,
    ewt_enabled: false,
    ewt_rate: 0,
    vatable_sales_snapshot: vatable,
    vat_rate_snapshot: taxType === 'vatable' ? 12 : 0,
    vat_amount_snapshot: vat,
    ewt_amount_snapshot: 0,
    gross_total_snapshot: gross,
    ewt_treatment_snapshot: 'none',
    amount_due_snapshot: gross,
    official_receipt_number: status === 'paid' ? `OR-2026-${String(sequence).padStart(4, '0')}` : null,
  };
  const { error } = await supabase.from('invoices').insert(row);
  if (error) throw new Error(`${job.job_number}: ${error.message}`);
  added += 1;
}
console.log(`Added ${added} demo invoices.`);
