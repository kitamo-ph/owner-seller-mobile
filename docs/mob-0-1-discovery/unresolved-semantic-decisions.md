# Unresolved Semantic Decisions

## Purpose

Maintain the approval-gated decision register discovered during MOB-0/MOB-1. This document records current Android evidence and ambiguity; it does not approve a canonical contract or implementation change.

## Scope and inspection context

- **Inspection date:** 2026-07-25
- **Repository:** `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile`
- **Branch:** `codex/pre-internal-hardening`
- **HEAD:** `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4`
- **Register size:** **21 unresolved decisions**
- **Machine-readable companion:** [`generated/semantic-decisions.json`](generated/semantic-decisions.json)
- **Excluded:** Resolving a decision, implementing a mapping, creating contract code, changing SQLite, adding authentication, or adding cloud connectivity.

Evidence labels: **Confirmed** is directly supported by inspected current code; **Likely** is supported but not live-data/device verified; **Unresolved** needs evidence or approval; **Proposed for later review** is not current behavior. Decision statuses are limited to `Under Review` and `Deferred` in this register. Every entry requires approval.

## Decision register

### MOB-SEM-001 — Branch, store, stall, booth, and kiosk mapping

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** `Branch` maps to `branches`; `branch_type` defaults to `stall` and the typed values are `stall`, `branch`, `kiosk`, `booth`, `home kitchen`, and `pop-up`.
- **Ambiguity:** Whether every Branch is a future Stall, whether “store” belongs to Business, and whether physical formats require distinct canonical concepts.
- **Affected tables/entities:** `branches`, Business, Branch, branch-scoped Product/Sale/operations.
- **Affected workflow:** Owner setup, active context, inventory, checkout, transfers, and reports.
- **Potential canonical options:** Map Branch→Stall; retain Branch plus operating-format subtype; or use an explicit legacy discriminator.
- **Risk:** Data loss **High** if formats collapse; migration **Medium** and must be reversible; offline context keys depend on current IDs; every repository must agree on location identity.
- **Recommendation:** Use `stall` only as a future direction and retain legacy Branch/type evidence until approval.
- **Governance:** Decision owner: Product/domain architecture. Participants: mobile, Shared Contracts, backend, product. Blocking milestone: MOB-2 location contracts.
- **Source references:** [`src/domain/types.ts:38`](../../src/domain/types.ts), migration 001, branch repository.

### MOB-SEM-002 — Local identifiers and future cloud identity

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Most `TEXT` IDs use `local_<kind>_<time>_<random>`; ProblemReport uses `problem_<Expo Crypto UUID>`.
- **Ambiguity:** Collision handling, device namespace, canonical/server ID ownership, and export stability.
- **Affected tables/entities:** All 23 persisted application entities and 60 foreign keys.
- **Affected workflow:** All persistence, future export/import, and synchronization.
- **Potential canonical options:** Adopt local ID; retain it alongside server ID; or add explicit client/device namespace.
- **Risk:** Data loss **High** if IDs change/collide; migration **High** across relations and JSON; offline creation must remain possible; all repositories depend on the decision.
- **Recommendation:** Keep current IDs immutable and make any second identity explicit.
- **Governance:** Decision owner: Shared Contracts architecture. Participants: mobile, backend, data migration. Blocking milestone: MOB-2 identity contracts.
- **Source references:** [`src/domain/ids.ts`](../../src/domain/ids.ts), migration 001, [`src/services/problemReports.ts:35`](../../src/services/problemReports.ts).

### MOB-SEM-003 — UTC instants, local business dates, and business timezone

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Normal instants use UTC ISO strings; grocery/fixed-cost dates use local `YYYY-MM-DD`; report periods start at device-local midnight.
- **Ambiguity:** No IANA timezone is stored and SQLite does not enforce formats.
- **Affected tables/entities:** All timestamped entities, IngredientLot, FixedCost/Payment, Sale, reports.
- **Affected workflow:** Checkout, daily/weekly/monthly reports, grocery purchase, and fixed-cost occurrence generation.
- **Potential canonical options:** UTC Instant + `Asia/Manila`; UTC Instant + per-business IANA timezone; distinct LocalDate type.
- **Risk:** Data loss **High** if dates become instants; migration **High** for report boundaries; device timezone currently changes offline results; analytics contracts must agree.
- **Recommendation:** Distinguish Instant from LocalDate and approve a business-timezone rule without rewriting legacy values.
- **Governance:** Decision owner: Product analytics/domain architecture. Participants: mobile, Shared Contracts, reporting. Blocking milestone: MOB-2 temporal contracts.
- **Source references:** shared repository helper, grocery/fixed-cost/profit services.

