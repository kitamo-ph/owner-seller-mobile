# Inventory redesign migration plan

## Decision and scope

Phase B adds migrations `011` through `014`. Migrations `001` through `010`
remain byte-for-byte historical records and are never edited, reordered, or
replayed under a different ID.

The migration is additive:

- `catalog_items` becomes the new semantic identity.
- `legacy_item_bindings` connects that identity to an exact existing Product
  or Ingredient ID.
- Existing Products, Ingredients, lots, recipes, batches, sales, movements,
  bundles, costs, reports, and identifiers remain in place.
- Existing records are imported as `legacy_unclassified` and review-required.
  Product type, name, price, bundle fields, or recipe presence is not enough
  evidence to assign one of the six owner-facing classifications.
- Native prepared or finished items use Product projections. Native purchased
  ingredients and supplies use Ingredient projections. Direct-resale items
  also use Product projections and native Product purchase lots.
- Product scalar stock remains the availability authority during the
  transition.

This plan implements the decisions in
[domain-compatibility-map.md](domain-compatibility-map.md). It must also
preserve the historical guarantees recorded in
[sqlite-schema-inventory.md](../mob-0-1-discovery/sqlite-schema-inventory.md),
[migration-timeline.md](../mob-0-1-discovery/migration-timeline.md), and
[protected-business-invariants.md](../mob-0-1-discovery/protected-business-invariants.md).

No migration changes the Android package, Expo/EAS identity, signing,
release metadata, cloud configuration, or offline-only behavior.

## Existing runner contract

The current runner:

1. creates `schema_migrations`;
2. checks migration IDs already in that ledger;
3. applies each missing migration in one exclusive SQLite transaction; and
4. records the migration ID in the same transaction.

Its idempotency is ledger-based. It does not inspect columns or repair a
partially hand-edited schema. The in-process `WeakMap` queue prevents two
startup callers using the same database handle from overlapping, but it is
not a substitute for schema verification.

Consequences for Phase B:

- Every new migration has one permanent ID and one immutable SQL body.
- A migration and its ledger row commit together or roll back together.
- `INSERT OR IGNORE` is not used to conceal unexpected duplicate semantic
  data during a backfill.
- Deterministic backfill IDs and uniqueness constraints make the intended
  mapping auditable.
- Unexpected schema drift fails with an actionable error; the migration must
  not guess which parts are safe to skip.
- Application repositories and stores do not open until the complete target
  schema is available.
- `runMigrations` is never called from an application transaction.

## Required deployment gate

The current Kiosk Product query applies only the existing branch/shared
predicate. It does not enforce catalog lifecycle, sellable, Kiosk-enabled,
price-complete, or prepared-base exclusion rules.

Therefore the Phase B code must deploy the compatibility-aware Kiosk
predicate before any native Product projection can be created. The ordering
is non-negotiable:

1. Upgrade through migration `014`.
2. Use a reader that preserves the exact legacy branch/shared behavior for
   unreviewed `legacy_unclassified` Products.
3. Require active lifecycle, supported sale classification, explicit
   sellable, explicit Kiosk-enabled, known selling price, branch
   applicability, and required recipe readiness for native/reviewed Products.
4. Keep native Product creation and legacy review disabled until that reader
   and its checkout revalidation tests pass.
5. Only then enable the owner creation/review entry points.

A feature rollback may hide the new owner workflows, but it must never roll
back this compatibility filter after native Product rows exist.

## Migration sequence

| ID | Proposed module | Responsibility | Legacy data mutation |
| --- | --- | --- | --- |
| `011_catalog_identity` | `src/db/migrations/011_catalog_identity.ts` | Catalog identity, exact bindings, lifecycle/readiness metadata, item-specific unit conversions, and review state | Adds one catalog item and one exact binding for every existing Product and Ingredient; changes no legacy business field |
| `012_recipe_versions_and_drafts` | `src/db/migrations/012_recipe_versions_and_drafts.ts` | Immutable recipe versions and lines, drafts, nested dependencies, and active compatibility pointers | Imports the current stored definition without claiming it describes earlier production |
| `013_inventory_planning_and_adjustments` | `src/db/migrations/013_inventory_planning_and_adjustments.ts` | Optional purchasing facts, Product lots, exact Product/production allocations, production plans, and stock adjustments | Adds nullable links/metadata only; does not create Product lots for legacy scalar balances |
| `014_supply_order_costs` | `src/db/migrations/014_supply_order_costs.ts` | Supply rules, reviewed order usage, lot usage, and separately categorized supply costs | No inferred rules or historical supply usage |

