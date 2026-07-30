# Shared Contracts Evidence Map

## Purpose

Provide an evidence worksheet for `kitamo-ph/shared-contracts` that preserves current Android meaning while leaving every unapproved canonical destination and transformation explicitly unresolved.

## Scope and inspection context

- **Inspection date:** 2026-07-25
- **Source repository:** `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile`
- **Branch:** `codex/pre-internal-hardening`
- **HEAD:** `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4`
- **Target context:** Future `kitamo-ph/shared-contracts`; that repository was not opened or modified in this task.
- **Scope:** Compatibility evidence for all 23 persisted application entities and protected multi-table workflow boundaries.
- **Excluded:** Canonical schemas/code, approved mappings, data migration, authentication, cloud sync, or backend implementation.

Evidence labels: **Confirmed** is supported by current mobile source; **Likely** is supported but not verified on a production database; **Unresolved** needs a decision; **Proposed for later review** is not current behavior.

## Authority rule

- **Confirmed:** This mobile repository is authoritative for existing offline behavior at this baseline.
- **Proposed for later review:** Shared Contracts may later become authoritative for cross-system machine-readable meaning only after explicit approval.
- No worksheet row below is `Approved`. `Under Review`, `Proposed`, and `Deferred` are evidence states, not authorization.
- The word `stall` appears only as a known future direction for a possible Branch mapping. Current SQLite and TypeScript names remain `branches` and `Branch`.

## Entity compatibility worksheet: current data semantics

The worksheet is split across two tables keyed by Entity so every required field remains readable.

