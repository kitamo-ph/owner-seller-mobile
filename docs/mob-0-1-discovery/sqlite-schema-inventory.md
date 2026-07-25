# SQLite Schema Inventory

## Purpose and scope

This report describes the current MOB-1 SQLite persistence model at baseline commit `6ed9ace`. It records existing Android behavior and does not propose or apply a canonical schema. Exact replayed column/index records are in [`generated/sqlite-columns.json`](generated/sqlite-columns.json), [`generated/sqlite-tables.json`](generated/sqlite-tables.json), and [`generated/sqlite-indexes.json`](generated/sqlite-indexes.json).

Evidence labels: **Confirmed** is directly supported by inspected code/DDL or isolated replay; **Likely** is supported but not live-device verified; **Unresolved** requires more evidence; **Proposed for later review** is not current behavior.

## Audit context

| Item | Value |
| --- | --- |
| Inspection date | 2026-07-25 (Asia/Manila) |
| Repository | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Branch / HEAD | `codex/pre-internal-hardening` / `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4` |
| SQLite adapter | `expo-sqlite` `16.0.10` |
| Database name | `kitamo_local.db` |
| Schema version | `10` in `src/db/schema.ts`; descriptive only—migration IDs/list/ledger drive execution |
| Replayed objects | 24 tables including `schema_migrations`; 334 columns; 41 declared indexes; 0 triggers; 0 views |

## Persistence architecture

```text
Expo Router screens
    ↓ call
Domain/application services + Zustand in-memory stores
    ↓ use repository methods and, for multi-table workflows, raw parameterized SQL
Repository modules + pure domain calculators/validators
    ↓ use a shared Expo SQLite handle
openKitamoDatabase() singleton
    ↓ opens kitamo_local.db and enables PRAGMA foreign_keys = ON
Serialized migration runner + 10 ordered up-only migrations
    ↓
24 tables, 41 declared indexes, foreign keys and limited CHECK/UNIQUE constraints
```

No screen, component, or Zustand store directly imports the SQLite client. Multi-table services (`kioskSales`, `production`, `transfers`, `stockOps`, and others) intentionally contain raw SQL and therefore sit partly below the repository abstraction.

## Initialization, lifecycle, and safety

- **Confirmed:** `src/db/client.ts:3-13` memoizes one synchronous Expo SQLite connection for the process and enables foreign keys immediately after opening.
- **Confirmed:** the database filename is static. The physical sandbox path is delegated to Expo SQLite and is not hard-coded.
- **Confirmed:** `src/db/migrations/index.ts:44-105` serializes migration runs per database object using a `WeakMap` promise queue. Each unapplied migration runs in its own exclusive transaction and is then recorded in `schema_migrations`.
- **Confirmed:** services commonly call `runMigrations` before reads/writes; connection opening alone does not bootstrap the schema.
- **Confirmed:** migrations are up-only. There are no `down` functions, table rebuilds, triggers, views, or ORM/query builder.
- **Confirmed:** raw SQL uses Expo SQLite parameter binding for values. The reset/count helpers interpolate only table names from compile-time allowlists.
- **Confirmed:** there is no automatic development reset. The owner-invoked pilot-data wipe hard-deletes all application tables in dependency-safe order inside one exclusive transaction; it leaves `schema_migrations`.
- **Confirmed:** Expo backup is disabled in `app.json` and SecureStore Android backup configuration is disabled. No database import, export, restore, or remote backup exists.
- **Likely:** all normal app connections have foreign keys enabled because only `openKitamoDatabase` opens the app database.
- **Unresolved:** platform-specific WAL/journal mode, busy timeout, file path, encryption-at-rest beyond the OS sandbox, and disk-full recovery are not configured or tested here.

## Common storage semantics

- Application IDs are `TEXT PRIMARY KEY NOT NULL` and normally application-generated. SQLite does not generate them.
- Most business tables carry `created_at`, `updated_at`, `sync_status`, and nullable `deleted_at`. `app_settings` and `schema_migrations` are exceptions.
- `sync_status` has a database CHECK for `local|pending|synced|failed`; most writes set `local`. `offline_queue` defaults its separate `status` and `sync_status` to `pending`.
- Money and quantities are `REAL` and map to JavaScript `number`; no database scale or rounding constraint exists.
- Application timestamps are normally `new Date().toISOString()` (UTC instant with milliseconds). Business dates such as purchases and fixed-cost due dates are local `YYYY-MM-DD` text.
- `deleted_at` is queried consistently but no normal source path sets it. Fixed costs and ingredient lots use status-based archival. Full pilot wipe uses hard deletes.
- Only sync status and problem-report mode/category/status have comprehensive CHECK constraints. Most other TypeScript enums are not database-enforced.

