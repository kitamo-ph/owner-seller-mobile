# Inventory redesign Phase B verification

## Verification decision

Phase B is complete as an additive domain-and-persistence foundation and must
pause here. The schema, pure domain rules, repositories, services, and
automated migration/transaction harnesses are present and passing. The new
owner and Kiosk experiences are not implemented, and the Phase B runtime
feature gates remain disabled.

This evidence does not authorize native catalog creation, legacy
classification review, Product-lot activation, manual stock controls,
production execution, supply deduction at checkout, or any Phase C–E route.

## Repository evidence

Evidence was captured on 2026-07-26 in the authoritative local repository.

| Check | Verified value |
| --- | --- |
| Working directory | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Git root | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Remote | `origin https://github.com/kitamo-ph/owner-seller-mobile.git` for fetch and push |
| Branch | `feat/mob-inventory-recipe-redesign` |
| Phase A baseline | `044a14f9a5ab5ddab13139ad4acf036fd1631088` |
| Phase B implementation HEAD before this document | `02a9b6662add70eb9fa0846c61fbdc111c582f98` |

Phase B was separated into focused commits:

| Commit | Purpose |
| --- | --- |
| `c3e9ad707476e8aee4c71b3d42b59b93830266a0` | `feat(mobile): add inventory redesign schema` |
| `58e898b82e97075de6a671d973e9ed623e1f949f` | `feat(mobile): model inventory planning domains` |
| `0b5ca5923f6d081bdd17b46dafab67eeebce0356` | `feat(mobile): add inventory persistence foundations` |
| `02a9b6662add70eb9fa0846c61fbdc111c582f98` | `test(mobile): verify inventory redesign foundations` |

The Phase A-to-Phase B diff contains migrations, schema declarations, domain
modules, repositories, services, validation scripts, and additive package
scripts only. It contains no application route, screen, component, Kiosk
state, environment, cloud, signing, EAS, or release-artifact change.

## Migration verification

Migrations `001` through `010` remain byte-for-byte unchanged from the Phase A
baseline. The migration index appends exactly `011` through `014` and exports
schema version `14`.

### `011_catalog_identity`

Implemented:

- `catalog_items`, `legacy_item_bindings`, and `item_unit_conversions`;
- deterministic one-to-one Product and Ingredient catalog backfills;
- exact legacy entity bindings with uniqueness constraints;
- `legacy_unclassified` and review-required state without name or
  `ProductType` inference;
- separate semantic identity from the retained Product/Ingredient
  projections; and
- lifecycle, readiness, completeness, stock-policy, and Kiosk-eligibility
  metadata.

The migration changes no existing Product or Ingredient identifier and does
not merge equal names.

### `012_recipe_versions_and_drafts`

Implemented:

- immutable `recipe_versions` and `recipe_version_lines`;
- explicit `catalog_item_recipe_roles`;
- SQLite-authoritative `recipe_drafts` and `recipe_draft_lines`;
- exact child-version pointers for nested recipes;
- one active primary and one active Kiosk role constraint per output;
- compatibility pointers on the existing Recipe family; and
- current-definition import that preserves legacy selected-lot and cost
  snapshots.

The import does not assign an imported version to old production or sale
history when the effective historical definition cannot be proven. It does
not infer a primary recipe when multiple legacy Recipe families target the
same Product.

### `013_inventory_planning_and_adjustments`

Implemented:

- optional `suppliers` and `purchase_receipts`;
- nullable Ingredient-lot cost shadows, explicit cost/provenance state, and
  optional expiry/Supplier/Receipt facts;
- `product_stock_lots`, sale Product-lot usage, and production input
  allocation evidence;
- saved production plans, topological stages, requirements, and exact lot
  allocations;
- stock adjustments and exact adjustment allocations;
- expected/actual production yield and cost fields; and
- reconciliation, lookup, idempotency, and history indexes.

Legacy Product scalar stock is retained. No legacy Product-lot balance is
fabricated during migration.

### `014_supply_order_costs`

Implemented:

- versioned `supply_usage_rules`;
- production-stage versus checkout-stage separation;
- required, default-editable, suggested-optional, and requested-only
  behaviors;
- confirmed sale supply usage and exact Ingredient-lot usage;
- explicit rounding/scope contracts; and
- separately persisted packaging, utensil/condiment, other-supply, and total
  order-cost categories.

No historical SaleItem COGS is recalculated, and separately persisted order
costs are not merged into the protected profit formula.

### Reset and migration-runner scope

All 22 Phase B tables are included in the child-first reset inventory. Focused
startup counts add only `catalog_items`, `recipe_drafts`, `production_plans`,
and `stock_adjustments`. The representative reset harness retains the
migration ledger and verifies foreign-key integrity.

