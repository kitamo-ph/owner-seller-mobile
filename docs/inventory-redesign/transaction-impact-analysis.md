# Inventory redesign transaction-impact analysis

## Purpose

This document identifies every current write boundary that can affect the
inventory redesign and defines the atomic boundaries required in Phase B.
It is a plan only; Phase A changes no transaction or application behavior.

The target model is additive. Existing Product scalar stock, Ingredient lots,
selected-lot recipes, sales/COGS, bundles, production, spoilage, transfers,
fixed costs, reports, receipts, and offline queue behavior remain protected.
The schema sequence is defined in
[migration-plan.md](migration-plan.md).

## Non-negotiable transaction invariants

1. `products.stock_qty` remains the Product availability authority during the
   transition.
2. `product_stock_lots` is exact evidence only for native or owner-reviewed
   Product records.
3. Once Product-lot evidence is active, scalar stock, every affected Product
   lot, and the movement/usage evidence commit together.
4. Ingredient and supply stock remains authoritative in
   `ingredient_lots`; every guarded deduction must affect exactly one row.
5. Native recipe-version lines reference catalog items or exact child
   versions, not lots. A production or sale transaction records the actual
   lot allocation.
6. Imported legacy recipe lines retain their selected-lot IDs and cost
   snapshots.
7. Production input deductions, output creation, movements/usages, actual
   cost, and stage completion are one atomic stage transaction.
8. Sale, SaleItems, Product/Ingredient/supply deductions, COGS evidence,
   receipt, queue row, and checkout-token result are one atomic checkout
   transaction.
9. Stock adjustment and mark-empty quantity changes and their audit evidence
   are one transaction.
10. A failed guarded update, constraint, validation, or write rolls back the
    complete operation. No caller converts a failed write into a partial
    success.

The detailed protected baseline is in
[repository-and-service-map.md](../mob-0-1-discovery/repository-and-service-map.md)
and
[protected-business-invariants.md](../mob-0-1-discovery/protected-business-invariants.md).

## Current write inventory

### Existing exclusive transaction entry points

The repository currently has fifteen exclusive transaction call sites when
the three owner-setup operations and the two stock-operations are counted
separately.

| Current entry point | Existing transaction responsibility | Redesign impact |
| --- | --- | --- |
| `src/db/migrations/index.ts` | One missing migration plus ledger row | Extend immutably through `014`; add upgrade/failure/resume checks |
| `src/db/repositories/pilotDataReset.ts` | Child-first hard delete of resettable tables | Add every new data table in safe order; keep migration ledger |
| `src/db/repositories/sales.ts` | Generic Sale, SaleItems, optional receipt | Diverges from live checkout; must not become a bypass for stock/supply/COGS rules |
| `src/services/groceryPool.ts` purchase | Ingredient creation when needed, lot, purchase movement | Add native catalog/binding and optional purchase facts atomically |
| `src/services/groceryPool.ts` adjustment | Ingredient-lot quantity and adjustment movement | Move balance-sensitive read into transaction or use guarded expected value; route native adjustment through structured adjustment evidence |
| `src/services/kioskSales.ts` | Live Sale, items, Product/cook deductions, usages, COGS, receipt, queue | Extend, do not split, for Product lots and supplies; fix unchecked cook-lot update |
| `src/services/ownerSetup.ts` (three operations) | Business/stall/settings setup writes | No inventory semantics; retain isolation and regression coverage |
| `src/services/pilotData.ts` | Pilot seed graph | Seed coherent compatibility/native fixtures and remain all-or-nothing |
| `src/services/production.ts` | Batch, Ingredient deductions/usages/movements, Product scalar output, alert | Extend for versions, plans, exact Product inputs/output lot, scalar reconciliation, and failure injection |
| `src/services/recipes.ts` | Recipe plus current flat lines | Keep for legacy compatibility; native publication gets an immutable version transaction |
| `src/services/stockOps.ts` legacy cook | `recipe_batches`, Product scalar increment, movement, optional alert | Preserve as explicitly legacy; dual-write or block for Product-lot-enabled records |
| `src/services/stockOps.ts` finished spoilage | Guarded Product scalar decrement plus costed movement | Add exact Product-lot allocations for native/reviewed records |
| `src/services/transfers.ts` | Source decrement, destination update/create, transfer, paired movements | Replace native name matching with exact identity; dual-write both scalar and lot evidence |