### MOB-SEM-004 — PHP money representation, precision, and rounding

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Money is SQLite `REAL`/JavaScript `number`; Business currency is PHP; calculations have no systematic stored rounding.
- **Ambiguity:** Centavo scale, negative values, canonical decimal representation, and rounding stage.
- **Affected tables/entities:** Products, sales/items, lots/movements, recipes/production, fixed costs, and reports.
- **Affected workflow:** Pricing, checkout, COGS, production, spoilage, transfers, and profit.
- **Potential canonical options:** Integer centavos; decimal string; decimal library type; legacy floating compatibility field.
- **Risk:** Data loss **High** under conversion; migration **High** across accounting; offline code currently uses number; every financial repository must reconcile.
- **Recommendation:** Record legacy PHP `REAL` semantics and require fixture-based reconciliation before approving minor units.
- **Governance:** Decision owner: Finance domain/Shared Contracts. Participants: mobile, finance/product, backend, QA. Blocking milestone: MOB-2 money contracts.
- **Source references:** Business type, checkout, profit service, generated column inventory.

### MOB-SEM-005 — Quantity precision, unit vocabulary, and conversions

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Quantities use `REAL`/number; Product and Ingredient units have different vocabularies; conversion is limited to same unit and `g`↔`kg`, `ml`↔`L`.
- **Ambiguity:** Scale, rounding, pack size, product/ingredient equivalence, and allowed conversions.
- **Affected tables/entities:** Product, Ingredient/Lot, Recipe, ProductionBatch, SaleItem, Transfer.
- **Affected workflow:** Inventory, recipes, production, checkout, spoilage, and transfers.
- **Potential canonical options:** Typed quantity/unit; base-unit normalization; source unit plus optional conversion metadata.
- **Risk:** Data loss **High** from rounding/collapse; migration **High** for stock/COGS; local deductions rely on existing values; all inventory contracts are affected.
- **Recommendation:** Preserve source quantity/unit and defer new conversions until approved with fixtures.
- **Governance:** Decision owner: Inventory domain. Participants: mobile, operations/product, Shared Contracts. Blocking milestone: MOB-2 quantity contracts.
- **Source references:** domain unit types, recipe costing, grocery/production/stock services.

### MOB-SEM-006 — Finished-product stock and lifetime-average production COGS

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Product has scalar `stock_qty`; there is no finished-product lot; checkout can use produced-average COGS.
- **Ambiguity:** Costing horizon, unsold-unit allocation, and desired future lot traceability.
- **Affected tables/entities:** Product, ProductionBatch, InventoryMovement, SaleItem.
- **Affected workflow:** Production, prepared-product checkout, and COGS reports.
- **Potential canonical options:** Preserve scalar/lifetime average; moving average; finished-product lots; explicit legacy source.
- **Risk:** Data loss **High** if historical COGS is recomputed; migration **High** because units are not batch-allocated; offline costing must remain possible; sales/finance contracts are affected.
- **Recommendation:** Treat stored SaleItem COGS snapshot/provenance as authoritative legacy evidence.
- **Governance:** Decision owner: Finance/inventory. Participants: mobile, finance/product, Shared Contracts. Blocking milestone: MOB-2 inventory/COGS contracts.
- **Source references:** production, checkout, profit services and Product model.