## Table inventory

Notation: `!` = NOT NULL, `?` = nullable, `=…` = database default. All foreign keys have `ON UPDATE NO ACTION`.

### Core business, context, and settings

#### `businesses`

- **Purpose/status:** **Confirmed** top-level local business profile (`src/db/migrations/001_initial_schema.ts:4-17`; `src/db/repositories/businesses.ts`).
- **Columns:** `id TEXT! PK`; `business_name TEXT!`; `business_type TEXT!`; `owner_name TEXT!`; `barangay TEXT!`; `contact_number TEXT?`; `preferred_language TEXT!='Taglish'`; `currency TEXT!='PHP'`; `created_at TEXT!`; `updated_at TEXT!`; `sync_status TEXT!='local'`; `deleted_at TEXT?`; `notes TEXT?` (added by migration 002).
- **Constraints/indexes/FKs:** PK; sync CHECK; no FK or declared index.
- **Paths/transactions:** repository create/update/get/list; demo seed creates it in a larger exclusive transaction; Owner setup/context, reports, and problem-context validation read it.
- **Deletion/time:** no normal delete; full reset hard-deletes and cascades. Repository timestamps are UTC ISO.
- **Protected semantics:** local business scope and explicit `PHP` literal at repository validation. Confidence **Confirmed**.

#### `branches`

- **Purpose:** **Confirmed** local business locations; current type vocabulary includes stall/branch/kiosk/booth/home kitchen/pop-up.
- **Columns:** `id TEXT! PK`; `business_id TEXT!`; `branch_name TEXT!`; `location TEXT?`; `branch_type TEXT!='stall'`; `active INTEGER!=1`; `created_at TEXT!`; `updated_at TEXT!`; `sync_status TEXT!='local'`; `deleted_at TEXT?`; `notes TEXT?` (migration 002).
- **FK/index:** `business_id → businesses.id ON DELETE CASCADE`; `idx_branches_business_id`.
- **Paths:** branches repository; Owner setup/context; kiosk context; transfer, production, fixed-cost/report, and problem-report joins. Demo creation is transactional.
- **Deletion:** no normal delete; dependent historical foreign keys frequently use SET NULL if a branch is removed via a business cascade/reset. Confidence **Confirmed**.

#### `app_settings`

- **Purpose:** **Confirmed** local typed string storage for theme, active business/branch, first-run/demo flags, favorites, and recent products.
- **Columns:** `id TEXT! PK`; `key TEXT! UNIQUE`; `value TEXT!`; `value_type TEXT!='string'`; `created_at TEXT!`; `updated_at TEXT!`.
- **Indexes:** UNIQUE autoindex on `key` plus redundant declared `idx_app_settings_key`.
- **Paths:** `appSettings` repository; Owner setup/context, theme and kiosk preference services. Context switches group related writes in exclusive transactions; individual upserts use read-then-update/insert.
- **Absence semantics:** missing row differs from empty-string value; boolean reads are true only when the stored string equals `"true"`. No soft delete/sync columns. Confidence **Confirmed**.

### Finished products, sales, receipts, and stock history

#### `products`

- **Purpose:** **Confirmed** finished-product definition plus aggregate on-hand stock. This is not a finished-goods lot model.
- **Columns:** `id TEXT! PK`; `business_id TEXT!`; `branch_id TEXT?`; `name TEXT!`; `category TEXT!='General'`; `price REAL!=0`; `cost REAL!=0`; `stock_qty REAL!=0`; `unit_type TEXT!='piece'`; `low_stock_threshold REAL!=0`; `bundle_quantity REAL?`; `bundle_price REAL?`; `bundle_label TEXT?`; `active INTEGER!=1`; `product_type TEXT!='retail item'`; lifecycle/sync timestamps.
- **FK/index:** business CASCADE, branch SET NULL; indexes on business and branch.
- **Write paths:** products repository; guarded checkout/spoilage/transfer deductions; production/cooked-batch increments; transfer can clone a destination row. Most compound writes are exclusive transactions.
- **Read paths:** Owner inventory, kiosk context/cart, recipe/production, stock ops, reports, analytics.
- **Risk:** repository schemas allow arbitrary finite `stockQty` including negative values, while protected workflow updates use guarded SQL. No DB CHECK enforces nonnegative stock. Confidence **Confirmed**.

