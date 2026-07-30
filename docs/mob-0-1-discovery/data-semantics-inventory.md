# Data Semantics Inventory

## Purpose

Record the current Android meanings of identifiers, dates and timestamps, money, quantities, units, enums, absence, deletion, audit history, and sync-shaped metadata before Shared Contracts defines cross-system meaning.

## Scope and inspection context

- **Inspection date:** 2026-07-25
- **Repository:** `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile`
- **Branch:** `codex/pre-internal-hardening`
- **HEAD:** `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4`
- **Scope:** Migrations, domain types, repository row mappings, protected services, formatting code, report SQL, and validation/check scripts.
- **Excluded:** Data conversion, cleanup, rounding, schema evolution, canonical terminology, or approval of future semantics.

Evidence labels: **Confirmed** is directly supported by inspected code/DDL; **Likely** is supported but not verified against live device data; **Unresolved** needs evidence or approval; **Proposed for later review** is not current behavior.

## Confirmed findings

### Identifiers

- Every runtime table, including `schema_migrations`, has a single `TEXT id` primary key.
- The current application does not use SQLite integers/autoincrement, composite primary keys, remote IDs, server IDs, device IDs, or revisions.
- No persisted application entity lacks a durable primary-key field.

| Entities / field | SQLite and TypeScript representation | Generation and stability | UI/export/collision behavior | Contract concern |
| --- | --- | --- | --- | --- |
| Business, Branch, Product, Sale, SaleItem, Receipt, InventoryMovement, OwnerAlert, queue item, RecipeBatch, AppSetting, Ingredient, IngredientLot, IngredientMovement, Recipe, RecipeIngredientLine, ProductionBatch, ProductionIngredientUsage, SaleIngredientUsage, ProductTransfer, FixedCost, FixedCostPayment | `TEXT id` / `string` | [`makeLocalId`](../../src/domain/ids.ts) emits `local_<kind>_<Date.now base36>_<six Math.random base36 chars>` | IDs are stable once stored and used by foreign keys/navigation, but no export/import stability test or collision handler exists | **Unresolved:** local versus canonical/server identity and device namespace |
| ProblemReport | `TEXT id` / `string` | [`makeProblemReportId`](../../src/services/problemReports.ts) emits `problem_<Expo Crypto UUID>` | Report ID is used in local list/detail navigation and shared diagnostic text | **Unresolved:** external exposure and remote diagnostic identity |
| Sale checkout token | nullable `TEXT checkout_token` / input `string` | Normally created by `makeCheckoutId()` when a cart begins; partial unique index for non-null, non-deleted sales | Used internally to return the same Sale after duplicate submission; not the Sale primary key | Token retention, reuse scope, and cross-device idempotency are unresolved |
| Sale transaction number | `TEXT transaction_no` / `string` | Live checkout uses `KTM-<UTC happened_at YYYYMMDD>-<uppercase last six Sale-ID chars>`; no database uniqueness constraint | Human-facing orders/receipt identifier | Must not be treated as globally unique |
| AppSetting key | unique `TEXT key` / fixed union plus `activeBranchId:${string}` | Caller-supplied logical identifier | Internal preference lookup; dynamic branch suffix embeds a local ID | Missing/unknown/dynamic-key semantics need explicit scope |
| Polymorphic queue identity | `entity_type`, `entity_id`, `operation` as `TEXT` | Checkout writes a Sale ID and literal operation | Only serialized in local outbox row; no consumer | No versioned entity/operation vocabulary exists |

**Likely:** local IDs are sufficiently stable for the current single-device database because references retain the same string. **Unresolved:** collision probability/handling and safety across many offline devices. Do not replace or regenerate current IDs.

### Timestamps and dates