### Other repository writers

The following modules issue single-statement or separately orchestrated
writes and must be included in Phase B call-site review:

- `src/db/repositories/appSettings.ts`
- `src/db/repositories/branches.ts`
- `src/db/repositories/businesses.ts`
- `src/db/repositories/fixedCosts.ts`
- `src/db/repositories/ingredientLots.ts`
- `src/db/repositories/ingredients.ts`
- `src/db/repositories/inventoryMovements.ts`
- `src/db/repositories/ownerAlerts.ts`
- `src/db/repositories/problemReports.ts`
- `src/db/repositories/products.ts`
- `src/db/repositories/recipeIngredientLines.ts`
- `src/db/repositories/recipes.ts`

Single SQL statements are individually atomic, but that is insufficient when
they participate in a multi-row domain mutation. Phase B repositories must
accept the caller's transaction handle and must not silently open another
connection or transaction.

`src/services/fixedCosts.ts` currently performs a payment existence read and
later insert without a database uniqueness guarantee. That race is not
reclassified as inventory work, but new report integration must not rely on
it as stronger evidence than it is. Existing fixed-cost behavior and formulas
remain regression gates.

### Complex raw SQL readers

`src/services/localAnalytics.ts` and
`src/services/profitReports.ts` are important even though they are read-only.
The redesign changes neither historical values nor existing formulas.
New Product-lot, supply, and adjustment joins must avoid double counting and
must read a consistent snapshot.

`src/services/problemReports.ts`/its repository remains independent of
inventory transactions. Problem-report persistence and redaction stay in the
regression suite.

## Current risks that Phase B must close

| Risk | Current evidence | Required treatment |
| --- | --- | --- |
| Native Product accidentally appears in Kiosk | Kiosk context filters Product only by business and branch/shared scope | Deploy catalog-aware compatibility filter before enabling native Product creation |
| Untracked scalar mutation | Product update accepts a direct `stock_qty` replacement | For native/reviewed Products, reject direct stock edits and require stock operations/adjustments |
| Ingredient adjustment race | Current quantity is read before opening the transaction | Re-read inside the transaction and check one guarded update |
| Grocery identity race | Existing Ingredient lookup occurs before purchase transaction and names are not unique | Use exact catalog binding/ID; validate inside transaction; never merge by name |
| Cook-upon-order partial evidence | Checkout does not check the affected-row result of one Ingredient-lot update | Require `changes === 1` before writing usage/movement/COGS |
| Stale cart facts | Checkout trusts name/price/type snapshots and does not fully reload Product/catalog context | Revalidate identity, branch, lifecycle, readiness, unit, and stock under checkout transaction while retaining price snapshot rules |
| Optional checkout token | A null token has no durable retry identity | Redesigned order/supply confirmation requires a non-null token; legacy behavior remains explicitly tested |
| Divergent generic sale writer | Generic sales repository writes no stock, movement, token, queue, cook, or supply effects | Keep it out of inventory checkout or make its accounting-only contract explicit; it cannot back Kiosk confirmation |
| Production context mismatch | Business validation exists, but branch and branch-specific output Product are not proven aligned together | Validate business/branch/Product/catalog scope inside stage transaction |
| Recipe mutation in place | Current header repository can overwrite recipe facts | Native publication inserts a new immutable version and changes only active pointer/state |
| Legacy cook bypass | Manual cook path increments only Product scalar | Keep legacy-only; dual-write Product lots for activated records or fail closed |
| Transfer destination race | Same-name destination is selected before the transaction; destination update result is not always authoritative | Native transfer uses exact catalog/binding, unit, and branch; revalidate/update both sides inside transaction |
| Product-lot drift | Several existing paths write Product scalar independently | Inventory every writer and require dual-write/reconciliation for activated records |
| Report torn read | Profit report performs sequential queries without a shared snapshot | Use one aggregate statement or a bounded read transaction for redesigned report sections |
| Delete cascade misuse | Existing foreign keys include cascades, but no centralized permanent-delete service exists | Check every reference and delete in one exclusive transaction; fail closed |
| Reset omissions | Reset/count inventories are hard-coded | Update reset order and focused diagnostic counts with schema changes |