The final exported `schemaVersion` becomes `14`, and the migration index must
list exactly `001` through `014` in order.

## Migration 011: catalog identity and compatibility

### New structures

`catalog_items` owns:

- stable catalog ID and business scope;
- optional branch/location policy;
- owner-facing and normalized search names;
- classification, including internal `legacy_unclassified`;
- lifecycle and archive state;
- classification-review state;
- sellable and Kiosk-enabled state;
- purchase-cost and selling-price completeness state;
- stock policy; and
- the repository's standard timestamps, sync state, and soft-delete metadata.

`legacy_item_bindings` owns:

- catalog item ID;
- entity kind, `product` or `ingredient`;
- exact legacy entity ID;
- projection role;
- compatibility mode;
- review and native-activation timestamps; and
- uniqueness for `(entity_kind, legacy_entity_id)`.

`item_unit_conversions` stores immutable or superseding Item-specific
conversion definitions. There is no universal mass-to-volume,
pack-to-piece, or ingredient-to-output conversion.

Historical foreign keys use `RESTRICT` or `SET NULL` plus snapshots.
Catalog-to-binding deletion does not authorize deletion of the legacy
entity.

### Backfill

For every existing Product row, including inactive or soft-deleted rows:

1. Create one deterministically identifiable catalog row.
2. Create one exact Product binding.
3. Store `legacy_unclassified`, compatibility mode, and review-required.
4. Preserve branch/shared scope and the raw legacy visibility facts.
5. Preserve price, cost, stock, bundle, type, unit, threshold, and timestamps
   only in their existing columns; do not reinterpret them.

Repeat the same process independently for every Ingredient. A Product and an
Ingredient with the same name, or even the same text ID in their separate
tables, remain two different catalog identities. No name-based merge occurs.

Legacy zero price/cost values remain zero in their original fields but their
new completeness state remains review-required. Positive values do not prove
classification. Existing bundle fields are labeled only as legacy quantity
pricing and do not create inferred bundle components.

The migration creates no Product, Ingredient, lot, recipe, sale, production,
movement, or report row in an existing legacy table.

### Required constraints and indexes

- unique exact binding by entity kind and entity ID;
- binding lookup by catalog item and projection role;
- catalog lookup by business, lifecycle, classification, and review state;
- Kiosk eligibility lookup for native/reviewed catalog Product bindings;
- normalized-name lookup scoped by business without making names identity;
- conversion lookup by catalog item, units, and active/superseded state; and
- checks for documented classification, lifecycle, projection role, and
  compatibility values.

### State after 011

Legacy application behavior is still authoritative. The new catalog is a
review-required semantic overlay. No native Product may yet be created.
Restarting after `011` can safely continue with `012`.

## Migration 012: recipe versions, graph, and drafts

### New structures

- `recipe_versions`: immutable published header, expected yield, output
  catalog item, completeness, source, and version number.
- `recipe_version_lines`: immutable catalog leaf, exact child-version edge,
  or custom-cost line with quantity, unit, role, conversion, and history
  snapshots.
- `catalog_item_recipe_roles`: explicit primary, alternate, and
  cook-upon-order/Kiosk Recipe-family selection for a catalog output item.
- `recipe_drafts` and `recipe_draft_lines`: mutable, restart-safe work with
  revision checks, unresolved placeholders, and nested return context.
- Nullable compatibility pointers from `recipes` to the active imported or
  native version.

Native published lines reference catalog items or exact child recipe
versions. They never select an inventory lot. Planning recommends lots and
execution records exact allocations.