| Field set | Storage, generator, and example | Parsing/display/sort/update behavior | Null and timezone semantics |
| --- | --- | --- | --- |
| `created_at`, `updated_at` on all 23 application tables | `TEXT`; repositories/services normally call `nowIso()` or `new Date().toISOString()`; redacted-shape example `2026-07-25T02:34:56.789Z` | JavaScript `Date`/string consumers; ISO strings sort lexically if uniformly formatted; writers set both on create and explicitly update `updated_at`; no DB default/trigger | Required; UTC instant by current writers; SQLite does not enforce format |
| `deleted_at` on 22 application tables | nullable `TEXT`; intended ISO-like shape | Queries commonly filter `IS NULL`; no current normal writer sets a non-null value | Null currently means not tombstoned; it does not prove a complete deletion contract |
| `sales.happened_at` | required `TEXT`; checkout sale instant in UTC ISO form | Orders, shifts, analytics, and reports filter/sort it | No timezone field; format unenforced |
| `receipt_records.issued_at` | required `TEXT`; same sale instant in normal checkout | Receipt/order retrieval | No timezone field; format unenforced |
| `ingredient_lots.purchase_date` | required `TEXT`; local calendar builder emits `YYYY-MM-DD`, e.g. `2026-07-25` | Displayed/filtered as a business date; lexical order works for valid shape | Device-local calendar date, not an instant |
| `fixed_costs.due_date`, `start_date`, nullable `end_date` | `TEXT` local dates `YYYY-MM-DD` | Occurrence generation operates on date strings/JavaScript local dates | No stored business timezone; end date absent means no configured end |
| `fixed_cost_payments.due_date`, nullable `paid_date` | `TEXT` local dates | Due date identifies an occurrence in current application logic; paid date absent until supplied | Current active writer creates paid records; no skipped writer found |
| `schema_migrations.applied_at` | required `TEXT` generated by migration runner as UTC ISO | Ledger inspection only | Infrastructure metadata |
| Report range boundaries | Local device midnight/Monday/month start converted with `toISOString()` for instant filters; local `YYYY-MM-DD` for fixed costs | Half-open `[start, next local midnight)` timestamp ranges; “all” fixed-cost start is `2000-01-01` | Results depend on the device timezone; no IANA business timezone is persisted |

- **Confirmed:** Seconds and milliseconds are present in normal instant writers.
- **Likely:** Existing rows created only by current paths use the above formats.
- **Unresolved:** Legacy/manually altered rows may contain mixed formats because every field is unconstrained `TEXT`.
- **Proposed for later review:** Distinguish UTC Instant from LocalDate and associate reports with an approved IANA business timezone, commonly expected to be `Asia/Manila`; no migration is authorized here.

### Money and accounting

All persisted money/cost fields use SQLite `REAL` and TypeScript/JavaScript `number`. Currency is explicit only on `businesses.currency`, whose current typed/default value is `PHP`; every child monetary value therefore assumes the business currency rather than storing currency beside the amount.