## Transaction implementation rules

### Ownership

- The domain service owns the exclusive transaction.
- Repository functions accept the supplied transaction database.
- A repository called from an active transaction does not call
  `withExclusiveTransactionAsync` again.
- Migration execution, UI navigation, network work, SecureStore, logging
  uploads, and receipt sharing are never invoked from a domain transaction.
- Post-commit UI effects run only after the transaction promise resolves.

### Reads and revalidation

Expensive planning, graph expansion, formatting, and UI validation may happen
before the write transaction. Every fact that authorizes a mutation is then
re-read or conditionally guarded inside it:

- business and branch scope;
- catalog lifecycle/classification/readiness;
- Product scalar and Product-lot reconciliation;
- Ingredient/Product lot ownership, unit, status, and balance;
- draft revision and dependency versions;
- plan/stage state;
- supply rules, required minima, and reviewed cart revision; and
- request-token uniqueness.

A stale preflight result produces a domain error and no writes.

### Guarded writes

Every stock or state transition checks `changes === 1`. A zero or unexpected
row count throws before related movement/usage evidence is inserted.
Guards include expected identity/context, non-deleted status, current state,
and sufficient balance.

Quantities and money must be finite. Storage remains SQLite `REAL` and
JavaScript `number`; comparisons use the documented tolerance rather than
exact equality. No transaction rounds intermediate cost contributions.

### Ordering and bounded work

- Resolve exact allocations before the transaction.
- Revalidate and write them in a deterministic order, normally item kind,
  stable item ID, and stable lot ID.
- Automatic FEFO/FIFO recommendations retain their explicit deterministic
  tie-breaker; manual allocations retain owner order only as display
  metadata.
- Batch-load all rows needed by a transaction. Do not issue one discovery
  query per cart line or graph node.
- Keep graph traversal within documented node/edge/depth caps.
- Never hold a transaction open while awaiting owner input.

### Idempotency

An idempotency token or uniqueness key is required for operations exposed to
double-submit or resume:

- checkout;
- stock adjustment/mark-empty;
- owner-review Product baseline initialization;
- production-plan stage execution;
- draft publication;
- native Grocery purchase confirmation; and
- other multi-write confirmations added by Phase B.

If the token already identifies a committed result, return that result
without recalculating or mutating inventory. If a previous attempt rolled
back, retry performs the operation once. A lost response after commit is
therefore safe.

## Target operation boundaries

### Catalog Item and projection creation

One transaction creates:

1. the Catalog Item;
2. the native Product or Ingredient projection;
3. the exact binding;
4. initial readiness/review metadata; and
5. any initial purchase lot and movement explicitly supplied by the owner.

Prepared/finished/direct-resale Product projection creation is disabled until
the compatibility-aware Kiosk reader is deployed. Newly created records
start not sellable and not Kiosk-enabled.

The transaction validates business/branch scope and uniqueness by exact ID.
It never looks up an existing semantic identity by name.

### Owner review and `legacy_balance` initialization

Owner review is one exclusive, idempotent transaction:

1. Load the exact binding and Product.
2. Confirm it is still unreviewed and belongs to the owner context.
3. Validate the chosen classification, unit, lifecycle, and stock policy.
4. Read `products.stock_qty`.
5. Prove no prior Product-lot activation/baseline exists.
6. If Product-lot evidence is being enabled, create exactly one marked
   `legacy_balance` lot equal to the non-negative scalar balance, including a
   zero balance if the final DDL permits a zero baseline.
7. Reconcile scalar against the resulting Product-lot sum.
8. Mark the binding reviewed/native-lot-enabled.

The baseline records uncertain provenance and existing cost only; it does not
claim a purchase or production event. A negative, non-finite, cross-context,
already-initialized, or unreconcilable value rolls back the review. Migration
never performs this operation in bulk.

### Draft autosave

Draft autosave is a short transaction containing:

