# Inventory Redesign Acceptance Criteria

## Document status

- Milestone: Phase A architecture and validation planning
- Status: Planned; not executed
- Scope: Inventory, Paluto, Grocery, Paninda, and Kiosk redesign
- Protected baseline: application commit `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4`
- MOB-0/MOB-1 documentation closeout: `4e784579dfafa65193e734760e9493811fa99bbb`
- Protected Android package: `ph.kitamo.app`
- Protected AAB: `KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`

This document defines future acceptance gates. It does not claim that the
redesign exists or that any planned check has passed.

## Verification labels

| Label | Meaning |
| --- | --- |
| Existing automated | A repository command exists today and must remain green. |
| Planned automated | A deterministic repository check must be implemented in an approved later phase. |
| Planned integration | A temporary-SQLite or failure-injection check must be implemented in an approved later phase. |
| Planned manual | A human must execute the linked scenario on the implemented application. |
| Inspection | A source, Git, configuration, or artifact-integrity review is required. |

All planned automated and integration checks must:

- use deterministic identifiers, dates, and non-sensitive fixtures;
- avoid the real `kitamo_local.db`;
- require no network access;
- delete temporary databases on success and failure;
- use tolerance-aware comparisons for legacy `REAL` money and quantity values;
- fail with a readable assertion rather than printing private application data;
- leave the protected AAB and repository identity untouched.

## Baseline validation gates

| ID | Criterion | Verification |
| --- | --- | --- |
| INV-AC-BASE-001 | `npm run typecheck` exits successfully. | Existing automated |
| INV-AC-BASE-002 | `npm run lint` exits successfully. | Existing automated |
| INV-AC-BASE-003 | Existing owner-context and owner-PIN security checks remain green. | Existing automated |
| INV-AC-BASE-004 | Existing pricing, recipe-costing, production-math, COGS, fixed-cost, pilot, migration, and problem-report checks remain green without weakened assertions. | Existing automated |
| INV-AC-BASE-005 | `git diff --check` reports no whitespace error and all changed text files have one final newline. | Inspection |
| INV-AC-BASE-006 | Every phase's diff contains only files authorized for that phase. | Inspection |

## Recipe graph

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-GRAPH-001 | A recipe containing only purchased/raw inputs resolves to the configured quantities and units without inventing a conversion. | Planned automated |
| INV-AC-GRAPH-002 | A one-level prepared ingredient expands the exact child version pinned when the parent was published and aggregates its raw requirements. | Planned automated |
| INV-AC-GRAPH-003 | A multi-level graph such as Raw Rice → Cooked Rice → Sushi Rice → Musubi expands in preparation order. | Planned automated and planned manual |
| INV-AC-GRAPH-004 | The same raw ingredient used in multiple branches is aggregated exactly once by stable item identity and compatible unit, while branch contributions remain explainable. | Planned automated |
| INV-AC-GRAPH-005 | Adding a direct self-reference fails by stable Recipe/output identity before persistence, including a new version that references an older version of itself, and reports the readable dependency path. | Planned automated |
| INV-AC-GRAPH-006 | An indirect path that returns to the same stable Recipe/output identity fails even when it reaches a different pinned version, and reports the full path that closes the cycle. | Planned automated |
| INV-AC-GRAPH-007 | An archived dependency remains readable by historical versions but cannot be newly selected unless explicitly restored or replaced. | Planned automated and planned manual |
| INV-AC-GRAPH-008 | Planning selects the requested or effective recipe version deterministically; it never silently switches historical versions. | Planned automated |
| INV-AC-GRAPH-009 | Graph traversal respects documented depth, node, and edge limits and returns a friendly bounded-limit error rather than hanging or overflowing the stack. | Planned automated |
| INV-AC-GRAPH-010 | Ingredient roles are descriptive only and do not change quantity or costing results. | Planned automated |

Planned primary check: `scripts/check-recipe-graph.js`.