| Entity | Legacy source | Current Android meaning | Candidate canonical destination | Transformation | Precision and rounding | Null behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Business | `businesses`; `Business` | Top-level owner business profile; PHP currency and operating classification | Unresolved `Business` | None approved; retain all legacy fields | Text; no numeric rounding | Contact/notes/deleted timestamp nullable |
| Branch | `branches`; `Branch` | Business-scoped operating location with branch-type discriminator | Future `Stall` direction is Under Review; destination unresolved | Possible rename/discriminator mapping, not approved | Text; active integer→boolean is lossless | Location/notes/deleted timestamp nullable |
| Product | `products`; `Product` | Branch-optional sellable item plus scalar finished-stock, price/cost, and optional bundle pricing | Unresolved Product/Catalog + branch-stock model | Split/rename unresolved | Money/quantity `REAL`; no stored rounding | Branch/bundle fields/deleted timestamp nullable |
| Sale | `sales`; `Sale` + checkout token column | Committed local transaction header; no seller/cancel/refund identity | Unresolved Sale/Order | Header and actor mapping unresolved | Money `REAL`; no calculation rounding | Branch/reference/notes/token/deleted timestamp nullable |
| SaleItem | `sale_items`; `SaleItem` | Immutable-like sale line snapshot with price/cost/bundle/COGS provenance | Unresolved SaleLine | Field rename and discount reconciliation unresolved | Money/quantity `REAL`; no calculation rounding | Product/branch/COGS/recipe/deleted timestamp nullable |
| InventoryMovement | `inventory_movements`; `InventoryMovement` | Append-oriented finished-product stock event with direction encoded by movement type | Unresolved InventoryMovement/StockEvent | Event/type mapping unresolved | Quantity/cost `REAL`; outgoing quantity normally positive; no rounding | Branch/product/sale/cost/deleted timestamp nullable |
| RecipeBatch | `recipe_batches`; `RecipeBatch` | Legacy cooked-batch log without ingredient usage | Unresolved legacy production record | Must not synthesize missing recipe/ingredient links | Batches/servings/cost `REAL`; no rounding | Branch/notes/deleted timestamp nullable |
| OwnerAlert | `owner_alerts`; `OwnerAlert` | Local owner notification, often product/stock related | Deferred alert contract | `open`/`active` compatibility mapping unresolved | Non-numeric except timestamps | Branch/product/deleted timestamp nullable |
| ReceiptRecord | `receipt_records`; no standalone model | Stored human-readable receipt text snapshot for a Sale | Deferred structured Receipt | Text parsing would be lossy; retain raw text if mapped | Embedded display money is two decimals; not source precision | Branch/sale/deleted timestamp nullable |
| OfflineQueueItem | `offline_queue`; no standalone model | Pending local JSON sale-create evidence; no active consumer | Unresolved sync envelope/outbox, not necessarily an entity | Versioned payload mapping required; none approved | JSON may contain `REAL`-origin numbers | Business/branch/error/deleted timestamp nullable |
| AppSetting | `app_settings`; `AppSetting` | Local typed key/value preferences and active-context pointers | Mostly Deferred/local-only; per-key decision required | Per-key classification/typing unresolved | Number values serialize through text; no rounding rule | Row/value non-null; missing key is distinct from stored false/zero/empty |
| Ingredient | `ingredients`; `Ingredient` | Business ingredient catalog with default unit and low-stock threshold | Unresolved Ingredient | Identity/unit mapping unresolved | Threshold `REAL`; no rounding | Deleted timestamp nullable |
| IngredientLot | `ingredient_lots`; `IngredientLot` | Selected grocery lot with acquisition date, remaining quantity, and cost | Unresolved InventoryLot | Preserve selected-lot source; no FIFO conversion | Quantity/money `REAL`; no rounding | Brand/source/notes/deleted timestamp nullable |
| IngredientMovement | `ingredient_movements`; `IngredientMovement` | Grocery lot/history event for purchase, adjustment, or recipe usage | Unresolved IngredientMovement | Event/sign mapping unresolved | Quantity/cost `REAL`; downward adjustment is negative | Lot/cost/deleted timestamp nullable |
| Recipe | `recipes`; `Recipe` | Product-output recipe with production mode and active flag | Unresolved Recipe | Versioning/output mapping unresolved | Output quantity/price `REAL`; no rounding | Suggested price/notes/deleted timestamp nullable |
| RecipeIngredientLine | `recipe_ingredient_lines`; `RecipeIngredientLine` | Selected-lot or custom recipe input with cost/source snapshots | Unresolved RecipeComponent tagged union | Discriminator and source mapping unresolved | Quantity/cost `REAL`; limited metric conversions, no rounding | Ingredient/lot/custom/override/snapshot/source/notes/deleted timestamp vary by line |
| ProductionBatch | `production_batches`; `ProductionBatch` | Ingredient-backed production result and output cost snapshot | Unresolved ProductionBatch | Must remain distinct from legacy RecipeBatch until approved | Quantity/cost `REAL`; no rounding | Branch/recipe/output product/notes/deleted timestamp nullable |
| ProductionIngredientUsage | `production_ingredient_usages`; `ProductionIngredientUsage` | Historical per-source ingredient consumption/cost snapshot | Unresolved ProductionUsage | Snapshot/reference mapping unresolved | Quantity/cost `REAL`; no rounding | Ingredient/lot/source/deleted timestamp nullable |
| SaleIngredientUsage | `sale_ingredient_usages`; no standalone model | Cook-upon-order actual/estimated ingredient usage and shortfall evidence | Unresolved SaleIngredientUsage | Actual/estimated/requested meanings require mapping | Quantity/cost `REAL`; no rounding | Recipe/ingredient/lot/source/deleted timestamp nullable |
| ProductTransfer | `product_transfers`; no standalone model | Value-neutral movement of scalar finished-product stock between branches | Unresolved StockTransfer | Source/destination product identity mapping unresolved | Quantity/cost `REAL`; no rounding | Branch/product/notes/deleted timestamp nullable |
| FixedCost | `fixed_costs`; `FixedCost` | Due-date occurrence template for period expense | Unresolved FixedCost/ScheduledExpense | Frequency/effective-date mapping unresolved | Amount `REAL`; no rounding | Branch/end date/notes/deleted timestamp nullable |
| FixedCostPayment | `fixed_cost_payments`; `FixedCostPayment` | Paid occurrence evidence; skipped is declared but unwritten | Unresolved FixedCostOccurrence/Payment | Occurrence identity/status mapping unresolved | Amount `REAL`; no rounding | Branch/paid date/notes/deleted timestamp nullable |
| ProblemReport | `problem_reports`; `ProblemReport` | Local diagnostic report with JSON environment/breadcrumb evidence | Deferred DiagnosticReport | Privacy filtering and schema version required | Primarily text/JSON; no business-money precision | Business/branch/deleted timestamp nullable |

