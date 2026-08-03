const { execFileSync } = require("node:child_process");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  "typecheck",
  "lint",
  "check:owner-context",
  "check:owner-pin-security",
  "check:pricing",
  "check:recipes",
  "check:production",
  "check:cogs",
  "check:fixedcosts",
  "check:pilot",
  "check:migrations",
  "check:problem-reports",
  "check:inventory-domain",
  "check:paninda-stabilization",
  "check:paninda-lifecycle-transactions",
  "check:grocery-production-stabilization",
  "check:recipe-graph",
  "check:recipe-versioning",
  "check:recipe-drafts",
  "check:recipe-first",
  "check:recipe-conversion-chains",
  "check:apple-cider-recipe-chain",
  "check:recipe-stabilization",
  "check:recipe-first-transactions",
  "check:recipe-first-orchestration",
  "check:production-planner",
  "check:production-plan-lot-guards",
  "check:inventory-redesign-migrations",
  "check:inventory-redesign-transactions",
];

for (const check of checks) {
  console.log(`\n=== npm run ${check} ===`);
  execFileSync(npm, ["run", check], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  });
}

console.log(
  "\nALL INVENTORY REDESIGN PHASE B THROUGH PHASE C2-D1 CHECKS PASSED",
);
