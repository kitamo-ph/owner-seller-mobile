# Domain Entity Inventory

## Purpose

Document the current persisted and material in-memory domain shapes of the KitaMo Owner–Seller mobile application before any Shared Contracts design.

## Scope and inspection context

- **Inspection date:** 2026-07-25
- **Repository:** `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile`
- **Branch:** `codex/pre-internal-hardening`
- **HEAD:** `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4`
- **Scope:** TypeScript domain models, SQLite mappings, identifiers, lifecycle paths, validation, derived shapes, state stores, and current consumers.
- **Excluded:** Canonical contract design, cloud entities, authentication entities, schema changes, and production behavior changes.

Evidence labels in this report have their literal meanings: **Confirmed** is directly supported by inspected code or DDL; **Likely** is the best-supported interpretation but was not exercised against a device database; **Unresolved** lacks enough evidence; **Proposed for later review** is not current behavior.

The exact field type, nullability, default, and constraint inventory is machine-readable in [`generated/sqlite-columns.json`](generated/sqlite-columns.json). Persisted vocabularies are in [`generated/enums.json`](generated/enums.json), and the compact entity inventory is in [`generated/domain-entities.json`](generated/domain-entities.json).

## Confirmed findings

### Entity count and model coverage

- **Confirmed:** There are **23 persisted application entities**. `schema_migrations` is infrastructure metadata and is not counted as a business entity.
- **Confirmed:** Nineteen have explicit exported TypeScript models: eighteen in [`src/domain/types.ts`](../../src/domain/types.ts) and `ProblemReport` in [`src/domain/problemReports.ts`](../../src/domain/problemReports.ts).
- **Confirmed:** Four tables have no standalone exported domain model: `receipt_records`, `offline_queue`, `sale_ingredient_usages`, and `product_transfers`.
- **Confirmed:** All persisted application entities have durable `TEXT` primary-key fields. Most use [`makeLocalId`](../../src/domain/ids.ts); problem reports use an Expo Crypto UUID with a `problem_` prefix in [`src/services/problemReports.ts`](../../src/services/problemReports.ts).
- **Confirmed:** No structured entity/database import, export, backup, restore, or remote API exposes these entities outside this repository today. Receipt text can be copied/shared through [`shareReceipt.ts`](../../src/services/shareReceipt.ts), but that is presentation output rather than a structured entity or backup.

### Persisted entity worksheet

In the “required/optional” column, “remaining schema fields required” means the exhaustive `NOT NULL` set in `generated/sqlite-columns.json`; it avoids copying 334 column facts into two places. `deleted_at` is nullable on every row below except `AppSetting`, but no normal tombstone writer was found.