An imported legacy line is the deliberate exception: it retains its exact
selected Ingredient lot ID, cost/source snapshots, and
`legacy_selected` allocation mode. That evidence is never replaced with
FIFO/FEFO or a newly inferred catalog-only line.

See [recipe-graph-design.md](recipe-graph-design.md) and
[recipe-versioning-design.md](recipe-versioning-design.md) for publication
and graph rules.

### Backfill

For each existing Recipe:

1. Preserve the Recipe ID as the stable compatibility identity.
2. Resolve its output Product through the exact binding created by `011`.
3. Create one deterministic imported version for the definition currently
   stored.
4. Copy header quantities, unit, production mode, suggested price, notes,
   active state, and timestamps without recalculation.
5. Copy every line in stored order, preserving Ingredient, selected lot,
   custom name, quantity, unit, cost override, cost snapshots, source label,
   notes, and ambiguity.
6. Mark imported completeness and classification as review-required where
   the old schema cannot prove intent.
7. Set only the Recipe's compatibility active-version pointer.

No old production batch or sale usage is assigned this version merely
because it references the same Recipe. Existing Recipes could have been
edited in place, so old `recipe_version_id` fields remain `NULL` or explicitly
legacy-unknown unless exact evidence proves the relationship. Existing
batch, usage, SaleItem COGS, and snapshot fields remain historical authority.

Inactive and history-bearing Recipe rows are imported so their definitions
remain resolvable; import status does not make them selectable for new work.

When multiple active Recipes target the same legacy Product, import every
family and current definition. Do not infer a primary or Kiosk Recipe from
creation order. The unreviewed compatibility reader retains the current
chronological resolution until the owner explicitly chooses a recipe role.

### Required constraints and indexes

- unique `(recipe_id, version_number)`;
- one source kind per immutable line;
- version and line lookup by business/Recipe;
- child-version reverse reference;
- active version lookup;
- unique effective recipe role by catalog output and role;
- draft lookup by business, lifecycle, revision, parent draft, and return
  line;
- graph traversal indexes; and
- foreign keys that prevent deletion of referenced versions while allowing
  draft-owned children to cascade only where they are truly ephemeral.

### State after 012

Imported versions are readable compatibility evidence. Existing recipe,
production, and Kiosk writers continue to use their old paths until their
Phase B replacements are enabled. Draft and nested-version entry points
remain disabled. Restarting after `012` can safely continue with `013`.

## Migration 013: purchasing facts, Product lots, planning, and adjustments

### New structures

- `suppliers` and `purchase_receipts` for optional, structured Grocery facts;
- additive optional expiry, Supplier, Receipt, provenance, and
  cost-completeness fields on Ingredient lots;
- nullable authoritative `recorded_total_cost` and
  `recorded_cost_per_unit` Ingredient-lot shadow values, plus
  `known`/`unknown`/`legacy_review` state, because the existing cost columns
  are non-null compatibility fields;
- `product_stock_lots` for exact native/reviewed Product purchase or
  production evidence;
- `sale_product_lot_usages` for exact Product-lot COGS evidence;
- `production_input_allocations` for actual Ingredient-lot and prepared
  Product-lot consumption;
- `production_plans`, `production_plan_stages`,
  `production_plan_requirements`, and `production_plan_allocations`;
- additive nullable recipe-version, plan-stage, expected-yield, actual-yield,
  cost-completeness, and variance facts on production history; and
- `stock_adjustments` and `stock_adjustment_allocations`.

Planning tables store snapshots and explicit recommendations but never
reserve or mutate stock. Actual allocation tables store the committed lot
IDs, quantities, unit/conversion snapshots, and unrounded cost
contributions.

See [production-planner-design.md](production-planner-design.md),
[lot-and-costing-design.md](lot-and-costing-design.md), and
[stock-adjustment-design.md](stock-adjustment-design.md).

### Product-stock transition

`products.stock_qty` remains the availability authority.

