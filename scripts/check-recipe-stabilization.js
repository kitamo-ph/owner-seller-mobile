const { execFileSync } = require("node:child_process");
const path = require("node:path");

const workspace = process.cwd();
const node = process.execPath;

function run(relativeScript, label) {
  console.log(`\n--- ${label} ---`);
  execFileSync(node, [path.join(workspace, relativeScript)], {
    cwd: workspace,
    encoding: "utf8",
    stdio: "inherit",
  });
}

run(
  "scripts/check-recipe-stabilization-behavior.js",
  "Behavioral arithmetic",
);
run(
  "scripts/check-recipe-stabilization-source-contracts.js",
  "Source-contract guards",
);

console.log(
  "\nRECIPE STABILIZATION SUITE PASSED (behavior + source-contract guards; UI render coverage reported separately)",
);