| Entity | Source and persistence | Identifier | Required, optional, enums, and serialization | Lifecycle, validation, relationships, and consumers | Shared Contracts concern |
| --- | --- | --- | --- | --- | --- |
| Business | [`types.ts:27`](../../src/domain/types.ts), `businesses` | `makeBusinessId()` | Optional: contact number, notes, `deleted_at`; enums: business type, language, PHP currency; snake_case row is mapped to camelCase | Owner setup/business settings create and update; parent of branches and most scoped records; validated in owner setup and repository inputs; UI: welcome, context, business settings | Business identity, membership, implicit PHP currency, and legacy business-type values |
| Branch | [`types.ts:38`](../../src/domain/types.ts), `branches` | `makeBranchId()` | Optional: location, notes, `deleted_at`; enums: branch type; integer `active` maps to boolean | Created/updated in business settings; belongs to Business; scopes inventory, sales, operations, and reports; UI: context and business settings | Branch/store/stall mapping and branch-scoped identity are unresolved |
| Product | [`types.ts:47`](../../src/domain/types.ts), `products` | `makeProductId()` | Optional: branch, bundle fields, `deleted_at`; enums: product type and unit; money/quantity are `REAL` to number; integer `active` maps to boolean | Inventory UI creates/updates; checkout, production, transfers, spoilage, and reports consume; scalar stock and low-stock threshold; no normal delete | Product/catalog identity, branch ownership, scalar stock, bundles, money, and units |
| Sale | [`types.ts:64`](../../src/domain/types.ts), `sales` | `makeSaleId()` | Optional: branch, external reference, notes, checkout token, `deleted_at`; payment enums; `checkout_token` is not in the exported `Sale` model | Live checkout creates atomically; generic repository also has an unused divergent creator; has SaleItems; orders/reports read; no cancel/refund/update path | Sale lifecycle, actor attribution, amount/discount meaning, checkout-token scope |
| SaleItem | [`types.ts:79`](../../src/domain/types.ts), `sale_items` | `makeSaleItemId()` | Optional: branch/product/COGS fields/recipe/`deleted_at`; COGS source enum; booleans stored as integers | Created with Sale; line price/cost/name snapshots; checkout is primary writer; receipt/orders/profit read; cascades with hard-deleted Sale | Line discount allocation, product-null snapshot semantics, COGS precision and provenance |
| InventoryMovement | [`types.ts:109`](../../src/domain/types.ts), `inventory_movements` | `makeMovementId()` | Optional: branch, product, linked sale, unit/total cost, `deleted_at`; movement-type enum | Appended by demo opening stock, checkout, production/legacy cooked, finished-product spoilage, and transfers; reporting/logbook read; no correction/reversal entity | Append-only history, sign convention, cost snapshots, reversal semantics |
| RecipeBatch | [`types.ts:272`](../../src/domain/types.ts), `recipe_batches` | `makeBatchId()` | Optional: branch, notes, `deleted_at`; numeric batches/servings/cost | Legacy `recordCookedBatch` path creates a cooking log without ingredient usage; local analytics reads it | Relationship to newer ProductionBatch is unresolved; must not invent ingredient details |
| OwnerAlert | [`types.ts:257`](../../src/domain/types.ts), `owner_alerts` | `makeAlertId()` | Optional: branch, product, `deleted_at`; severity and status vocabularies; schema default `open` differs from typed `active` | Alert workflows create/reuse and resolve; owner home, notifications, and kiosk stock consume; product reference has no declared FK | `open`/`active` compatibility and alert deduplication |
| ReceiptRecord | No standalone model; `receipt_records` | `makeReceiptId()` | Optional: branch, sale, `deleted_at`; receipt text is a serialized display snapshot | Always inserted by successful live checkout; optional only in the unused generic sale-repository transaction; order/receipt display reads; Sale hard deletion sets relation null | Receipt text is presentation data, not a canonical structured receipt |
| OfflineQueueItem | No standalone model; `offline_queue` | `makeQueueItemId()` | Optional: business, branch, last error, `deleted_at`; payload is JSON text; queue vocabulary is not centrally typed | Checkout appends a pending sale-create item; no consumer/retry/update worker was found | Payload version, lifecycle, ordering, idempotency, and failure handling are unresolved |
| AppSetting | [`types.ts:283`](../../src/domain/types.ts), `app_settings` | `makeSettingId()`; key is unique | All columns required; key and value-type vocabularies; typed values serialize to `TEXT` | Read/upsert repository; owner setup, active context, theme, favorites, and recents consume; missing row supplies caller defaults | Decide local-only versus shared keys and preserve missing vs false/empty/zero |
| Ingredient | [`types.ts:123`](../../src/domain/types.ts), `ingredients` | `makeIngredientId()` | Optional: `deleted_at`; ingredient-unit enum; integer `is_active` maps to boolean | Grocery pool creates/updates; owns lots; recipe editor and production consume; validation requires positive thresholds where enforced by service/UI | Ingredient identity, unit normalization, and inactive semantics |
| IngredientLot | [`types.ts:134`](../../src/domain/types.ts), `ingredient_lots` | `makeIngredientLotId()` | Optional: brand, source, notes, `deleted_at`; unit/status enums; quantity and cost use numbers | Grocery purchase creates; adjustment, production, and cook-upon-order paths can mutate remaining quantity; selected rather than FIFO; can deplete/archive; no ingredient-lot spoilage writer was found | Lot selection, cost precision, local-date purchase semantics, concurrency |
| IngredientMovement | [`types.ts:151`](../../src/domain/types.ts), `ingredient_movements` | `makeIngredientMovementId()` | Optional: lot, unit cost, total cost, `deleted_at`; movement-type and unit enums | Active writers append purchase, adjustment, and recipe usage; the enum admits spoilage but no ingredient-spoilage writer was found; grocery/logbook views read; no compensating/reversal relation | Quantity sign, lot-null history, unimplemented spoilage value, reversal and audit contract |
| Recipe | [`types.ts:165`](../../src/domain/types.ts), `recipes` | `makeRecipeId()` | Optional: suggested price, notes, `deleted_at`; production-mode/unit enums; integer active maps to boolean | Recipe service creates and archives; repository supports header update and the tracked service uses it to deactivate; belongs to Business and outputs Product; recipe/production/checkout consume | Versioning and edits versus historical cost/output meaning |
| RecipeIngredientLine | [`types.ts:177`](../../src/domain/types.ts), `recipe_ingredient_lines` | `makeRecipeLineId()` | Optional: ingredient, lot, custom name, overrides/snapshots/source/notes/`deleted_at`; unit enum | Created with a recipe; either catalog ingredient/lot or custom line; cost snapshots are derived at write time; no line update/delete path was found beyond cascade and reset | Tagged-union requirement, selected-lot semantics, snapshot provenance |
| ProductionBatch | [`types.ts:193`](../../src/domain/types.ts), `production_batches` | `makeProductionBatchId()` | Optional: branch, recipe, output product, notes, `deleted_at`; output unit enum | Production service atomically creates batch/usages, deducts ingredient lots, increments product stock, and appends movement; production/reporting read | Batch identity, output cost method, nullable historical links, legacy-batch coexistence |
| ProductionIngredientUsage | [`types.ts:207`](../../src/domain/types.ts), `production_ingredient_usages` | `makeProductionUsageId()` | Optional: ingredient, lot, source label, `deleted_at`; unit enum; custom flag | Written with ProductionBatch as quantity/cost/source snapshot; cascades with batch | Actual versus snapshot values and null relations after source removal |
| SaleIngredientUsage | No standalone model; `sale_ingredient_usages` | `makeSaleUsageId()` | Optional: recipe, ingredient, lot, source, `deleted_at`; unit; estimated flag and shortfall | Cook-upon-order checkout writes actual/estimated usage and shortfall inside the sale transaction; no separate UI model | Actual/estimated/shortfall semantics and possible deduction/history divergence |
| ProductTransfer | No standalone model; `product_transfers` | `makeTransferId()` | Optional: source/destination branches/products, notes, `deleted_at`; cost/quantity are numbers | Transfer service creates with source decrement, destination increment/clone, and paired movements in one transaction | Destination same-name merge, product identity, unit/type compatibility, reversal |
| FixedCost | [`types.ts:232`](../../src/domain/types.ts), `fixed_costs` | `makeFixedCostId()` | Optional: branch, end date, notes, `deleted_at`; category/frequency/status enums; dates are local-date strings | Fixed-cost service creates and archives; no general update path was found; occurrence calculations and profit reports read | Effective dating, archival impact on history, money/date meaning |
| FixedCostPayment | [`types.ts:246`](../../src/domain/types.ts), `fixed_cost_payments` | `makeFixedCostPaymentId()` | Optional: branch, paid date, notes, `deleted_at`; paid/skipped status | Active writer creates `paid`; `skipped` is declared/persistable but no writer was found; application performs read-before-insert duplicate check by occurrence; no database uniqueness on occurrence | Stable occurrence identity, unused skipped state, and concurrent duplicate handling |
| ProblemReport | [`problemReports.ts:40`](../../src/domain/problemReports.ts), `problem_reports` | `problem_${Crypto.randomUUID()}` | Optional: business, branch, `deleted_at`; mode/category/status DB checks; diagnostics serialized as JSON | Form/service validates, captures bounded diagnostics/breadcrumbs, and creates an open report; owner/kiosk report UIs list/read it; resolved is allowed by the vocabulary but no resolver writer was found | Diagnostics schema/version, status lifecycle, privacy minimization, and local-only versus shared ownership |