## Drafts and nested creation

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-DRAFT-001 | An unfinished recipe can be saved with missing optional price or classification details. | Planned automated and planned manual |
| INV-AC-DRAFT-002 | A persisted draft is restored after database reopen and application restart with the same stable ID and entered data. | Planned integration and planned manual |
| INV-AC-DRAFT-003 | Nested ingredient/base creation preserves the parent draft and returns with the new child selected. | Planned automated and planned manual |
| INV-AC-DRAFT-004 | A missing purchase cost does not block ingredient or recipe draft save and is represented as unknown, not fabricated as zero. | Planned automated and planned manual |
| INV-AC-DRAFT-005 | An incomplete ingredient requirement remains visibly unfinished and cannot be treated as production-ready. | Planned automated and planned manual |
| INV-AC-DRAFT-006 | Native or owner-reviewed draft, incomplete, non-sellable, or not-ready-for-sale items are excluded from Kiosk queries; this does not silently change unreviewed legacy visibility. | Planned integration and planned manual |
| INV-AC-DRAFT-007 | Automatic draft preservation is idempotent and does not create a new draft row for each save or navigation event. | Planned integration |
| INV-AC-DRAFT-008 | Back, cancellation, and interruption never discard entered data without a clear confirmation or persisted recovery path. | Planned manual |

Planned primary check: `scripts/check-recipe-drafts.js`.

## Production planning and execution

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-PLAN-001 | Planning 30 finished products uses the selected recipe version and configured yields to calculate every required stage. | Planned automated and planned manual |
| INV-AC-PLAN-002 | The planner expands all reachable sub-recipes in dependency order and keeps prepared versus purchased requirements distinguishable. | Planned automated |
| INV-AC-PLAN-003 | Available prepared stock reduces the quantity still needing preparation without reducing the raw-input requirement twice. | Planned automated |
| INV-AC-PLAN-004 | Choosing “prepare everything fresh” ignores prepared stock for planning without mutating that stock. | Planned automated and planned manual |
| INV-AC-PLAN-005 | Creating, recalculating, saving, loading, or cancelling a plan changes no lots, stock, movements, production batches, or COGS. | Planned integration |
| INV-AC-PLAN-006 | Expected output and actual batch output are stored separately; actual output never rewrites the recipe yield. | Planned integration |
| INV-AC-PLAN-007 | A lower-than-expected intermediate output recalculates downstream availability and warns of target shortfall. | Planned automated and planned manual |
| INV-AC-PLAN-008 | The owner can reduce the final target after a shortfall, and the revised plan remains traceable to the original recipe versions and actual intermediate batches. | Planned integration and planned manual |
| INV-AC-PLAN-009 | A saved plan restores target, stages, stock-use choice, lot recommendations, missing-cost state, and version references after database reopen. | Planned integration and planned manual |
| INV-AC-PLAN-010 | Successful production records actual consumed quantities, actual output, exact lot contributions, output stock, movements, batch cost, and variance in one transaction. | Planned integration |
| INV-AC-PLAN-011 | Historical production cost and usage snapshots remain unchanged after recipe, item, or lot edits. | Planned integration |

Planned checks:

- `scripts/check-production-planner.js`
- `scripts/check-inventory-redesign-transactions.js`

## Lots, units, and costing

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-LOT-001 | Existing legacy selected-lot references remain selected and retain their cost snapshots after migration. | Planned integration |
| INV-AC-LOT-002 | New automatic allocation uses FEFO when valid expiry dates are available under the approved policy. | Planned automated |
| INV-AC-LOT-003 | New automatic allocation uses FIFO when FEFO does not apply, with deterministic tie-breaking. | Planned automated |
| INV-AC-LOT-004 | Explicit manual lot allocation overrides automatic recommendation only for authorized owner workflows and records that it was manual. | Planned automated and planned manual |
| INV-AC-LOT-005 | One requirement can split across two or more lots without overconsuming any lot. | Planned automated and planned integration |
| INV-AC-LOT-006 | Batch cost equals the sum of exact quantity × historical cost from every allocated lot, within the documented legacy `REAL` tolerance. | Planned automated |
| INV-AC-LOT-007 | Insufficient lot quantity blocks production before any write and reports required versus available quantities. | Planned automated and planned integration |
| INV-AC-LOT-008 | A later purchase at a different price does not change an earlier lot, production batch, SaleItem COGS, or historical report. | Planned integration |
| INV-AC-LOT-009 | Same-unit, `g`↔`kg`, and `ml`↔`L` compatibility remain correct; volume-to-weight, pack sizing, or ingredient-specific conversions occur only when explicitly configured. | Existing and planned automated |
| INV-AC-LOT-010 | Ingredient-specific conversions are visible, editable for future use, and historically snapshotted where used. | Planned integration and planned manual |
| INV-AC-LOT-011 | No new calculation rounds intermediate quantities or costs prematurely. Final display/accounting rounding follows one documented rule. | Planned automated and inspection |
| INV-AC-LOT-012 | An unknown native Ingredient-lot cost persists as `NULL` authoritative shadow values with explicit unknown state; the required legacy-column sentinel is never displayed, costed, or reported as a known zero. | Planned integration |

