import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
const anonKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const users = [
  ["owner@local.test", "Local Owner", "owner"],
  ["admin@local.test", "Local Admin", "admin"],
  ["sales@local.test", "Local Sales", "sales"],
  ["accounting@local.test", "Local Accounting", "accounting"],
  ["staff@local.test", "Local Staff", "staff"],
  ["viewer@local.test", "Local Viewer", "viewer"],
];

async function ensureUsers() {
  const listed = await admin.auth.admin.listUsers();
  if (listed.error) throw listed.error;
  for (const [email, displayName, role] of users) {
    let user = listed.data.users.find((u) => u.email === email);
    if (!user) {
      const created = await admin.auth.admin.createUser({
        email,
        password: "password123",
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (created.error) throw created.error;
      user = created.data.user;
    } else {
      const updated = await admin.auth.admin.updateUserById(user.id, {
        password: "password123",
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (updated.error) throw updated.error;
    }
    const profile = await admin
      .from("profiles")
      .upsert({ id: user.id, email, display_name: displayName, status: "active", signature_url: `https://local.invalid/rls-${role}` });
    if (profile.error) throw profile.error;
    const deleted = await admin.from("user_roles").delete().eq("user_id", user.id);
    if (deleted.error) throw deleted.error;
    const inserted = await admin.from("user_roles").insert({ user_id: user.id, role });
    if (inserted.error) throw inserted.error;
  }
}

async function clientFor(email) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = await client.auth.signInWithPassword({ email, password: "password123" });
  if (auth.error) throw auth.error;
  return client;
}

async function seedRecords() {
  const suffix = Date.now();
  const salesRole = await admin.from("user_roles").select("user_id").eq("role", "sales").single();
  if (salesRole.error) throw salesRole.error;
  const salesAgentUserId = salesRole.data.user_id;
  const adminRole = await admin.from("user_roles").select("user_id").eq("role", "admin").single();
  if (adminRole.error) throw adminRole.error;
  const approverUserId = adminRole.data.user_id;
  const customer = await admin
    .from("customers")
    .insert({
      customer_name: `RLS Customer ${suffix}`,
      contact_person: "QA",
      contact_number: "000",
    })
    .select("id")
    .single();
  if (customer.error) throw customer.error;

  const quote = await admin
    .from("quotations")
    .insert({
      customer_id: customer.data.id,
      project_name: `RLS Project ${suffix}`,
      quote_date: new Date().toISOString().slice(0, 10),
      status: "approved",
      subtotal: 100,
      total_amount: 100,
      tax_type: "non_vat",
      sales_agent_user_id: salesAgentUserId,
    })
    .select("id")
    .single();
  if (quote.error) throw quote.error;

  const job = await admin
    .from("job_orders")
    .insert({
      quotation_id: quote.data.id,
      customer_id: customer.data.id,
      project_name: `RLS Project ${suffix}`,
      quoted_amount: 100,
      status: "pending",
      tax_type: "non_vat",
      prepared_by_user_id: salesAgentUserId,
      approved_by_user_id: approverUserId,
    })
    .select("id")
    .single();
  if (job.error) throw job.error;

  const paymentQuote = await admin
    .from("quotations")
    .insert({
      customer_id: customer.data.id,
      project_name: `RLS Payment Proof ${suffix}`,
      quote_date: new Date().toISOString().slice(0, 10),
      status: "approved",
      subtotal: 100,
      total_amount: 100,
      tax_type: "non_vat",
      sales_agent_user_id: salesAgentUserId,
    })
    .select("id")
    .single();
  if (paymentQuote.error) throw paymentQuote.error;

  const paymentJob = await admin
    .from("job_orders")
    .insert({
      quotation_id: paymentQuote.data.id,
      customer_id: customer.data.id,
      project_name: `RLS Payment Proof ${suffix}`,
      quoted_amount: 100,
      status: "pending",
      tax_type: "non_vat",
      prepared_by_user_id: salesAgentUserId,
      approved_by_user_id: approverUserId,
    })
    .select("id")
    .single();
  if (paymentJob.error) throw paymentJob.error;

  const paymentLine = await admin.from("job_order_line_items").insert({
    job_order_id: paymentJob.data.id,
    description: "RLS payment proof item",
    pricing_mode: "fixed",
    quantity: 1,
    unit_price: 100,
    line_total: 100,
    sort_order: 0,
  });
  if (paymentLine.error) throw paymentLine.error;

  for (const status of ["in_production", "ready", "delivered", "completed"]) {
    const completedPaymentJob = await admin
      .from("job_orders")
      .update({ status })
      .eq("id", paymentJob.data.id);
    if (completedPaymentJob.error) throw completedPaymentJob.error;
  }

  const paymentInvoice = await admin
    .from("invoices")
    .insert({
      job_order_id: paymentJob.data.id,
      customer_id: customer.data.id,
      invoice_amount: 100,
      invoice_date: new Date().toISOString().slice(0, 10),
      status: "issued",
    })
    .select("id")
    .single();
  if (paymentInvoice.error) throw paymentInvoice.error;

  const audit = await admin
    .from("audit_logs")
    .insert({
      action: "rls.test",
      entity_type: "customers",
      entity_id: customer.data.id,
      new_values: { marker: `rls-${suffix}` },
    })
    .select("id")
    .single();
  if (audit.error) throw audit.error;

  const adminQuote = await admin
    .from("quotations")
    .insert({
      customer_id: customer.data.id,
      project_name: `RLS Admin Job ${suffix}`,
      quote_date: new Date().toISOString().slice(0, 10),
      status: "approved",
      subtotal: 125,
      total_amount: 125,
      tax_type: "non_vat",
      sales_agent_user_id: salesAgentUserId,
    })
    .select("id")
    .single();
  if (adminQuote.error) throw adminQuote.error;

  const salesQuote = await admin
    .from("quotations")
    .insert({
      customer_id: customer.data.id,
      project_name: `RLS Sales Job ${suffix}`,
      quote_date: new Date().toISOString().slice(0, 10),
      status: "approved",
      subtotal: 150,
      total_amount: 150,
      tax_type: "non_vat",
      sales_agent_user_id: salesAgentUserId,
    })
    .select("id")
    .single();
  if (salesQuote.error) throw salesQuote.error;

  const workflowQuote = await admin
    .from("quotations")
    .insert({
      customer_id: customer.data.id,
      project_name: `RLS Quote Approval ${suffix}`,
      quote_date: new Date().toISOString().slice(0, 10),
      status: "draft",
      subtotal: 175,
      total_amount: 175,
      tax_type: "non_vat",
      sales_agent_user_id: salesAgentUserId,
    })
    .select("id")
    .single();
  if (workflowQuote.error) throw workflowQuote.error;

  const workflowQuoteLine = await admin.from("quote_line_items").insert({
    quotation_id: workflowQuote.data.id,
    description: `RLS Quote Line ${suffix}`,
    pricing_mode: "fixed",
    quantity: 1,
    unit_price: 175,
    line_total: 175,
    sort_order: 0,
  });
  if (workflowQuoteLine.error) throw workflowQuoteLine.error;

  const activeContact = await admin
    .from("customer_contacts")
    .insert({
      customer_id: customer.data.id,
      contact_name: `Active Contact ${suffix}`,
      phone: "09170000001",
      is_active: true,
    })
    .select("id")
    .single();
  if (activeContact.error) throw activeContact.error;

  const inactiveContact = await admin
    .from("customer_contacts")
    .insert({
      customer_id: customer.data.id,
      contact_name: `Inactive Contact ${suffix}`,
      phone: "09170000002",
      is_active: false,
    })
    .select("id")
    .single();
  if (inactiveContact.error) throw inactiveContact.error;

  const otherCustomer = await admin
    .from("customers")
    .insert({
      customer_name: `RLS Other Customer ${suffix}`,
      contact_person: "Other QA",
      contact_number: "001",
    })
    .select("id")
    .single();
  if (otherCustomer.error) throw otherCustomer.error;

  const foreignContact = await admin
    .from("customer_contacts")
    .insert({
      customer_id: otherCustomer.data.id,
      contact_name: `Foreign Contact ${suffix}`,
      phone: "09170000003",
      is_active: true,
    })
    .select("id")
    .single();
  if (foreignContact.error) throw foreignContact.error;

  return {
    customerId: customer.data.id,
    jobId: job.data.id,
    auditId: audit.data.id,
    adminQuoteId: adminQuote.data.id,
    adminQuoteProject: `RLS Admin Job ${suffix}`,
    salesQuoteId: salesQuote.data.id,
    salesQuoteProject: `RLS Sales Job ${suffix}`,
    workflowQuoteId: workflowQuote.data.id,
    activeContactId: activeContact.data.id,
    inactiveContactId: inactiveContact.data.id,
    foreignContactId: foreignContact.data.id,
    paymentInvoiceId: paymentInvoice.data.id,
  };
}

await ensureUsers();
const {
  customerId,
  jobId,
  auditId,
  adminQuoteId,
  adminQuoteProject,
  salesQuoteId,
  salesQuoteProject,
  workflowQuoteId,
  activeContactId,
  inactiveContactId,
  foreignContactId,
  paymentInvoiceId,
} = await seedRecords();
const viewer = await clientFor("viewer@local.test");
const adminStaff = await clientFor("admin@local.test");
const sales = await clientFor("sales@local.test");
const accounting = await clientFor("accounting@local.test");
const staff = await clientFor("staff@local.test");
const owner = await clientFor("owner@local.test");

async function uploadProof(client, path) {
  return client.storage.from("invoice-payment-proofs").upload(path, new Uint8Array([1, 2, 3]), {
    contentType: "image/png",
    upsert: false,
  });
}

const proofPaths = [
  `rls-tests/${paymentInvoiceId}/accounting-proof.png`,
  `rls-tests/${paymentInvoiceId}/admin-proof.png`,
  `rls-tests/${paymentInvoiceId}/owner-proof.png`,
];
const accountingProof = await uploadProof(accounting, proofPaths[0]);
assert.equal(accountingProof.error, null, "accounting should upload payment proof");
const accountingPayment = await accounting
  .from("invoice_payments")
  .insert({
    invoice_id: paymentInvoiceId,
    payment_date: new Date().toISOString().slice(0, 10),
    amount: 40,
    remarks: "Accounting proof test",
    proof_storage_path: proofPaths[0],
    proof_file_name: "accounting-proof.png",
    proof_file_type: "image/png",
    proof_file_size: 3,
  })
  .select("id")
  .single();
assert.equal(accountingPayment.error, null, "accounting should record payment with proof");

const adminProof = await uploadProof(adminStaff, proofPaths[1]);
assert.equal(adminProof.error, null, "admin should upload payment proof");
const adminPayment = await adminStaff
  .from("invoice_payments")
  .insert({
    invoice_id: paymentInvoiceId,
    payment_date: new Date().toISOString().slice(0, 10),
    amount: 30,
    remarks: "Admin proof test",
    proof_storage_path: proofPaths[1],
    proof_file_name: "admin-proof.png",
    proof_file_type: "image/png",
    proof_file_size: 3,
  })
  .select("id")
  .single();
assert.equal(adminPayment.error, null, "admin should record payment with proof");

const ownerProof = await uploadProof(owner, proofPaths[2]);
assert.equal(ownerProof.error, null, "owner should upload payment proof");
const ownerPayment = await owner
  .from("invoice_payments")
  .insert({
    invoice_id: paymentInvoiceId,
    payment_date: new Date().toISOString().slice(0, 10),
    amount: 30,
    remarks: "Owner proof test",
    proof_storage_path: proofPaths[2],
    proof_file_name: "owner-proof.png",
    proof_file_type: "image/png",
    proof_file_size: 3,
  })
  .select("id")
  .single();
assert.equal(ownerPayment.error, null, "owner should record payment with proof");

const overpayment = await accounting.from("invoice_payments").insert({
  invoice_id: paymentInvoiceId,
  payment_date: new Date().toISOString().slice(0, 10),
  amount: 1,
  remarks: "Overpayment must be blocked",
});
assert.notEqual(overpayment.error, null, "overpayment must be rejected server-side");

const paidInvoice = await admin
  .from("invoices")
  .select("status, amount_due_snapshot, invoice_amount")
  .eq("id", paymentInvoiceId)
  .single();
assert.equal(paidInvoice.error, null, "paid invoice should remain readable");
assert.equal(paidInvoice.data.status, "paid", "invoice status should update automatically");

const salesProof = await uploadProof(sales, `rls-tests/${paymentInvoiceId}/sales-proof.png`);
assert.notEqual(salesProof.error, null, "sales must not upload payment proof");
const viewerProof = await uploadProof(viewer, `rls-tests/${paymentInvoiceId}/viewer-proof.png`);
assert.notEqual(viewerProof.error, null, "viewer must not upload payment proof");
const staffProof = await uploadProof(staff, `rls-tests/${paymentInvoiceId}/staff-proof.png`);
assert.notEqual(staffProof.error, null, "staff must not upload payment proof");

const salesPayment = await sales.from("invoice_payments").insert({
  invoice_id: paymentInvoiceId,
  payment_date: new Date().toISOString().slice(0, 10),
  amount: 1,
  remarks: "Sales must be blocked",
});
assert.notEqual(salesPayment.error, null, "sales must not record payments");
const viewerPayment = await viewer.from("invoice_payments").insert({
  invoice_id: paymentInvoiceId,
  payment_date: new Date().toISOString().slice(0, 10),
  amount: 1,
  remarks: "Viewer must be blocked",
});
assert.notEqual(viewerPayment.error, null, "viewer must not record payments");
const staffPayment = await staff.from("invoice_payments").insert({
  invoice_id: paymentInvoiceId,
  payment_date: new Date().toISOString().slice(0, 10),
  amount: 1,
  remarks: "Staff must be blocked",
});
assert.notEqual(staffPayment.error, null, "staff must not record payments");

const replacement = await accounting
  .from("invoice_payments")
  .update({
    proof_storage_path: proofPaths[0],
    proof_file_name: "accounting-proof-replaced.png",
  })
  .eq("id", accountingPayment.data.id)
  .select("id");
assert.equal(replacement.error, null, "accounting should replace payment proof metadata");

const salesDelete = await sales.storage.from("invoice-payment-proofs").remove([proofPaths[0]]);
assert.equal(
  salesDelete.error,
  null,
  "storage should not expose policy errors to unauthorized callers",
);
assert.equal(salesDelete.data?.length ?? 0, 0, "sales must not delete payment proof");

const atomicCustomerName = `Atomic Customer ${Date.now()}`;
const atomicCustomer = await sales.rpc("create_customer_with_contacts", {
  customer_data: {
    customer_name: atomicCustomerName,
    contact_person: "Primary Atomic Contact",
    contact_number: "09170000010",
    email: "primary.atomic@example.test",
  },
  contacts: [
    {
      contact_name: "Additional Atomic Contact",
      phone: "09170000011",
    },
  ],
});
assert.equal(atomicCustomer.error, null, "sales should create a customer and contacts atomically");
assert.ok(
  atomicCustomer.data?.customer?.id,
  "atomic customer creation should return the customer id",
);
const atomicContacts = await sales
  .from("customer_contacts")
  .select("id")
  .eq("customer_id", atomicCustomer.data.customer.id);
assert.equal(atomicContacts.error, null);
assert.equal(
  atomicContacts.data.length,
  2,
  "main and additional contacts should be created together",
);

const viewerCreateResult = await viewer.rpc("create_customer_with_contacts", {
  customer_data: {
    customer_name: `Viewer Customer ${Date.now()}`,
    contact_person: "Viewer Contact",
    contact_number: "09170000014",
  },
});
assert.notEqual(viewerCreateResult.error, null, "viewer must not create customers through the RPC");

const failedAtomicName = `Failed Atomic Customer ${Date.now()}`;
const failedAtomicCustomer = await sales.rpc("create_customer_with_contacts", {
  customer_data: {
    customer_name: failedAtomicName,
    contact_person: "Primary Atomic Contact",
    contact_number: "09170000012",
  },
  contacts: [{ contact_name: "", phone: "09170000013" }],
});
assert.notEqual(failedAtomicCustomer.error, null, "invalid contacts must fail customer creation");

const failedCustomerCheck = await sales
  .from("customers")
  .select("id")
  .eq("customer_name", failedAtomicName);
assert.equal(failedCustomerCheck.error, null);
assert.equal(
  failedCustomerCheck.data.length,
  0,
  "failed creation must not leave a customer behind",
);

const inactiveContactUpdate = await sales
  .from("quotations")
  .update({ customer_contact_id: inactiveContactId })
  .eq("id", workflowQuoteId)
  .eq("status", "draft")
  .select("id");
assert.notEqual(inactiveContactUpdate.error, null, "inactive contacts must not be selectable");

const foreignContactUpdate = await sales
  .from("quotations")
  .update({ customer_contact_id: foreignContactId })
  .eq("id", workflowQuoteId)
  .eq("status", "draft")
  .select("id");
assert.notEqual(foreignContactUpdate.error, null, "cross-customer contacts must not be selectable");

const activeContactUpdate = await sales
  .from("quotations")
  .update({ customer_contact_id: activeContactId })
  .eq("id", workflowQuoteId)
  .eq("status", "draft")
  .select("id, contact_name_snapshot");
assert.equal(activeContactUpdate.error, null, "active customer contacts should be selectable");
assert.equal(activeContactUpdate.data[0].contact_name_snapshot.startsWith("Active Contact"), true);

const viewerCustomer = await viewer.from("customers").select("id").eq("id", customerId);
assert.equal(viewerCustomer.error, null);
assert.equal(viewerCustomer.data.length, 0, "viewer must not read sensitive customers");

const viewerJob = await viewer.from("job_orders").select("id").eq("id", jobId);
assert.equal(viewerJob.error, null);
assert.equal(viewerJob.data.length, 0, "viewer must not read sensitive job orders directly");

const viewerSummary = await viewer
  .from("viewer_job_status_summary")
  .select("status, job_count")
  .eq("status", "pending");
assert.equal(viewerSummary.error, null);
assert.equal(viewerSummary.data.length, 1, "viewer should read safe job status summary");
assert.ok(Number(viewerSummary.data[0].job_count) >= 1, "viewer summary should include jobs");

const salesCustomer = await sales.from("customers").select("id").eq("id", customerId);
assert.equal(salesCustomer.error, null);
assert.equal(salesCustomer.data.length, 1, "sales should read customer workflow records");

const salesJobUpdate = await sales
  .from("job_orders")
  .update({ status: "in_production" })
  .eq("id", jobId)
  .select("id");
assert.equal(salesJobUpdate.data?.length ?? 0, 0, "sales must not update job status");

const adminStaffJobUpdate = await adminStaff
  .from("job_orders")
  .update({ status: "in_production" })
  .eq("id", jobId)
  .select("id");
assert.equal(adminStaffJobUpdate.error, null, "admin staff should update job status");
assert.equal(adminStaffJobUpdate.data.length, 1, "admin staff should update one job status");

const adminStaffUserId = (await adminStaff.auth.getUser()).data.user.id;
const adminStaffJobInsert = await adminStaff
  .from("job_orders")
  .insert({
    quotation_id: adminQuoteId,
    customer_id: customerId,
    project_name: adminQuoteProject,
    quoted_amount: 125,
    status: "pending",
    tax_type: "non_vat",
    prepared_by_user_id: adminStaffUserId,
    approved_by_user_id: adminStaffUserId,
  })
  .select("id");
assert.equal(adminStaffJobInsert.error, null, "admin staff should create job orders");
assert.equal(adminStaffJobInsert.data.length, 1, "admin staff should create one job order");

const salesJobInsert = await sales.from("job_orders").insert({
  quotation_id: salesQuoteId,
  customer_id: customerId,
  project_name: salesQuoteProject,
  quoted_amount: 150,
  status: "pending",
  tax_type: "non_vat",
});
assert.notEqual(salesJobInsert.error, null, "sales must not create job orders");

const salesSubmitQuote = await sales
  .from("quotations")
  .update({ status: "pending_manager_approval" })
  .eq("id", workflowQuoteId)
  .eq("status", "draft")
  .select("id");
assert.equal(salesSubmitQuote.error, null, "sales should send draft quotes");
assert.equal(salesSubmitQuote.data.length, 1, "sales should submit one quote");

const salesManagerApprove = await sales
  .from("quotations")
  .update({ status: "sent", manager_approved_by_user_id: "00000000-0000-0000-0000-000000000000" })
  .eq("id", workflowQuoteId)
  .eq("status", "pending_manager_approval")
  .select("id");
assert.notEqual(salesManagerApprove.error, null, "sales must not approve manager review");

const adminManagerApprove = await adminStaff
  .from("quotations")
  .update({ status: "sent" })
  .eq("id", workflowQuoteId)
  .eq("status", "pending_manager_approval")
  .select("id, manager_approved_by_user_id");
assert.equal(adminManagerApprove.error, null, "admin should approve manager review");
assert.equal(adminManagerApprove.data.length, 1, "admin should approve one quote");
assert.equal(
  adminManagerApprove.data[0].manager_approved_by_user_id,
  (await adminStaff.auth.getUser()).data.user.id,
);

const salesEditSentQuote = await sales
  .from("quotations")
  .update({ remarks: "Sales should not edit after sending" })
  .eq("id", workflowQuoteId)
  .eq("status", "sent")
  .select("id");
assert.notEqual(salesEditSentQuote.error, null, "sales must not edit sent quotes");

const salesCustomerApprove = await sales
  .from("quotations")
  .update({ status: "approved" })
  .eq("id", workflowQuoteId)
  .eq("status", "sent")
  .select("id");
assert.equal(salesCustomerApprove.error, null, "sales should record customer approval");
assert.equal(salesCustomerApprove.data.length, 1, "sales should approve one customer decision");

const accountingJobUpdate = await accounting
  .from("job_orders")
  .update({ status: "in_production" })
  .eq("id", jobId)
  .select("id");
assert.equal(accountingJobUpdate.data?.length ?? 0, 0, "accounting must not update job status");

const ownerJobUpdate = await owner
  .from("job_orders")
  .update({ status: "in_production" })
  .eq("id", jobId)
  .select("id");
assert.equal(ownerJobUpdate.error, null);
assert.equal(ownerJobUpdate.data.length, 1, "owner should update job status");

const salesExpense = await sales.from("job_expenses").insert({
  job_order_id: jobId,
  expense_date: new Date().toISOString().slice(0, 10),
  expense_type: "materials",
  supplier_name: "RLS Supplier",
  description: "Sales should not insert",
  amount: 1,
});
assert.notEqual(salesExpense.error, null, "sales must not insert expenses");

const accountingExpense = await accounting.from("job_expenses").insert({
  job_order_id: jobId,
  expense_date: new Date().toISOString().slice(0, 10),
  expense_type: "installation",
  supplier_name: "RLS Supplier",
  description: "Accounting should insert installation",
  amount: 1,
});
assert.equal(accountingExpense.error, null, "accounting should insert expenses");

const salesAudit = await sales.from("audit_logs").select("id").eq("id", auditId);
assert.equal(salesAudit.error, null);
assert.equal(salesAudit.data.length, 0, "sales must not read audit logs");

const adminStaffAudit = await adminStaff.from("audit_logs").select("id").eq("id", auditId);
assert.equal(adminStaffAudit.error, null);
assert.equal(adminStaffAudit.data.length, 0, "admin staff must not read audit logs");

const ownerAudit = await owner.from("audit_logs").select("id").eq("id", auditId);
assert.equal(ownerAudit.error, null);
assert.equal(ownerAudit.data.length, 1, "owner should read audit logs");

const proofCleanup = await admin.storage.from("invoice-payment-proofs").remove(proofPaths);
assert.equal(proofCleanup.error, null, "test proof files should be cleaned up");

console.log("RLS role boundary checks passed");