## Domain implementation

### Catalog, readiness, and cost state

- `catalogItems.ts` models the six approved classifications plus internal
  `legacy_unclassified`, exact projection policy, legacy compatibility, and
  explicit native readiness.
- `costState.ts` distinguishes `known`, `unknown`,
  `legacy_zero_unresolved`, and `not_applicable`.
- Native unknown cost persists a `NULL` authoritative value. Known zero is an
  explicit complete state, not a missing-price sentinel.
- Old required-zero fields and historical COGS remain unchanged.

### Stock authority, lots, and adjustments

- Ingredient lots remain the Ingredient and tracked-supply stock authority.
- Legacy Product scalar stock remains compatibility authority.
- Reviewed/native Product lots are exact evidence and the Product scalar is
  an atomic compatibility projection.
- Reconciliation reports and blocks scalar/lot drift; it does not silently
  repair it.
- Manual, FIFO, and FEFO allocation policies produce exact split
  allocations; imported `legacy_selected` evidence remains exact.
- Owner-only stock adjustments use request-token idempotency, explicit
  reasons/accounting classes, guarded balances, and exact lot allocations.
- Archive is implemented; permanent-delete eligibility is fail-closed, but
  permanent deletion itself is intentionally not exposed.

### Recipe graph, versions, and drafts

- Graph validation uses exact pinned versions, rejects direct and indirect
  cycles with paths, handles diamonds, aggregates shared leaves correctly,
  and enforces depth/node operation budgets.
- Published versions are immutable. Editing creates a new version in the same
  family; duplication creates a new family and does not copy sale readiness.
- Implicit selection requires exactly one default active recipe; alternatives
  require an explicit exact selection.
- Drafts persist stable IDs, monotonic revisions, placeholders, nested return
  state, and restart-safe child-version resolution in SQLite.

### Planning, supplies, and order costs

- Planning expands nested exact versions without mutating stock.
- Plans preserve topological stages, prepared-stock-first versus
  prepare-fresh intent, expected and actual yield, recalculation lineage,
  shortages, explicit lot choices, and incomplete-cost state.
- Production-stage packaging and checkout-stage supplies are isolated, and
  rule/usage identifiers prevent double-stage and duplicate cost
  contributions.
- Checkout supply usage and order-cost persistence exist only as future
  transactional primitives; they are not wired to production checkout.

## Persistence implementation

The new repository layer covers:

- catalog identity/readiness and exact compatibility bindings;
- item-specific unit conversions;
- immutable recipe publication, active roles, and graph reads;
- revision-guarded recipe drafts and nested return state;
- Product-lot initialization, mutation, allocation, and reconciliation;
- saved production plans/stages/requirements/allocations;
- owner-authorized stock adjustments;
- archive and fail-closed delete eligibility; and
- supply rules, confirmed usage, exact lot usage, and separate order costs.

Existing Product and Ingredient creation now adds exact catalog/binding
metadata in the same transaction while preserving its visible legacy
behavior. Transfer-created destination Products use the same catalog-aware
repository boundary instead of bypassing it with service-level SQL. A
positive Ingredient-lot purchase records known shadow-cost and provenance
metadata. Product-lot mutations require a reviewed/native exact binding and a
reconciled starting balance.

Service orchestration is present for catalog metadata, recipe publication,
production planning, stock adjustments, lifecycle decisions, and supply
rules. No new compatibility reader, persistence service, or repository is
wired to an owner or Kiosk route in this phase.

## Compatibility and protected boundaries

`src/services/inventoryRedesignFeatures.ts` keeps every Phase B activation
flag `false`, including native catalog projection creation and checkout supply
deduction.

The following boundaries remain intact:

- Android package: `ph.kitamo.app`;
- Expo owner: `kitamoandroidapp`;
- Expo slug: `kitamo-android`;
- EAS project ID: `d2ab769c-4916-4efa-ab1e-a2dfdc638607`;
- app version: `1.0.0`;
- Android `versionCode`: `2`;
- protected AAB:
  `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`;
- protected AAB size: `57,120,066` bytes; and
- protected AAB SHA-256:
  `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`.

No Expo/EAS project was created. No credentials were generated. No Android
package name, application identity, signing, cloud, environment, version,
`versionCode`, AAB, or release-history migration was performed.

Visible Kiosk Product selection and checkout behavior are unchanged. The
catalog-aware readiness predicate is tested as a domain contract but is not
wired into the Kiosk query. Native Product creation and review remain disabled
until that reader and checkout revalidation are integrated and proven.

## Automated validation evidence

The canonical command completed with exit code `0`:

```text
npm run check:inventory-redesign
```

It ran, in order:

