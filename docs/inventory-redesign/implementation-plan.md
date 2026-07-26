# File-by-file implementation plan

## Status and sequencing

This is a Phase A plan, not implementation authorization. No file listed below has been changed for runtime behavior.

Safe sequence after explicit approvals:

1. Phase B1: add temporary-database fixtures/check harnesses and additive schema.
2. Phase B2: add domain/repository services and compatibility readers.
3. Phase B3: migrate every affected stock writer, enable reconciliation, then expose native writes.
4. Phase C: add Paluto catalog, drafts, versioning, and lifecycle UX.
5. Phase D: add Grocery shopping/missing-price and Paninda planning/execution UX.
6. Phase E: add one Kiosk order-review route and extend the existing checkout transaction.
7. Phase F: run fresh/upgrade/rollback-injection/performance/manual evidence and update handoff documentation.

The compatibility-aware Kiosk reader must land before Paluto can create a native Product projection. Product-lot writes must remain disabled until production, checkout, stock operations, transfers, direct stock editing, and reset/reconciliation paths are safe.

## Phase B: migrations and schema

### New migration files

| File | Planned responsibility |
| --- | --- |
| `src/db/migrations/011_catalog_identity.ts` | `catalog_items`, `legacy_item_bindings`, item-unit conversions, exact indexes, and legacy review state |
| `src/db/migrations/012_recipe_versions_and_drafts.ts` | Immutable recipe versions/lines, explicit catalog-item recipe roles, recipe drafts/lines, graph references, imported current-definition versions, and active compatibility pointers |
| `src/db/migrations/013_inventory_planning_and_adjustments.ts` | Optional Grocery facts, nullable Ingredient-lot cost shadows/state, Suppliers/Receipts, Product stock lots/usages, production plan/stage/requirement/allocation tables, expected/actual batch extensions, stock adjustments, and reconciliation indexes |
| `src/db/migrations/014_supply_order_costs.ts` | Supply rules, sale supply usage/allocations, separate order-cost categories, and supporting indexes |

### Existing migration/schema files

| File | Planned change |
| --- | --- |
| `src/db/migrations/index.ts` | Append 011–014 in exact order and update descriptive `schemaVersion`; never modify 001–010 |
| `src/db/schema.ts` | Add target table/type declarations used by repositories |

Each migration must leave a resumable intermediate state because the existing runner commits migrations one at a time. Details are in [migration-plan.md](migration-plan.md).

## Phase B: domain files

### New domain modules

| File | Planned responsibility |
| --- | --- |
| `src/domain/catalogItems.ts` | Six classifications, internal legacy state, lifecycle/readiness predicates, and projection rules |
| `src/domain/recipeGraph.ts` | Bounded graph load model, cycle detection, readable paths, expansion, aggregation, and operation budgets |
| `src/domain/recipeVersioning.ts` | Immutable-version validation, edit/duplicate rules, and completeness |
| `src/domain/recipeDrafts.ts` | Draft revision, unresolved requirements, and nested return state |
| `src/domain/itemUnitConversions.ts` | Built-in families plus owner-configured item-specific conversion snapshots |
| `src/domain/productionPlanner.ts` | Pure target expansion, prepared-stock-first/fresh modes, stages, and downstream recalculation |
| `src/domain/lotAllocation.ts` | Legacy-selected/manual/FEFO/FIFO recommendation, split allocation, cost contribution, and tolerance |
| `src/domain/supplyRules.ts` | Per-product/per-quantity/per-order rules, behaviors, required minima, and aggregation |
| `src/domain/stockAdjustments.ts` | Reason/accounting mapping, bounds, mark-empty allocation, and idempotency contract |
| `src/domain/itemLifecycle.ts` | Archive/readiness/delete-eligibility result types |
| `src/domain/orderCosts.ts` | Product, packaging, utensil/condiment, other-supply, and total order cost categories |

### Existing domain modules