#### `sales`

- **Purpose:** **Confirmed** sale header/payment record and checkout idempotency anchor.
- **Columns:** `id TEXT! PK`; `business_id TEXT!`; `branch_id TEXT?`; `transaction_no TEXT!`; `happened_at TEXT!`; `amount REAL!=0`; `discount REAL!=0`; `payment_method TEXT!='cash'`; `payment_status TEXT!='paid'`; `external_reference_number TEXT?`; `notes TEXT?`; lifecycle/sync fields; `checkout_token TEXT?` (migration 009).
- **FK/index:** business CASCADE, branch SET NULL; business/branch indexes; partial unique `idx_sales_checkout_token` where token non-null and sale not soft-deleted.
- **Write paths:** protected kiosk checkout writes it with all related facts in one exclusive transaction. A generic `createSale` repository also writes sales/items/optional receipt transactionally but is not called by tracked app code.
- **Read paths:** kiosk history/shift, local analytics, profit reports.
- **Deletion/cancellation:** no cancellation/reversal method; normal queries exclude `deleted_at`. Confidence **Confirmed**.

#### `sale_items`

- **Purpose:** **Confirmed** immutable-at-write sale line snapshots, bundle result, and COGS attribution.
- **Columns:** identity/sale/business/branch/product/name; `quantity`, `unit_price`, `unit_cost`, `line_total`, `discount_amount` as REAL; `bundle_applied INTEGER`; lifecycle/sync fields; nullable `cogs_total`, `cogs_per_unit`, `cogs_source`, `related_recipe_id`; `cogs_is_estimated INTEGER!=0` (migration 007).
- **FK/index:** sale/business CASCADE; branch/product SET NULL; sale index.
- **Paths:** kiosk checkout and unused generic sale repository write; reports/analytics read. Kiosk sale lines receive zero `discount_amount` even when a header discount exists.
- **Deletion:** cascades with sale/business; otherwise no normal delete. Historical name/prices/COGS remain snapshots if product/recipe links disappear. Confidence **Confirmed**.

#### `inventory_movements`

- **Purpose:** **Confirmed** append-style finished-product stock/value history.
- **Columns:** IDs/scopes; `movement_type TEXT!`; `quantity REAL!=0`; `reason TEXT!`; optional linked sale; nullable `unit_cost`/`total_cost`; lifecycle/sync.
- **FK/index:** business CASCADE; branch/product/sale SET NULL; business/product indexes.
- **Writes:** demo opening stock, checkout stock-out, production/cooked, spoilage, and paired transfer-in/out; compound operations share the parent exclusive transaction.
- **Reads:** records/analytics and spoilage profit aggregation.
- **Audit:** no update/delete path except full reset. Quantity direction is carried by movement type, not consistently by sign; transfer and sale-out rows store positive quantity. Confidence **Confirmed**.

#### `receipt_records`

- **Purpose:** **Confirmed** rendered text receipt snapshot.
- **Columns:** `id`, business/branch/sale, transaction number, `receipt_text`, `issued_at`, lifecycle/sync.
- **FK/index:** business CASCADE; branch/sale SET NULL; sale index.
- **Paths:** kiosk checkout and generic sale repository write in their sale transaction; kiosk history/analytics read.
- **Audit:** receipt survives a deleted sale link only when the row itself survives and FK becomes null; full reset removes it. Confidence **Confirmed**.

#### `offline_queue`

- **Purpose:** **Confirmed** sale-create outbox placeholder, not active cloud sync.
- **Columns:** ID; optional business/branch; `entity_type`, `entity_id`, `operation`, JSON `payload`; `status='pending'`; `attempt_count=0`; `last_error?`; lifecycle; `sync_status='pending'`.
- **FK/index:** business CASCADE, branch SET NULL; status index.
- **Paths:** kiosk checkout inserts one pending sale entry inside checkout; UI/services only count pending rows. No tracked drain, retry increment, success/failure update, or deletion path exists.
- **Risk:** queue grows monotonically with checkout until full reset. Payload is a partial sale summary, not a complete canonical event. Confidence **Confirmed**.

