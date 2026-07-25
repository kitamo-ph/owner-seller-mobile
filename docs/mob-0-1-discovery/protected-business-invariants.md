# Protected Business Invariants

## Purpose

State the business and local-integrity rules actually enforced by the current Owner–Seller mobile implementation so later Shared Contracts work does not simplify or reinterpret protected behavior.

## Scope and inspection context

- **Inspection date:** 2026-07-25
- **Repository:** `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile`
- **Branch:** `codex/pre-internal-hardening`
- **HEAD:** `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4`
- **Scope:** Checkout, bundles, grocery lots, recipes, production, COGS, spoilage, transfers, fixed costs, profit reports, audit history, owner/kiosk mode, reset, and transaction boundaries.
- **Excluded:** Any correction, migration, security redesign, accounting redesign, cloud behavior, or canonical contract.

Evidence labels: **Confirmed** is enforced or directly calculated by inspected code; **Likely** is expected from the used SQLite/Expo transaction API but was not failure-injected on-device; **Unresolved** is ambiguous or weakly enforced; **Proposed for later review** is not current behavior.

## Confirmed invariant register

The MOB-1 executive count is **21 identified protected invariants**. A “protected invariant” here means a current rule or calculation that future work must preserve or explicitly approve changing; it does not mean every rule is perfectly enforced under all races.

