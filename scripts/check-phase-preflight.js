#!/usr/bin/env node
/**
 * Deterministic, non-destructive phase preflight guard for Codex mutation phases.
 *
 * Example:
 *   node scripts/check-phase-preflight.js \
 *     --branch feat/mob-inventory-recipe-redesign \
 *     --head a8119ef56853b138cc2d9546d48dd7209fc477c8
 *
 * Optional allowlists for intentional dirty worktrees:
 *   --allow-untracked docs/tmp-notes.md
 *   --allow-modified package.json
 *
 * The script never stashes, resets, cleans, deletes, stages, commits, or pushes.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function usage() {
  return [
    "Usage: node scripts/check-phase-preflight.js [options]",
    "",
    "Options:",
    "  --branch <name>           Require exact current branch",
    "  --head <sha>              Require exact HEAD commit",
    "  --repo-root <path>        Expected git toplevel (default: cwd)",
    "  --allow-untracked <path>  Allowlisted relative untracked path (repeatable)",
    "  --allow-modified <path>   Allowlisted relative modified path (repeatable)",
    "  --require-upstream        Fail when no upstream is configured",
    "  --help                    Show this help",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    branch: null,
    head: null,
    repoRoot: null,
    allowUntracked: new Set(),
    allowModified: new Set(),
    requireUpstream: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--require-upstream") {
      options.requireUpstream = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (arg === "--branch") options.branch = value;
    else if (arg === "--head") options.head = value;
    else if (arg === "--repo-root") options.repoRoot = path.resolve(value);
    else if (arg === "--allow-untracked") options.allowUntracked.add(value);
    else if (arg === "--allow-modified") options.allowModified.add(value);
    else throw new Error(`Unknown option: ${arg}`);
    index += 1;
  }
  return options;
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message, details = []) {
  console.error(`PHASE PREFLIGHT FAILED: ${message}`);
  for (const detail of details) {
    console.error(`  - ${detail}`);
  }
  process.exitCode = 1;
}

function findNestedGitDirectories(root) {
  const nested = [];
  const skipNames = new Set([
    ".git",
    "node_modules",
    ".expo",
    "dist",
    "build",
    "coverage",
    "release-artifacts",
  ]);
  function walk(directory, depth) {
    if (depth > 6 || nested.length >= 20) return;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || skipNames.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (fs.existsSync(path.join(absolute, ".git"))) {
        nested.push(path.relative(root, absolute) || ".");
        continue;
      }
      walk(absolute, depth + 1);
    }
  }
  walk(root, 0);
  return nested;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), [usage()]);
    return;
  }

  const cwd = options.repoRoot ?? process.cwd();
  let toplevel;
  try {
    toplevel = path.resolve(git(["rev-parse", "--show-toplevel"], cwd));
  } catch {
    fail("command is not running inside a Git repository", [cwd]);
    return;
  }

  if (options.repoRoot && path.resolve(options.repoRoot) !== toplevel) {
    fail("repository root mismatch", [
      `expected ${path.resolve(options.repoRoot)}`,
      `actual ${toplevel}`,
    ]);
    return;
  }

  const branch = git(["branch", "--show-current"], toplevel);
  const head = git(["rev-parse", "HEAD"], toplevel);
  const porcelain = git(["status", "--porcelain"], toplevel);
  const changes = porcelain
    ? porcelain.split("\n").filter(Boolean)
    : [];

  const unexpected = [];
  for (const line of changes) {
    const code = line.slice(0, 2);
    const filePath = line.slice(3);
    const isUntracked = code === "??";
    const isStaged = code[0] !== " " && code[0] !== "?";
    if (isStaged) {
      unexpected.push(`staged change: ${filePath}`);
      continue;
    }
    if (isUntracked) {
      if (!options.allowUntracked.has(filePath)) {
        unexpected.push(`untracked file: ${filePath}`);
      }
      continue;
    }
    if (!options.allowModified.has(filePath)) {
      unexpected.push(`modified file: ${filePath}`);
    }
  }

  if (options.branch && branch !== options.branch) {
    fail("branch mismatch", [`expected ${options.branch}`, `actual ${branch || "(detached)"}`]);
    return;
  }
  if (options.head && head !== options.head) {
    fail("HEAD mismatch", [`expected ${options.head}`, `actual ${head}`]);
    return;
  }
  if (unexpected.length > 0) {
    fail("worktree is not clean for a mutation phase", unexpected);
    return;
  }

  const nested = findNestedGitDirectories(toplevel);
  if (nested.length > 0) {
    fail("nested Git repository detected inside the working tree", nested);
    return;
  }

  let upstream = null;
  try {
    upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], toplevel);
  } catch {
    upstream = null;
  }
  if (options.requireUpstream && !upstream) {
    fail("upstream relationship is required but not configured");
    return;
  }

  console.log("PHASE PREFLIGHT PASSED");
  console.log(`repository: ${toplevel}`);
  console.log(`branch: ${branch || "(detached)"}`);
  console.log(`head: ${head}`);
  console.log(`worktree: clean`);
  console.log(`upstream: ${upstream ?? "(none)"}`);
  console.log("nested-git: none");
}

main();