### Grocery lots, recipes, and production

#### `ingredients`

- **Purpose:** **Confirmed** business-level grocery ingredient catalog.
- **Columns:** `id`, `business_id`, `name`, `default_unit='pcs'`, `category='General'`, `low_stock_threshold=0`, `is_active=1`, lifecycle/sync.
- **FK/index:** business CASCADE; business/name indexes (name index is not unique).
- **Paths:** ingredients repository and grocery purchase service write; grocery/recipe/report views read. No normal deletion. Confidence **Confirmed**.

#### `ingredient_lots`

- **Purpose:** **Confirmed** purchased grocery lots with source/brand, acquisition cost, and remaining quantity.
- **Columns:** IDs/scopes; optional brand/source; local `purchase_date`; purchased/remaining REAL quantities; explicit unit; `total_cost`, `cost_per_unit`; notes; `status='active'`; lifecycle/sync.
- **FK/index:** business and ingredient CASCADE; business/ingredient/status indexes.
- **Writes:** grocery purchase creates; manual adjustment bounds remaining to `[0,purchased]`; production and cook-to-order checkout deduct selected lots; archive changes status.
- **Reads:** grocery pool, recipe costing/production, cook-to-order checkout. Ordering is newest purchase first for lists; no FIFO depletion algorithm exists.
- **Protected semantics:** production validates and atomically guards deductions; cook-to-order deliberately estimates shortfalls. Confidence **Confirmed**.

#### `ingredient_movements`

- **Purpose:** **Confirmed** grocery purchase/adjustment/recipe-usage history. The vocabulary admits `spoilage`, but no active ingredient-spoilage writer was found.
- **Columns:** IDs/scopes; optional lot; movement type; REAL quantity; explicit unit; nullable costs; reason; lifecycle/sync.
- **FK/index:** business/ingredient CASCADE, lot SET NULL; business/ingredient indexes.
- **Writes:** grocery repository/service, recipe production, and cook-to-order checkout; parent compound operations are transactional. Current writers use purchase, adjustment, and recipe usage.
- **Reads:** local records. Negative quantity is permitted and used for downward manual adjustment; recipe usage stores positive depletion. Confidence **Confirmed**.

#### `recipes`

- **Purpose:** **Confirmed** recipe header for an output product and production mode.
- **Columns:** IDs/scopes/output product/name; REAL output quantity; output unit; `production_mode='prepared_before_selling'`; optional suggested price/notes; `is_active=1`; lifecycle/sync.
- **FK/index:** business CASCADE; output product CASCADE; indexes on both.
- **Writes:** recipe repository/service; recipe header and lines are created in one exclusive transaction. Updates do not edit line membership.
- **Reads:** recipe overview, production, kiosk latest-active-mode selection.
- **Risk:** output-product deletion cascades recipe definition; downstream historical batch/usage links use SET NULL. Confidence **Confirmed**.

#### `recipe_ingredient_lines`

- **Purpose:** **Confirmed** selected grocery-lot line or custom-cost line plus save-time cost/label snapshots.
- **Columns:** IDs/scopes; optional ingredient/lot/custom name; REAL quantity; unit; nullable override and per-unit snapshot; `line_cost_snapshot`; source label; `is_custom`; notes; lifecycle/sync.
- **FK/index:** business/recipe CASCADE; ingredient/lot SET NULL; business/recipe indexes.
- **Paths:** created with recipe transaction; repository/service reads for recipe overview, production, and checkout COGS. No tracked update/delete except cascade/reset.
- **Protected semantics:** a selected lot, not FIFO/average lots, determines cost. Snapshot fields preserve fallback meaning. Confidence **Confirmed**.

#### `production_batches`

- **Purpose:** **Confirmed** recipe-based production fact and cost snapshot.
- **Columns:** IDs/scopes and nullable recipe/product; recipe-name snapshot; output quantity/unit; batch multiplier; total cost; cost/output unit; notes; lifecycle/sync.
- **FK/index:** business CASCADE; branch/recipe/product SET NULL; business/branch indexes.
- **Writes:** production service inside the same transaction as grocery deductions/usages, product stock increment, and finished movement.
- **Reads:** production repositories, analytics, and profit/average-produced-cost calculations.
- **Audit:** append-only except full reset; history retains names/costs when links are nulled. Confidence **Confirmed**.