Planned primary check: `scripts/check-lot-allocation.js`.

## Recipe versions and duplication

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-VERSION-001 | Editing a historically used recipe creates a new effective version or immutable equivalent rather than rewriting the used version. | Planned integration |
| INV-AC-VERSION-002 | Existing production remains linked to the historical recipe version and keeps its original usage and cost snapshots. | Planned integration |
| INV-AC-VERSION-003 | Existing SaleItem COGS and historical reports remain unchanged after a new recipe version becomes active. | Planned integration |
| INV-AC-VERSION-004 | Duplicate creates independent stable IDs and copies ingredients, quantities, units, classification, yield, roles, and supply rules without linking future edits. | Planned automated and planned manual |
| INV-AC-VERSION-005 | Rename, category, price, sellability, and Kiosk-status edits do not reinterpret historical production or sales. | Planned integration |

Planned primary check: `scripts/check-recipe-versioning.js`.

## Grocery and missing-price behavior

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-GROCERY-001 | Direct recipe shopping lists only the selected version's direct requirements. | Planned automated and planned manual |
| INV-AC-GROCERY-002 | Complete-tree shopping expands prepared bases to purchased/raw leaves without mutating inventory. | Planned automated and planned manual |
| INV-AC-GROCERY-003 | Selected-stage shopping limits requirements to the chosen intermediate preparation. | Planned automated and planned manual |
| INV-AC-GROCERY-004 | Repeated purchased ingredients are aggregated, with per-branch contributions and total shown. | Planned automated |
| INV-AC-GROCERY-005 | Results distinguish already in stock, need to buy, not enough stock, no purchase price, no supplier, and incomplete cost. | Planned automated and planned manual |
| INV-AC-GROCERY-006 | Receipt and supplier details remain optional; omitting them does not block a valid purchase or item definition. | Planned integration and planned manual |
| INV-AC-GROCERY-007 | Missing purchase cost does not block item/recipe save; missing selling price blocks ready-for-sale/Kiosk status but not recipe or production. | Planned automated and planned manual |
| INV-AC-GROCERY-008 | Missing-price groups include ingredients, resale products, supplies, finished products, recipes, and production plans under the correct price owner. | Planned automated and planned manual |
| INV-AC-GROCERY-009 | Missing information produces a warning or unknown state and never fabricates price, supplier, receipt, stock, or cost data. | Planned automated |

Planned primary check: `scripts/check-grocery-requirements.js`.

## Supplies and Kiosk order review

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-SUPPLY-001 | Per-product rules calculate exact suggestions for each applicable cart line. | Planned automated |
| INV-AC-SUPPLY-002 | Per-quantity rules apply their documented rounding rule, including boundary and remainder quantities. | Planned automated |
| INV-AC-SUPPLY-003 | Per-order rules are applied once per checkout, not once per product. | Planned automated |
| INV-AC-SUPPLY-004 | Optional and default-editable supplies can be removed or changed during review. | Planned automated and planned manual |
| INV-AC-SUPPLY-005 | Required packaging cannot be silently removed or reduced below its required quantity. | Planned automated and planned manual |
| INV-AC-SUPPLY-006 | A tracked-supply shortage is shown before confirmation and follows the approved block/warning policy without inventing stock. | Planned automated and planned manual |
| INV-AC-SUPPLY-007 | Confirmed tracked-supply quantities are deducted exactly once and record exact order usage. | Planned integration |
| INV-AC-SUPPLY-008 | Retrying or double-tapping the same checkout token does not duplicate supply usage, supply movement, product/lot deduction, Sale, receipt, or queue row. | Planned integration and planned manual |
| INV-AC-SUPPLY-009 | Product COGS, packaging cost, utensil/condiment cost, and total order cost remain separately queryable and visibly distinguishable. | Planned integration and planned manual |
| INV-AC-SUPPLY-010 | Non-customer-facing supplies do not appear as ordinary Kiosk products or recipe output. | Planned integration and planned manual |
| INV-AC-SUPPLY-011 | Seller mode cannot reach owner-only supply administration or manual lot manipulation through normal navigation. | Planned automated boundary check and planned manual |

Planned checks:

