# Phase C2–D1 verification correction

## Status

This document corrects the verification governance record for Phase C2–D1. It
does not recreate or rewrite the accepted implementation.

| Item | Value |
| --- | --- |
| Independently confirmed branch | `feat/mob-inventory-recipe-redesign` |
| Independently confirmed HEAD at correction start | `a8119ef56853b138cc2d9546d48dd7209fc477c8` |
| Final worktree at correction start | Clean; local and origin heads matched |
| Corrective phase | C2–D1R Verification Hardening and Owner-Test Readiness |

## Original dirty-worktree preflight nonconformance

The original C2–D1 prompt required a stop when unexpected local changes
existed. Implementation continued from a dirty worktree that already contained
substantial in-progress C2–D1 changes above starting HEAD
`72f44bea4ced947bc5cff6a74dcccd2b34712c37`.

### Architect waiver and rationale

The resulting code remains accepted because:

* the final branch was clean after commit;
* local and remote heads matched;
* all changed files were committed;
* the complete implementation was independently inspected;
* typecheck, lint, umbrella validation, migrations, integrity checks, and
  transaction checks passed; and
* protected application identity and AAB were independently confirmed
  unchanged.

### Explicit non-claim

This record does **not** claim that the original C2–D1 implementation began
from a clean worktree.

Distinction:

* Code validity: accepted with known product limitations.
* Process compliance: original dirty-worktree preflight was a governance
  nonconformance and is recorded here.

## Checks independently confirmed for accepted C2–D1

Independently confirmed classes of evidence included:

* TypeScript typecheck
* ESLint
* inventory-redesign umbrella suite
* migration fresh/upgrade/interrupted recovery for additive schema through 016
* foreign-key and integrity checks
* SQLite transaction checks for Paninda lifecycle, recipe-first, and Apple
  Cider chain acceptance
* domain conversion-chain checks
* protected package / Expo project / version / versionCode inspection
* protected AAB SHA-256 and size inspection

## Checks previously asserted without dedicated executable umbrella steps

The following were previously treated as verified in narrative form, but were
not first-class executable umbrella categories:

* repository hygiene (`git diff --check`, final newlines, trailing whitespace,
  JSON parse, documentation link resolution, protected-path scope)
* protected-artifact verification as an npm-registered check with explicit
  pass/fail/skip semantics
* reusable phase-preflight guard that fails closed on dirty worktrees
* rendered Paninda action-sheet behavior distinct from source-text matching
* rendered ingredient-library picker behavior distinct from source-text matching
* Step 2 / Step 3 resolved identity presentation as a pure behavioral model

Phase C2–D1R adds executable coverage for those gaps and categorizes umbrella
output so skipped protected-AAB verification cannot appear as passed.

## Approved design deviations

See [phase-c2-d1-design-decisions.md](./phase-c2-d1-design-decisions.md):

1. Migration `016_recipe_usability` validated JSON conversion snapshots
2. Two sequential destructive confirmations instead of exact-name typing
3. `ingredient_lots.entered_quantity` / `entered_unit` original evidence

## Remaining physical-device requirement

No owner Expo Go physical-device test has been completed for the hardened
corrective head. Manual scenarios remain in
[phase-c2-d1-manual-test.md](./phase-c2-d1-manual-test.md).

## Related documents

* [phase-c2-d1-manual-test.md](./phase-c2-d1-manual-test.md)
* [phase-c2-d1-design-decisions.md](./phase-c2-d1-design-decisions.md)
* [phase-b-verification.md](./phase-b-verification.md)
* [phase-c1-recipe-first-manual-test.md](./phase-c1-recipe-first-manual-test.md)
