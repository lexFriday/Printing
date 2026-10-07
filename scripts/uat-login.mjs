import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const baseURL = process.env.UAT_BASE_URL ?? "http://127.0.0.1:8091";
const authFile = ".auth/uat-user.json";

await mkdir(".auth", { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(`${baseURL}/auth`);

console.log("\nSign in in the browser window that opened.");
console.log("After the app redirects away from /auth, come back here and press Enter.\n");

const rl = readline.createInterface({ input, output });
await rl.question("Press Enter after sign-in is complete...");
rl.close();

await page.context().storageState({ path: authFile });
await browser.close();

console.log(`Saved UAT login to ${authFile}. You can now run: npm run uat`);