## Entity compatibility worksheet: behavior, governance, and evidence

For every row, current behavior ownership is **Mobile**. Future cross-system machine meaning is **Shared Contracts only after approval**; until then it is unresolved. “Reversible if source retained” means no transformation is authorized and any later mapping must preserve enough legacy evidence to reconstruct the source.

| Entity | Schema version | Current failure behavior | Reversibility | Ownership | Approval status | Evidence and open question |
| --- | --- | --- | --- | --- | --- | --- |
| Business | 001 + notes in 002 | Repository validation/SQLite error throws | Reversible if source retained | Mobile / future unresolved | Under Review | [`businesses.ts`](../../src/db/repositories/businesses.ts), [`types.ts`](../../src/domain/types.ts); what is membership/owner identity? |
| Branch | 001 + notes in 002 | Invalid business FK/update throws | Reversible only with type discriminator retained | Mobile / future unresolved | Under Review | [`branches.ts`](../../src/db/repositories/branches.ts); is every Branch a Stall? |
| Product | 001 | Repository/service errors throw; guarded protected decrements fail | Reversible if scalar stock/bundle/source unit retained | Mobile / future unresolved | Under Review | [`products.ts`](../../src/db/repositories/products.ts); catalog versus branch stock identity? |
| Sale | 001 + checkout token in 009 | Live transaction throws/rolls back; duplicate token rereads Sale | Reversible if all header/token fields retained | Mobile / future unresolved | Under Review | [`kioskSales.ts`](../../src/services/kioskSales.ts); actor/cancel/idempotency scope? |
| SaleItem | 001 + COGS fields in 007 | Live checkout rollback on thrown failure | Reversible if snapshots and null legacy fields retained | Mobile / future unresolved | Under Review | `kioskSales`, `profitReports`; how reconcile header discount and line zero? |
| InventoryMovement | 001 | Writer transaction aborts on error; generic insert otherwise throws | Reversible if original event type/sign/snapshots retained | Mobile / future unresolved | Under Review | `stockOps`, `transfers`, `production`, `kioskSales`; reversal model? |
| RecipeBatch | 001 | Legacy cooked transaction throws/rolls back | Reversible only as distinct legacy shape | Mobile / future unresolved | Under Review | [`stockOps.ts`](../../src/services/stockOps.ts); same entity as production batch? |
| OwnerAlert | 001 + fields in 003 | Repository errors throw; resolve is a single update | Reversible if open/active values retained | Mobile / future unresolved | Under Review | [`ownerAlerts.ts`](../../src/db/repositories/ownerAlerts.ts); are open and active synonyms? |
| ReceiptRecord | 001 | Live checkout failure rolls back receipt with Sale | Raw text is reversible; parsed structure may not be | Mobile / future unresolved | Deferred | [`receipts.ts`](../../src/domain/receipts.ts), `kioskSales`; structured receipt scope? |
| OfflineQueueItem | 001 | Producer rolls back with checkout; no consumer/failure transition | JSON source retained, but unversioned interpretation may not be | Mobile / future unresolved | Under Review | `kioskSales`, [`syncStub.ts`](../../src/services/syncStub.ts); envelope/version/retry? |
| AppSetting | 001 | Read/upsert throws; invalid/missing values use caller-specific fallback | Reversible if key/value/type and absence retained | Mobile / future unresolved | Deferred | [`appSettings.ts`](../../src/db/repositories/appSettings.ts); a per-key decision is required—what crosses systems? |
| Ingredient | 004 | Repository/service validation or FK error throws | Reversible if name/default unit retained | Mobile / future unresolved | Under Review | `ingredients`, `groceryPool`; ingredient identity and unit policy? |
| IngredientLot | 004 | Protected guarded update aborts; archive/update errors throw | Reversible if exact quantities/cost/unit/status retained | Mobile / future unresolved | Under Review | `ingredientLots`, `groceryPool`, `production`; selected lot or policy lot? |
| IngredientMovement | 004 | Parent workflow transaction aborts on thrown error | Reversible if signed quantity/type/cost retained | Mobile / future unresolved | Under Review | `ingredientLots`, `groceryPool`; correction/reversal semantics? |
| Recipe | 005 | Create-with-lines transaction aborts; archive update throws | Reversible if legacy header and active flag retained | Mobile / future unresolved | Under Review | [`recipes.ts`](../../src/services/recipes.ts); edit/version policy? |
| RecipeIngredientLine | 005 | Invalid custom/lot/unit input aborts recipe creation | Reversible if discriminator, source, and snapshots retained | Mobile / future unresolved | Under Review | `recipes`, `recipeCosting`; canonical tagged union and lot fallback? |
| ProductionBatch | 006 | Availability/unit/guard failure aborts whole production transaction | Reversible if batch/output/cost snapshots retained | Mobile / future unresolved | Under Review | [`production.ts`](../../src/services/production.ts); output costing/lot model? |
| ProductionIngredientUsage | 006 | Created/rolled back with ProductionBatch | Reversible if snapshots and null references retained | Mobile / future unresolved | Under Review | `production`; actual usage versus recipe plan? |
| SaleIngredientUsage | 007 | Created/rolled back with Sale, but lot changed-row result is unchecked | Reversible only if estimated/shortfall/source preserved | Mobile / future unresolved | Under Review | `kioskSales`; what was requested, deducted, actual, or estimated? |
| ProductTransfer | 007 | Source guard/transaction failure aborts; destination identity check is incomplete | Reversible if both IDs/name/value/movements retained | Mobile / future unresolved | Under Review | [`transfers.ts`](../../src/services/transfers.ts); same-name merge rule? |
| FixedCost | 008 | Validation/DB errors throw; archive returns false when no row changes; occurrence calculation is query-time | Reversible if local dates/frequency/archive retained | Mobile / future unresolved | Under Review | [`fixedCosts.ts`](../../src/services/fixedCosts.ts); archive effective date? |
| FixedCostPayment | 008 | Read-before-write duplicate check can race; insert throws on DB error | Reversible if due-date occurrence evidence retained | Mobile / future unresolved | Under Review | fixed-cost repository/service; durable occurrence key? |
| ProblemReport | 010 | Form/service validation or DB checks reject; no resolver/upload | Reversible if stored sanitized diagnostics JSON is retained, subject to privacy | Mobile / future unresolved | Deferred | `problemReports` domain/service/repository; privacy, status, version, owner? |