| ID | Current invariant | Enforcement and evidence | Known edge/risk |
| --- | --- | --- | --- |
| MOB-INV-001 | Mutating workflows operate inside an active Business and, where required, Branch context. | Owner setup/context services validate stored IDs; checkout/production/transfer inputs carry business/branch identity. | No durable membership or actor relation proves authorization. |
| MOB-INV-002 | Checkout requires a non-empty cart, positive item quantities, valid context/payment reference, and a discount no greater than subtotal before persistence. | [`kioskSales.ts`](../../src/services/kioskSales.ts) checks these conditions and resolves recipes/lots for protected costing/stock paths. | It trusts cart name/price/unit-cost snapshots and does not fully enforce product-to-active-branch membership at the lower layer; zero price is allowed. |
| MOB-INV-003 | A successful live checkout commits the Sale, SaleItems, stock/ingredient effects, movement history, one ReceiptRecord, and a pending queue record together. | One `withExclusiveTransactionAsync` in live checkout covers all writes. | Generic repository `createSale` is a divergent writer and makes receipt optional while omitting other protected effects. |
| MOB-INV-004 | Prepared finished-product sales cannot deduct more scalar product stock than is available at the guarded update. | Checkout checks and uses a guarded product decrement; failure aborts. | Generic product updates do not have a DB non-negative constraint. |
| MOB-INV-005 | Re-submitting the same non-null checkout token returns/uses one non-deleted Sale rather than committing a duplicate. | Partial unique index on `sales.checkout_token`, pre-read, and uniqueness-race reread. | Token/cart are in memory before success; restart loses an uncommitted draft/token. |
| MOB-INV-006 | Bundle pricing applies only to complete bundle groups when configured and cheaper than regular pricing; remainder units use regular price. | [`pricing.ts`](../../src/domain/pricing.ts) floors bundle count and compares bundled versus regular totals. | Bundle savings are not allocated to persisted line `discount_amount` by live checkout. |
| MOB-INV-007 | Cook-upon-order sales do not block solely because grocery stock is short; the line records estimated COGS and shortfall evidence. | Checkout planning and `sale_ingredient_usages` estimated/shortfall fields. | Guarded lot-update result is not checked before movement/usage insert, so stock and history may diverge in a race. |
| MOB-INV-008 | Sold COGS is snapshotted per SaleItem with its source; legacy null COGS falls back to `unit_cost × quantity` in reports. | Checkout COGS selection plus [`profitReports.ts`](../../src/services/profitReports.ts) SQL fallback. | Production-average scope and binary floating-point precision are unresolved. |
| MOB-INV-009 | A grocery purchase creates/gets the Ingredient, creates its Lot, and appends the purchase movement atomically. | Exclusive transaction in [`groceryPool.ts`](../../src/services/groceryPool.ts). | Same-name ingredient identity and concurrent creation constraints are limited. |
| MOB-INV-010 | Ingredient consumption is selected-lot, not FIFO, and only exact or supported metric-unit conversions are used. | Recipe line stores lot ID/snapshots; conversion allows same unit, `g`↔`kg`, `ml`↔`L`. | Pack sizing and fallback lot policy are unresolved. |
| MOB-INV-011 | Manual lot adjustment requires an unarchived lot and constrains new remaining quantity to `0 <= remaining <= purchased_quantity`, appending its movement with the update. | Exclusive adjustment transaction, validation, and guarded update. | No ingredient-lot spoilage workflow exists despite the enum value. |
| MOB-INV-012 | Recipe creation preserves quantity, selected/custom source, and cost/source snapshots for each ingredient line. | Exclusive recipe-plus-lines transaction and costing functions. | Recipe-line edit/version history is absent. |
| MOB-INV-013 | Production validates positive multiplier/output, compatible units, and sufficient selected-lot quantities before committing. | Production planning plus guarded lot decrements in [`production.ts`](../../src/services/production.ts). | Finished-product output has no lot-level identity. |
| MOB-INV-014 | Successful production deducts ingredients, records usage/batch history, increments finished stock, writes a cooked movement, and resolves the product alert in one SQLite transaction. | Exclusive production transaction and affected-row checks. | Alert `open`/`active` legacy vocabulary remains inconsistent. |
| MOB-INV-015 | A finished-product transfer is value-neutral for profit and commits source decrement, destination increment/clone, transfer record, and paired out/in movements together. | Exclusive transfer transaction; reports show transfer value but exclude it from profit. | Destination same-name lookup occurs before transaction and does not verify type/unit compatibility or changed-row count. |
| MOB-INV-016 | Finished-product spoilage cannot exceed available scalar stock; it decrements stock and records a costed spoilage movement atomically. | Exclusive transaction in [`stockOps.ts`](../../src/services/stockOps.ts); average-produced cost else product cost. | No reversal/correction link and no ingredient-lot spoilage writer. |
| MOB-INV-017 | Protected workflows retain display/cost/source snapshots and movement/usage history rather than relying only on live source rows. | Sale lines, receipts, recipe lines, production/sale usages, transfers, and movements. | Full pilot reset hard-deletes all history; DB permissions do not make it immutable. |
| MOB-INV-018 | Fixed cost expense is accrued for each due-date occurrence in the report range whether paid or not; payment rows are cash-flow visibility. | [`fixedCosts.ts`](../../src/services/fixedCosts.ts) occurrence calculation. | Currently archived costs stop participating even in recomputed historical periods; payment duplicate check can race. |
| MOB-INV-019 | Profit recognizes cost when goods are sold, adds fixed-cost occurrences and recorded spoilage as expenses, and excludes production cost, unsold inventory, and transfers from expense. | [`profitMath.ts`](../../src/domain/profitMath.ts) and report SQL. | No cancellation/refund model; device timezone and archive state affect results. |
| MOB-INV-020 | Owner mode is UI-gated by optional local PIN/biometric state; kiosk mode can perform seller-facing checkout without a persisted seller identity. | Owner access service/store/gate and route structure. | Repositories/services have no actor/role authorization argument; UI hiding/gating is the lower boundary. |
| MOB-INV-021 | Destructive pilot reset requires UI confirmation/owner verification and hard-deletes application tables in a child-first exclusive transaction while preserving the migration ledger. | Business-settings flow, pilot-data service, reset repository, and table order. | SecureStore is cleared before DB deletion, so the two stores are not atomic; exported service has no embedded authorization guard. |

## Checkout invariant analysis

### Start, validation, and persistence

- **Confirmed:** A seller builds an in-memory cart in [`kioskStore.ts`](../../src/state/kioskStore.ts). The store holds the cart, checkout token, last receipt, and shift-local display state; there is no persisted draft transaction.
- **Confirmed:** Checkout calls `completeKioskSale`, validates business/branch context, non-empty cart, positive quantities, payment-reference requirements, and discount bounds, and resolves recipe/lot evidence for protected paths. It does not independently reload/validate every cart name, price, or unit-cost snapshot, does not require positive price, and does not fully enforce product-to-active-branch membership at the lower layer.
- **Confirmed:** Prepared-stock products are checked and atomically decremented. Cook-upon-order products use their recipe/lot plan, but shortfall does not block the sale.
- **Confirmed:** The live transaction writes:
  1. `sales`
  2. `sale_items`
  3. prepared product stock deductions and `inventory_movements`
  4. cook-upon-order ingredient lot deductions, `ingredient_movements`, and `sale_ingredient_usages`
  5. one `receipt_records` row
  6. one pending `offline_queue` row
