import { createClient } from '@supabase/supabase-js';

const url = process.env.LOCAL_SUPABASE_URL ?? 'http://127.0.0.1:57421';
const key = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error('Local Supabase secret key was not found. Start Supabase and retry.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = `STRESS-${Date.now()}`;
const created = { authUser: null, profiles: [], customers: [], quotes: [], jobs: [], expenses: [], batches: [] };

const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function cleanup() {
  const operations = [
    created.expenses.length && db.from('job_expense_allocations').delete().in('job_expense_id', created.expenses),
    created.expenses.length && db.from('job_expenses').delete().in('id', created.expenses),
    created.batches.length && db.from('petty_cash_batches').delete().in('id', created.batches),
    created.jobs.length && db.from('job_orders').delete().in('id', created.jobs),
    created.quotes.length && db.from('quotations').delete().in('id', created.quotes),
    created.customers.length && db.from('customers').delete().in('id', created.customers),
    created.profiles.length && db.from('profiles').delete().in('id', created.profiles),
  ].filter(Boolean);
  for (const operation of operations) {
    const result = await operation;
    if (result.error) throw result.error;
  }
  if (created.authUser) {
    const result = await db.auth.admin.deleteUser(created.authUser);
    if (result.error) throw result.error;
  }
}

try {
  const createdUser = await db.auth.admin.createUser({ email: `${tag.toLowerCase()}@local.test`, password: 'LocalStress-Only-123!', email_confirm: true });
  if (createdUser.error) throw createdUser.error;
  const testUser = createdUser.data.user;
  created.authUser = testUser.id;
  const { error: profileError } = await db.from('profiles').upsert({ id: testUser.id, display_name: `${tag} Owner`, email: testUser.email, status: 'active', signature_url: `https://local.invalid/${tag}` });
  if (profileError) throw profileError;
  created.profiles.push(testUser.id);
  const { data: customers, error: customerError } = await db.from('customers').insert({ customer_name: `${tag} Customer`, contact_person: `${tag} Contact`, contact_number: '000' }).select('id').single();
  if (customerError) throw customerError;
  created.customers.push(customers.id);
  const { data: quote, error: quoteError } = await db.from('quotations').insert({ customer_id: customers.id, project_name: `${tag} Quote`, subtotal: 100, total_amount: 100, status: 'approved', sales_agent: `${tag} Owner`, sales_agent_user_id: testUser.id }).select('id').single();
  if (quoteError) throw quoteError;
  created.quotes.push(quote.id);
  const { data: job, error: jobError } = await db.from('job_orders').insert({ customer_id: customers.id, quotation_id: quote.id, project_name: `${tag} Job`, job_number: `${tag}-JO`, quoted_amount: 100, status: 'pending', prepared_by_user_id: testUser.id, approved_by_user_id: testUser.id, approved_by_name: `${tag} Owner`, prepared_by_name_snapshot: `${tag} Owner`, prepared_by_signature_url_snapshot: `https://local.invalid/${tag}`, approved_by_signature_url_snapshot: `https://local.invalid/${tag}` }).select('id').single();
  if (jobError) throw jobError;
  created.jobs.push(job.id);
  const { data: batch, error: batchError } = await db.from('petty_cash_batches').insert({ custodian_name: `${tag} Custodian`, cash_received: 10000, funding_date: '2026-08-28', funding_source: 'BDO', funding_reference: tag, status: 'open' }).select('id').single();
  if (batchError) throw batchError;
  created.batches.push(batch.id);
  const { data: expense, error: expenseError } = await db.from('job_expenses').insert({ job_order_id: job.id, petty_cash_batch_id: batch.id, expense_date: '2026-08-28', expense_type: 'miscellaneous', disbursement_category: 'petty_cash', supplier_name: `${tag} Supplier`, description: `${tag} Receipt`, amount: 100, payment_status: 'paid', payment_state: 'cleared', payment_method: 'petty_cash', payment_source: 'BDO', receipt_missing_reason: 'Local regression fixture has no uploaded file.' }).select('id').single();
  if (expenseError) throw expenseError;
  created.expenses.push(expense.id);
  const { error: allocationError } = await db.from('job_expense_allocations').insert({ job_expense_id: expense.id, job_order_id: job.id, allocated_amount: 100 });
  if (allocationError) throw allocationError;
  const { error: rejected } = await db.from('job_expense_allocations').update({ allocated_amount: 101 }).eq('job_expense_id', expense.id);
  assert(rejected, 'Over-allocation should be rejected.');
  const { data: rows, error: readError } = await db.from('job_expenses').select('amount, petty_cash_batch_id').eq('id', expense.id).single();
  if (readError) throw readError;
  assert(Number(rows.amount) === 100 && rows.petty_cash_batch_id === batch.id, 'Source expense changed unexpectedly.');
  const { data: batchReceipts, error: batchReadError } = await db.from('job_expenses').select('amount').eq('petty_cash_batch_id', batch.id);
  if (batchReadError) throw batchReadError;
  assert(batchReceipts.reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0) === 100, 'Petty-cash running balance source total is incorrect.');
  console.log('Local workflow stress checks passed');
} finally {
  await cleanup();
}