### MOB-SEM-007 — Ingredient lot selection versus FIFO depletion

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Recipe lines retain a selected lot; production deducts selected lots; no FIFO policy was found.
- **Ambiguity:** Required selection, fallback when unavailable, and whether a future policy may choose a lot.
- **Affected tables/entities:** IngredientLot, RecipeIngredientLine, production/sale usage.
- **Affected workflow:** Recipe costing, production, cook-upon-order checkout, and future ingredient spoilage.
- **Potential canonical options:** Explicit selected-lot semantics; FIFO; configurable strategy.
- **Risk:** Data loss **High** if historical usage is reallocated; migration **Medium**; local availability must resolve offline; command contracts must distinguish who selected.
- **Recommendation:** Name current behavior selected-lot, never FIFO, until approved.
- **Governance:** Decision owner: Inventory operations. Participants: mobile, operations/product, backend. Blocking milestone: MOB-2 lot contracts.
- **Source references:** recipe line type, production and checkout services.

### MOB-SEM-008 — Deletion, tombstone, archive, and full-reset semantics

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Twenty-two tables have `deleted_at` but no normal tombstone writer; archive/active/status fields control some lifecycles; reset hard-deletes all app data.
- **Ambiguity:** Entity-specific deletion authority, tombstone retention, report inclusion, and sync intent.
- **Affected tables/entities:** All application entities, especially accounting/inventory history.
- **Affected workflow:** Lifecycle, reports, reset, and future sync.
- **Potential canonical options:** Tombstones; status archive; immutable records plus compensation; hard delete only for local reset.
- **Risk:** Data loss **Critical**; migration **High**; offline deletion needs durable intent/conflict rules; every repository is affected.
- **Recommendation:** Decide lifecycle per entity and do not infer an approved model from dormant columns.
- **Governance:** Decision owner: Data governance/domain architecture. Participants: mobile, finance/product, backend, privacy. Blocking milestone: MOB-2 lifecycle contracts.
- **Source references:** schema/reset repository, fixed-cost and lot repositories, recipe service.

### MOB-SEM-009 — Owner alert `open` versus `active`

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** SQLite defaults to `open`; TypeScript declares `active | resolved`; repository reads accommodate legacy/current values.
- **Ambiguity:** Synonyms, sequential states, or defect.
- **Affected tables/entities:** OwnerAlert.
- **Affected workflow:** Low-stock notifications and resolution.
- **Potential canonical options:** Map open→active; retain both; explicit compatibility alias.
- **Risk:** Data loss **Medium** if open records disappear; migration **Low/Medium** but needs live data; offline legacy rows persist; alert parsers across repositories must agree.
- **Recommendation:** Retain both in compatibility vocabulary until row distributions are known.
- **Governance:** Decision owner: Mobile/product. Participants: mobile, Shared Contracts, QA. Blocking milestone: MOB-2 alert contracts.
- **Source references:** OwnerAlert model, migration 001, owner-alert repository.

### MOB-SEM-010 — Seller identity and Sale attribution

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Owner/kiosk modes exist, but no Seller/User/Shift/actor ID is persisted on Sale.
- **Ambiguity:** Actor, membership, device identity, and historical attribution.
- **Affected tables/entities:** Sales/items/movements, kiosk state, owner access.
- **Affected workflow:** Checkout, shifts, owner review, and future authentication.
- **Potential canonical options:** Nullable seller; device-session actor; membership/role; explicit unattributed legacy actor.
- **Risk:** Data loss **High** through false attribution; migration **High** because history cannot be reconstructed; offline actor continuity is required; identity/sales repositories depend on it.
- **Recommendation:** Represent existing rows as unattributed legacy actions; never synthesize a person.
- **Governance:** Decision owner: Identity/product architecture. Participants: mobile, security, backend, product. Blocking milestone: MOB-2 actor contracts before auth design.
- **Source references:** Sale model, kiosk store, owner access, checkout service.

### MOB-SEM-011 — Offline queue event shape and lifecycle

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Checkout writes pending Sale JSON; no worker consumes or updates it.
- **Ambiguity:** Payload version, ordering, retries, idempotency, terminal states, and cleanup.
- **Affected tables/entities:** OfflineQueueItem, Sale/Item/Receipt.
- **Affected workflow:** Checkout, future sync, and failure recovery.
- **Potential canonical options:** Transactional outbox; command queue; change log; per-entity dirty tracking.
- **Risk:** Data loss **Critical** if dropped/duplicated/misread; migration **High** for unversioned JSON; it is the central offline handoff; backend/contract coordination is mandatory.
- **Recommendation:** Inspect/freeze the payload and define version/idempotency before any consumer.
- **Governance:** Decision owner: Sync architecture. Participants: mobile, backend, Shared Contracts, QA. Blocking milestone: MOB-2 sync envelope.
- **Source references:** migration 001, checkout queue insert, sync stub.