1. `typecheck`;
2. `lint`;
3. `check:owner-context`;
4. `check:owner-pin-security`;
5. `check:pricing`;
6. `check:recipes`;
7. `check:production`;
8. `check:cogs`;
9. `check:fixedcosts`;
10. `check:pilot`;
11. `check:migrations`;
12. `check:problem-reports`;
13. `check:inventory-domain`;
14. `check:recipe-graph`;
15. `check:recipe-versioning`;
16. `check:recipe-drafts`;
17. `check:production-planner`;
18. `check:production-plan-lot-guards`;
19. `check:inventory-redesign-migrations`; and
20. `check:inventory-redesign-transactions`.

The final output was:

```text
ALL INVENTORY REDESIGN PHASE B CHECKS PASSED
```

### Baseline migration regression

Exact results:

```text
first migration run: 14 applied
second migration run: 0 applied
checkout_token column: present
problem_reports table: present
duplicate checkout token: rejected
sales with checkout_1: 1
ALL MIGRATION CHECKS PASSED
```

### Phase B migration harness

Exact results:

```text
fresh 001-014 migration and replay: passed
populated v10 preservation and deterministic import: passed
legacy zero, selected-lot, and historical-version handling: passed
binding and one-primary-recipe constraints: passed
native unknown/known-zero persistence constraints: passed
representative child-first pilot reset with migration ledger retained: passed
forced rollback and restart for 011-014: passed
integrity_check and foreign_key_check: passed
ALL INVENTORY REDESIGN MIGRATION CHECKS PASSED
```

### Phase B transaction harness

Exact results:

```text
transfer-created Product catalog binding boundary: passed
inventory redesign schema constraints: passed
Product lot and scalar authority rollback: passed
stock-adjustment transaction rollback: passed
recipe-version publication rollback: passed
checkout-supply persistence rollback: passed
integrity_check and foreign_key_check: passed
ALL INVENTORY REDESIGN TRANSACTION CHECKS PASSED
```

The focused domain checks also ended with all-pass markers for catalog/stock
authority, cost state, lot allocation, stock adjustments, supply rules/order
costs, lifecycle, recipe graph, versioning, drafts, and production planning.
They cover known zero versus unknown cost, reconciliation drift, allocation
splits and provenance, graph cycles/diamonds/bounds, immutable versions,
stale draft revisions, restart-safe nested returns, prepared-stock/fresh
planning, yield variance, stage isolation, and fail-closed lifecycle policy.

`git diff --check` passed, and a direct Phase A-baseline diff of migration
files `001` through `010` was empty.

## Unresolved risks and rollout gates

The detailed current statuses are in
[risk-register.md](risk-register.md). The most important remaining gates are:

- **Kiosk activation:** the catalog-aware Kiosk reader and native checkout
  revalidation are not wired. Native Product creation remains disabled
  (`INV-REDESIGN-003`, `INV-REDESIGN-028`).
- **Product stock writers:** production, checkout, transfers, direct edits,
  and every other legacy Product writer have not all migrated to the
  reviewed/native lot strategy (`INV-REDESIGN-004`,
  `INV-REDESIGN-016`).
- **Existing checkout guard:** the known cook-upon-order Ingredient-lot
  affected-row defect and same-token retry evidence remain outside this
  phase (`INV-REDESIGN-007`).
- **Accounting approval:** display/final rounding and report recognition of
  separate supply/order costs remain undecided
  (`INV-REDESIGN-009`, `INV-REDESIGN-014`,
  `INV-REDESIGN-024`).
- **Execution and UI:** production-stage execution, autosave navigation,
  manual lot selection, archive/delete controls, Kiosk supply review, and all
  Paluto/Grocery/Paninda UI/manual/device/accessibility evidence remain later
  work (`INV-REDESIGN-008`, `INV-REDESIGN-010`,
  `INV-REDESIGN-018` through `INV-REDESIGN-021`,
  `INV-REDESIGN-026`, `INV-REDESIGN-029`).
- **Release compatibility:** native data-bearing activation cannot precede
  an approved forward-only app rollout and downgrade policy
  (`INV-REDESIGN-025`).

No manual UI, physical-device, screen-reader, performance-device, production
checkout, build, signing, upload, or AAB verification is claimed by Phase B.

## Recommendation

**Proceed with conditions** for Phase B closeout: accept the
domain-and-persistence foundation, keep all activation flags disabled, and
pause before Phase C. The next approved phase should wire and prove only its
named surface, retain the forward-only migration policy, and re-run the
complete Phase B suite without weakening legacy checks.

Do not enable native Product creation or reviewed Product-lot behavior until
the compatibility-aware Kiosk reader, native checkout revalidation, and every
affected Product stock writer have explicit integration and failure-injection
evidence. Do not change checkout supply deduction or supply-cost report
recognition until their separately approved phases.
