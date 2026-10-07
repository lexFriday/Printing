import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const jobOrderId = "daf3f8f5-377a-4280-a0b3-ef382ea4d59c";
const itemId = "4995146c-9130-4a69-b9a1-812aee49540d";

async function signInAsOwner(page: Page) {
  const url = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: "owner@local.test",
    password: "password123",
  });
  if (error) throw error;
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate(
    ([keyName, session]) => localStorage.setItem(keyName, JSON.stringify(session)),
    [storageKey, data.session] as const,
  );
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 375, height: 812 },
]) {
  test(`production item deep link is revealed and usable on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await signInAsOwner(page);
    await page.goto(`/production/${jobOrderId}#item-${itemId}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const details = page.locator("details").filter({ hasText: "Production items" });
    await expect(details).toHaveAttribute("open", "");
    await expect(page.locator(`#item-${itemId}`)).toBeVisible();
    const linkedItem = page.locator(`#item-${itemId}`);
    await expect(linkedItem.getByRole("heading", { name: "Materials for this item" })).toBeVisible();
    await expect(linkedItem.getByText("Glossy Vinyl")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Production items" })).toBeVisible();
    await expect(page.getByText("Work from the highlighted item")).toBeVisible();
    await expect(page.getByText("Blocked", { exact: true })).toHaveCount(0);

    if (viewport.name === "desktop") {
      const addMaterials = page
        .getByRole("button", { name: /Add (required|missing) materials?/ })
        .first();
      await addMaterials.click();
      await expect(page.getByText("Start with a BOM suggestion")).toBeVisible();
      const recipeSelect = page.getByLabel("Start with a BOM suggestion");
      await expect(
        recipeSelect.getByRole("option", { name: /A4 Detailer · recipe version 2/ }),
      ).toHaveCount(1);
      await expect(page.getByText("Item Template recipes prefill this form only")).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
    }

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
}