- `scripts/check-supply-rules.js`
- `scripts/check-kiosk-supply-checkout.js`
- `scripts/check-profit-report-cost-categories.js`

## Stock adjustments and mark-empty

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-ADJUST-001 | Personal/household use creates a classified adjustment and movement but does not enter product COGS. | Planned integration |
| INV-AC-ADJUST-002 | Spoilage/damage creates the approved inventory-loss classification and preserves cost evidence. | Planned integration |
| INV-AC-ADJUST-003 | Counting correction records expected, counted, difference, reason, and movement without deleting or rewriting history. | Planned integration |
| INV-AC-ADJUST-004 | Promotion/free sample, unknown loss, returned-to-supplier, expired, damaged, and other reasons remain distinguishable. | Planned automated and planned manual |
| INV-AC-ADJUST-005 | Marking one lot empty shows the prior remaining quantity, requires a reason and owner authorization, sets the lot to zero through domain logic, and appends a movement. | Planned integration and planned manual |
| INV-AC-ADJUST-006 | Marking total stock empty allocates the adjustment across affected stock records under the approved rule and preserves each movement. | Planned integration and planned manual |
| INV-AC-ADJUST-007 | Movement history retains the item/lot, quantity, unit, cost, reason, classification, timestamp, and applicable owner context. | Planned integration |
| INV-AC-ADJUST-008 | A failed adjustment or mark-empty operation leaves stock and movement history unchanged. | Planned integration |

Planned primary check: `scripts/check-stock-adjustments.js`.

## Archive and permanent delete

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-LIFE-001 | An unused draft with no references, lots, purchases, production, sales, movements, bundle membership, or supply rule can be permanently deleted. | Planned integration |
| INV-AC-LIFE-002 | An item with any protected usage or reference cannot be permanently deleted; eligibility fails closed if the check is uncertain. | Planned integration |
| INV-AC-LIFE-003 | A used item can be archived without changing its stable ID or historical snapshots. | Planned integration and planned manual |
| INV-AC-LIFE-004 | Archived items remain readable from historical sales, production, COGS, reports, stock history, versions, and audit records. | Planned integration and planned manual |
| INV-AC-LIFE-005 | Archived items are excluded from normal creation selectors and Kiosk availability unless an explicit archived-history view is opened. | Planned integration and planned manual |
| INV-AC-LIFE-006 | Permanent delete and archive actions require the approved owner boundary and are not available from seller-mode routes. | Planned automated boundary check and planned manual |

Planned primary check: `scripts/check-item-lifecycle.js`.

## Atomicity, rollback, and idempotency

Each planned integration test must take a before-state snapshot, inject a
failure after every material write boundary, and compare the post-failure
state to that exact snapshot.

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-TXN-001 | Production input deductions, output creation, usage/movement history, batch cost, and batch completion commit together or all roll back. | Planned integration |
| INV-AC-TXN-002 | Checkout Sale, SaleItems, product/lot/supply deductions, all movements/usages, COGS categories, receipt, queue row, and checkout-token completion commit together or all roll back. | Planned integration |
| INV-AC-TXN-003 | A checkout retry with the same non-null token returns the committed sale and creates no second effect. | Planned integration |
| INV-AC-TXN-004 | Concurrent or rapid duplicate confirmation still produces one committed checkout. | Planned integration and planned manual |
| INV-AC-TXN-005 | Stock adjustment and mark-empty update stock and append their movement together or all roll back. | Planned integration |
| INV-AC-TXN-006 | Saving a recipe version and all of its immutable lines/dependencies commits together or all rolls back. | Planned integration |
| INV-AC-TXN-007 | Saving a production plan and all stages/version references commits together or all rolls back without inventory effects. | Planned integration |
| INV-AC-TXN-008 | Guarded product, ingredient-lot, and supply updates verify affected-row counts before related history is inserted. | Planned integration and inspection |
| INV-AC-TXN-009 | No protected transaction performs graph expansion, list rendering, network access, or other unbounded work inside its write transaction. | Inspection and performance check |

Planned primary check: `scripts/check-inventory-redesign-transactions.js`.

