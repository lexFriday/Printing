import { zipSync, strToU8 } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import * as ResEdit from "resedit";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(__dirname, "dist");
const publicDir = path.join(projectRoot, "public");

if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

console.log("\n[1/4] Bundling print engine into standalone CommonJS script...");
await build({
  configFile: false,
  build: {
    ssr: path.join(__dirname, "print-delivery-receipt.mjs"),
    outDir: distDir,
    target: "node22",
    rollupOptions: {
      output: {
        format: "cjs",
        entryFileNames: "agent.cjs",
      },
    },
    minify: false,
  },
  ssr: {
    noExternal: true,
  },
});

const cjsBundlePath = path.join(distDir, "agent.cjs");
const outputExePath = path.join(publicDir, "Automate DirectPrint.exe");
const legacyExePath = path.join(publicDir, "dr-direct-print-agent.exe");

// Stage SumatraPDF.exe into distDir so pkg embeds it into virtual snapshot
const sourceSumatra = path.join(__dirname, "bin/SumatraPDF.exe");
if (fs.existsSync(sourceSumatra)) {
  fs.copyFileSync(sourceSumatra, path.join(distDir, "SumatraPDF.exe"));
}

const pkgConfigPath = path.join(distDir, "pkg.config.json");
fs.writeFileSync(pkgConfigPath, JSON.stringify({ assets: ["SumatraPDF.exe"] }, null, 2));

console.log("\n[2/4] Compiling standalone executables...");
// CRITICAL: --no-bytecode and --public prevent cross-architecture V8 bytecode incompatibility
execSync(
  `npx -y @yao-pkg/pkg "${cjsBundlePath}" --config "${pkgConfigPath}" --target node22-win-x64 --no-bytecode --public --output "${outputExePath}"`,
  {
    stdio: "inherit",
    cwd: projectRoot,
  },
);

const outputMacPath = path.join(publicDir, "Automate DirectPrint-mac");
console.log("\nCompiling standalone macOS ARM64 executable (Automate DirectPrint-mac)...");
execSync(
  `npx -y @yao-pkg/pkg "${cjsBundlePath}" --target node22-macos-arm64 --no-bytecode --public --output "${outputMacPath}"`,
  {
    stdio: "inherit",
    cwd: projectRoot,
  },
);
try {
  fs.chmodSync(outputMacPath, 0o755);
} catch {}

console.log("\n[3/4] Embedding program icon (favicon.ico) & application metadata...");
const exeBuffer = fs.readFileSync(outputExePath);
const ntExe = ResEdit.NtExecutable.from(exeBuffer, { ignoreCert: true });
const ntRes = ResEdit.NtExecutableResource.from(ntExe);

const iconIcoPath = path.join(publicDir, "favicon.ico");
if (fs.existsSync(iconIcoPath)) {
  const iconBuf = fs.readFileSync(iconIcoPath);
  const iconFile = ResEdit.Data.IconFile.from(iconBuf);
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    ntRes.entries,
    1,
    1033,
    iconFile.icons.map((item) => item.data),
  );
  console.log(`  ✓ Injected icon (${iconFile.icons.length} icon entry) into executable resource.`);
}

const viList = ResEdit.Resource.VersionInfo.fromEntries(ntRes.entries);
if (viList.length > 0) {
  const vi = viList[0];
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: "Automate DirectPrint",
      FileDescription: "Automate DirectPrint Agent",
      OriginalFilename: "Automate DirectPrint.exe",
      CompanyName: "Arlechino Concepts Inc.",
      LegalCopyright: "Copyright (c) Arlechino Concepts Inc. All rights reserved.",
    },
  );
  vi.outputToResourceEntries(ntRes.entries);
  console.log("  ✓ Updated application version and metadata.");
}