| File | Planned change |
| --- | --- |
| `src/domain/types.ts` | Add catalog, version, draft, plan, lot, supply, adjustment, and projection types without renaming protected legacy types |
| `src/domain/recipeCosting.ts` | Preserve flat legacy calculation and delegate native graph costing; retain existing assertions |
| `src/domain/productionMath.ts` | Preserve legacy selected-lot math and share tolerance/allocation primitives |
| `src/domain/orderCogs.ts` | Preserve cook-shortfall fallback while accepting explicit native allocations and cost completeness |
| `src/domain/inventory.ts` | Add structured movement/reason contracts without changing old movement interpretation |
| `src/domain/pricing.ts` | Keep current quantity-bundle arithmetic unchanged; do not create component-combo semantics |
| `src/domain/profitMath.ts` | Accept separately supplied cost categories only after the accounting rule is approved |
| `src/domain/receipts.ts` | Optionally format reviewed supply detail without changing historical receipt values |

## Phase B: repositories

### New repositories

| File | Planned responsibility |
| --- | --- |
| `src/db/repositories/catalogItems.ts` | Focused catalog CRUD, readiness lists, and missing-price queries |
| `src/db/repositories/legacyItemBindings.ts` | Exact Product/Ingredient binding lookup and uniqueness |
| `src/db/repositories/recipeVersions.ts` | Immutable insert/read, active pointer, explicit output-item recipe roles, graph batch-load, and history |
| `src/db/repositories/recipeDrafts.ts` | Revision-guarded draft and nested-return persistence |
| `src/db/repositories/itemUnitConversions.ts` | Effective conversion versions and snapshots |
| `src/db/repositories/productStockLots.ts` | Native/reviewed Product lot creation, allocation, guarded balance, and reconciliation |
| `src/db/repositories/productionPlans.ts` | Plan/stage/requirement/allocation persistence and focused status queries |
| `src/db/repositories/suppliers.ts` | Optional business Supplier directory |
| `src/db/repositories/purchaseReceipts.ts` | Optional receipt metadata |
| `src/db/repositories/supplyRules.ts` | Effective rule batch lookup and history |
| `src/db/repositories/stockAdjustments.ts` | Immutable adjustment and allocation reads |

### Existing repositories

| File | Planned change |
| --- | --- |
| `src/db/repositories/index.ts` | Export approved repositories |
| `src/db/repositories/products.ts` | Catalog-aware native projection and guarded scalar/Product-lot dual-write helpers; preserve legacy listing |
| `src/db/repositories/ingredients.ts` | Catalog binding and supply/purchased-item projection helpers |
| `src/db/repositories/ingredientLots.ts` | Optional purchase facts, deterministic allocation candidates, and guarded updates |
| `src/db/repositories/recipes.ts` | Stable family/active-version compatibility; stop native in-place definition edits |
| `src/db/repositories/recipeIngredientLines.ts` | Read-only imported compatibility path after native versions |
| `src/db/repositories/productionBatches.ts` | Expected/actual/version/plan snapshots and native Product-lot cost lookup |
| `src/db/repositories/inventoryMovements.ts` | Structured origin/adjustment/category fields |
| `src/db/repositories/ownerAlerts.ts` | Low-stock lookup/resolution for native Product, Ingredient, and tracked-supply projections |
| `src/db/repositories/sales.ts` | Deprecate or hard-guard the divergent generic writer so it cannot bypass checkout invariants |
| `src/db/repositories/pilotDataReset.ts` | Add new tables child-first; retain all existing reset behavior |

## Phase B: services

### New services

| File | Planned responsibility |
| --- | --- |
| `src/services/catalogItems.ts` | Unified Paluto summaries, classification review, projection creation, and readiness |
| `src/services/recipeGraph.ts` | Bounded graph fetch/validation/expansion orchestration |
| `src/services/recipeDrafts.ts` | Autosave, nested child/return, resume, and discard |
| `src/services/recipeVersioning.ts` | Atomic publish/edit/duplicate/archive |
| `src/services/productionPlanner.ts` | Read-only calculate/save/recalculate/start and stage status |
| `src/services/lotAllocation.ts` | Candidate recommendation and explicit execution allocations |
| `src/services/groceryRequirements.ts` | Direct/tree/stage shopping aggregation and Missing Prices |
| `src/services/supplyRules.ts` | Owner rule administration and Kiosk suggestion batch read |
| `src/services/stockAdjustments.ts` | Owner-only atomic adjustment and mark-empty |
| `src/services/itemLifecycle.ts` | Fail-closed archive/permanent-delete reference checks |