### Validation, invariants, and derived values

- **Confirmed:** SQLite strongly enforces foreign keys and sync-status checks, but most business enums and numeric ranges are application-enforced rather than database-enforced.
- **Confirmed:** Repositories use private Zod input schemas, while services/screens add manual workflow and form validation; some row mappers cast arbitrary SQLite strings to TypeScript unions. Unknown legacy strings can therefore enter typed shapes without a central failure policy.
- **Confirmed:** Product and ingredient quantities, monetary values, COGS, batch costs, profit summaries, and analytics are JavaScript `number` values. There is no decimal layer or general conversion engine; [`recipeCosting.ts`](../../src/domain/recipeCosting.ts) implements limited same-unit plus `g`↔`kg` and `ml`↔`L` conversions.
- **Confirmed:** Derived persistent snapshots include sale line name/price/cost, receipt text, recipe cost/source labels, production usage costs, sale ingredient usage estimates/shortfalls, transfer value, and movement value.
- **Confirmed:** Derived non-persistent shapes include bundle pricing decisions, checkout plans, receipt display models, recipe cost/makeability calculations, production plans, local analytics, and profit summaries.
- **Confirmed:** Snake_case SQLite rows are manually mapped to camelCase TypeScript shapes in repositories/services. Booleans are persisted as integer `0`/`1`; JSON is used for app-setting values, offline queue payloads, and problem-report diagnostics.