| Field group | Current meaning and calculation path | Precision, sign, rounding, and null behavior |
| --- | --- | --- |
| `products.price`, `products.cost`, nullable `bundle_price` | Regular selling price, simple/unit fallback cost, and optional beneficial bundle price | Binary floating-point; DB has no scale/range check; normal UIs/services constrain non-negative values variably |
| `sales.amount`, `sales.discount` | Checkout total and cart/header discount snapshot | `REAL NOT NULL DEFAULT 0`; current live checkout stores cart-level discount here |
| `sale_items.unit_price`, `unit_cost`, `line_total`, `discount_amount` | Price/cost/name line snapshots and computed line total | Live checkout currently writes `discount_amount = 0` even when the Sale header has a cart discount; bundle savings are computed by pricing logic but header/line allocation is unresolved |
| Nullable `sale_items.cogs_total`, `cogs_per_unit`, `cogs_source`; `cogs_is_estimated` | Preferred sold-COGS snapshot. Simple uses product cost; prepared production can use produced average; cook-upon-order uses summed actual/estimated ingredient cost | Null legacy COGS falls back in reports to `unit_cost * quantity`; no calculation rounding; estimated flag is integer boolean |
| `inventory_movements.unit_cost`, `total_cost` | Optional value snapshot for product stock events | Nullable for legacy/non-costed movements; spoilage and transfer writers populate cost |
| `recipe_batches.total_batch_cost` | Legacy cooked-batch total snapshot | Required `REAL`; no ingredient allocation relation |
| `ingredient_lots.total_cost`, `cost_per_unit` | Purchase total and `totalCost / purchasedQuantity` | Service validates positive purchase quantity/cost; no stored scale or rounding |
| `ingredient_movements.unit_cost`, `total_cost` | Optional lot movement cost snapshots | Nullable; active writers populate according to purchase/usage/adjustment context |
| `recipes.suggested_selling_price` | Optional owner advisory price | Null means no suggestion; not the Product selling price |
| `recipe_ingredient_lines.cost_override`, `cost_per_unit_snapshot`, `line_cost_snapshot` | Optional custom/selected cost inputs plus required derived line snapshot | Custom-vs-lot meaning depends on `is_custom`; no decimal rounding |
| `production_batches.total_batch_cost`, `cost_per_output_unit` | Sum of production usage line costs; total divided by output quantity | Required `REAL`; production validates positive output and compatible units |
| `production_ingredient_usages.line_cost` | Per-source historical production cost snapshot | Required; source references may later become null through `SET NULL` |
| `sale_ingredient_usages.line_cost` | Cook-upon-order usage cost, potentially estimated | Required; read together with estimated and shortfall fields |
| `product_transfers.unit_cost`, `total_cost` | Value-neutral transfer snapshot; current cost preview uses produced-average cost when available, otherwise product cost | Positive quantity validation; no profit effect |
| `fixed_costs.amount`, `fixed_cost_payments.amount` | Recurring/one-time cost amount and a payment occurrence amount | Required `REAL`; occurrence expense counts by due date whether paid or not |
| Derived reports | `revenue = SUM(sales.amount)`; `soldCogs = SUM(COALESCE(cogs_total, unit_cost * quantity))`; `grossProfit = revenue - soldCogs`; `netProfit = revenue - soldCogs - fixedCosts - spoilageLoss` | JavaScript/SQLite floating-point sums; no calculation-stage rounding |
| Informational report values | Unsold goods = positive scalar product stock × average produced cost; grocery remaining value = lot remaining × cost/unit; production cost and transfer value reported but excluded from profit | Current snapshots, not ledger balances; may change as current stock/rows change |

There are no tax, debt/`utang`, balance, tender-payment ledger, general-expense, refund, or exchange-rate fields.

**Rounding and display:**

- Calculations and persisted amounts are not systematically rounded.
- [`formatPeso`](../../src/components/ui/KitaMoUI.tsx) renders whole numbers with zero decimals and fractional numbers with two decimals using `en-PH`; this is display formatting, not stored rounding.
- Receipt text uses `toFixed(2)`, and bundle labels can use two decimals. Quantity UI displays at most two fractional digits.
- Negative report results are valid for loss display. Database columns generally lack `CHECK >= 0`, so invalid negative source amounts remain structurally possible even when current UIs validate inputs.
- **Risk:** binary floating-point aggregation and inconsistent display-only rounding can diverge from a future decimal/minor-unit contract.

### Quantities and units

