# Lot and costing design

## Baseline that must remain true

- Ingredient inventory and purchase cost are stored in separate `ingredient_lots`.
- Current recipe and production behavior consumes the explicitly selected lot; it is not FIFO or FEFO.
- Grocery purchase creates the Ingredient if needed, lot, and purchase movement atomically.
- Lot unit cost is the unrounded purchase total divided by purchased quantity.
- Money and quantities are SQLite `REAL` and JavaScript `number`, with no systematic calculation-stage rounding.
- Product stock is currently one scalar `products.stock_qty`; sale Product COGS uses stored snapshots/fallbacks.

The redesign preserves all existing lot rows and historical snapshots. It does not reinterpret current selected-lot behavior.

## Purchase lots

### Ingredients and supplies

Continue using `ingredient_lots`. Add optional:

- expiry date;
- Supplier and purchase Receipt references;
- nullable `recorded_total_cost` and `recorded_cost_per_unit` shadow values;
- cost state: `known`, `unknown`, or `legacy_review`; and
- structured source metadata.

Quantity and unit remain required. Cost, supplier, receipt, and expiry may be absent.

The existing `total_cost` and `cost_per_unit` columns are `REAL NOT NULL`; an additive migration cannot make them nullable safely. Native readers therefore treat the new nullable shadow values plus cost state as authoritative:

- legacy positive costs copy exactly into the shadow fields with state `known`;
- an ambiguous legacy zero keeps its original columns unchanged and receives state `legacy_review` with nullable shadows;
- a new known zero stores shadow zero with state `known`; and
- a new unknown cost stores `NULL` shadows with state `unknown`.

For a new unknown-cost lot, the required legacy columns receive a compatibility sentinel of zero only so the old table constraint can be satisfied. Native readers, costing, reports, and readiness checks must never treat that sentinel as a known cost. Native cost-optional writes remain disabled until every affected reader uses the explicit state. An older binary after native writes is unsupported as documented in [migration-plan.md](migration-plan.md).

A missing cost is always displayed and propagated as unknown, never as a known zero.

Supplies reuse Ingredient lots because they are purchased consumables, not sale Products.

### Direct resale Products

Add `product_stock_lots` so separate purchases at changing costs are retained. A purchase-origin lot stores Product, quantity/unit, total cost, unit cost, optional Supplier/Receipt/expiry, and exact remaining quantity.

Production-origin Product lots use the same table but point to a production batch and actual batch cost. This permits prepared/finished stock to retain batch provenance without replacing current `products.stock_qty` immediately.

## Allocation modes

Every committed allocation records one of:

- `legacy_selected`: exact lot pinned by an existing recipe line;
- `manual`: owner selected one or more lots;
- `recommended_fefo`: automatic recommendation selected earliest valid expiry first;
- `recommended_fifo`: automatic recommendation selected oldest purchase date first; or
- `legacy_balance`: explicitly labeled Product compatibility stock.

Existing recipe versions retain `legacy_selected`. FEFO/FIFO applies only to new automatic allocation and never silently changes an old version.

## Recommendation ordering

For new automatic allocations:

1. Candidate must match item, business/branch scope, compatible unit, active status, and positive remaining quantity.
2. Lots with valid expiry are ordered by expiry ascending.
3. Remaining ties and lots without expiry are ordered by purchase date ascending, then creation time, then stable ID.
4. The allocator consumes across as many lots as needed.
5. The saved recommendation contains exact lot IDs and quantities.

“FEFO where expiry exists, otherwise FIFO” is a recommendation policy. Execution still writes explicit allocations and revalidates them.

## Manual selection

Owner mode can allocate across lots, for example:

```text
Required raw rice: 5 kg
Sack A: 2 kg
Sack B: 3 kg
```

The UI shows source, date, expiry, remaining quantity, unit, and cost completeness. It prevents negative quantities and over-allocation before review. The service remains authoritative and rejects:

- cross-item or cross-context lots;
- incompatible units without a valid conversion;
- archived/empty lots;
- duplicate allocation rows unless intentionally coalesced;
- sum below or above required quantity beyond tolerance; and
- any guarded update that does not affect exactly one row.

Kiosk mode cannot perform administrative lot selection.

## Exact cost contribution

For each allocation:

```text
allocation cost = allocated quantity in lot unit × stored lot cost per unit
```

Conversions use the versioned Ingredient-specific factor snapshotted by the consuming recipe/version. The system persists:

- original allocation quantity/unit;
- normalized quantity/unit;
- lot unit cost;
- unrounded contribution;
- conversion/factor snapshot; and
- cost-completeness state.

Batch and order totals sum persisted unrounded contributions. Display and receipt formatting may round to the existing currency presentation rule. No centavo/integer-money migration or new decimal dependency is part of this redesign.

Comparisons use a shared tolerance (initially compatible with the current `1e-9` guard) and never use exact floating-point equality for quantities.

## Historical cost

- A later purchase never rewrites an older lot.
- Recipe version publication never rewrites a production batch.
- Sale Product COGS and supply usage keep exact lot/cost snapshots.
- Existing sale COGS continues to use its stored `cogs_total` and legacy fallback.
- A legacy Product balance lot is created only during explicit owner review/native-lot enablement. It copies the then-recorded quantity/cost and is marked as uncertain provenance; it does not claim exact historical acquisition cost.

## Grocery shopping requirements

`Shop by Recipe` uses the pure graph expansion and offers:

- direct recipe components;
- complete nested tree to purchased leaves; or
- one selected preparation stage.

It aggregates by stable item and compatible canonical unit, retaining per-path subtotals. Stock is compared across compatible available lots; the recipe's legacy selected lot does not artificially make other stock invisible in a shopping estimate.

Results group into:

- already in stock;
- need to buy;
- not enough stock;
- no purchase price;
- no supplier; and
- cost incomplete.

This is read-only until the owner records a purchase.

## Missing-price center

The Missing Prices view is a derived, focused query, not an authoritative table. It includes:

- Ingredient/supply definitions without any known current purchase cost;
- direct resale Products without a known purchase cost;
- finished Products without a known selling price;
- recipe versions with incomplete component cost; and
- plans with incomplete estimates.

Legacy zero values are marked for review because current storage cannot prove whether zero meant missing or intentional. New `*_known` flags disambiguate future values.

## Reconciliation

For a native or owner-reviewed Product, every Product stock mutation must update scalar stock and Product lots inside one transaction. Unreviewed legacy Products continue on the protected scalar path. A native reconciliation check compares:

```text
products.stock_qty
= sum(active product_stock_lots.remaining_quantity)
```

Branch-null shared versus branch-specific scope is part of that sum. A mismatch blocks native lot allocation and produces an owner-visible review issue; it is never silently repaired.

## Required indexes and checks

Indexes must support:

- available Ingredient lots by item/status/expiry/purchase date;
- Product lots by Product/branch/status/origin date;
- sale and production allocation history by lot;
- missing-cost and missing-price queries; and
- Supplier/Receipt lookup.

Tests must cover selected-lot regression, FIFO, FEFO, manual split, exact cost, insufficient quantity, history immutability, optional purchase facts, Product scalar/lot reconciliation, and query plans.