- **Confirmed:** Receipt text and line fields retain human-readable/item cost snapshots.

### Plain-language checkout atomicity invariant

> A live checkout either commits the sale and all of its local stock, cost, history, receipt, and pending-sync evidence together, or it should commit none of them; duplicate submission with the same non-null checkout token must not create a second sale.

The rollback portion is **Likely** under the Expo SQLite transaction contract when a callback throws. Source inspection confirms throw paths and a single transaction, but this task did not inject device/database failures.

### Duplicate, interruption, and partial-write risks

- The partial unique token index is the durable duplicate guard. A token is unique only when non-null and `deleted_at IS NULL`.
- If an insert loses a uniqueness race, checkout rereads the token and returns the existing Sale.
- Before commit, the cart/token exists only in memory. Process death can discard the cart; there is no interrupted-checkout recovery record.
- The offline queue records only a committed sale; it does not recover an incomplete checkout and has no active consumer.
- **Unresolved risk:** cook-upon-order executes a guarded lot update but does not inspect its changed-row result before inserting usage/movement evidence.
- **Confirmed divergent path:** [`src/db/repositories/sales.ts`](../../src/db/repositories/sales.ts) can create a Sale/Items/Receipt transaction but omits live checkout stock, movement, token, cook COGS, and queue behavior. No current live caller was found.

### Checkout permissions and checks

- Kiosk/seller-facing checkout does not require owner PIN at the service boundary.
- No persisted seller/user/shift ID is written to Sale.
- Relevant available scripts are `check:pricing`, `check:cogs`, `check:pilot`, and `check:migrations` (including checkout-token index evidence). There is no full checkout, receipt, or profit-report SQL service integration test. The scripts are source/Node checks rather than a physical-device fault-injection suite.

## Inventory-lot analysis

### Finished products

- **Confirmed:** Finished Product stock is one `products.stock_qty` scalar, optionally scoped to Branch. There is no finished-product lot.
- Production increments that scalar; prepared checkout, transfer, and spoilage decrement it.
- Guarded decrement paths prevent negative stock for protected operations. Generic product repository update can still set a value without a database range check.
- Cost uses product cost or production-average evidence depending on the workflow.

### Grocery ingredients and lots

- A grocery purchase records acquisition date, purchased/remaining quantity, explicit unit, total cost, and cost/unit on `ingredient_lots`, plus a purchase movement.
- IDs use current local ID generation.
- Depletion is explicitly selected-lot. No FIFO ordering policy was found.
- Recipe lines retain selected lot ID and cost/source snapshots; production and cook-upon-order usage retain their own snapshots.
- Production and manual adjustment enforce remaining-quantity bounds. Cook-upon-order is deliberately best-effort for shortfall.
- Lot status can become `depleted` or `archived`; no normal `deleted_at` writer exists.
- **Confirmed absent:** ingredient-lot transfer and ingredient-lot spoilage writer. `IngredientMovementType` contains `spoilage`, but no active path writes it.
- **Unresolved:** reversal/correction semantics, concurrency across devices, and fallback when a selected lot is unavailable.

## Recipes and production analysis

- A Recipe belongs to Business, targets an output Product, stores output quantity/unit and production mode, and has ingredient lines.
- Each line is either selected ingredient/lot evidence or a custom line, with optional override and cost/source snapshots. Creation validates the shape and writes recipe plus lines atomically.
- Supported unit conversion is limited to same-unit, `g`↔`kg`, and `ml`↔`L`.
- Production multiplies recipe quantities, validates compatibility/availability, and disallows committing partial production when a selected lot is insufficient.
- A production commit atomically deducts lots, creates ingredient movements and usage snapshots, creates the batch, increments output Product stock, creates a cooked movement, and resolves the related stock alert.
- `totalBatchCost = sum(production usage lineCost)`.
- `costPerOutputUnit = totalBatchCost / produced outputQuantity`.
- No calculation-stage money/quantity rounding occurs.
- Historical batch/usage snapshots survive source relation loss through nullable `SET NULL` references until reset.
- **Confirmed separate legacy behavior:** `recipe_batches`/`recordCookedBatch` logs batches and servings without ingredient usage. It is not automatically equivalent to `production_batches`.