### MOB-SEM-012 — Sync revision, conflict, device, and remote metadata

- **Status / approval required:** Deferred / Yes.
- **Context and current Android evidence:** Rows have `sync_status`, timestamps, and dormant `deleted_at`, but no server ID, revision, device ID, conflict, or synced timestamp.
- **Ambiguity:** Authority, ordering, versioning, mutation identity, and merge policy.
- **Affected tables/entities:** Twenty-two sync-shaped tables and offline queue.
- **Affected workflow:** All future cloud synchronization.
- **Potential canonical options:** Server revision; mutation ID + server version; logical clock; per-entity merge policy.
- **Risk:** Data loss **Critical** under assumed last-write-wins; migration **High**; offline conflicts are inherent; all connected repositories are affected.
- **Recommendation:** Defer implementation until MOB-2 defines envelopes and conflict semantics.
- **Governance:** Decision owner: Sync architecture. Participants: mobile, backend, Shared Contracts, security. Blocking milestone: post-MOB-2 sync design.
- **Source references:** LocalEntity type, sync stub, migrations.

### MOB-SEM-013 — Sale cancellation, refund, and reversal

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** No cancel/refund/void/compensating Sale entity or workflow exists.
- **Ambiguity:** Financial reversal, stock restoration, payment refund, and reports.
- **Affected tables/entities:** Sale, SaleItem, movements/usages, Receipt.
- **Affected workflow:** Orders, returns, corrections, and profit.
- **Potential canonical options:** Immutable Sale + refund; void + linked stock reversal; separate return transaction.
- **Risk:** Data loss **Critical** if deletion substitutes for reversal; migration **High**; offline commands need causal idempotency; commerce/inventory/finance repositories must agree.
- **Recommendation:** Define explicit compensation; do not infer cancellation from payment status or deletion.
- **Governance:** Decision owner: Commerce/finance. Participants: mobile, finance/product, backend. Blocking milestone: MOB-2 Sale lifecycle.
- **Source references:** Sale types, checkout, profit service.

### MOB-SEM-014 — Fixed-cost payment occurrence uniqueness

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Application checks `(fixed_cost_id, due_date)` before insert; no unique constraint/atomic idempotency.
- **Ambiguity:** Exact business key, branch participation, paid/skipped replacement, and conflict behavior.
- **Affected tables/entities:** FixedCost and FixedCostPayment.
- **Affected workflow:** Mark paid, the declared but unimplemented skip occurrence, and profit visibility.
- **Potential canonical options:** Unique cost+due date; versioned occurrence ID; explicit upsert/replacement.
- **Risk:** Data loss **High** through duplicate counting; migration **Medium** with reconciliation; multiple offline devices can duplicate; canonical occurrence identity is cross-repository.
- **Recommendation:** Approve occurrence identity before sync; do not add a constraint during discovery.
- **Governance:** Decision owner: Finance. Participants: mobile, finance/product, backend. Blocking milestone: MOB-2 fixed-cost contracts.
- **Source references:** fixed-cost repository, migration 008, fixed-cost service.

### MOB-SEM-015 — Cook-upon-order best-effort ingredient deduction

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Sale does not block for shortfall and records estimated/shortfall evidence; guarded lot-update result is not checked before movement/usage inserts.
- **Ambiguity:** Whether a failed deduction plus recorded usage is intended or a defect.
- **Affected tables/entities:** IngredientLot, SaleIngredientUsage, IngredientMovement, SaleItem.
- **Affected workflow:** Cook-upon-order checkout, grocery stock, and COGS.
- **Potential canonical options:** Requested vs deducted quantities; block only on race; virtual/negative consumption; compensating adjustment.
- **Risk:** Data loss **High** because balances/history may diverge; migration **Medium** because history cannot prove update success; offline state can race; actual/estimated meanings cross repositories.
- **Recommendation:** Domain review before specifying the usage contract; preserve current behavior.
- **Governance:** Decision owner: Commerce/inventory. Participants: mobile, operations/product, finance, QA. Blocking milestone: MOB-2 cook-upon-order contracts.
- **Source references:** checkout service, SaleItem type, migration 007.