- one guarded draft revision update/upsert;
- changed draft-line upserts/removals; and
- persisted nested return/placeholder state.

It writes no Product, Ingredient, lot, movement, Recipe version, plan,
production, sale, or Kiosk state. A stored revision newer than the caller's
revision rejects the stale save. Autosaves are debounced/coalesced rather
than one transaction per keystroke.

### Recipe publication

Publication uses one exclusive transaction:

1. Re-read draft identity and revision.
2. Validate scope, required fields, units, readiness, and dependencies.
3. Validate the bounded proposed graph and reject cycles.
4. Allocate a unique `(recipe_id, version_number)`.
5. Insert the immutable version.
6. Insert every immutable line and exact child-version edge.
7. Update the Recipe's active-version/compatibility pointer and explicitly
   approved catalog readiness projections and recipe roles.
8. Mark the draft published.

The old active version remains active if any step fails. Native lines do not
write lot IDs. Imported `legacy_selected` lines remain unchanged. Publication
does not create stock or production.

If multiple Recipe families output one catalog item, a separate explicit
primary/Kiosk role is required for native readiness. Publication never
chooses that role merely because the new row has the latest timestamp.

### Production planning and plan save

Graph expansion and stock/cost observation are read-only. They never mutate
lots or reserve inventory.

Saving a plan uses one bounded transaction for the plan header, stages,
requirements, provenance, and proposed allocations. A saved plan is a
snapshot and has its own revision/idempotency key. Failure leaves no partial
plan and no inventory effect.

For a consistent planning observation, graph/version/stock inputs are loaded
in one read snapshot or are fingerprinted and revalidated before the plan is
marked ready.

### Production stage execution

Human preparation is not one long transaction. Each completed stage is one
atomic operation:

1. Re-read exact plan, stage, Recipe version, business/branch, Product
   projection, and execution token.
2. Revalidate status, units, explicit actual allocations, Ingredient lots,
   prepared Product lots, Product scalar/lot reconciliation, and actual
   output.
3. Insert a production batch with expected/actual/version/plan and
   cost-completeness snapshots.
4. Apply each guarded Ingredient-lot and prepared Product-lot deduction.
5. For every prepared Product input, decrement its scalar stock in the same
   transaction.
6. Insert exact input allocations, existing compatibility usages where
   required, and all input movements.
7. Insert the production-origin Product output lot using actual output and
   unrounded actual batch cost.
8. Increment output `products.stock_qty`.
9. Insert output movement and required compatibility evidence.
10. Mark the stage complete, link its batch, update downstream shortage
    state, and update alerts.

All Product lot/scalar changes reconcile before commit. A guarded deduction,
unit mismatch, stale plan, branch mismatch, insufficient stock, duplicate
execution, or any later insert failure rolls back the batch and every stock
effect.

The existing manual “cook batch without Recipe” operation remains labeled
legacy. It may continue for unreviewed legacy Products. For a Product with
lot evidence enabled, it must either create a correctly marked output lot and
dual-write atomically or reject the operation; it cannot update only scalar
stock.

### Grocery purchase

Native purchase confirmation uses one transaction:

1. Re-read exact catalog/binding or create a new purchased Ingredient/supply
   catalog identity and Ingredient projection.
2. Validate business, unit, quantity, optional Supplier/Receipt, expiry, and
   cost completeness.
3. Insert the Ingredient lot with nullable authoritative cost shadows and
   explicit cost state. When cost is unknown, write `NULL` shadows and only
   the required legacy-column compatibility sentinel; no native calculation
   may read the sentinel as known cost.
4. Insert the purchase movement.
5. Link optional purchasing facts and commit the request token.

Existing Ingredients are resolved by exact binding/ID, not name. A Product
for direct resale uses the analogous native Product purchase-lot operation:
insert Product lot, increment Product scalar, insert movement, reconcile, and
commit together.

### Checkout with Product lots and supplies

Rule calculation and seller review occur outside the write transaction.
Confirmation extends the existing live Kiosk transaction; it does not call
the generic Sale repository as a separate write.

Inside one exclusive transaction:

1. Require and recheck the non-null checkout token. If committed, return the
   existing Sale with no new effect.
