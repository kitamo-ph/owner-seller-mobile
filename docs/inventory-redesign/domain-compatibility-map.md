# Domain compatibility map

## Architecture decision

Use an additive `catalog_items` semantic identity and `legacy_item_bindings`. Do not merge, rename, or replace existing Products, Ingredients, IDs, foreign keys, lots, sales, production batches, bundle pricing, movements, or snapshots.

The catalog owns the new six-way classification, lifecycle, readiness, price-completeness, stock policy, and Paluto identity. Bindings connect a catalog item to an existing Product or Ingredient projection by exact ID; names are never used to merge identity.

This resolves two compatibility problems:

1. `ProductType` is presentation metadata and cannot safely classify legacy records.
2. Supplies must not become Products, and native non-sellable Product projections must not become Kiosk candidates under the legacy query.

## Catalog and binding contract

### `catalog_items`

Proposed core fields:

- stable ID and business scope;
- optional branch/location policy;
- owner-facing name and normalized search name;
- classification: the six approved values or internal `legacy_unclassified`;
- lifecycle: draft, ready, active, archived;
- classification-review flag;
- sellable and Kiosk-enabled flags;
- purchase-cost-known and selling-price-known flags;
- stock-tracking policy;
- archive timestamps; and
- standard sync/deletion metadata consistent with the repository.

### `legacy_item_bindings`

Each binding records:

- catalog item ID;
- entity kind (`product` or `ingredient`);
- exact legacy entity ID;
- projection role and compatibility mode;
- created/reviewed timestamps; and
- uniqueness on `(entity_kind, legacy_entity_id)`.

A native purchased ingredient or supply receives an Ingredient projection because current Ingredient lots and movements remain proven. A native prepared base, finished item, direct resale item, or retained bundle receives a Product projection when it needs Product stock or sale compatibility.

Creating native Product projections is feature-gated until the Kiosk reader understands catalog readiness. An ordinary old binary would otherwise expose prepared bases because the current query ignores Product `active`.

## Existing entity reuse

| Existing entity | Current meaning | Target reuse | Compatibility rule |
| --- | --- | --- | --- |
| `products` | Branch-specific or business-shared scalar sale/output stock with price, cost, and inline bundle pricing | Compatibility projection for prepared bases, finished Products, resale Products, and retained bundles | Preserve IDs/fields. Product scalar stock remains availability authority during transition. Native/reviewed Product lots are exact evidence and must reconcile. |
| `ingredients` | Business-wide definition whose stock/cost lives in lots | Compatibility projection for purchased ingredients and supplies | Preserve IDs and active state. Catalog carries target classification/lifecycle. |
| `ingredient_lots` | Purchased stock/cost selected explicitly by legacy recipe lines | Ingredient/supply purchase lots | Preserve every row/value. Add optional expiry/Supplier/Receipt links plus nullable authoritative cost shadows and explicit cost state; keep existing non-null cost columns as compatibility fields. |
| Ingredient movements | Purchase, consumption, and adjustment history | Ingredient/supply ledger | Extend structured origin/reason references; never rewrite old rows. |
| `recipes` | Mutable flat header with one output Product | Stable legacy recipe family and compatibility pointer to active immutable version | Preserve ID/output Product. Bind output to catalog identity. |
| `recipe_ingredient_lines` | Exact selected Ingredient lot or custom-cost line | Imported legacy-version evidence | Preserve rows. New native version lines reference catalog items, not purchase lots. |
| `production_batches` and usages | Flat batch plus selected-lot/custom snapshots | Historical authority plus nullable version/plan/expected-output links | Never infer an old version when unprovable. |
| `sales`, items, cook usages | Existing checkout, price, and COGS evidence | Historical authority | Add separate Product-lot and supply evidence for native writes; do not recalculate old COGS. |
| Product inventory movements | Scalar Product stock history | Product compatibility ledger | Preserve. Add structured native origins where new writes can prove them. |
| Product bundle fields | Advantageous quantity pricing on one Product | `legacy_quantity_pricing` compatibility behavior | Do not infer composite bundle identity or components. Preserve current arithmetic. |
| Transfers, spoilage, fixed costs, receipts, reports | Protected operations/accounting | Existing behavior | Update explicitly and only where new stock/cost categories require it. |

The detailed baseline is in [domain-entity-inventory.md](../mob-0-1-discovery/domain-entity-inventory.md), [sqlite-schema-inventory.md](../mob-0-1-discovery/sqlite-schema-inventory.md), and [protected-business-invariants.md](../mob-0-1-discovery/protected-business-invariants.md).

## Additive entities

Names remain architectural until Phase B verifies SQLite statements and naming conventions.

| Entity | Responsibility | Key relationship |
| --- | --- | --- |
| `catalog_items` | Unified semantic identity and owner-facing state | Business; optionally native Product/Ingredient projections through bindings |
| `legacy_item_bindings` | Exact, non-name-based legacy mapping | Catalog item to Product or Ingredient |
| `recipe_versions` | Immutable recipe header/yield | Stable Recipe and output catalog item |
| `recipe_version_lines` | Immutable component/role/conversion snapshot | Catalog leaf or exact child recipe version; optional imported selected lot |
| `catalog_item_recipe_roles` | Explicit primary/alternate/Kiosk recipe-family selection | Catalog output item and stable Recipe |
| `recipe_drafts` / `recipe_draft_lines` | Mutable restart-safe editing and unresolved nested return | Catalog item, source version, child draft/version |
| `item_unit_conversions` | Owner-configured item-specific conversion versions | Catalog item, from/to units, factor, supersession |
| `product_stock_lots` | Exact native/reviewed Product purchase or production evidence | Product binding and origin batch/receipt |
| `sale_product_lot_usages` | Exact Product lot contribution for native sale COGS | Sale item and Product lot |
| `production_plans` | Saved calculation intent | Root recipe version and target |
| `production_plan_stages` | Topological preparation sequence | Plan and exact recipe version |
| `production_plan_requirements` | Expanded requirements with provenance | Stage and catalog item |
| `production_plan_allocations` | Explicit recommended/manual lot choices | Requirement and Ingredient/Product lot |
| `suppliers` / `purchase_receipts` | Optional Grocery facts | Business/branch and optional supplier |
| `supply_usage_rules` | Versioned per-product/per-quantity/per-order suggestion | Supply catalog item and optional target |
| `sale_supply_usages` / lot usages | Reviewed actual supply and exact cost/deduction | Sale, supply catalog item, Ingredient lot |
| `stock_adjustments` / allocations | Owner-authorized reason, before/after, and per-lot evidence | Catalog item, Product/Ingredient projection, movements |