| Quantity fields | Unit semantics and calculations | Fraction/negative/rounding validation |
| --- | --- | --- |
| `products.stock_qty`, `low_stock_threshold` | Product `unit_type` supplies piece/bottle/pack/sachet/kilo/serving/case/tray/other | `REAL`; fractions structurally allowed; prepared checkout/transfer/spoilage use guarded decrements; generic product update has no DB non-negative check |
| `products.bundle_quantity`; cart/SaleItem `quantity` | Bundle size is interpreted as an integer; SaleItem quantity inherits product unit | Pricing floors bundle size/count, applies only full bundles, prices remainder regularly, and refuses a bundle price that is not cheaper; cart quantity is non-negative |
| `inventory_movements.quantity` | Signed/typed meaning comes from movement type and writer convention, not a DB check | `REAL`; no universal sign constraint |
| `recipe_batches.batches`, `expected_servings`, `actual_servings` | Batches/servings are implicit semantic units, not enum-backed | `REAL`; legacy path validates workflow inputs, but schema allows arbitrary values |
| `ingredients.low_stock_threshold` | Expressed in `default_unit` | `REAL`; grocery summaries convert compatible lots |
| `ingredient_lots.purchased_quantity`, `remaining_quantity` | Explicit lot `unit` | `REAL`; purchase requires positive; adjustments/production guard availability; fractions allowed |
| `ingredient_movements.quantity` | Explicit movement `unit` | `REAL`; writer/movement type determines sign; no DB range check |
| `recipes.output_quantity`, `recipe_ingredient_lines.quantity` | Explicit ingredient-unit vocabulary (`g`, `kg`, `ml`, `L`, `pcs`, `pack`) | Positive validation in recipe workflow; fractions allowed |
| `production_batches.output_quantity`, `batch_multiplier`; `production_ingredient_usages.quantity_used` | Explicit output/usage units; required quantities scale by multiplier | Production blocks invalid multiplier/output, incompatible unit, or confirmed lot shortfall; no persisted rounding |
| `sale_ingredient_usages.quantity_used`, `shortfall_quantity` | Explicit unit; distinguishes planned/recorded usage and missing amount | Cook-upon-order deliberately does not block a sale for shortfall; values can be estimated |
| `product_transfers.quantity` | Inherits Product unit; destination compatibility is not validated beyond same-name reuse/clone behavior | Requires positive quantity and guarded source stock; fractions structurally allowed |
| Spoilage input and movement quantity | Finished-product quantity inherits Product unit | Requires positive quantity and guarded stock; no ingredient-lot spoilage writer exists |

**Confirmed conversion rules:** same-unit passthrough, `kg`↔`g` by 1000, and `L`↔`ml` by 1000 in grocery/recipe costing. `pcs` and `pack` require exact match; pack sizing and product-unit/ingredient-unit cross-conversion are not implemented. Makeability uses floor-based complete-batch calculation with an epsilon; this is a planning result, not stored quantity rounding.

### Enums and persisted vocabularies

There are **27 persisted or typed persisted vocabularies** in [`generated/enums.json`](generated/enums.json). SQLite `TEXT` comparisons and TypeScript literal values are case-sensitive in current use.

Unknown-value classes used below:

- **Reject:** a SQLite `CHECK` rejects unknown persisted input.
- **Unspecified:** there is no database check; current typed/validated writers constrain intended values, but a legacy/manually altered unknown may be cast, displayed raw, ignored by a condition, or fail mapper validation. There is no central unknown-value policy.