## Migration and compatibility

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-MIG-001 | A fresh temporary database applies all migrations in order and exposes the complete new schema. | Planned integration |
| INV-AC-MIG-002 | A populated exact schema-v10 fixture upgrades without changing existing IDs, lot quantities/costs, recipe snapshots, production history, sales, COGS, bundles, fixed costs, reports, or problem reports. | Planned integration |
| INV-AC-MIG-003 | Ambiguous legacy records are marked for review or retain an explicit unknown classification; migration does not guess. | Planned integration |
| INV-AC-MIG-004 | Running the migration runner again applies zero migrations and leaves schema/data unchanged. | Existing and planned integration |
| INV-AC-MIG-005 | A forced failure during each new migration leaves neither its schema/data changes nor its migration-ledger row partially committed. | Planned integration |
| INV-AC-MIG-006 | `PRAGMA integrity_check` returns `ok` after fresh install and upgrade. | Planned integration |
| INV-AC-MIG-007 | `PRAGMA foreign_key_check` returns zero rows after fresh install and upgrade. | Planned integration |
| INV-AC-MIG-008 | The migration index, migration check inventory, schema version, resettable table list, and countable table list agree. | Planned automated |
| INV-AC-MIG-009 | Upgrade and fresh-install databases produce equivalent behavior for newly created records. | Planned integration and planned manual |
| INV-AC-MIG-010 | Migration and application startup require no Internet access. | Planned integration and planned manual |
| INV-AC-MIG-011 | No migration renames or reinterprets a legacy field without a documented compatibility mapping and rollback. | Inspection |
| INV-AC-MIG-012 | Unreviewed `legacy_unclassified` Products retain the exact pre-upgrade business/branch-shared Kiosk visibility predicate until owner review; native/reviewed readiness rules do not hide them silently. | Planned integration and planned manual |

Planned primary check: `scripts/check-inventory-redesign-migrations.js`.

## Performance and query budgets

Blocking budgets favor deterministic operation and query counts over
machine-dependent timing.

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-PERF-001 | Each recipe-version node and dependency edge is processed at most once per graph expansion key; aggregation remains `O(V + E)`. | Planned automated |
| INV-AC-PERF-002 | One production or complete-tree Grocery snapshot uses at most six SQLite read calls before pure graph expansion, independent of graph node count. | Planned automated with instrumented repository |
| INV-AC-PERF-003 | Changing only target quantity after a plan snapshot performs zero additional SQLite reads until that snapshot is invalidated. | Planned automated |
| INV-AC-PERF-004 | Recipe Book and classification lists fetch at most 50 summary rows per page, execute at most five SQLite reads per initial page, and never expand every recipe graph for list cards. | Planned automated and inspection |
| INV-AC-PERF-005 | Kiosk supply preparation adds at most four pre-transaction SQLite reads regardless of cart-line count and performs no per-line supply query. | Planned automated with instrumented repository |
| INV-AC-PERF-006 | Lot selectors are bounded/paginated and use indexed business, ingredient, status, expiry, and purchase-order fields where applicable. | Query-plan inspection |
| INV-AC-PERF-007 | Draft autosave coalesces a burst of edits and does not open one SQLite write transaction per keystroke. | Planned automated and planned manual |
| INV-AC-PERF-008 | Synthetic traversal at the documented node/edge/depth caps completes without recursion overflow, infinite loop, or duplicate aggregation. | Planned automated |
| INV-AC-PERF-009 | `EXPLAIN QUERY PLAN` shows indexed access for active recipe-version lookup, dependencies, drafts, lots, supply rules, and order-supply usage; unexpected full scans require documented review. | Query-plan inspection |
| INV-AC-PERF-010 | On the designated low-end Android test device, representative Recipe Book, complete-tree planning, and order review show no visible UI freeze longer than one second and remain responsive to Back/cancel. | Planned manual |
| INV-AC-PERF-011 | No redesign path adds polling, background network work, heavy animation, unbounded images, or a new large dependency. | Inspection |

Planned primary check: `scripts/check-inventory-redesign-performance.js`.