2. Revalidate Product/catalog identity, branch/shared scope, native Kiosk
   eligibility, cart/review revision, supply rules, required minima, units,
   Product reconciliation, and all selected lots.
3. Insert the token-backed Sale.
4. Insert SaleItems with existing price/discount/bundle snapshots.
5. For legacy prepared Products, apply the existing guarded scalar
   deduction. For native/reviewed Products, deduct exact Product lots,
   decrement scalar, insert lot usages, and reconcile.
6. For cook-upon-order items, apply every Ingredient-lot deduction and check
   each affected-row count before inserting usage/movement evidence.
7. Insert existing Product/Ingredient COGS snapshots.
8. Deduct each tracked supply Ingredient lot with checked updates.
9. Insert supply movements, `sale_supply_usages`, exact lot usages, and
   separate unrounded cost-category snapshots. Record but do not deduct
   explicitly untracked supplies.
10. Insert receipt and offline queue rows and finish the token-backed result.

Any failure rolls back the Sale, items, scalar/lot balances, movements,
usages, COGS, receipt, and queue row. Retrying the same token returns the
committed Sale and cannot double-deduct Products, Ingredient lots, or
supplies.

Supply cost remains separate from Product COGS:

```text
Product COGS
Packaging cost
Utensil and condiment cost
Other supply cost
```

See
[supplies-and-order-cost-design.md](supplies-and-order-cost-design.md).

### Stock adjustment and mark-empty

One owner-authorized transaction:

1. Revalidates owner/business/branch, request token, subject, unit, reason,
   and note requirements.
2. Re-reads current scalar and/or lot balances.
3. Inserts the immutable adjustment header.
4. Applies every guarded exact lot update.
5. Updates Product scalar compatibility stock where applicable.
6. Inserts every movement and adjustment allocation with before/delta/after
   snapshots.
7. Updates empty/active lot status and alert state.
8. Reconciles Product scalar and Product lots.

Mark-empty is the same transaction shape with a delta equal to all selected
remaining stock. It does not archive or delete the item/lot.

For unreviewed legacy Product scalar stock, compatibility behavior may use a
guarded scalar adjustment plus movement. Enabling native lot evidence first
requires the explicit owner-review baseline transaction.

See [stock-adjustment-design.md](stock-adjustment-design.md).

### Transfers

Legacy transfers retain their current compatibility behavior and report
treatment. Native/reviewed transfers use exact catalog and projection IDs,
not same-name discovery.

One transfer transaction:

1. Revalidates business, source/destination branch, classification, unit, and
   exact bindings.
2. Reconciles source and destination Product scalar/lot state.
3. Deducts explicit source Product lots and source scalar with checked
   updates.
4. Creates or increments destination transfer-origin lots and destination
   scalar.
5. Inserts the transfer record and paired movements with preserved
   unrounded cost.
6. Reconciles both sides and updates alerts.

If an explicit destination projection must be created, its catalog binding
is created in this same transaction. Any destination conflict, unit mismatch,
or failed update rolls back both branches. Transfer value remains
informational in current profit reporting; it is not silently added as
revenue or expense.

### Spoilage and other Product stock operations

Finished-product spoilage for an unreviewed legacy Product keeps the current
guarded scalar/movement behavior. For a native/reviewed Product it must also
allocate exact Product lots, decrement them, update scalar, preserve cost,
insert movement/adjustment evidence, and reconcile in one transaction.

No Product definition update may change `stock_qty` for a native/reviewed
record. Callers route through production, purchase, checkout, transfer,
spoilage, or stock-adjustment services.

Ingredient-lot adjustment likewise moves from a read-then-write orchestration
to a transaction that re-reads or conditionally guards the expected
remainder.

### Supply-rule publication

Creating or superseding a supply rule is one small transaction:

- validate exact supply binding, target, branch, unit, scope, behavior, and
  quantity;
- insert the immutable new rule version;
- supersede the old active version if present; and
- update the active pointer/state.

It writes no stock and cannot alter a committed sale. Kiosk reads the exact
rule snapshot again during checkout.

### Archive and permanent delete