| Vocabulary | Values/default | Unknown behavior and SQL use | UI labels, legacy values, transitions, and compatibility |
| --- | --- | --- | --- |
| SyncStatus | local, pending, synced, failed; default local (queue sync default pending) | Reject; DB checks and queue/status queries | Only local/pending actively written; synced/failed transitions absent; future state machine unresolved |
| BusinessType | 7 values; no DB default | Unspecified; not a material SQL discriminator | Typed owner form labels; preserve exact lowercase/spaced legacy strings |
| LanguagePreference | Taglish, Filipino, English; Taglish | Unspecified | UI preference labels; mixed capitalization is significant |
| Currency | PHP; PHP | Unspecified | Display assumes pesos; no alternative transition |
| BranchType | stall, branch, kiosk, booth, home kitchen, pop-up; stall | Unspecified | User-facing location labels; mapping to future Stall unapproved |
| ProductType | retail item, cooked food, ingredient-based item, service/other; retail item | Unspecified; workflow code branches on value | UI product classification; protected stock/recipe behavior depends on it |
| UnitType | 9 product units; piece | Unspecified | UI labels; no general conversions |
| PaymentMethod | cash, GCash, Maya, bank transfer, other; cash | Unspecified; analytics groups/filters values | Human labels largely match persisted strings; casing/spaces must be retained |
| PaymentStatus | paid, unpaid, pending, failed; paid | Unspecified | Stored on sale create; no later transition writer found |
| SaleCogsSource | simple, production_average, cook_upon_order_actual, cook_upon_order_estimated; null | Unspecified; reports primarily use values/estimated flag, not enforce enum | Internal provenance labels; null is legacy/not recorded |
| InventoryMovementType | 9 values; required/no default | Unspecified; SQL/report filters include spoilage and event categories | UI logbook maps selected values; some declared values have no active writer |
| IngredientUnit | g, kg, ml, L, pcs, pack; often pcs | Unspecified; service conversions branch on exact values | UI unit labels; uppercase `L` is significant |
| IngredientLotStatus | active, depleted, archived; active | Unspecified; repository SQL filters status | Active→depleted/archive paths; no reactivation path established |
| IngredientMovementType | purchase, adjustment, recipe_usage, spoilage; required | Unspecified; logbook/report reads types | `spoilage` is declared but has no active ingredient writer |
| RecipeProductionMode | prepared_before_selling, cook_upon_order; prepared_before_selling | Unspecified; workflow code branches on exact value | UI labels differ from stored tokens; changes affect checkout/production |
| FixedCostCategory | 9 values; other | Unspecified | UI label map; no central unknown fallback contract |
| FixedCostFrequency | daily, weekly, monthly, one_time; monthly | Unspecified; occurrence generator branches on value | UI labels; affects expense timing |
| FixedCostStatus | active, archived; active | Unspecified; service filters active | Archive writer exists; no unarchive writer |
| FixedCostPaymentStatus | paid, skipped; paid | Unspecified | Active writer creates paid; skipped has no writer |
| OwnerAlertSeverity | info, warning, critical; info | Unspecified | UI tone mapping; no transition |
| OwnerAlertStatus | persisted/default open plus typed active/resolved | Unspecified; repository SQL considers active/open and writes resolved | **Confirmed legacy mismatch**; open versus active mapping needs approval |
| AppSettingKey | seven fixed forms plus dynamic branch key; none | Unspecified; SQL equality on exact key | Mostly internal; unknown keys remain structurally possible |
| AppSettingValueType | string, boolean, number, json; string | Unspecified; parser branches on value | Invalid JSON/number fallback behavior is repository-specific |
| ProblemReportMode | owner, kiosk; required | Reject | UI mode fixes value at creation; no transition |
| ProblemReportCategory | 7 diagnostic categories; required | Reject | Form label mapping; exact underscore tokens persisted |
| ProblemReportStatus | open, resolved; open | Reject; an index exists, but current list/count methods do not filter by status | Only open actively written; no resolver writer found |
| ThemeMode | light, dark, system; caller default system | Unspecified; stored as setting value | UI labels; invalid value falls back through theme preference logic |

Untyped persisted vocabularies remain in `offline_queue.status`, `entity_type`, and `operation`, and nested diagnostic breadcrumb JSON. These are **Unresolved**, not additional approved enums.

### Null, default, and absence semantics