## Legacy regression and protected boundaries

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-REG-001 | Legacy bundle pricing and mixed-cart arithmetic remain unchanged. | Existing automated and planned manual |
| INV-AC-REG-002 | Existing checkout validation, payment-reference behavior, stock protection, receipt, queue, and checkout-token idempotency remain intact. | Existing partial plus planned integration/manual |
| INV-AC-REG-003 | Existing selected-lot recipe costing, makeability, unit conversion, and incompatible-unit rejection remain intact. | Existing automated |
| INV-AC-REG-004 | Existing production arithmetic and protected transaction outcomes remain intact for non-nested recipes. | Existing partial plus planned integration/manual |
| INV-AC-REG-005 | Existing cook-upon-order actual/estimated COGS and shortfall behavior remain intact unless separately approved. | Existing automated plus planned integration/manual |
| INV-AC-REG-006 | Existing transfers, finished-product spoilage, inventory movements, and stock alerts remain intact. | Planned integration and planned manual |
| INV-AC-REG-007 | Fixed-cost recurrence and profit formulas remain unchanged. | Existing automated plus planned report integration |
| INV-AC-REG-008 | Historical report formulas continue to distinguish revenue, sold COGS, fixed costs, spoilage, production value, unsold value, transfers, and new supply categories as designed. | Planned integration and planned manual |
| INV-AC-REG-009 | The existing pilot arithmetic scenario remains green and a database-backed redesign pilot scenario is added. | Existing and planned automated |
| INV-AC-REG-010 | Problem-report persistence, duplicate protection, and sensitive-text redaction remain green. | Existing automated |
| INV-AC-REG-011 | Owner PIN throttling, protected actions, business/stall context, and normal owner/Kiosk navigation boundaries remain green. | Existing automated and planned manual |
| INV-AC-REG-012 | Kiosk remains focused on selling and review; Home and core Kiosk navigation are not broadly redesigned. | Inspection and planned manual |
| INV-AC-REG-013 | Offline-first operation, restart persistence, and no-Internet use remain functional for all redesign workflows. | Planned integration and planned manual |

Planned umbrella check: `scripts/check-inventory-redesign.js`.

## Protected identity, release, and repository gates

| ID | Acceptance criterion | Verification |
| --- | --- | --- |
| INV-AC-PROTECT-001 | Android package remains exactly `ph.kitamo.app`. | Inspection |
| INV-AC-PROTECT-002 | Expo owner, slug, and EAS project ID remain unchanged. | Inspection |
| INV-AC-PROTECT-003 | Version remains `1.0.0` and versionCode remains `2` until a separately authorized release task. | Inspection |
| INV-AC-PROTECT-004 | Signing configuration and credentials are neither regenerated nor changed. | Inspection |
| INV-AC-PROTECT-005 | The protected AAB path, byte size, modification timestamp, and SHA-256 match the recorded baseline evidence. | Inspection |
| INV-AC-PROTECT-006 | No AAB, APK, prebuild, Gradle release, EAS build, upload, or Play Console action is performed in Phases A–F without separate authorization. | Inspection |
| INV-AC-PROTECT-007 | No Clerk, Supabase, Platform API, cloud configuration, Internet permission, or offline-first policy change is introduced. | Inspection |
| INV-AC-PROTECT-008 | Git history is extended normally; no new repository is initialized and no protected baseline artifact/history is rewritten. | Inspection |

## Phase exit gates

### Phase B

- All schema/domain/repository checks in this document are implemented for the
  Phase B scope.
- Fresh and populated-upgrade migration checks pass.
- Transaction rollback checks cover every new Phase B mutation.
- Existing checks remain green.
- Phase B manual persistence and boundary scenarios pass.
- No Phase C–F UI behavior is claimed complete.

### Phase C

- Paluto creation, autosave, nested return, edit, duplicate, archive/delete,
  classifications, optional prices, and Kiosk-exclusion checks pass.
- Required Phase C manual scenarios pass on a physical Android device.
- Home and core Kiosk remain unchanged except approved links/labels.

### Phase D

- Grocery direct/tree shopping, missing-price grouping, planning, actual yield,
  saved plans, preparation order, and lot-selection checks pass.
- Planning remains write-free; production remains atomic.
- Required Phase D manual scenarios pass.

### Phase E

- Supply rules, order editing, availability, checkout atomicity, cost categories,
  and retry idempotency checks pass.
- Existing pricing, checkout, COGS, reports, PIN, and Kiosk workflows regressions
  pass.
- Required Phase E manual scenarios pass.

### Phase F

- All existing and redesign automated checks pass from a clean checkout.
- Fresh-install and populated-upgrade simulations pass integrity checks.
- Query budgets and low-end-device performance criteria pass.
- The full manual checklist passes offline, including restart/interruption.
- Documentation and risk dispositions are current.
- Protected identity, signing, version, and AAB checks pass.
- No new AAB is built or uploaded without separate authorization.

## Manual traceability

The planned manual evidence for these criteria is defined in
[manual-test-scenarios.md](manual-test-scenarios.md). A future execution record
must record the app commit, schema version, device model, Android version, date,
tester, scenario IDs, results, and evidence links without rewriting this
planning document.