#### `production_ingredient_usages`

- **Purpose:** **Confirmed** per-batch ingredient/custom usage and cost snapshot.
- **Columns:** IDs/scopes/batch; optional ingredient/lot; quantity/unit; line cost; label snapshot; `is_custom`; lifecycle/sync.
- **FK/index:** business/batch CASCADE; ingredient/lot SET NULL; business/batch indexes.
- **Paths:** production service writes within batch transaction; production detail repository reads. Confidence **Confirmed**.

#### `recipe_batches`

- **Purpose:** **Confirmed** legacy/simple cooked-batch history used by `recordCookedBatch`, separate from recipe-based `production_batches`.
- **Columns:** ID/scopes; recipe-name snapshot; batches; expected/actual servings; total batch cost; notes; lifecycle/sync.
- **FK/index:** business CASCADE; branch SET NULL; business index.
- **Paths:** `stockOps.recordCookedBatch` writes with product increment and movement transaction. No tracked read path was found beyond counting/reset.
- **Compatibility risk:** two production representations coexist with different detail/cost provenance. Confidence **Confirmed**.

#### `sale_ingredient_usages`

- **Purpose:** **Confirmed** cook-to-order actual usage, shortfall, estimated cost, and source label per sale line.
- **Columns:** IDs/scopes/sale/sale item; optional recipe/ingredient/lot; used quantity/unit; line cost; estimated flag; shortfall quantity; label snapshot; lifecycle/sync.
- **FK/index:** business/sale/sale item CASCADE; recipe/ingredient/lot SET NULL; sale/business indexes.
- **Paths:** kiosk checkout writes; no tracked application read path other than counts/reset was found.
- **Audit risk:** evidence is stored but currently not surfaced; cook-to-order lot UPDATE result is intentionally not checked before movement/usage rows are written. Confidence **Confirmed**.

### Transfers, costs, alerts, and support

#### `product_transfers`

- **Purpose:** **Confirmed** transfer header/value snapshot across source/destination product rows.
- **Columns:** IDs/scopes; optional source/destination branch/product IDs; name snapshot; quantity/unit/total cost; notes; lifecycle/sync.
- **FK/index:** business CASCADE; all branch/product links SET NULL; business index.
- **Paths:** transfer service writes in one transaction with source decrement, destination increment/create, and paired inventory movements; reports/analytics read.
- **Protected semantics:** value moves but is excluded from profit. No reverse/cancel method. Confidence **Confirmed**.

#### `fixed_costs`

- **Purpose:** **Confirmed** one-time/recurring fixed-cost definition.
- **Columns:** ID/scopes/name/category; amount; frequency; due/start/end dates; `status='active'`; notes; lifecycle/sync.
- **FK/index:** business CASCADE, branch SET NULL; business index.
- **Paths:** repository/service create and status-archive; overview and profit report derive occurrences in JavaScript.
- **Deletion/time:** archive is status-based, not soft delete. Archived costs are excluded from all later range calculations, including historical ranges queried after archive. Confidence **Confirmed**.

#### `fixed_cost_payments`

- **Purpose:** **Confirmed** cash-payment visibility for a due occurrence; profit accrual does not depend on payment.
- **Columns:** IDs/scopes/cost; due/paid dates; amount; `status='paid'`; notes; lifecycle/sync.
- **FK/index:** business and fixed cost CASCADE; branch SET NULL; business/cost indexes.
- **Paths:** fixed-cost service does read-then-write duplicate guarding; analytics reads.
- **Risk:** no unique `(fixed_cost_id,due_date)` constraint and no encompassing transaction, so concurrent duplicate payments remain possible. Confidence **Confirmed**.

#### `owner_alerts`

- **Purpose:** **Confirmed** local Owner alert, primarily low-stock notification.
- **Columns:** IDs/scopes; alert type/title/message; `status='open'`; `source='local'`; lifecycle/sync; `severity='info'` and optional `product_id` added by migration 003.
- **FK/index:** business CASCADE; branch SET NULL; product ID is not declared as an FK; business/status/product indexes.
- **Paths:** alert repository creates/resolves/reads; stock and production services resolve relevant alerts.
- **Compatibility:** repository-created rows use `active`, legacy/default rows may use `open`; reads normalize either to active. Confidence **Confirmed**.

#### `problem_reports`

