// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

function resolveAppVersion(): string {
  const versionFilePath = path.resolve(process.cwd(), "public", "version.json");
  const isBuild = process.argv.some((arg) => arg === "build");

  if (!isBuild && fs.existsSync(versionFilePath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(versionFilePath, "utf8")) as {
        version?: string;
      };
      if (existing?.version) return existing.version;
    } catch {}
  }

  let gitSha = "local";
  try {
    gitSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {}

  const now = new Date();
  const datePart = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, "0")}.${String(now.getUTCDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const version = `${datePart}-${timePart}-${gitSha}`;

  try {
    fs.mkdirSync(path.dirname(versionFilePath), { recursive: true });
    fs.writeFileSync(
      versionFilePath,
      JSON.stringify({ version, builtAt: now.toISOString() }, null, 2) + "\n",
      "utf8",
    );
  } catch {}

  return version;
}

const APP_VERSION = resolveAppVersion();

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    preset: process.env.NITRO_PRESET || "node-server",
  },
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
    },
  },
});
