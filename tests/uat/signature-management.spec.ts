import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

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
    ([keyName, session]) => localStorage.setItem(keyName, JSON.stringify(session)),
    [storageKey, data.session] as const,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 });
}

test("owner previews a normalized signature and gets a safe removal confirmation", async ({
  page,
}) => {
  await signInAs(page, "owner@local.test");
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByText(/PNG, JPG, or WEBP up to 512 KB/)).toBeVisible();

  const imagePath = fileURLToPath(new URL("../../public/brand/njl-logo.png", import.meta.url));
  await page.locator('input[type="file"]').first().setInputFiles(imagePath);
  await expect(page.getByRole("heading", { name: "Confirm signature" })).toBeVisible();
  await expect(page.getByText("Document-size preview")).toBeVisible();
  await expect(page.getByRole("img", { name: /Signature preview for/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save signature" })).toBeEnabled();
  await page.getByRole("button", { name: "Choose another image" }).click();

  const removeButton = page.getByRole("button", { name: /Remove signature for/ }).first();
  await removeButton.click();
  await expect(page.getByRole("heading", { name: "Remove signature?" })).toBeVisible();
  await expect(
    page.getByText(/Existing finalized documents keep their original signature/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep signature" }).click();
});

test("non-manager cannot use Admin Users to change another signature", async ({ page }) => {
  await signInAs(page, "sales@local.test");
  await page.goto("/settings/users");
  await expect(page.getByText("You do not have permission to perform this action.")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});