Archive updates Catalog lifecycle and required compatibility projections in
one transaction. It does not remove bindings, lots, versions, usages,
movements, sales, batches, or reports.

Permanent delete is owner-only and fail-closed:

1. Start an exclusive transaction.
2. Re-read lifecycle and exact binding.
3. Check Product, Ingredient, purchase, lot, Recipe/version/draft, bundle,
   plan, production, sale, movement, transfer, rule, supply usage, and
   adjustment references.
4. Deny if any query fails, any unknown reference kind exists, or any
   protected row is found.
5. Delete only the proven-unused draft/root and its ephemeral owned children.

Existing foreign-key cascade behavior is never used as authorization. A
history-bearing record is archived, not permanently deleted.

### Pilot reset

The reset remains one exclusive child-first transaction. All new child,
usage, movement, lot, version, plan, rule, adjustment, binding, and catalog
tables must appear before their parents in `resettableTables`.

The transaction does not delete `schema_migrations`. SecureStore cleanup, if
the caller performs it, remains outside SQLite and must be reported
separately because it cannot be atomic with the database reset.

## Product scalar/lot decision table

| Product state | Availability authority | Product-lot expectation | Allowed stock writers |
| --- | --- | --- | --- |
| Unreviewed legacy | `products.stock_qty` | None; no mass backfill | Existing compatibility writers with current guarded movement behavior |
| Owner review in progress | Scalar read inside review transaction | One exact `legacy_balance` baseline only if activation succeeds | Review transaction only |
| Reviewed/native lot-enabled | `products.stock_qty`, required to reconcile | Exact active Product lots, including any legacy baseline | Dual-write production, purchase, checkout, transfer, spoilage, adjustment services only |
| Reconciliation mismatch | Scalar remains visible recorded balance but native allocation is blocked | Evidence is inconsistent | Corrective owner workflow only; no silent repair |

This avoids two false claims: Product lots do not become universal authority
during this redesign, and a migration-created lot does not pretend to know
legacy acquisition history.

## Report and read-snapshot impact

Historical report rows remain authoritative:

- SaleItem stored COGS and legacy fallback remain unchanged.
- Existing spoilage remains in its established category.
- Transfers remain informational.
- Fixed-cost recurrence and payments remain unchanged.
- Existing production value and unsold value remain unchanged.

New report queries add categories explicitly:

- Product COGS;
- packaging;
- utensil/condiment;
- other supply;
- spoilage/damage/expiry;
- promotion;
- owner withdrawal;
- stock variance; and
- supplier return.

Supply costs are not added to Product COGS. Owner withdrawal and counting
correction are not Sale COGS. A query joining sales to multiple lot-usage
tables must aggregate each child set before joining so row multiplication
cannot double count costs.

Multi-query reports use a bounded read transaction/snapshot or a single
aggregate statement. New indexes must support business, branch, time,
category, sale, batch, item, and lot predicates. Report checks compare
pre-upgrade and post-upgrade legacy results exactly, then verify new
categories independently.

## Branch, unit, and precision impact

### Branch

- Every mutation validates business first and branch/shared scope second.
- A branch-specific Product must match the operation branch.
- A branch-null Product retains current business-shared semantics.
- Ingredient stock remains business-wide unless an approved additive
  location field explicitly scopes a lot.
- Transfer is the only operation that intentionally spans two branches, and
  it validates both in the same transaction.
- Inconsistent legacy history is preserved and flagged, never rewritten.

### Units

- Existing `piece`, `pcs`, mass, and volume text remains unchanged.
- Native writes require same-unit, built-in same-family conversion, or an
  exact versioned Item conversion snapshot.
- No generic mass-to-volume or pack conversion is inferred.
- Allocation stores original and normalized quantity/unit where conversion
  occurs.
- A unit mismatch rejects before any stock write.

### Precision

- SQLite `REAL` and JavaScript `number` remain the storage/calculation types.
- All input values must be finite and domain-valid.
- Exact lot contribution is quantity times the stored lot cost per unit,
  retained unrounded.
- Sums and reconciliation use the shared tolerance, initially compatible
  with existing `1e-9` guards.
