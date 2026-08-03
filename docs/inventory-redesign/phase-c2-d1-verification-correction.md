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
* Paninda action-sheet behavior distinct from source-text matching
* ingredient-library picker behavior distinct from source-text matching
* Step 2 / Step 3 resolved identity presentation as a pure behavioral model

Phase C2–D1R adds executable coverage for those gaps and categorizes umbrella
output so skipped protected-AAB verification cannot appear as passed.

## Follow-up correction — rendered-structure evidence

An independent pass after C2–D1R found that the action-sheet and picker suites
exercise extracted view models, not host-rendered components, and that the
umbrella category "UI behavioral checks" therefore overstated them. React Native
components cannot be host-rendered in this repository: `react-test-renderer`,
`react-native-web`, and `jsdom` are absent, and dependency additions are gated.

Two corrections were applied without changing product behavior:

1. The umbrella category was renamed to `View-model behavioral checks`, and a
   separate `Rendered structure conformance` category was added.
2. `scripts/check-paninda-action-sheet-structure.js` asserts the **real JSX** of
   `ProductActionSheet` in `app/owner/inventory.tsx` through the TypeScript
   compiler API — true AST parent, child, and sibling relationships rather than
   source-text matching. It proves the Modal roots the sheet with Android Back
   wired, the scrim closes it, bounded height and bottom inset are bound to
   `buildPanindaActionSheetLayout`, exactly one `ScrollView` holds the actions,
   the fixed header and close action are preceding siblings never nested inside
   that `ScrollView`, and the action list is produced from
   `buildPanindaActionDescriptors`. It additionally pins the test-only
   `buildPanindaActionSheetTree` model to the same invariants so the model
   cannot drift away from the component it describes.

The guard was mutation-tested. Unbinding `maxHeight` from the layout model,
removing `onRequestClose`, and moving the fixed header inside the action
`ScrollView` each fail it, while the pre-existing view-model suite passes on all
three — which is the coverage gap this correction closes.

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