### MOB-SEM-016 — Fixed-cost archive and historical reports

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Occurrence calculation includes only currently active costs, so archive can alter recomputed historical periods.
- **Ambiguity:** Archive effect for past versus future dates.
- **Affected tables/entities:** FixedCost, FixedCostPayment, ProfitReport.
- **Affected workflow:** Cost management and historical reporting.
- **Potential canonical options:** Effective-dated archive; occurrence snapshots; include archived costs before archive.
- **Risk:** Data loss **High** through changed history; migration **High** because no archive time exists; reports recompute offline; canonical reports must be stable.
- **Recommendation:** Treat current result as implementation behavior, not approved accounting meaning.
- **Governance:** Decision owner: Finance/product. Participants: mobile, finance, Shared Contracts. Blocking milestone: MOB-2 reporting contracts.
- **Source references:** fixed-cost repository, [`src/services/fixedCosts.ts:205`](../../src/services/fixedCosts.ts), profit service.

### MOB-SEM-017 — Legacy `recipe_batches` versus `production_batches`

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Legacy batches store name/servings/cost; newer production links recipe/output and ingredient usages.
- **Ambiguity:** One canonical entity, distinct workflows, or legacy compatibility subtype.
- **Affected tables/entities:** RecipeBatch, ProductionBatch, ProductionIngredientUsage.
- **Affected workflow:** Legacy cooking log, production, and analytics.
- **Potential canonical options:** Two types; versioned one-batch type; partial legacy production record.
- **Risk:** Data loss **High** if ingredient detail is invented; migration **High** due to different required relations; both may coexist offline; Shared Contracts must distinguish.
- **Recommendation:** Keep separate until product ownership approves convergence.
- **Governance:** Decision owner: Production domain. Participants: mobile, operations/product, Shared Contracts. Blocking milestone: MOB-2 production contracts.
- **Source references:** both domain models, migrations 001/006, stock/production services.

### MOB-SEM-018 — Sale header discount and line allocation

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Live checkout stores cart discount on `sales.discount` and currently writes zero to each `sale_items.discount_amount`.
- **Ambiguity:** Allocation, remainder rounding, bundle interaction, and reconciliation equation.
- **Affected tables/entities:** Sale and SaleItem.
- **Affected workflow:** Checkout, receipt, and revenue reporting.
- **Potential canonical options:** Header-only; fully allocated lines; both with required reconciliation.
- **Risk:** Data loss **High** if history is reallocated; migration **Medium** because snapshots exist; offline calculation must be deterministic; receipts/reports/backend must agree.
- **Recommendation:** Preserve both fields and document the algorithm before canonical allocation.
- **Governance:** Decision owner: Commerce/finance. Participants: mobile, finance/product, backend, QA. Blocking milestone: MOB-2 Sale amount contracts.
- **Source references:** Sale types, [`src/services/kioskSales.ts:399`](../../src/services/kioskSales.ts), profit service.

### MOB-SEM-019 — Authorization, ownership, and membership enforcement

- **Status / approval required:** Deferred / Yes.
- **Context and current Android evidence:** Owner PIN/biometric gates UI; repositories/services accept no actor, role, or membership.
- **Ambiguity:** Roles, membership, device trust, and lower-layer enforcement.
- **Affected tables/entities:** Business/Branch and all mutable records; owner security state.
- **Affected workflow:** Owner/kiosk modes, reset, inventory, and finance.
- **Potential canonical options:** Server membership roles; capability commands; offline session plus later attribution.
- **Risk:** Data loss/security **Critical** if remote calls trust UI mode; migration **High** because no actor fields exist; offline authorization is hard; auth/API/contracts all depend on it.
- **Recommendation:** Separate approved threat/role model; no authentication in MOB-1.
- **Governance:** Decision owner: Security/product architecture. Participants: security, mobile, backend, product. Blocking milestone: authentication/cloud design after MOB-2.
- **Source references:** owner access service/store/gate and pilot-data service.