## Protected workflow compatibility boundaries

Independent row contracts are insufficient for the following **Confirmed** current workflows:

| Workflow | Current atomic result | Required compatibility evidence | Approval status |
| --- | --- | --- | --- |
| Live checkout | Sale + lines + finished/grocery stock effects + movements/usages + receipt + queue | Checkout token, exact snapshots, prepared versus cook mode, actual/estimated COGS, shortfall, rollback | Under Review |
| Grocery purchase | Ingredient + lot + purchase movement | Local purchase date, explicit unit, total/unit cost, same-name behavior | Under Review |
| Lot adjustment | Guarded lot balance + signed adjustment movement | Previous/new balance, signed cost, status restriction | Under Review |
| Recipe creation | Recipe + selected/custom lines and cost snapshots | Tagged source, unit conversion, chosen lot, snapshot provenance | Under Review |
| Production | Lot deductions + movements/usages + batch + product increment + movement/alert | Preflight, all-or-nothing behavior, cost/output snapshots | Under Review |
| Finished-product spoilage | Guarded product decrement + costed movement | Cost source, loss date, reversal policy | Under Review |
| Product transfer | Source/destination stock + transfer + paired movements | Destination identity, value neutrality, atomicity | Under Review |
| Fixed-cost occurrence/payment | Query-time due occurrence plus optional paid record | Business key, date/frequency, archive effective date, payment race | Under Review |
| Pilot reset | SQLite table deletion is atomic; SecureStore clear then SQLite reset is sequential and non-atomic across stores | This is local destructive maintenance, not a sync command | Blocked from contract implementation |

