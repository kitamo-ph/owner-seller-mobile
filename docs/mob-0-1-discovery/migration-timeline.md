# Migration Timeline

## Purpose and scope

This MOB-1 report records the exact order, operations, upgrade effects, reversibility, and regression evidence for the current SQLite migrations. It describes baseline behavior only and makes no schema change.

Evidence labels: **Confirmed** is directly supported by inspected migration code or isolated replay; **Likely** is supported but not live-device verified; **Unresolved** requires more evidence; **Proposed for later review** is not current behavior.

## Audit context

| Item | Value |
| --- | --- |
| Inspection date | 2026-07-25 (Asia/Manila) |
| Repository | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Branch / HEAD | `codex/pre-internal-hardening` / `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4` |
| Current schema version | `10` (`src/db/schema.ts:1`), descriptive only; migration IDs/list/ledger drive execution |
| Ordered migrations | 10 (`src/db/migrations/index.ts:21-32`) |
| Rollbacks | None |

## Runner behavior

- **Confirmed:** `schema_migrations(id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)` is created before inspection/application.
- **Confirmed:** the runner reads applied IDs, skips matches, and applies each remaining migration in order.
- **Confirmed:** each migration `up` string and its migration-ledger insert execute in an Expo SQLite exclusive transaction.
- **Confirmed:** a per-database promise queue serializes concurrent startup callers.
- **Confirmed:** the ledger insert uses `INSERT OR IGNORE`, while schema statements generally rely on the ledger to avoid rerunning ALTER statements.
- **Risk:** if an ALTERed column exists but its ledger row is missing, the corresponding migration will fail; the runner does not introspect individual columns before ALTER.

## Timeline

| Order | Migration | Operations and fresh-install effect | Upgrade/data effect | Destructive / reversible | Regression evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | `001_initial_schema` | Creates 11 tables: businesses, branches, products, sales, sale_items, inventory_movements, recipe_batches, owner_alerts, receipt_records, offline_queue, app_settings; creates 13 declared indexes. | Bootstrap only; IF NOT EXISTS avoids recreating existing objects but does not validate their shape. | No drop/rename/backfill; no down migration; not automatically reversible. | Temporary replay and `check:migrations`. |
| 2 | `002_owner_setup_fields` | Fresh replay adds nullable `notes` to businesses and branches after table creation. | Existing rows receive NULL for both new columns. | Two ALTER ADD COLUMN statements; no data transform; no rollback. | Temporary replay. |
| 3 | `003_owner_alert_fields` | Adds `severity TEXT NOT NULL DEFAULT 'info'`, nullable `product_id`, and status/product indexes. | Existing alerts are backfilled by SQLite default to severity `info`; product ID is NULL. Existing status `open` remains. | Additive; no FK added for product; no rollback. | Temporary replay. |
| 4 | `004_grocery_pool` | Creates ingredients, ingredient_lots, ingredient_movements and 7 indexes. | No existing-table transformation. | Additive, up-only. | Migration replay; recipe/production checks exercise associated pure math, not service persistence. |
| 5 | `005_recipes` | Creates recipes and recipe_ingredient_lines with 4 indexes. | No backfill. | Additive, up-only. | Migration replay; `check:recipes`. |
| 6 | `006_production` | Creates production_batches and production_ingredient_usages with 4 indexes. | Leaves legacy recipe_batches unchanged; both representations coexist. | Additive, up-only. | Migration replay; `check:production` covers planning only. |
| 7 | `007_selling_cogs` | Adds five columns to sale_items; creates sale_ingredient_usages and product_transfers with 3 indexes. | Existing sale items get NULL `cogs_total`, `cogs_per_unit`, `cogs_source`, `related_recipe_id`; `cogs_is_estimated` becomes `0`. Reports explicitly fall back to `unit_cost * quantity` for NULL COGS. | Additive; no historical COGS backfill; no rollback. | Migration replay; COGS/pilot checks cover math. |
| 8 | `008_fixed_costs` | Creates fixed_costs, fixed_cost_payments and 3 indexes. | No backfill. | Additive, up-only. | Migration replay; fixed-cost check covers schedule/profit math. |
| 9 | `009_checkout_idempotency` | Adds nullable `sales.checkout_token`; creates partial unique index for non-null tokens on non-deleted sales. | Existing sales get NULL and do not conflict. Future duplicate live tokens are rejected. | Additive; unique-index creation could fail only if a nonstandard preexisting column already contained duplicates. No rollback. | `check:migrations` inserts a duplicate token and confirms rejection. |
| 10 | `010_problem_reports` | Creates problem_reports with CHECKed mode/category/status and 4 indexes. | No backfill. | Additive, up-only. | `check:migrations` checks table presence; `check:problem-reports` checks repeat-safe migration replay and persistence. |