- Unreviewed legacy Products have no required Product-lot reconstruction.
- Migration `013` performs no mass Product-lot backfill.
- Native Product rows and owner-reviewed legacy Product rows opt into exact
  Product-lot evidence.
- At owner review only, a legacy Product may create one idempotent
  `legacy_balance` lot equal to the scalar quantity observed inside the same
  transaction. Its cost and provenance are explicitly marked legacy and
  uncertain.
- Negative, non-finite, cross-branch, already-initialized, or otherwise
  unreconcilable balances block activation and create a review issue; they
  are never normalized by migration.
- After activation, every Product stock writer atomically updates scalar
  stock, exact Product lots, and movement evidence.

For native/reviewed lot-tracked Products, the invariant is:

```text
products.stock_qty
≈ sum(non-deleted active product_stock_lots.remaining_quantity)
```

The shared legacy `REAL` tolerance applies. The sum includes a
`legacy_balance` lot when one was created. A mismatch blocks native
allocation and requires owner-visible review; no background job silently
repairs it.

### Legacy data treatment

- Existing Ingredient lots and movements remain authoritative and unchanged.
- Existing positive Ingredient-lot costs copy exactly into nullable shadow
  fields as known. Existing zero costs remain unchanged and become
  `legacy_review`; migration does not infer free versus missing.
- A native unknown-cost lot uses `NULL` authoritative shadow values and an
  explicit `unknown` state. Its required legacy cost columns receive a zero
  storage sentinel that no native reader may interpret as a known cost.
- Cost-optional writes remain gated until Grocery, recipe costing,
  production, checkout, Missing Prices, and reports read the explicit state.
- Free-text `source_name` remains free text and is not promoted to a verified
  Supplier.
- Existing Product scalar quantities and costs remain byte-for-byte numeric
  values.
- Existing production quantities, usages, and costs remain unchanged.
- Existing sales receive no inferred Product-lot allocations.
- Existing spoilage and transfer history remains unchanged.

### Required constraints and indexes

- one owner-review initialization token per Product/context;
- Product lots by Product, branch/shared context, status, expiry/origin date,
  and source;
- exact sale and production usage by lot;
- plans by business/branch, status, root version, and update time;
- stages by plan and topological order;
- requirements and allocations by stage/item;
- adjustment request-token uniqueness;
- movement/adjustment reverse lookup;
- Supplier and Receipt lookup; and
- checks for finite domain-approved quantities at the service boundary,
  non-negative remaining quantities, source kinds, lifecycle values, and
  allocation modes.

### State after 013

New structures remain inert until native writers and reconciliation checks
are enabled. Product scalar stock still drives availability. Legacy Products
still have no fabricated lot history. Restarting after `013` can safely
continue with `014`.

## Migration 014: supply rules and order costs

### New structures

- `supply_usage_rules`: versioned/audited per-product, per-quantity, or
  per-order rules with required/default/suggested/requested behavior;
- `sale_supply_usages`: reviewed actual quantity, unit, category,
  completeness, rule snapshots, and unrounded cost contribution;
- `sale_supply_lot_usages`: exact Ingredient-lot allocations and cost
  snapshots for tracked supplies; and
- indexes supporting one bounded rule load per cart and separate report
  aggregation.

Supply catalog items bind to Ingredients and use existing Ingredient lots.
They do not become ordinary Products or Kiosk tiles. Packaging, utensil and
condiment, and other supply costs remain separately queryable from Product
COGS.

See
[supplies-and-order-cost-design.md](supplies-and-order-cost-design.md).

### Backfill

There is no historical rule or order-supply backfill. Current rows do not
prove which packaging was used on a past order. Existing sales, SaleItems,
COGS, receipts, offline queue payloads, and reports remain unchanged.

### Required constraints and indexes

- immutable rule version uniqueness and explicit supersession;
- rule lookup by business/branch, active state, target Product, and scope;
- unique sale-usage identity under the checkout request;
- lot usage by sale usage and Ingredient lot;
- allowed scopes, behaviors, and cost categories; and
- foreign keys and snapshots that preserve sale history after archive.

### State after 014