## Highest-risk mappings

1. **Identifiers and actors:** current local IDs have no server/device namespace; Sales have no seller.
2. **Money and quantities:** SQLite `REAL`/JavaScript `number`, no systematic stored rounding, mixed unit vocabularies.
3. **Temporal semantics:** UTC instants coexist with device-local dates and report boundaries; no stored IANA timezone.
4. **Inventory/COGS:** selected grocery lots, scalar finished stock, production-average/cook COGS, and estimated shortfall evidence.
5. **Lifecycle:** inactive tombstone fields, status-based archives, no sale reversal, hard reset.
6. **Outbox:** unversioned Sale JSON payload with no consumer/retry/conflict protocol.
7. **Transfers:** destination product equality currently relies on name without approved identity compatibility.
8. **Fixed costs:** archived current state can change historical reports; occurrence uniqueness is not durable.

## Likely findings

- A lossless initial compatibility layer will need legacy source fields alongside any candidate canonical representation.
- Protected workflows should become command/result contracts before their component rows become independently synchronizable.
- Several current shapes (ReceiptRecord text, AppSetting, OwnerAlert, ProblemReport) may remain mobile-local rather than cross-system entities.

## Unresolved findings

- All 21 decisions in [`unresolved-semantic-decisions.md`](unresolved-semantic-decisions.md).
- Which entities/settings/diagnostics are in cross-repository scope.
- Canonical IDs, actors/membership, timezone, money/quantity types, deletion/reversal, revision/conflict, and retry/idempotency.
- Required legacy-data fixtures and reconciliation tolerances.

## Risks

- Declaring a plausible mapping `Approved` without owners would convert an implementation guess into a contract.
- Omitting snapshots/null legacy fields would make transformations irreversible.
- Syncing individual rows outside protected transaction semantics could expose partial accounting/inventory state.
- Parsing presentation receipt text into accounting data would be lossy.
- Reusing current `sync_status` as a complete protocol would ignore absent revision/conflict/device state.

## Shared Contracts implications

- The generated JSON files are evidence inputs, not a production schema package.
- Candidate contracts must carry source version/provenance and explicit failure/idempotency semantics.
- Android compatibility tests should compare current calculation/write fixtures before canonical conversion.
- Shared Contracts ownership begins only after explicit approval at the next gate; mobile remains authoritative for existing offline behavior.

## Evidence sources and files inspected

- [`domain-entity-inventory.md`](domain-entity-inventory.md)
- [`repository-and-service-map.md`](repository-and-service-map.md)
- [`data-semantics-inventory.md`](data-semantics-inventory.md)
- [`protected-business-invariants.md`](protected-business-invariants.md)
- All generated inventories under [`generated`](generated)
- The referenced migrations, domain types, repositories, services, stores, routes, and safe check scripts

## Commands executed

- `rg`, `nl -ba`, and `sed -n` traced every entity field to DDL, row mapping, writer, reader, calculation, and UI workflow.
- Isolated SQLite replay verified schema constraints/indexes without touching an application database.
- Read-only Node scripts cross-checked entity, vocabulary, migration, module, SQL-call, and transaction counts.
- Documentation was created with no contract code, migration, or runtime change.

## Limitations

- The Shared Contracts repository and any backend schemas were not inspected.
- No live database/export payload was sampled.
- No canonical transformation or round-trip test exists yet.
- Approval owners and participants are proposed governance roles, not evidence of organizational assignment.

## Next approval gate

Review the worksheets and formally disposition the 21 decision-register entries. MOB-2 should begin only after explicit acceptance of MOB-0/MOB-1 and authorization to design, not implement, the first Shared Contracts mappings.