- **Null relation:** Nullable branch/product/recipe/ingredient/lot/sale references can mean “not scoped/not applicable,” “legacy record,” or “source later deleted with `ON DELETE SET NULL`.” These meanings cannot be collapsed safely.
- **Null cost:** Nullable movement and COGS fields mean cost not recorded or legacy; report COGS explicitly falls back to `unit_cost * quantity`.
- **Null suggested value:** `suggested_selling_price = null` means no suggestion.
- **Null checkout token:** Sale was created without durable checkout idempotency; the partial unique index excludes it.
- **Missing app-setting row:** Caller default/bootstrap state. It is distinct from stored empty string, `false`, `0`, empty JSON array, or JSON `null`.
- **Empty string:** Several forms trim/validate names, but SQLite does not globally prohibit empty strings.
- **Zero:** Often a legitimate default (stock, thresholds, amounts, counts, shortfall); it is not equivalent to absent. A zero `cogs_total` is distinct from null fallback.
- **False:** Persisted as integer `0`; for `active`, `is_active`, bundle, custom, and estimated fields it is a real state, not missing.
- **Missing relation:** Foreign-key `SET NULL` preserves the snapshot row; display names/cost snapshots may remain.
- **Not yet calculated:** Commonly represented by null in optional COGS/cost/advisory fields or by an absent query-time result.
- **Deleted record:** Current queries often interpret non-null `deleted_at` as excluded, but normal code does not create tombstones.
- **Unknown:** There is no general sentinel; null is overloaded by field, making per-field contracts necessary.

**Confirmed sign conventions:** a downward manual ingredient-lot adjustment writes a negative `ingredient_movements.quantity` and negative `total_cost`; finished-product outgoing movements retain a positive quantity and encode direction in `movement_type` such as `stock_out_sale`, `transfer_out`, or `spoilage`; report profit values may be negative to represent loss. No database-wide sign constraint enforces these conventions.

### Deletion, audit, and history

- Twenty-two app tables have `deleted_at`; `app_settings` does not. No current normal writer sets a tombstone.
- Current logical lifecycle controls are `fixed_costs.status = archived`, `ingredient_lots.status = archived/depleted`, `recipes.is_active = 0`, and `owner_alerts.status = resolved`.
- No current problem-report resolver, fixed-payment skip writer, sale cancel/refund, movement reversal, or compensating-transaction entity was found.
- The only runtime hard-delete path is PIN-gated pilot reset, which deletes all 23 application tables in child-first order inside SQLite. `schema_migrations` remains.
- Foreign keys comprise 29 `CASCADE` and 31 `SET NULL` actions. Business deletion would cascade widely; source/reference deletion often nulls links while preserving snapshots.
- Movement, usage, sale, receipt, production, and transfer history is append-oriented under normal workflows, but it is not immutable at the database permission level and full reset removes it.
- Reports generally filter `deleted_at IS NULL`. Fixed-cost reports additionally exclude currently archived costs, which can alter a recomputed historical period.
- There is no reversible cancellation/compensation model. Removing or rewriting history would risk accounting, inventory audit, and future sync evidence.

### Existing sync and version metadata

| Field/concept | Current status | Evidence-based meaning |
| --- | --- | --- |
| `sync_status` | Partially implemented | Present/check-constrained on 22 tables; normal writes use local, checkout queue uses pending; no synced/failed writer |
| `created_at`, `updated_at` | Active local metadata | Writer-supplied UTC ISO strings; no server clock/revision meaning |
| `deleted_at` | Structurally present, inactive | Queried as tombstone-like exclusion but never set by normal current code |
| `offline_queue.status` | Partially implemented | Checkout writes pending; no worker changes it |
| `attempt_count` | Unused | Defaults to zero; no increment writer found |
| `last_error` | Unused | Nullable; no error writer found |
| `offline_queue.payload` | Active producer, no consumer | JSON Sale payload written during checkout; no schema version |
| `checkout_token` | Active local idempotency | Unique for non-null/non-deleted Sale; normally originated in in-memory cart |
| `schemaVersion = 10` | Descriptive only | No consumer found; ordered migration IDs and `schema_migrations` drive execution |
| Migration IDs/ledger | Active local schema metadata | Ten exact IDs; no checksum, downgrade, or drift verifier |
| `syncedAt`, `lastSyncedAt`, `remoteId`, `serverId`, `deviceId`, `clientId`, row `version`/`revision`, `dirty`, conflict/tombstone version | Confirmed absent | No current persisted field or active implementation found |

## Likely findings