The database is structurally ready for Phase B persistence code. Supply
features remain disabled until checkout revalidation, checked lot
deductions, token retry, cost-category reporting, and failure-injection tests
pass.

## Intermediate-state and resume contract

The app must never expose repositories against a partly upgraded schema.
Startup waits for `runMigrations` to finish and verifies the expected
migration set before initializing domain stores.

Each successfully committed intermediate state is deliberately valid:

| Highest committed migration | Safe behavior before resume |
| --- | --- |
| `010` | Exact current application |
| `011` | Current application plus inert compatibility catalog |
| `012` | Current application plus readable imported recipe versions |
| `013` | Current application plus inert Product-lot/planning/adjustment structures |
| `014` | Phase B schema present; features still controlled by readiness gates |

A forced failure inside a migration must leave neither its schema/data
changes nor its ledger row. On restart, the runner begins that same migration
again. A process stopped after a successful migration resumes at the next
ID. Tests cover both conditions for each of `011` through `014`.

## Fresh-install behavior

A fresh empty database applies `001` through `014` in order. It has:

- no legacy catalog rows to backfill;
- no imported Recipe versions;
- no Product `legacy_balance` lots;
- the same constraints, indexes, and feature gates as an upgraded database;
  and
- native defaults of draft/not-sellable/not-Kiosk-enabled until the owner
  explicitly completes readiness.

Running the migration runner a second time applies zero migrations and
changes neither schema nor data.

## Populated-v10 upgrade behavior

The populated fixture must be produced by the exact unmodified migrations
`001` through `010`, then include at least:

- branch-specific and business-shared Products;
- active, inactive, and soft-deleted rows;
- Product and Ingredient name collisions and same-text IDs across tables;
- zero and positive prices/costs;
- positive, zero, and anomalous scalar stock requiring review;
- legacy quantity-pricing bundle fields;
- multiple Ingredient lots with different costs and selected-lot Recipe
  lines;
- custom-cost Recipe lines;
- existing production batches/usages;
- prepared and cook-upon-order sales with COGS snapshots;
- checkout tokens, receipts, queue rows, transfers, spoilage, fixed costs,
  reports, and problem reports.

Before and after upgrade, the test records counts and value fingerprints for
every legacy table. It then proves:

- every legacy ID and relationship is unchanged;
- every legacy quantity, price, cost, snapshot, timestamp, and status is
  unchanged;
- exactly one catalog binding exists per legacy Product/Ingredient;
- all imported records are review-required/`legacy_unclassified`;
- no Product lot was fabricated;
- one imported current-definition Recipe version exists per Recipe;
- imported lines retain selected-lot and cost snapshots;
- old batches and sales did not receive guessed version/lot/supply links;
- old report results are identical; and
- newly created native records behave equivalently on fresh and upgraded
  databases.

## Validation matrix

Phase B must extend `scripts/check-migrations.js` or replace it with a focused
redesign migration check while retaining its existing assertions.

| Check | Fresh | Populated v10 | Resume/interruption |
| --- | ---: | ---: | ---: |
| Apply exactly `001`–`014` | Yes | Yes | Yes |
| Second run applies zero | Yes | Yes | Yes |
| Failure before each new ledger insert rolls back all DDL/data | Yes | Yes | Yes |
| Stop after each of `011`, `012`, `013`, reopen, and finish | N/A | Yes | Yes |
| `PRAGMA integrity_check = ok` | Yes | Yes | After every resume |
| `PRAGMA foreign_key_check` returns no rows | Yes | Yes | After every resume |
| Required columns, checks, unique constraints, and indexes | Yes | Yes | Final |
| Legacy value fingerprints unchanged | N/A | Yes | Yes |
| No guessed classification/version/lot/supply facts | N/A | Yes | Yes |
| Product scalar/lot reconciliation | Native fixture | Reviewed fixture | Yes |
| Selected-lot legacy evidence | N/A | Yes | Yes |
| Query plans use required indexes | Yes | Yes | Final |
| No Internet access | Yes | Yes | Yes |