## Bundle analysis

- A bundle is not a separate entity and has no component table. It is optional pricing metadata on one Product: quantity, price, and label.
- Bundle availability uses the same product stock as regular units; checkout deducts the total SaleItem quantity.
- Pricing:

```text
regularTotal = quantity × unitPrice
bundleCount = floor(quantity / bundleQuantity)
remainder = quantity mod bundleQuantity
bundledTotal = bundleCount × bundlePrice + remainder × unitPrice

use bundle only if:
  bundleQuantity > 1
  bundlePrice > 0
  bundleCount > 0
  bundledTotal < regularTotal
```

- Bundle pricing changes revenue/line total, not physical composition or unit COGS.
- `bundle_applied` is snapshotted on SaleItem. Product inventory editing can change/clear bundle fields for future checkouts; prior SaleItem snapshots remain.
- **Unresolved:** persisted discount allocation. Pricing calculates savings, but live checkout writes SaleItem `discount_amount = 0` and stores cart discount on Sale.

## Spoilage and transfer analysis

### Spoilage

- Applies to scalar finished-product stock only.
- Requires a positive quantity and available stock.
- In one transaction: guarded Product decrement, then an `inventory_movements` row of type `spoilage`.
- Cost is the average produced cost when available, else the Product cost; total loss is quantity × selected unit cost.
- Report expense is the sum of spoilage movement `total_cost` in the report time range.
- No reversal/correction relation or ingredient-lot spoilage writer exists.

### Transfers

- Applies to finished Product stock between branches.
- Cost preview/recording uses current unit-cost logic and snapshots `unit_cost`/`total_cost`.
- In one transaction: source guarded decrement, destination increment or clone, `product_transfers` insert, `transfer_out` movement, and `transfer_in` movement.
- Transfers are value movement only and never reduce profit.
- The service looks up a same-name destination Product before the transaction; name is not unique, type/unit compatibility is not checked, and destination update affected-row count is not checked. This is a **Confirmed risk**, not an approved identity rule.
- No reversal/compensating transfer exists.

## Fixed-cost and profit analysis

### Fixed costs

- FixedCost stores amount, category, frequency, due/start/end local dates, optional Branch, and status.
- Occurrences are generated for due dates inside the requested range.
- Every occurrence is an expense whether paid or unpaid; payment rows are visibility, not the expense-recognition trigger.
- Active payment writer creates `paid`. `skipped` is declared but has no writer.
- Duplicate payment prevention is a read-before-write check, not a unique business key or atomic idempotency operation.
- Archived FixedCosts are excluded from occurrence generation. Because no archive-effective timestamp exists, recomputing an old period after archive can remove cost from that report.
- No general Expense entity exists.

### Exact report formulas

```text
revenue =
  SUM(sales.amount)
  for non-deleted sales in the selected instant range

soldCogs =
  SUM(COALESCE(sale_items.cogs_total,
               sale_items.unit_cost × sale_items.quantity))
  joined to non-deleted sales/items in the range

grossProfit =
  revenue - soldCogs

fixedCosts =
  SUM(number of active FixedCost due-date occurrences in range
      × FixedCost.amount)

spoilageLoss =
  SUM(inventory_movements.total_cost)
  where movement_type = "spoilage" and row is non-deleted in range

netProfit =
  revenue - soldCogs - fixedCosts - spoilageLoss
```

- Production cost is informational; adding it to sold COGS would double-count.
- Current unsold finished-product value and remaining grocery value are inventory information, not expenses.
- Transfer values are informational and excluded from profit.
- Report boundaries begin at device-local midnight/week Monday/month start and are converted to UTC ISO strings; fixed costs use local date strings.
- No calculation-stage rounding occurs.
- There is no cancelled/refunded Sale treatment because no such representation exists.

## Role-boundary analysis