## Fresh versus upgraded installation

- **Confirmed:** a fresh install runs the same chronological `up` sequence; final table definitions therefore include ALTER-added fields appended after their original columns.
- **Confirmed:** upgrades preserve legacy `owner_alerts.status='open'` values while new repository-created alerts use `active`. Reads accept both.
- **Confirmed:** upgrades preserve historical sale items with NULL COGS fields and use report fallback logic rather than a migration backfill.
- **Confirmed:** migration 009 does not assign tokens to existing sales; idempotency begins only for checkout calls supplying a token.
- **Confirmed:** no migration transforms money, quantity, identifiers, timestamps, names, or currency values.
- **Confirmed:** no table rebuild, dropped/renamed column, destructive operation, or newly changed default was found.
- **Unresolved:** no actual upgraded device database was inspected, so schema drift and partially applied historical states are not observed.

## Compatibility assumptions

- SQLite supports `ALTER TABLE … ADD COLUMN`, partial indexes, CHECK constraints, and transactional DDL in the deployed Expo/Android SQLite version.
- IDs and parent rows satisfy foreign keys when services insert dependent records.
- `new Date().toISOString()` is acceptable for migration ledger ordering; ordering is actually by migration ID in reads.
- Migration IDs remain stable and are never renamed.

## Test coverage and gaps

- `check:migrations` verifies first run applies 10, second run applies 0, checkout token exists/is unique, and problem reports exist.
- `check:problem-reports` independently replays all migrations twice in a host-temp SQLite file.
- No test starts from each historical intermediate schema with representative legacy rows.
- No rollback, interrupted-DDL recovery, corrupt-ledger, disk-full, foreign-key drift, or Android Expo SQLite integration test exists.

## Confirmed, likely, unresolved

- **Confirmed:** ordered fresh replay succeeds in host SQLite and yields the machine inventory in `generated/migrations.json`.
- **Likely:** production startup is protected from same-process overlapping migration transactions by the promise queue.
- **Unresolved:** cross-process concurrency and old/hand-modified database behavior.
- **Proposed for later review:** Shared Contracts should version its own schemas independently and cite these migrations as legacy evidence, not copy their version number as canonical.

## Risks and Shared Contracts implications

The highest migration-related contract risks are nullable historical COGS, the `open`/`active` alert compatibility path, coexistence of two production batch models, and absence of a durable rollback/export path. Any later canonical migration must preserve those states explicitly.

## Evidence sources and files inspected

- `src/db/migrations/index.ts`
- `src/db/migrations/001_initial_schema.ts` through `010_problem_reports.ts`
- `src/db/schema.ts`
- `scripts/check-migrations.js`, `scripts/check-problem-reports.js`
- `src/services/profitReports.ts`, `src/services/kioskSales.ts`, `src/db/repositories/ownerAlerts.ts`
- `generated/migrations.json`

## Commands executed and outcomes

- Line-numbered reads and targeted DDL searches over all migration files — operations/timeline confirmed.
- Fresh temporary SQLite replay and PRAGMA/sqlite_master introspection — all 10 migrations applied and final objects inventoried.
- Migration ID extraction/counts — 10 ordered IDs matched schema version 10.
- Validation scripts are recorded in `validation-and-test-inventory.md`; final run status is added there.

## Limitations

This audit did not open a user database or simulate every historical upgrade boundary with production records. Reversibility is assessed from absence of `down` implementations, not from attempted destructive rollback.

## Next approval gate

Do not add, renumber, rewrite, squash, or backfill migrations before Verification Pause A and separate production-migration approval.
