import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.LOCAL_SUPABASE_URL;
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set local Supabase URL and service key before running this test.");

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = `MONEY-OUT-RLS-${Date.now()}`;
const created = { expenseId: null, batchIds: [] };

async function clientFor(email) {
  const client = createClient(url, process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw error;
  return client;
}

try {
  const accounting = await clientFor("accounting@local.test");
  const staff = await clientFor("staff@local.test");
  const { data: job, error: jobError } = await admin
    .from("job_orders")
    .select("id")
    .limit(1)
    .single();
  if (jobError) throw jobError;

  const accountingBatch = await accounting
    .from("petty_cash_batches")
    .insert({
      custodian_name: `${tag} Accounting`,
      cash_received: 100,
      funding_date: new Date().toISOString().slice(0, 10),
      funding_source: "Cash",
      funding_reference: tag,
    })
    .select("id")
    .single();
  assert.equal(accountingBatch.error, null, "accounting should open a petty-cash batch");
  created.batchIds.push(accountingBatch.data.id);

  const staffBatch = await staff.from("petty_cash_batches").insert({
    custodian_name: `${tag} Staff`,
    cash_received: 100,
    funding_date: new Date().toISOString().slice(0, 10),
    funding_source: "Cash",
    funding_reference: tag,
  });
  assert.notEqual(staffBatch.error, null, "staff must not open a petty-cash batch");

  const accountingExpense = await accounting
    .from("job_expenses")
    .insert({
      expense_date: new Date().toISOString().slice(0, 10),
      expense_type: "miscellaneous",
      disbursement_category: "other",
      supplier_name: "RLS Money Out Supplier",
      description: tag,
      amount: 5,
      payment_status: "pending",
      payment_state: "pending",
      payment_method: "check",
    })
    .select("id")
    .single();
  assert.equal(accountingExpense.error, null, "accounting should create a general expense");
  created.expenseId = accountingExpense.data.id;

  const accountingAllocation = await accounting.rpc("replace_job_expense_allocations", {
    p_expense_id: created.expenseId,
    p_allocations: [{ job_order_id: job.id, allocated_amount: 1 }],
  });
  assert.equal(accountingAllocation.error, null, "accounting should confirm a project allocation");

  const staffAllocation = await staff.rpc("replace_job_expense_allocations", {
    p_expense_id: created.expenseId,
    p_allocations: [],
  });
  assert.notEqual(staffAllocation.error, null, "staff must not change a project allocation");

  console.log("money-out RLS checks passed");
} finally {
  if (created.expenseId) {
    await admin.from("job_expense_allocations").delete().eq("job_expense_id", created.expenseId);
    await admin.from("job_expenses").delete().eq("id", created.expenseId);
  }
  if (created.batchIds.length) {
    await admin.from("petty_cash_batches").delete().in("id", created.batchIds);
  }
}