- Owner access is local optional PIN/biometric state stored outside SQLite, with throttled verification and an Owner route gate. No sensitive values were read or reported.
- Kiosk/seller mode is route and in-memory session state, not a persisted Seller/User entity.
- Owner routes expose business setup, inventory configuration, recipes, production, grocery, transfers, fixed costs, reports, notifications, diagnostics, and reset.
- Kiosk routes expose selling/checkout, orders, shift summary, stock visibility/alerts, help, and problem reporting.
- Repositories/services do not accept actor, role, membership, or authorization context. A direct caller can invoke exported mutation/reset functions without the UI gate.
- **Confirmed:** production safeguards are workflow validation/transactions, not role enforcement.
- **Unresolved:** future membership, seller attribution, offline authorization, and server enforcement. Authentication is outside MOB-1.

## Likely findings

- Transaction callbacks that throw roll back their SQLite writes as intended by the Expo API.
- Stored snapshots and append-oriented history are intended to preserve offline audit meaning.
- The split between owner and kiosk screens is a product role boundary, but it is not a security boundary below UI/service orchestration.

## Unresolved findings

- Cook-upon-order guarded-update/history divergence under a real concurrent change.
- Fixed-payment duplicates under concurrent calls.
- Destination product behavior under same-name ambiguity/concurrent transfers.
- Sale/refund/reversal and stock correction semantics.
- Bundle discount allocation and production-average COGS horizon.
- Whether owner access is required or optional for every production distribution.

## Risks

1. A future “generic save Sale” contract could omit protected checkout side effects.
2. Recomputing COGS or profit under textbook/accounting assumptions different from current code would change reports.
3. Retrying non-idempotent production, transfer, spoilage, recipe, or grocery commands without mutation IDs could duplicate effects.
4. Treating UI owner mode as authenticated authorization would expose destructive or financial operations.
5. Treating ingredient depletion as FIFO or products as lots would alter current inventory behavior.

## Shared Contracts implications

- Preserve these 21 invariants as compatibility requirements or require explicit product/finance approval to change one.
- Prefer command/result contracts for multi-table workflows over independent row CRUD.
- Carry snapshot provenance, estimated/shortfall flags, movement type, and legacy fallback fields.
- Do not encode current risks as desirable canonical rules; record them as Under Review decisions.
- Only local non-null checkout-token idempotency is **Confirmed**. Cross-system idempotency and mutation IDs for every command remain unresolved and approval-gated.

## Evidence sources and files inspected

- [`src/services/kioskSales.ts`](../../src/services/kioskSales.ts)
- [`src/domain/pricing.ts`](../../src/domain/pricing.ts), [`recipeCosting.ts`](../../src/domain/recipeCosting.ts), [`profitMath.ts`](../../src/domain/profitMath.ts)
- [`src/services/groceryPool.ts`](../../src/services/groceryPool.ts), [`recipes.ts`](../../src/services/recipes.ts), [`production.ts`](../../src/services/production.ts)
- [`src/services/stockOps.ts`](../../src/services/stockOps.ts), [`transfers.ts`](../../src/services/transfers.ts)
- [`src/services/fixedCosts.ts`](../../src/services/fixedCosts.ts), [`profitReports.ts`](../../src/services/profitReports.ts)
- [`src/services/ownerAccess.ts`](../../src/services/ownerAccess.ts), [`pilotData.ts`](../../src/services/pilotData.ts)
- Related repositories, migrations, state stores, routes, and `scripts/check-*.js`

## Commands executed

- `rg` traced transaction sites, stock/lot guards, COGS sources, pricing, report formulas, statuses, role gates, and all writers.
- `nl -ba`/`sed -n` inspected each protected service, pure domain calculation, repository, route workflow, and check script.
- Static Node checks and schema replay cross-checked constraints and source invariants.
- No production data, physical device, network, signing state, or release artifact was mutated.

## Limitations

- No concurrent-device, process-kill, disk-full, or injected-SQLite failure test was run.
- No physical-device PIN/biometric or route-bypass penetration test was run.
- No live data was reconciled against report formulas.
- No formal unit/integration test runner or coverage report exists.
- The report documents current source behavior; it does not certify accounting, security, or synchronization correctness.

## Next approval gate

Product, finance, inventory, mobile, backend, security, and Shared Contracts owners must review the invariant register and the 21 open semantic decisions before MOB-2. No protected behavior may be renamed, simplified, migrated, or reimplemented based solely on this document.