### Existing services

| File | Planned change |
| --- | --- |
| `src/services/recipes.ts` | Preserve legacy reads while routing native create/edit to drafts/versions |
| `src/services/production.ts` | Stage execution, exact allocations, expected/actual yield, branch validation, Product-lot/scalar dual-write |
| `src/services/groceryPool.ts` | Optional cost/Supplier/Receipt/expiry and in-transaction lot adjustment; retain atomic purchase |
| `src/services/kioskSales.ts` | Catalog-aware compatibility visibility, native Product/context revalidation, checked cook-lot guards, Product/supply allocations, and token-first idempotency |
| `src/services/stockOps.ts` | Structured native adjustment path while preserving legacy cook/spoilage evidence |
| `src/services/transfers.ts` | Validate unit/classification/location and dual-write native Product lots with checked destination update |
| `src/services/profitReports.ts` | Explicit separate supply/adjustment categories after accounting approval; preserve old sold-COGS fallback |
| `src/services/localAnalytics.ts` | Catalog labels/readiness and separately categorized events |
| `src/services/ownerSetup.ts` | Focused catalog-aware setup counts without adding sequential full-table startup counts |
| `src/services/pilotData.ts` | Optional native fixture seed only after migration checks; keep existing pilot compatibility |
| `src/services/offlineQueue.ts` | Preserve the existing pending-sale contract while carrying any approved supply-cost snapshot fields |
| `src/services/shareReceipt.ts` | Share the extended receipt representation without exposing private stock detail |

## Phase C: Paluto routes and components

### Existing routes/components

- `app/owner/_layout.tsx`
- `app/owner/index.tsx`
- `app/owner/recipes.tsx`
- `app/owner/recipe-detail.tsx`
- `app/owner/inventory.tsx`
- `src/components/owner/TindahanTabs.tsx` (replace only after the new workflow tab is wired)
- `src/components/owner/RecipeMakeableCard.tsx`
- `src/components/ui/KitaMoUI.tsx`
- `src/components/gabi/GabiControls.tsx`
- `src/utils/numberInput.ts`
- `src/utils/errors.ts`

### New routes

- `app/owner/paluto-editor.tsx`
- `app/owner/paluto-drafts.tsx`
- `app/owner/paluto-archived.tsx`

### New lightweight components

- `src/components/owner/InventoryWorkflowTabs.tsx`
- `src/components/owner/PalutoItemCard.tsx`
- `src/components/owner/ItemReadinessCard.tsx`
- `src/components/owner/RecipeDependencyTree.tsx`

No recipe Zustand store is planned. SQLite is authoritative; component state only buffers current typing.

## Phase D: Grocery and Paninda routes/components

### Existing routes

- `app/owner/grocery.tsx`
- `app/owner/production.tsx`
- `app/owner/transfers.tsx`
- `app/owner/records.tsx`
- `app/owner/reports.tsx`
- `app/owner/insights.tsx`
- `app/owner/notifications.tsx`
- `app/owner/pilot-guide.tsx`

### New routes

- `app/owner/grocery-shop.tsx`
- `app/owner/grocery-missing-prices.tsx`
- `app/owner/production-plan.tsx`
- `app/owner/production-run.tsx`
- `app/owner/production-history.tsx`
- `app/owner/stock-adjustment.tsx`

### New components

- `src/components/owner/ProductionStageCard.tsx`
- `src/components/owner/RequirementGroup.tsx`
- `src/components/owner/MissingPriceCard.tsx`

## Phase E: Kiosk route/state/components

### Existing files