- **Purpose:** **Confirmed** sanitized, local-only owner/kiosk report and diagnostic snapshot.
- **Columns:** ID; optional business/branch; CHECKed mode/category; five text/JSON content fields; CHECKed `status='open'`; lifecycle/sync.
- **FK/index:** business/branch SET NULL; business/branch/status/created-desc indexes.
- **Paths:** problem-report service/repository validates, sanitizes, uses `INSERT OR IGNORE` for repeat-safe same-ID creation, writes and reads. No uploader or resolver write path is active.
- **Privacy:** diagnostics JSON is sanitized but remains local user/device context; business and branch IDs are optional. Confidence **Confirmed**.

#### `schema_migrations`

- **Purpose:** **Confirmed** migration ledger.
- **Columns:** `id TEXT! PK`; `applied_at TEXT!`.
- **Paths:** created/read/written only by migration runner. It is deliberately excluded from pilot-data reset.
- **Time:** runtime uses UTC ISO; host regression script uses SQLite `datetime('now')` in a temporary database only. Confidence **Confirmed**.

## Constraints and indexes

- All 23 application business tables use application-supplied text IDs; `schema_migrations` also uses text IDs.
- Every business table except `app_settings` has foreign keys where defined and deletion actions shown in the generated inventory.
- `app_settings.key` is the only explicit non-primary-key table-level `UNIQUE` constraint.
- `sales.checkout_token` has the only declared unique partial index.
- The 41 explicitly declared named indexes are predominantly business, branch, relationship, status, and problem-report time lookups. Primary-key and `UNIQUE` autoindexes are separate and appear in the table replay inventory. Exact columns, partial/unique flags, defining migrations, and likely purposes are in `generated/sqlite-indexes.json`.
- No DB CHECK enforces nonnegative money/quantity, most enum vocabularies, ISO timestamp/date format, or boolean integer range.

## Confirmed, likely, unresolved

- **Confirmed:** replaying all 10 ordered `up` strings into a fresh temporary SQLite database produces the counts and structures above.
- **Confirmed:** for final schema shape, upgrade-only additions are the ALTER-added nullable/defaulted fields; no migration backfills domain values beyond SQLite defaults. Row semantics can still differ: legacy alerts retain `open`, historical SaleItems retain null COGS fields, and existing Sales retain null checkout tokens.
- **Likely:** normal app queries maintain referential behavior because the singleton connection enables foreign keys.
- **Unresolved:** existing device databases were not opened, so actual row formats, drift, corruption, and mixed-version data are not observed.
- **Proposed for later review:** machine inventories can seed Shared Contracts evidence, but they must not be treated as approved canonical definitions.

## Risks and Shared Contracts implications

Highest-risk mapping areas are JavaScript/SQLite REAL money, mixed instant/date semantics, non-UUID local IDs, unconstrained enum strings, legacy `recipe_batches`, aggregate finished stock versus grocery lots, status-based archive behavior, and unused soft-delete/sync fields. Shared Contracts must preserve observed Android semantics until each item is explicitly decided.

## Files inspected

- `src/db/client.ts`, `src/db/schema.ts`, `src/db/migrations/index.ts`
- all `src/db/migrations/001` through `010`
- all `src/db/repositories/*.ts`
- persistence-using `src/services/*.ts`
- relevant `src/domain/*.ts`, `src/state/*.ts`, and `app/**/*.tsx`
- schema check scripts and generated replay inventories

## Commands executed and outcomes

- `find`, `rg`, `nl -ba`, and bounded `sed` across persistence/domain/service callers — source paths and semantics traced.
- Temporary SQLite replay through `node` + host `sqlite3` — 24 tables, 334 columns, 41 declared indexes, no triggers/views.
- `sqlite_master`, `PRAGMA table_info`, `PRAGMA foreign_key_list`, `PRAGMA index_list`, and `PRAGMA index_info` queries — machine-readable inventories generated; temp DB deleted.
- JSON record-count reads — generated counts verified.

## Limitations

No real app database, private records, device filesystem, AAB, native prebuild, remote service, or secret was opened. Read/write path descriptions are based on tracked code, so reflective/dynamic code outside the repository would not be visible.

## Next approval gate

Review this inventory and the unresolved decision register at Verification Pause A. Do not create canonical schema code, change migrations, or normalize existing data before MOB-2 approval.
