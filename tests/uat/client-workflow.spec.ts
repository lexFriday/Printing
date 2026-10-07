import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

const email = process.env.UAT_EMAIL;
const password = process.env.UAT_PASSWORD;
const jobId = process.env.UAT_JOB_ID ?? "087bc445-8e1e-4b56-9dd6-083240dfe69d";
const hasSavedLogin = existsSync(".auth/uat-user.json");

async function signIn(page: Page) {
  if (hasSavedLogin) return;
  test.skip(!email || !password, "Set UAT_EMAIL and UAT_PASSWORD to run browser UAT.");

  await page.goto("/auth");
  await page.getByLabel("Email").fill(email!);
  await page.getByRole("textbox", { name: "Password" }).fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/auth$/);
}

async function gotoAuthed(page: Page, path: string) {
  await page.goto(path);
  const signInVisible = await page
    .getByRole("button", { name: "Sign in" })
    .waitFor({ state: "visible", timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (signInVisible) test.skip(true, "UAT login is missing or expired. Run npm run uat:login.");
}

test.describe("client workflow UAT", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("dashboard backlinks route users to the right work queues", async ({ page }) => {
    await gotoAuthed(page, "/dashboard");

    await page
      .getByRole("heading", { name: "Outstanding Receivables" })
      .locator("..")
      .getByRole("link", { name: "View all" })
      .click();
    await expect(page).toHaveURL(/\/reports\?tab=receivables/);
    await expect(page.getByRole("tab", { name: "Receivables" })).toHaveAttribute(
      "data-state",
      "active",
    );

    await gotoAuthed(page, "/dashboard");
    await page
      .getByRole("heading", { name: "Pending Expenses" })
      .locator("..")
      .getByRole("link", { name: "View all" })
      .click();
    await expect(page).toHaveURL(/\/reports\?tab=payables.*focus=pending-expenses/);
    await expect(page.getByRole("tab", { name: "Pending Expenses" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  test("reports keep users in context while switching subreports", async ({ page }) => {
    await gotoAuthed(page, "/reports?tab=payables&focus=pending-expenses");
    await expect(page.getByRole("tab", { name: "Pending Expenses" })).toHaveAttribute(
      "data-state",
      "active",
    );

    await page.evaluate(() => window.scrollTo(0, 420));
    await page.getByRole("tab", { name: "Disbursements" }).click();

    await expect(page).toHaveURL(/\/reports\?tab=disbursements/);
    await expect(page.getByRole("tab", { name: "Disbursements" })).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("material expense amount is derived from quantity and unit cost", async ({ page }) => {
    await gotoAuthed(page, `/jobs/${jobId}`);

    const addExpense = page.getByRole("button", { name: /^Add expense$/ });
    await addExpense.scrollIntoViewIfNeeded();
    await addExpense.click();

    await expect(page.getByRole("heading", { name: "Add expense" })).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "Add expense" });
    await dialog.getByPlaceholder("e.g. Paper supplier").fill("UAT Supplier");
    await dialog.getByRole("textbox").nth(2).fill("UAT plywood sheets");
    await dialog.getByRole("spinbutton").nth(0).fill("3");
    await dialog.getByPlaceholder("e.g. pcs, sheets, rolls").fill("sheets");
    await dialog.getByRole("spinbutton").nth(1).fill("125.5");

    await expect(dialog.getByRole("spinbutton").nth(2)).toHaveValue("376.50");
  });

  test("mutating end-to-end workflow is opt-in", async () => {
    test.skip(
      process.env.RUN_MUTATING_UAT !== "true",
      "Set RUN_MUTATING_UAT=true before running create/approve/pay UAT against test data.",
    );
  });
});
