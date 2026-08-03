#!/usr/bin/env node
/**
 * Executable repository hygiene checks.
 *
 *   node scripts/check-repo-hygiene.js
 *   node scripts/check-repo-hygiene.js --base 72f44be --head HEAD
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const BINARY_EXTENSIONS = new Set([
  ".aab",
  ".apk",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".mp3",
  ".mp4",
  ".zip",
  ".gz",
  ".jar",
  ".keystore",
  ".jks",
]);

const PROTECTED_PATH_PATTERNS = [
  /^app\.json$/,
  /^eas\.json$/,
  /^credentials\.json$/,
  /(^|\/)keystore/i,
  /\.keystore$/i,
  /\.jks$/i,
  /\.aab$/i,
  /^android\/.*signing/i,
];

function parseArgs(argv) {
  const options = { base: null, head: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base" || arg === "--head") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/check-repo-hygiene.js [--base <ref>] [--head <ref>]",
      );
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function git(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function listTrackedFiles() {
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

function isProbablyBinary(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return true;
  if (filePath.startsWith("release-artifacts/")) return true;
  return false;
}

function isTextCandidate(filePath) {
  if (isProbablyBinary(filePath)) return false;
  if (filePath.startsWith("node_modules/")) return false;
  if (filePath.startsWith(".git/")) return false;
  return true;
}

function collectFailures() {
  return [];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const failures = collectFailures();
  const skipped = [];
  const passed = [];
  const workspace = process.cwd();

  console.log("=== Repository hygiene ===");
  console.log(`scope: tracked files under ${workspace}`);

  // 5.1 Diff hygiene
  try {
    if (options.base && options.head) {
      execFileSync("git", ["diff", "--check", `${options.base}...${options.head}`], {
        cwd: workspace,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      passed.push(`git diff --check ${options.base}...${options.head}`);
    } else {
      execFileSync("git", ["diff", "--check"], {
        cwd: workspace,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      execFileSync("git", ["diff", "--cached", "--check"], {
        cwd: workspace,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      passed.push("git diff --check (worktree and index)");
    }
  } catch (error) {
    failures.push(
      `diff hygiene failed:\n${error.stdout || error.stderr || error.message}`,
    );
  }

  const tracked = listTrackedFiles();
  const textFiles = tracked.filter(isTextCandidate);

  // 5.2 Final newlines and 5.3 trailing whitespace
  for (const relativePath of textFiles) {
    const absolute = path.join(workspace, relativePath);
    let content;
    try {
      content = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    if (content.length === 0) continue;
    if (!content.endsWith("\n")) {
      failures.push(`missing final newline: ${relativePath}`);
    }
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/[ \t]+$/.test(line)) {
        failures.push(
          `trailing whitespace: ${relativePath}:${index + 1}`,
        );
        break;
      }
    }
  }
  passed.push(`final newlines and trailing whitespace (${textFiles.length} text files)`);

  // 5.4 JSON parsing
  const jsonFiles = tracked.filter(
    (filePath) => filePath.endsWith(".json") && !isProbablyBinary(filePath),
  );
  for (const relativePath of jsonFiles) {
    const absolute = path.join(workspace, relativePath);
    try {
      JSON.parse(fs.readFileSync(absolute, "utf8"));
    } catch (error) {
      failures.push(
        `JSON parse failed: ${relativePath} (${error instanceof Error ? error.message : error})`,
      );
    }
  }
  passed.push(`JSON parse (${jsonFiles.length} files)`);

  // 5.5 Documentation links
  const markdownFiles = tracked.filter((filePath) => filePath.endsWith(".md"));
  const linkPattern = /\[[^\]]*]\(([^)]+)\)/g;
  for (const relativePath of markdownFiles) {
    const absolute = path.join(workspace, relativePath);
    const content = fs.readFileSync(absolute, "utf8");
    let match;
    while ((match = linkPattern.exec(content))) {
      const target = match[1].trim();
      if (
        !target ||
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("mailto:") ||
        target.startsWith("#")
      ) {
        continue;
      }
      if (
        target.startsWith("/private/tmp/") ||
        target.includes("/private/tmp/") ||
        target.includes("codex-worktree") ||
        target.includes("/var/folders/")
      ) {
        failures.push(
          `temporary-location documentation link: ${relativePath} -> ${target}`,
        );
        continue;
      }
      const [filePart, anchor] = target.split("#");
      if (!filePart) {
        // same-file anchor
        if (anchor && !content.includes(`id="${anchor}"`) && !content.includes(`# ${anchor}`) && !headingExists(content, anchor)) {
          // anchors are best-effort; only fail hard temporary paths above
        }
        continue;
      }
      const resolved = path.normalize(
        path.join(path.dirname(absolute), filePart),
      );
      if (!resolved.startsWith(workspace)) {
        failures.push(
          `documentation link escapes repository: ${relativePath} -> ${target}`,
        );
        continue;
      }
      if (!fs.existsSync(resolved)) {
        failures.push(
          `broken documentation link: ${relativePath} -> ${target}`,
        );
      }
    }
  }
  passed.push(`documentation relative links (${markdownFiles.length} markdown files)`);

  // 5.6 Protected path scope
  if (options.base && options.head) {
    const changed = git([
      "diff",
      "--name-only",
      `${options.base}...${options.head}`,
    ])
      .split("\n")
      .filter(Boolean);
    const unexpectedProtected = changed.filter((filePath) =>
      PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(filePath)),
    );
    if (unexpectedProtected.length > 0) {
      failures.push(
        `unexpected protected-path changes in range:\n${unexpectedProtected.join("\n")}`,
      );
    } else {
      passed.push(
        `protected path scope (${options.base}...${options.head}; ${changed.length} changed files)`,
      );
    }
  } else {
    skipped.push(
      "protected path scope — SKIPPED (supply --base and --head to enable)",
    );
  }

  for (const item of passed) console.log(`PASS: ${item}`);
  for (const item of skipped) console.log(`SKIP: ${item}`);
  if (failures.length > 0) {
    console.error("REPO HYGIENE FAILED");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("REPO HYGIENE PASSED");
}

function headingExists(markdown, anchor) {
  const normalized = anchor.toLocaleLowerCase();
  return markdown.split("\n").some((line) => {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (!heading) return false;
    const slug = heading[1]
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    return slug === normalized;
  });
}

try {
  main();
} catch (error) {
  console.error(
    `REPO HYGIENE FAILED: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}
