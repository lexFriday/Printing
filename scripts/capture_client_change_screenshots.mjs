import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

const appUrl = "http://127.0.0.1:8080";
const supabaseUrl = process.env.SUPABASE_URL ?? "http://127.0.0.1:57421";
const anonKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
const outDir =
  "C:\\Users\\skhart\\Documents\\Codex\\2026-06-24\\cl\\outputs\\client-change-screenshots";

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signIn(page, email) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: "password123",
  });
  if (error) throw error;
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  await page.goto(appUrl);
  await page.evaluate(
    ([key, session]) => localStorage.setItem(key, JSON.stringify(session)),
    [storageKey, data.session],
  );
}

async function ensureIds() {
  const quote = await admin
    .from("quotations")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (quote.error) throw quote.error;

  const editableQuote = await admin
    .from("quotations")
    .select("id")
    .in("status", ["draft", "pending_manager_approval"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const job = await admin
    .from("job_orders")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (job.error) throw job.error;

  return {
    quoteId: quote.data.id,
    editableQuoteId: editableQuote.data?.id ?? quote.data.id,
    jobId: job.data.id,
  };
}

async function screenshot(page, route, fileName) {
  await page.goto(`${appUrl}${route}`, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(outDir, fileName),
    fullPage: false,
  });
}

await fs.mkdir(outDir, { recursive: true });
const ids = await ensureIds();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await signIn(page, "owner@local.test");
await screenshot(page, "/dashboard", "01-dashboard.png");
await screenshot(page, `/quotes/${ids.quoteId}`, "02-quote-detail.png");
await screenshot(page, `/quotes/${ids.editableQuoteId}/edit`, "03-quote-edit-vat.png");
await screenshot(page, `/jobs/${ids.jobId}`, "04-job-detail.png");
await screenshot(page, "/reports?tab=payables&focus=pending-expenses", "05-pending-expenses.png");
await screenshot(page, "/reports?tab=disbursements", "06-disbursements.png");

await browser.close();
console.log(outDir);