- ISO timestamp lexical ordering is reliable for rows written by current UTC writers, but not guaranteed for arbitrary legacy strings.
- Snapshot columns intentionally protect historical meaning when source records change; their continued presence should be favored over recomputation.
- PHP is the effective currency for all current monetary values, but the child rows do not independently prove currency if detached from Business.

## Unresolved findings

- Live-device value distributions, mixed timestamp formats, negative/NaN-like input history, and enum drift.
- Approved minor-unit/decimal representation and rounding policy.
- Whether bundle savings belong at header, line, or both; live line discount fields are zero.
- Quantity scale, pack sizing, and cross-vocabulary product/ingredient unit mapping.
- Deletion authority, archival effective date, sale reversal, actor identity, and sync/conflict policy.
- Exact offline queue payload schema and whether existing local rows exist.

## Risks

1. Converting `REAL` money to integer minor units without reconciliation can silently change historical totals.
2. Converting date-only values to instants can move an occurrence across a reporting day.
3. Assuming FIFO would rewrite selected-lot behavior and COGS provenance.
4. Treating null as one universal “missing” value would erase legacy, not-applicable, deleted-reference, and not-calculated distinctions.
5. Treating `sync_status` fields as a functioning protocol would overstate an unimplemented system.
6. Recomputing reports after fixed-cost archive can change historical net profit.

## Shared Contracts implications

- Contracts need distinct types for LocalId, Instant, LocalDate, Money, Quantity+Unit, nullable historical reference, and snapshot provenance.
- Legacy PHP `REAL` values and current calculation outputs must remain representable without forced rounding.
- Enum parsers need explicit unknown/legacy handling, especially OwnerAlert status.
- Sync envelopes must be separately designed; current fields are compatibility evidence, not a complete protocol.
- Every mapping in [`shared-contracts-evidence-map.md`](shared-contracts-evidence-map.md) remains Proposed, Under Review, or Deferred until approved.

## Evidence sources and files inspected

- All migrations under [`src/db/migrations`](../../src/db/migrations)
- [`src/domain/types.ts`](../../src/domain/types.ts), [`ids.ts`](../../src/domain/ids.ts), [`pricing.ts`](../../src/domain/pricing.ts), [`recipeCosting.ts`](../../src/domain/recipeCosting.ts), [`profitMath.ts`](../../src/domain/profitMath.ts), and [`receipts.ts`](../../src/domain/receipts.ts)
- All repositories under [`src/db/repositories`](../../src/db/repositories)
- Protected workflow and report modules under [`src/services`](../../src/services)
- [`src/components/ui/KitaMoUI.tsx`](../../src/components/ui/KitaMoUI.tsx)
- Relevant owner/kiosk routes under [`app`](../../app)
- Generated schema, column, enum, and decision inventories in this directory

## Commands executed

- `rg` located all identifier, date/timestamp, monetary, quantity, unit, enum/status, null/default, delete, and sync-shaped fields.
- `nl -ba`/`sed -n` inspected generators, validation, conversions, calculations, queries, formatting, row mapping, and write paths.
- A fresh isolated SQLite replay provided exact types, nullability, defaults, checks, foreign keys, and indexes; the temporary database was deleted.
- Read-only Node scripts counted and cross-checked columns, constraints, enum vocabularies, and SQL call sites.
- No source values, user records, secrets, or release artifact contents were printed.

## Limitations

- No live device database or production record distribution was inspected.
- Display labels were inspected at source level, not exhaustively exercised in every language/mode.
- JavaScript/SQLite floating-point behavior was not reconciled against a decimal reference dataset.
- Device timezone changes and daylight-saving edge cases were not executed.
- No sync, import/export, backup/restore, or remote parser exists to test compatibility.

## Next approval gate

Disposition the 21 entries in [`unresolved-semantic-decisions.md`](unresolved-semantic-decisions.md), especially identity, temporal, money, quantity, deletion, actor, outbox, COGS, fixed-cost, and transfer semantics, before MOB-2 creates machine-readable contracts. No conversion or cleanup is approved.