function setPeSubsystemToGui(buffer) {
  const peOffset = buffer.readUInt32LE(0x3c);
  const subsystemOffset = peOffset + 24 + 68;
  buffer.writeUInt16LE(2, subsystemOffset); // 2 = IMAGE_SUBSYSTEM_WINDOWS_GUI (prevents console window)
  return buffer;
}

ntRes.outputResource(ntExe);
const rawExeBinary = Buffer.from(ntExe.generate());
const finalExeBinary = setPeSubsystemToGui(rawExeBinary);
fs.writeFileSync(outputExePath, finalExeBinary);
console.log("  ✓ Configured Windows GUI subsystem (no console/terminal window).");
// Keep legacy filename in sync so older bookmarks or paths continue to work
fs.copyFileSync(outputExePath, legacyExePath);

console.log("\n[4/4] Generating ZIP bundles...");
const envContent = fs.existsSync(path.join(projectRoot, ".env"))
  ? fs.readFileSync(path.join(projectRoot, ".env"), "utf-8")
  : "";

const launcherBatContent = `@echo off
start "" "%~dp0Automate DirectPrint.exe"
exit
`;

const readmeContent = `# Automate DirectPrint (Arlechino Concepts Inc.)

Single standalone Windows application with Desktop GUI — No terminal, no Node.js needed!

## How to use:
1. Double-click "Automate DirectPrint.exe".
2. The DirectPrint Control Panel GUI window opens on your desktop.
3. Keep the window open or minimized in the background.
4. In your web browser, click "Direct Print" on any Delivery Receipt, Check, or Service Invoice page.
   The job instantly spools to your printer!

## Features:
- Clean standalone desktop GUI window
- Live hardware printer detection & selection
- Test print triggers for DR, Check, Service Invoice, and Check Voucher
- Real-time print activity history
`;

const zipData = zipSync({
  "Automate DirectPrint.exe": finalExeBinary,
  "run-agent.bat": strToU8(launcherBatContent),
  ".env": strToU8(envContent),
  "README.txt": strToU8(readmeContent),
});

const outputZipPath = path.join(publicDir, "Automate DirectPrint.zip");
fs.writeFileSync(outputZipPath, Buffer.from(zipData));
// Also copy to legacy dr-direct-print-agent.zip for backward compatibility
fs.copyFileSync(outputZipPath, path.join(publicDir, "dr-direct-print-agent.zip"));

// Standalone macOS bundle
const macLauncherContent = `#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$DIR/Automate DirectPrint-mac" 2>/dev/null
echo "Starting Automate DirectPrint Agent for macOS..."
"$DIR/Automate DirectPrint-mac"
osascript -e 'tell application "Terminal" to close (every window whose name contains "run-agent-mac")' 2>/dev/null || true
kill -9 $PPID 2>/dev/null || true
exit 0
`;

const macZipData = zipSync({
  "Automate DirectPrint-mac": fs.readFileSync(outputMacPath),
  "run-agent-mac.command": strToU8(macLauncherContent),
  ".env": strToU8(envContent),
  "README.txt": strToU8(readmeContent),
});
const outputMacZipPath = path.join(publicDir, "Automate DirectPrint-mac.zip");
fs.writeFileSync(outputMacZipPath, Buffer.from(macZipData));

console.log("\n============================================================");
console.log(
  `✓ Standalone Win EXE: ${outputExePath} (${(finalExeBinary.length / (1024 * 1024)).toFixed(1)} MB)`,
);
console.log(
  `✓ Standalone Win ZIP: ${outputZipPath} (${(zipData.length / (1024 * 1024)).toFixed(1)} MB)`,
);
console.log(
  `✓ Standalone Mac BIN: ${outputMacPath} (${(fs.statSync(outputMacPath).size / (1024 * 1024)).toFixed(1)} MB)`,
);
console.log(
  `✓ Standalone Mac ZIP: ${outputMacZipPath} (${(macZipData.length / (1024 * 1024)).toFixed(1)} MB)`,
);
console.log("============================================================\n");
