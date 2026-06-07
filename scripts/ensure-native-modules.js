// scripts/ensure-native-modules.js
// Ensures native modules like better-sqlite3 are compiled.
// Needed because pnpm v10 may skip build scripts for packages listed in onlyBuiltDependencies.

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const pnpmStore = path.join(process.cwd(), "node_modules", ".pnpm");
if (!fs.existsSync(pnpmStore)) {
  console.log("[ensure-native-modules] No .pnpm store found, skipping.");
  process.exit(0);
}

const nativePkgs = fs
  .readdirSync(pnpmStore)
  .filter((dir) => dir.startsWith("better-sqlite3"));

if (nativePkgs.length === 0) {
  console.log("[ensure-native-modules] better-sqlite3 not found in .pnpm store, skipping.");
  process.exit(0);
}

for (const pkg of nativePkgs) {
  const pkgDir = path.join(pnpmStore, pkg, "node_modules", "better-sqlite3");

  // Check if already compiled
  try {
    require("better-sqlite3");
    console.log("[ensure-native-modules] better-sqlite3 already loadable, skipping.");
    process.exit(0);
  } catch (_) {
    // Not compiled yet, proceed
  }

  console.log(`[ensure-native-modules] Compiling ${pkg} via npm run install...`);
  try {
    execSync("npm run install", { cwd: pkgDir, stdio: "inherit", timeout: 120000 });
    console.log(`[ensure-native-modules] ${pkg} compiled successfully.`);
  } catch (err) {
    console.error(`[ensure-native-modules] Failed to compile ${pkg}:`, err.message);
    process.exit(1);
  }
}