- `app/kiosk/_layout.tsx`
- `app/kiosk/sell.tsx`
- `app/kiosk/checkout.tsx`
- `app/kiosk/stock.tsx`
- `app/kiosk/orders.tsx`
- `src/state/kioskStore.ts`

### New files

- `app/kiosk/review-order.tsx`
- `src/components/kiosk/KioskSupplyEditor.tsx`

The grid, favorites, recents, cart quantity behavior, payment controls, receipt state, and navigation shell remain. Supply review state is tied to the checkout token and cleared with the cart.

## Validation and fixture files

### New shared fixtures/helpers

- `src/fixtures/inventoryRedesignScenarios.ts`
- `scripts/fixtures/schema-v10-upgrade.sql`
- `scripts/lib/check-helpers.js`
- `scripts/lib/sqlite-migration-harness.js`

### New Phase B checks

- `scripts/check-recipe-graph.js`
- `scripts/check-recipe-drafts.js`
- `scripts/check-production-planner.js`
- `scripts/check-lot-allocation.js`
- `scripts/check-recipe-versioning.js`
- `scripts/check-grocery-requirements.js`
- `scripts/check-supply-rules.js`
- `scripts/check-stock-adjustments.js`
- `scripts/check-item-lifecycle.js`
- `scripts/check-inventory-redesign-transactions.js`
- `scripts/check-inventory-redesign-migrations.js`

### New Phase C–F checks

- `scripts/check-paluto-workflows.js`
- `scripts/check-kiosk-supply-checkout.js`
- `scripts/check-profit-report-cost-categories.js`
- `scripts/check-owner-kiosk-inventory-boundary.js`
- `scripts/check-inventory-redesign-performance.js`
- `scripts/check-inventory-redesign-pilot.js`
- `scripts/check-inventory-redesign.js`

### Existing validation files to update

- `package.json` (add commands only after scripts exist; no dependency is planned)
- `scripts/check-migrations.js` (derive or verify the canonical migration list, enable foreign keys, add integrity checks)
- `scripts/check-pilot-scenario.js`
- `scripts/check-recipe-costing.js`
- `scripts/check-production-math.js`
- `scripts/check-order-cogs.js`
- `scripts/check-pricing.js`
- `scripts/check-fixed-costs.js`

Existing checks for owner context, PIN security, problem reports, pricing, recipes, production, COGS, fixed costs, pilot math, and migrations remain mandatory. A new check cannot replace or weaken one.

## Documentation files

The complete Phase A set:

- `docs/inventory-redesign/current-state-workflows.md`
- `docs/inventory-redesign/target-user-model.md`
- `docs/inventory-redesign/domain-compatibility-map.md`
- `docs/inventory-redesign/recipe-graph-design.md`
- `docs/inventory-redesign/recipe-versioning-design.md`
- `docs/inventory-redesign/production-planner-design.md`
- `docs/inventory-redesign/lot-and-costing-design.md`
- `docs/inventory-redesign/stock-adjustment-design.md`
- `docs/inventory-redesign/supplies-and-order-cost-design.md`
- `docs/inventory-redesign/migration-plan.md`
- `docs/inventory-redesign/transaction-impact-analysis.md`
- `docs/inventory-redesign/ux-flow-map.md`
- `docs/inventory-redesign/implementation-plan.md`
- `docs/inventory-redesign/risk-register.md`
- `docs/inventory-redesign/acceptance-criteria.md`
- `docs/inventory-redesign/manual-test-scenarios.md`

Later phases update these same documents with implemented file names, decisions, and evidence. No new AAB, identity, signing, environment, cloud, or dependency file is anticipated without separate authorization.

## Phase gates

- Phase B stops before UI workflow changes.
- Phase C stops before Grocery/Paninda UX.
- Phase D stops before Kiosk order review.
- Phase E stops before full-release claims.
- Phase F does not build/upload an AAB without separate authorization.
- Every phase reports exact diff scope, validation results, unresolved risk IDs, and a clean or explicitly described worktree.