The migration check inventory, TypeScript compilation list, migration index,
`schemaVersion`, reset inventory, and documented migration IDs must agree.

## Reset and count integration

`resettableTables` must include every new data table in foreign-key-safe,
child-first order. `schema_migrations` remains excluded so a pilot reset
clears user data without pretending to uninstall schema.

Reset verification must:

1. seed representative rows in every new root and child table;
2. execute the existing exclusive reset;
3. prove all resettable data tables are empty;
4. prove the migration ledger and schema remain intact; and
5. run foreign-key and integrity checks.

`countableTables` is not a mirror of every physical table. Add only
owner-visible root counts needed by diagnostics or pilot verification.
Large line, allocation, and history tables should not be counted on every
diagnostic read without a measured requirement. Any count contract change
must update its TypeScript type and consumers together.

## Precision, unit, branch, and report protections

- Existing SQLite `REAL` and JavaScript `number` storage remains.
- No migration rounds, rescales, or converts historical money or quantity.
- New cost contributions store unrounded snapshots; display rounding remains
  presentation-only.
- Quantity comparisons use the shared tolerance, not exact floating-point
  equality.
- Existing `piece`/`pcs` and other unit differences are not normalized by
  migration. Native publication/allocation requires an explicit compatible
  unit or snapshotted Item conversion.
- Branch-specific and branch-null shared Product behavior is retained.
  Inconsistent legacy scope is flagged, not rewritten.
- Existing Product COGS, spoilage, transfer, fixed-cost, and profit formulas
  remain unchanged for historical rows.
- New supply and adjustment categories are added to reports explicitly and
  cannot be silently merged into Product COGS.

## Delete and foreign-key protections

Existing cascade behavior remains untouched in migrations `001` through
`010`, but it is never treated as permission to delete.

New tables follow these rules:

- history references use `RESTRICT`, or `SET NULL` with immutable snapshots;
- cascade is limited to genuinely ephemeral draft-owned children;
- Recipe versions, plan execution, lots, usages, adjustments, sales, and
  production evidence survive archive;
- permanent delete runs a complete reference check and delete in one
  exclusive transaction; and
- a missing table, failed query, unknown reference kind, or race denies
  deletion.

## Rollback and correction strategy

There are no down migrations. Adding destructive SQL that claims to restore
the pre-redesign database would be unsafe because native identity, versions,
lots, and supply evidence cannot be losslessly projected into schema v10.

Rollback is operational and forward-only:

### Before native features are enabled

- Keep the new tables.
- Disable the new creation/review entry points.
- Continue the proven legacy readers and writers.
- Retain the compatibility-aware Kiosk predicate.

### After native or reviewed data exists

- Keep migrations and new data.
- Disable only the affected workflow behind its feature/readiness gate.
- Continue mandatory reconciliation and dual-write behavior for any
  native/reviewed Product that already exists, or make that record read-only
  until corrected.
- Preserve the compatibility-aware Kiosk and checkout validation paths.
- Repair schema or data with the next forward migration ID; never edit an
  applied migration.

Installing an older binary after native writes is unsupported because that
binary cannot understand the new readiness or lot evidence. Release
rollback must use a compatible forward-fixed build, not a schema downgrade.

### During migration failure

The exclusive migration transaction rolls back and no ledger row is written.
The next startup retries the same immutable migration. If integrity or schema
verification fails, startup blocks domain writes and reports the condition;
it does not reset, drop, or rebuild the owner's database.

## Phase B exit conditions

Migration work is not complete until:

- `011` through `014` are the only new migrations;
- `001` through `010` are unchanged;
- fresh, populated-v10, repeat-run, forced-failure, and resume checks pass;
- Kiosk compatibility filtering ships before native Product creation;
- all existing IDs/history and report results are preserved;
- ambiguous rows remain review-required;
- no legacy Product lot is mass-created;
- all Product-stock writers honor the scalar/lot transition;
- reset, counts, schema version, and check inventories agree; and
- the transaction checks in
  [transaction-impact-analysis.md](transaction-impact-analysis.md) pass.
