import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

async function signInAs(page: Page, email: string) {
  const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: "password123",
  });
  if (error) throw error;
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

  await page.goto("/");
  await page.evaluate(
    ([keyName, session]) => {
      localStorage.setItem(keyName, JSON.stringify(session));
    },
    [storageKey, data.session] as const,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 });
}

async function ensureRoleUsers() {
  const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const desired = [
    ["admin@local.test", "Local Admin", "admin"],
    ["owner@local.test", "Local Owner", "owner"],
    ["sales@local.test", "Local Sales", "sales"],
    ["accounting@local.test", "Local Accounting", "accounting"],
    ["viewer@local.test", "Local Viewer", "viewer"],
  ] as const;

  const listed = await supabase.auth.admin.listUsers();
  if (listed.error) throw listed.error;

  for (const [email, displayName, role] of desired) {
    let user = listed.data.users.find((u) => u.email === email);
    if (!user) {
      const created = await supabase.auth.admin.createUser({
        email,
        password: "password123",
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (created.error) throw created.error;
      user = created.data.user;
    } else {
      const updated = await supabase.auth.admin.updateUserById(user.id, {
        password: "password123",
        email_confirm: true,
        user_metadata: { display_name: displayName },
      });
      if (updated.error) throw updated.error;
    }

    const profile = await supabase
      .from("profiles")
      .upsert({ id: user.id, email, display_name: displayName, status: "active" });
    if (profile.error) throw profile.error;
    const deleted = await supabase.from("user_roles").delete().eq("user_id", user.id);
    if (deleted.error) throw deleted.error;
    const inserted = await supabase.from("user_roles").insert({ user_id: user.id, role });
    if (inserted.error) throw inserted.error;
  }
}

function adminClient() {
  const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedApprovedQuoteWithoutJob() {
  const supabase = adminClient();
  const suffix = Date.now();
  const customer = await supabase
    .from("customers")
    .insert({
      customer_name: `Role QA Customer ${suffix}`,
      contact_person: "QA",
      contact_number: "000",
    })
    .select("id")
    .single();
  if (customer.error) throw customer.error;

  const quote = await supabase
    .from("quotations")
    .insert({
      customer_id: customer.data.id,
      project_name: `Role QA Approved Quote ${suffix}`,
      quote_date: new Date().toISOString().slice(0, 10),
      status: "approved",
      subtotal: 100,
      total_amount: 100,
      tax_type: "non_vat",
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (quote.error) throw quote.error;

  return quote.data.id;
}

async function seedViewerStatusJobs() {
  const supabase = adminClient();
  const suffix = Date.now();
  const customer = await supabase
    .from("customers")
    .insert({
      customer_name: `Viewer Status Customer ${suffix}`,
      contact_person: "QA",
      contact_number: "000",
    })
    .select("id")
    .single();
  if (customer.error) throw customer.error;

  for (const [index, status] of ["pending", "in_production", "ready"].entries()) {
    const quote = await supabase
      .from("quotations")
      .insert({
        customer_id: customer.data.id,
        project_name: `Viewer Status ${status} ${suffix}`,
        quote_date: new Date().toISOString().slice(0, 10),
        status: "approved",
        subtotal: 100 + index,
        total_amount: 100 + index,
        tax_type: "non_vat",
      })
      .select("id")
      .single();
    if (quote.error) throw quote.error;

    const job = await supabase.from("job_orders").insert({
      quotation_id: quote.data.id,
      customer_id: customer.data.id,
      project_name: `Viewer Status ${status} ${suffix}`,
      quoted_amount: 100 + index,
      status,
      tax_type: "non_vat",
    });
    if (job.error) throw job.error;
  }
}

async function seedMaterialReportJob() {
  const supabase = adminClient();
  const suffix = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const customer = await supabase
    .from("customers")
    .insert({
      customer_name: `Material Report Customer ${suffix}`,
      contact_person: "QA",
      contact_number: "000",
    })
    .select("id")
    .single();
  if (customer.error) throw customer.error;

  const quote = await supabase
    .from("quotations")
    .insert({
      customer_id: customer.data.id,
      project_name: `Material Report Job ${suffix}`,
      quote_date: today,
      status: "approved",
      subtotal: 512,
      total_amount: 512,
      tax_type: "non_vat",
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (quote.error) throw quote.error;

  const quoteLine = await supabase.from("quote_line_items").insert({
    quotation_id: quote.data.id,
    description: `Material Report Line ${suffix}`,
    pricing_mode: "fixed",
    quantity: 2,
    unit_price: 256,
    line_total: 512,
    sort_order: 0,
  });
  if (quoteLine.error) throw quoteLine.error;

  const job = await supabase
    .from("job_orders")
    .insert({
      quotation_id: quote.data.id,
      customer_id: customer.data.id,
      project_name: `Material Report Job ${suffix}`,
      quoted_amount: 512,
      status: "completed",
      tax_type: "non_vat",
    })
    .select("id")
    .single();
  if (job.error) throw job.error;

  const expenses = await supabase.from("job_expenses").insert([
    {
      job_order_id: job.data.id,
      expense_date: today,
      expense_type: "materials",
      supplier_name: `Pending Supplier ${suffix}`,
      description: `Pending plywood ${suffix}`,
      quantity: 3,
      unit_of_measure: "sheets",
      unit_cost: 125.5,
      amount: 376.5,
      payment_status: "pending",
      due_date: today,
    },
    {
      job_order_id: job.data.id,
      expense_date: today,
      expense_type: "materials",
      supplier_name: `Paid Supplier ${suffix}`,
      description: `Paid tarp ${suffix}`,
      quantity: 4,
      unit_of_measure: "rolls",
      unit_cost: 250,
      amount: 1000,
      payment_status: "paid",
      paid_at: new Date().toISOString(),
      check_number: `CHK-${suffix}`,
      supplier_document_no: `DR-${suffix}`,
    },
  ]);
  if (expenses.error) throw expenses.error;

  return { jobId: job.data.id, suffix };
}

test.describe("role permission boundaries", () => {
  test.use({ storageState: undefined });
  test.beforeAll(async () => {
    await ensureRoleUsers();
  });

  test("viewer sign-in is held until an owner assigns a workspace role", async ({ page }) => {
    await page.goto("/auth");
    const signInButton = page.getByRole("button", { name: "Sign in" });
    await expect(signInButton).toBeEnabled({ timeout: 20_000 });
    await page.locator("#email").fill("viewer@local.test");
    await page.locator("#password").fill("password123");
    await signInButton.click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "Waiting for workspace access" })).toBeVisible();
  });

  test("viewer cannot open operational routes before an owner assigns a workspace role", async ({
    page,
  }) => {
    await signInAs(page, "viewer@local.test");

    for (const path of [
      "/customers",
      "/quotes",
      "/jobs",
      "/invoices",
      "/reports",
      "/settings/audit-logs",
    ]) {
      await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await expect(
        page.getByRole("heading", { name: "Waiting for workspace access" }),
      ).toBeVisible();
    }
  });

  test("sales can work quotes but cannot move job orders", async ({ page }) => {
    const quoteId = await seedApprovedQuoteWithoutJob();
    await signInAs(page, "sales@local.test");

    await page.goto("/quotes/new");
    await expect(page.getByRole("heading", { name: "New quote" })).toBeVisible();

    await page.goto(`/quotes/${quoteId}`);
    await expect(
      page.getByRole("heading", {
        name: "Only owner or admin staff can create job orders from approved quotes.",
      }),
    ).toBeVisible();
    await expect(page.getByText(/row-level security policy/i)).toHaveCount(0);

    await page.goto("/jobs");
    await expect(page.getByText(/job workflow is controlled by owner\/admin staff/i)).toBeVisible();
  });

  test("admin staff can do operational work but cannot use owner-only controls", async ({
    page,
  }) => {
    const quoteId = await seedApprovedQuoteWithoutJob();
    await signInAs(page, "admin@local.test");

    await page.goto("/settings/users");
    await expect(page.getByText(/ask the owner to update user access/i)).toBeVisible();

    await page.goto("/settings/audit-logs");
    await expect(page.getByText(/audit logs are available to the owner only/i)).toBeVisible();

    await page.goto("/reports");
    await expect(page.getByRole("button", { name: "Profit" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Operations" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Money In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Money Out" })).toBeVisible();

    await page.goto(`/quotes/${quoteId}`);
    await page.getByRole("button", { name: "Convert to Job Order" }).click();
    const dialog = page.getByRole("dialog", { name: "Create production Job Order" });
    await dialog.getByText("Date Requested").locator("..").getByRole("textbox").fill("2026-09-30");
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "Mitz Sy" }).click();
    await page.getByRole("button", { name: "Create Job Order" }).click();
    await expect(page).toHaveURL(/\/jobs\//);
    await expect(page.getByRole("link", { name: /Open production workspace/i })).toBeVisible();
  });

  test("accounting lands in Money Out pending expenses and cannot move job orders", async ({
    page,
  }) => {
    await signInAs(page, "accounting@local.test");

    await page.goto("/reports");
    await expect(page.getByRole("button", { name: "Money In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Money Out" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Profit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Operations" })).toHaveCount(0);

    await page.goto("/reports?tab=payables&focus=pending-expenses");
    await expect(page.getByRole("button", { name: "Money Out" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Pending Expenses" })).toHaveAttribute(
      "data-state",
      "active",
    );

    await page.goto("/jobs");
    await page
      .getByRole("link", { name: /open job order/i })
      .first()
      .click();
    await expect(page.getByText(/job workflow is controlled by owner\/admin staff/i)).toBeVisible();
  });

  test("money out reports show material quantity breakdown", async ({ page }) => {
    const { suffix } = await seedMaterialReportJob();
    await signInAs(page, "owner@local.test");

    await page.goto("/reports?tab=payables&focus=pending-expenses");
    const pendingRow = page.getByRole("row").filter({ hasText: `Pending plywood ${suffix}` });
    await expect(pendingRow).toBeVisible();
    await expect(pendingRow.getByText(/3\s+sheets.*125\.50/)).toBeVisible();

    await page.goto("/reports?tab=disbursements");
    const paidRow = page.getByRole("row").filter({ hasText: `Paid tarp ${suffix}` });
    await expect(paidRow).toBeVisible();
    await expect(paidRow.getByText(/4\s+rolls.*250\.00/)).toBeVisible();
  });

  test("priced delivery receipt is explicitly non-vat", async ({ page }) => {
    const { jobId } = await seedMaterialReportJob();
    await signInAs(page, "owner@local.test");

    await page.goto(`/jobs/${jobId}/delivery-receipt/print?priced=true`);
    await expect(page.getByText("Delivery Receipt - Priced")).toBeVisible();
    await expect(page.getByText(/Non-VAT/i)).toBeVisible();
    await expect(page.getByText(/VATable Sales/i)).toHaveCount(0);
  });

  test("owner can search audit logs for System user", async ({ page }) => {
    const supabase = adminClient();
    const inserted = await supabase
      .from("audit_logs")
      .insert({
        action: "role.qa.system",
        entity_type: "profiles",
        entity_id: crypto.randomUUID(),
        new_values: { marker: "system-user-search" },
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;

    try {
      await signInAs(page, "owner@local.test");
      await page.goto("/settings/audit-logs");
      await page.getByPlaceholder("Search by person, item, or change...").fill("System user");
      await expect(page.getByRole("cell", { name: "System user" }).first()).toBeVisible();
    } finally {
      await supabase.from("audit_logs").delete().eq("id", inserted.data.id);
    }
  });
});