- Display/receipt formatting may round at the existing presentation boundary.
- Failure snapshots compare numbers using exact persisted representation or
  the explicitly documented tolerance; tests never hide a real row change by
  broad rounding.

## Failure-injection plan

Integration tests add a test-only failure hook after each material write
boundary. For each injection point:

1. Seed a deterministic database.
2. Record involved table rows and balances.
3. Invoke the operation with failure at point `N`.
4. Assert the operation rejects.
5. Compare every involved table to the exact before snapshot.
6. Retry without failure.
7. Assert one committed result.
8. Retry with the same token and assert no additional effect.
9. Run foreign-key and integrity checks where schema/data breadth warrants.

| Operation | Mandatory injection boundaries |
| --- | --- |
| Migration | DDL/backfill groups and before ledger insert for each of `011`–`014` |
| Catalog create | Catalog row, projection row, binding row, initial lot, movement |
| Legacy review | baseline lot/marker, reconciliation, binding/catalog activation |
| Draft save | draft header, each line batch, nested return state, revision |
| Recipe publish | version, lines/edges, active pointer, catalog projection, draft state |
| Plan save | plan, stages, requirements, allocations, ready state |
| Production stage | batch, each input deduction, each scalar change, usages, movements, output lot, output scalar, output movement, stage/alert update |
| Grocery/direct-resale purchase | optional facts, projection/binding, lot, scalar where Product, movement |
| Checkout | Sale, each SaleItem group, Product scalar/lots, cook lots/usages/movements, supply lots/usages/movements, COGS, receipt, queue |
| Adjustment/mark-empty | header, every lot/scalar change, movements, allocations, status/alert |
| Transfer | source lot/scalar, destination projection/lot/scalar, transfer row, both movements, alerts |
| Spoilage | lot allocation, scalar, movement/adjustment, alert |
| Archive/delete | lifecycle/projection update; each eligible ephemeral delete group |
| Reset | representative points across the child-first table list |

The checkout test specifically proves that a failure after Product deduction
but before supply, receipt, or queue writes restores every Product,
Ingredient, and supply balance. The production test proves that a failure
after input consumption or output creation restores both sides and leaves no
batch/stage evidence.

## Concurrency and retry scenarios

Even though writes are serialized by exclusive transactions, stale reads
before a transaction can still cause incorrect decisions. Required tests
include:

- two rapid confirmations with one checkout token;
- two review attempts for one legacy Product baseline;
- two execution attempts for one plan stage;
- stale draft autosave racing publication;
- lot balance changed after FEFO/FIFO recommendation;
- Product scalar changed after planning but before execution;
- two adjustments based on the same displayed count;
- destination Product created/changed during transfer setup;
- supply rule superseded after order review; and
- app termination after a commit but before the success screen.

Each case produces either one committed result or a clear stale/conflict
error with zero partial state.

## Reset, count, and diagnostic checks

- Seed and then clear every new table through the existing reset service.
- Keep table deletion order explicit and child-first.
- Prove schema and migration ledger survive reset.
- Add only useful owner-visible root tables to `countableTables`; do not make
  every line/allocation table part of routine diagnostics.
- If a count is added, update `LocalDataCounts` consumers and pilot/problem
  diagnostics together.
- Ensure diagnostics never include private notes, owner secrets, receipt
  details, or other sensitive row content.

## Phase B transaction exit gate

Phase B persistence is not ready to enable until:

- every current Product scalar writer is classified as legacy-only,
  dual-write, or blocked for native/reviewed Products;
- the live Kiosk checkout is the only inventory-aware Sale confirmation path;
- the cook-upon-order affected-row check is fixed;
- native Product creation is behind the compatibility-aware Kiosk predicate;
- all balance-sensitive reads are inside or revalidated by their transaction;
- every guarded update checks exactly one affected row;
- production, checkout, purchase, adjustment, transfer, spoilage, publish,
  plan, review, delete, migration, and reset failure-injection suites pass;
- same-token retries produce one effect;
- report categories and read snapshots avoid double counting/torn reads;
- branch, unit, precision, delete, reset, and count protections pass; and
- fresh and populated-v10 migration/resume checks pass.