### MOB-SEM-020 — App-setting absence, null, empty, and typed values

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Non-null text+type values are upserted; missing key differs from empty, zero, false, or JSON content.
- **Ambiguity:** Canonical null/unknown key/invalid JSON/deletion/default behavior.
- **Affected tables/entities:** AppSetting, theme, first-run, active context, favorites/recents.
- **Affected workflow:** Setup, context, preferences, and kiosk usability.
- **Potential canonical options:** Typed optional settings; explicit reset/delete; versioned document; local-only preferences.
- **Risk:** Data loss **Medium** if absence collapses; migration **Medium** for legacy strings; bootstrap works offline; repositories must decide per-key ownership.
- **Recommendation:** Classify keys as local-only/shared and preserve absence explicitly.
- **Governance:** Decision owner: Product/mobile architecture. Participants: mobile, Shared Contracts, product. Blocking milestone: MOB-2 settings scope.
- **Source references:** AppSetting type/repository, owner setup, theme service.

### MOB-SEM-021 — Transfer destination product identity and merge

- **Status / approval required:** Under Review / Yes.
- **Context and current Android evidence:** Transfer finds a destination Product by Business+Branch+exact name before the transaction, then reuses or clones it.
- **Ambiguity:** Whether same-name means same product, required category/type/unit compatibility, and concurrent creation behavior.
- **Affected tables/entities:** Product, ProductTransfer, InventoryMovement, Branch.
- **Affected workflow:** Stock transfer, destination inventory, and reports.
- **Potential canonical options:** User-selected destination ID; shared catalog identity + branch stock; strict compatible same-name merge; always clone.
- **Risk:** Data loss **High** if stock merges into the wrong item; migration **High** because history lacks a shared catalog identity; concurrent offline transfers can compete; product/transfer contracts must agree.
- **Recommendation:** Do not infer canonical identity from name; require an approved destination rule.
- **Governance:** Decision owner: Inventory/catalog domain. Participants: mobile, operations/product, backend, Shared Contracts. Blocking milestone: MOB-2 transfer/product identity contracts.
- **Source references:** transfer service, Product model, migration 007.

## Confirmed findings

- Every register entry has current evidence and remains unapproved.
- Data-loss risk is High or Critical for identity, money, quantities, temporal conversion, deletion, actor attribution, outbox/sync, reversal, cook-upon-order, historical fixed cost, and transfer identity.
- No decision can be resolved solely by renaming a repository or choosing a plausible schema.

## Likely findings

- MOB-2 will need to sequence identity/location/temporal/money/quantity decisions before most entity contracts.
- Some decisions require production-data fixtures or owner interviews rather than source inspection alone.

## Unresolved findings

The 21 entries above are the unresolved findings. There are no `Approved` decisions in this document.

## Risks

- Implementing a Deferred item would bypass its blocking milestone.
- Treating a recommendation as approval would change authority without owners.
- Resolving one decision in isolation can invalidate another; actor, location, ID, outbox, and conflict semantics are coupled.

## Shared Contracts implications

- Import the machine-readable register as review input only, not as generated contract source.
- Contract pull requests should cite decision IDs and approved outcomes.
- Compatibility fixtures should retain Android source values so decisions remain reversible.

## Evidence sources and files inspected

- All reports and generated inventories in this directory
- Referenced domain types, migrations, repositories, services, stores, routes, and safe check scripts
- Git baseline/identity documentation from MOB-0

## Commands executed

- `rg`, `nl -ba`, and `sed -n` traced each ambiguity to source and searched for alternate implementations.
- Isolated schema replay and read-only Node inventory scripts verified structural evidence.
- JSON parsing cross-checks verify the machine-readable register count and required field presence.

## Limitations

- No Shared Contracts/backend repository, production database, stakeholder decision log, or device fleet telemetry was inspected.
- Suggested decision owners are governance roles, not confirmed individual assignees.
- Recommendations are evidence-led but are not approved outcomes.

## Next approval gate

Explicitly accept or conditionally accept MOB-0/MOB-1, then assign owners and disposition the decisions required for the first MOB-2 contract slice. Do not start implementation, authentication, sync, or migration at this pause.