### Material non-persisted domain and session shapes

| Shape | Current storage and lifecycle | Consumers | Contract relevance |
| --- | --- | --- | --- |
| Cart, checkout token, last receipt, and kiosk shift totals | In-memory Zustand [`kioskStore.ts`](../../src/state/kioskStore.ts); cleared by process/store actions | Kiosk sell, checkout, orders, and shift screens | **Unresolved:** no durable draft or shift entity; token becomes durable only when checkout succeeds |
| Owner access session | PIN/biometric preference in SecureStore plus in-memory [`ownerAccessStore.ts`](../../src/state/ownerAccessStore.ts) | Owner gate and owner routes | **Confirmed:** security state is outside SQLite; **Unresolved:** future actor/membership model |
| Theme state | Zustand mirror; persisted through `app_settings` | App shell and settings | **Likely:** local presentation preference; cross-system ownership is unapproved |
| Problem-report breadcrumbs | In-memory bounded breadcrumb list; serialized into diagnostics at submission | Problem-report flow | **Unresolved:** canonical diagnostics schema and retention/privacy rules |
| Checkout and bundle plan | Computed in service from cart/products/recipes/lots; not a separate table | Checkout | **Confirmed:** result is materialized through Sale, SaleItem, usages, movements, receipt, and queue records |
| Recipe/production cost and makeability plans | Derived from recipe lines and lot state | Recipe and production screens/services | **Confirmed:** selected snapshots are persisted only when recipe/production writes occur |
| Analytics and profit summaries | Query-time objects only | Owner dashboard, records, and reports | **Confirmed:** results are recomputed and have no report-snapshot entity |

### Entities searched for but not found

- **Confirmed absent:** durable Owner, Seller, User, Account, Membership, device, cloud revision, conflict, or remote-ID entities.
- **Confirmed absent:** persisted shift, draft checkout, refund/cancellation, general expense, finished-product lot, bundle component, tax, debt/`utang`, import/export, backup/restore, or cloud-sync job entities.
- **Likely:** “Owner” and “seller/kiosk” are application modes and access contexts, not persisted domain actors.