## Source-of-truth decisions

### Ingredient and supply stock

`ingredient_lots` remains authoritative. Native catalog items bind to an Ingredient. No duplicate generic lot ledger is introduced.

Because existing Ingredient-lot cost columns are non-null, optional native costs use nullable `recorded_total_cost`/`recorded_cost_per_unit` shadows plus `known`, `unknown`, or `legacy_review` state. Native readers never interpret the required legacy zero sentinel as a known cost.

### Product stock

During this redesign:

- `products.stock_qty` remains the availability authority required by existing Kiosk, transfer, stock, and reporting behavior.
- `product_stock_lots` is exact acquisition/production and allocation evidence only for native or owner-reviewed catalog items.
- Every native Product mutation dual-writes scalar stock, Product lot balance, and movement in one transaction.
- A legacy Product receives a marked `legacy_balance` Product lot only when the owner reviews/enables native lot behavior. It is not mass-backfilled.
- Initialization copies the recorded quantity and cost without claiming purchase/production provenance.
- A reconciliation mismatch blocks native allocation; it is never silently repaired.

This transition must be revisited only after every Product stock writer and reader has migrated. A later source-of-truth flip is out of scope.

### Branch and location

Catalog and Product-lot queries preserve current branch-specific versus branch-null shared semantics. New production must require that a branch-specific Product projection matches the selected branch; a shared Product remains business-wide. Existing mismatched history is preserved and flagged, not rewritten.

## Recipe constraints

- A native version line has exactly one source: catalog leaf, exact child recipe version, or explicit custom-cost line.
- Lines reference stable item identity, not a purchase lot. Execution chooses explicit allocations.
- Imported legacy lines retain selected-lot IDs/snapshots and allocation mode `legacy_selected`.
- A child edge pins the exact version; “latest” is never resolved while reading history.
- A draft may have unresolved placeholders; a published version may not.
- Published versions are immutable.

## Legacy upgrade mapping

Migration copies facts and flags ambiguity:

| Legacy fact | Safe result |
| --- | --- |
| Existing Product | One catalog item and exact Product binding; classification `legacy_unclassified`; compatibility-visible; review required. |
| Existing Ingredient | One catalog item and exact Ingredient binding; review required unless owner classifies it. |
| `ProductType`, name, `active`, positive/zero price | Preserved metadata only; never classification proof. |
| Product with bundle fields | Retain `legacy_quantity_pricing`; do not infer a component combo. |
| Product scalar stock | Preserve exactly; no mass Product-lot reconstruction. |
| Existing recipe/lines | One imported current-definition version; retain selected-lot and snapshot evidence. |
| Multiple active Recipes for one Product | Import every family/version; assign no inferred primary role; retain current legacy Kiosk resolution until owner review. |
| Existing batch/sale | Preserve every value. Version link remains null or `legacy_version_unknown` unless exact provenance is proven. |
| Zero price/cost | Preserve zero and mark completeness ambiguous; never infer missing versus free. |
| Free-text lot source | Preserve text; do not create a verified Supplier relation. |

No migration recalculates money, quantity, COGS, stock, timestamps, or identifiers.

## Kiosk compatibility predicate

Before any native Product can be created, `loadKioskContext` must distinguish:

- unbound or `legacy_unclassified` Product: retain the exact current branch/shared visibility rule;
- native/reviewed Product: require active catalog lifecycle, supported sale classification, explicit sellable, explicit Kiosk-enabled, known selling price, valid branch scope, and an explicit valid Kiosk recipe role when cook-upon-order applies;
- Ingredient/supply-only binding: never a Product tile;
- draft/archived Product: never a native Product tile.

Checkout must also reload and revalidate native Product/context facts rather than trusting only cart snapshots. Legacy sale behavior stays compatibility-controlled until regression evidence supports tightening it.

## Archive and delete

- Catalog archive hides native records from normal selection but keeps bindings and all history resolvable.
- Existing cascade and `SET NULL` foreign keys are not delete authorization.
- The lifecycle service checks Product, Ingredient, lots, stock, recipes/versions, bundles, rules, plans, sales, production, movements, transfers, and adjustments inside one exclusive transaction.
- Failure or ambiguity denies permanent delete.
- New historical foreign keys prefer `RESTRICT` or retained snapshots. Cascade is limited to ephemeral draft children.

## Owner/Kiosk boundary

- Owner mode defines, classifies, purchases, allocates, adjusts, archives, and performs eligible delete.
- Kiosk reviews a sale and exact supply use only.
- Kiosk cannot resolve classification, edit purchase facts, manipulate lots, adjust stock, or bypass required supply minima.
- All operations remain local SQLite/offline-first with no Internet dependency.
