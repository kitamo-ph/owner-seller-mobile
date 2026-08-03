#!/usr/bin/env node
/**
 * Executable protected application-identity and AAB verification.
 *
 * Example:
 *   node scripts/check-protected-artifacts.js \
 *     --aab release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab
 *
 * When no AAB path is available, identity still runs and AAB reports SKIPPED.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED = {
  package: "ph.kitamo.app",
  projectId: "d2ab769c-4916-4efa-ab1e-a2dfdc638607",
  version: "1.0.0",
  versionCode: 2,
  aabSha256:
    "9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd",
  aabBytes: 57_120_066,
};

function parseArgs(argv) {
  const options = { aab: null, requireAab: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require-aab") {
      options.requireAab = true;
      continue;
    }
    if (arg === "--aab") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --aab");
      }
      options.aab = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/check-protected-artifacts.js [--aab <path>] [--require-aab]",
          "",
          "Parses app.json for package/version/versionCode/projectId.",
          "When --aab is omitted, protected AAB verification is SKIPPED.",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function fail(message) {
  console.error(`PROTECTED ARTIFACTS FAILED: ${message}`);
  process.exitCode = 1;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const workspace = process.cwd();
  const appJsonPath = path.join(workspace, "app.json");
  if (!fs.existsSync(appJsonPath)) {
    fail("app.json is missing");
    return;
  }

  let app;
  try {
    app = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  } catch (error) {
    fail(`app.json is not valid JSON (${error instanceof Error ? error.message : error})`);
    return;
  }

  const actual = {
    package: app?.expo?.android?.package ?? null,
    version: app?.expo?.version ?? null,
    versionCode: app?.expo?.android?.versionCode ?? null,
    projectId: app?.expo?.extra?.eas?.projectId ?? null,
  };

  console.log("=== Protected identity ===");
  for (const [key, expected] of Object.entries({
    package: EXPECTED.package,
    version: EXPECTED.version,
    versionCode: EXPECTED.versionCode,
    projectId: EXPECTED.projectId,
  })) {
    const value = actual[key];
    if (value !== expected) {
      fail(`${key} mismatch: expected ${JSON.stringify(expected)}, actual ${JSON.stringify(value)}`);
      return;
    }
    console.log(`${key}: PASS (${value})`);
  }

  console.log("=== Protected AAB ===");
  if (!options.aab) {
    if (options.requireAab) {
      fail("AAB path required by --require-aab but not supplied");
      return;
    }
    console.log("Protected AAB verification: SKIPPED — artifact path unavailable");
    console.log("PROTECTED ARTIFACTS PASSED: identity only; AAB skipped");
    return;
  }

  const aabPath = path.resolve(workspace, options.aab);
  if (!fs.existsSync(aabPath)) {
    fail(`artifact unavailable: ${aabPath}`);
    console.error("Protected AAB verification: FAIL — artifact unavailable");
    return;
  }

  const size = fs.statSync(aabPath).size;
  if (size !== EXPECTED.aabBytes) {
    fail(
      `AAB size mismatch: expected ${EXPECTED.aabBytes} bytes, actual ${size} bytes`,
    );
    return;
  }
  const digest = sha256File(aabPath);
  if (digest !== EXPECTED.aabSha256) {
    fail(`AAB SHA-256 mismatch`);
    console.error(`expected ${EXPECTED.aabSha256}`);
    console.error(`actual   ${digest}`);
    return;
  }

  console.log(`path: ${aabPath}`);
  console.log(`size: PASS (${size} bytes)`);
  console.log(`sha256: PASS (${digest})`);
  console.log("PROTECTED ARTIFACTS PASSED: identity and AAB");
}

main();