## Likely findings

- The 23-entity count is the most useful current persisted-domain count for MOB-1. It intentionally does not inflate the count with infrastructure metadata, query-time reports, or transient stores.
- Current IDs are stable within local foreign-key relationships and receipt/history snapshots, but their collision safety across many devices is not established.
- Snapshot fields were designed to retain historical display/cost meaning when referenced products, recipes, ingredients, or lots later change or disappear.

## Unresolved findings

- Whether any production device contains legacy rows with values outside current TypeScript unions.
- Whether local IDs have collided in real usage or have been externally exported.
- Which app settings and diagnostic fields should ever cross a repository boundary.
- The canonical relationship among Business, Branch, future Stall, owner membership, seller identity, device, and shift.
- Whether legacy `recipe_batches` should remain a separate entity or map to a partial production concept.

## Risks

1. Mapping transient owner/kiosk modes to invented durable people would create false attribution.
2. Mapping `Branch` directly to a future `stall` without retaining `branch_type` could collapse distinct operating formats.
3. Recomputing stored money, COGS, quantity, or snapshot values under future precision rules could alter accounting history.
4. Treating same-name destination products as the same canonical product could misdirect transferred stock.
5. Treating nullable foreign keys as evidence that relationships were never present would discard historical link-loss semantics.
6. Treating `deleted_at` as an active deletion contract would overstate current behavior; current normal writers do not set it.

## Shared Contracts implications

- Preserve legacy table/entity names and source fields in compatibility worksheets; do not rename SQLite objects.
- Model snapshots and nullable historical relations explicitly.
- Treat identifiers, money, quantities, timestamps, deletion, actor attribution, and sync metadata as approval-gated semantics.
- Use `stall` only as a candidate future destination, never as an approved replacement for current `Branch`.
- A contract must distinguish persisted entities from commands, transient plans, reports, security state, and local UI preferences.

## Evidence sources and files inspected

- [`src/domain/types.ts`](../../src/domain/types.ts)
- [`src/domain/problemReports.ts`](../../src/domain/problemReports.ts)
- [`src/domain/ids.ts`](../../src/domain/ids.ts)
- All files under [`src/db/repositories`](../../src/db/repositories)
- All files under [`src/services`](../../src/services)
- All five stores under [`src/state`](../../src/state)
- All migrations under [`src/db/migrations`](../../src/db/migrations)
- Route consumers under [`app`](../../app)
- Generated schema and vocabulary inventories in this discovery directory

## Commands executed

- `find` and `rg --files` enumerated domain, repository, service, state, route, and migration files.
- `nl -ba` and `sed -n` inspected all exported domain types, ID generation, row mappers, lifecycle methods, and consumers.
- `rg` traced ID generation, repository/service imports, SQLite calls, enum use, Zustand stores, JSON serialization, direct repository consumers, and absent entity concepts.
- Node read-only parsers counted models, exports, route boundaries, and SQLite mappings.
- `git status --short` confirmed that only the discovery directory became untracked during this task.

All commands were read-only except creation of the documentation and generated inventories in this directory.

## Limitations

- No physical device database, user data, release artifact contents, remote API, or production telemetry was inspected.
- UI schemas and TypeScript types prove intended accepted values, not the complete value distribution of existing device rows.
- No export/import round trip exists to test identifier or serialization stability.
- Source-level “absent” means no implementation was found in the inspected repository at this HEAD; it does not rule out external systems.

## Next approval gate

Review and explicitly disposition the entity and identity decisions in [`unresolved-semantic-decisions.md`](unresolved-semantic-decisions.md) before MOB-2 defines entity, actor, location, money, quantity, or lifecycle contracts. No model or persistence change is authorized by this inventory.
