# Repository and Service Map

## Purpose

Map the current persistence boundaries, transaction ownership, callers, error/idempotency behavior, and future synchronization seams without refactoring the application.

## Scope and inspection context

- **Inspection date:** 2026-07-25
- **Repository:** `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile`
- **Branch:** `codex/pre-internal-hardening`
- **HEAD:** `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4`
- **Scope:** `src/db`, all repository modules, all service modules, Zustand state, and route-level callers.
- **Excluded:** Any new interface, dependency injection, sync adapter, cloud client, authentication layer, or behavior change.

Evidence labels: **Confirmed** is directly supported by inspected code; **Likely** is a supported architectural interpretation not exercised on-device; **Unresolved** requires a product or technical decision; **Proposed for later review** is not current behavior.

## Confirmed architecture

```text
Expo Router screens and common components
        │
        ├──────────────► five screens call repositories directly
        │
        ▼
Zustand stores / UI orchestration
        │
        ▼
18 domain and application service modules
        │
        ├──────────────► repository calls
        └──────────────► eight services also issue raw SQLite queries
        │
        ▼
16 repository/helper modules
        │
        ▼
expo-sqlite client: one memoized kitamo_local.db handle
        │
        ▼
23 application tables + schema_migrations

Parallel non-SQLite boundaries:
ownerAccess service ─► Expo SecureStore / LocalAuthentication
shareReceipt service ─► Clipboard / native Share
problemReports service ─► diagnostics + Clipboard / native Share
```

- **Confirmed:** The implementation contains **16 repository/helper modules** (excluding the barrel `index.ts`) with 82 exported functions/types and **18 service modules** with 85 exports. This report therefore uses **34 repository or service module boundaries** for the MOB-1 executive count.
- **Confirmed:** There is no ORM or query builder. Repositories and services call the `expo-sqlite` async API and manually map rows.
- **Confirmed:** Eight service modules contain direct SQL: `kioskSales`, `localAnalytics`, `ownerSetup`, `problemReports`, `production`, `profitReports`, `stockOps`, and `transfers`.
- **Confirmed:** No screen or Zustand store directly imports or calls the SQLite API.
- **Confirmed:** Five route modules call repositories directly rather than a service: owner business settings, owner inventory, owner home, owner notifications, and kiosk stock.
- **Confirmed:** There are 141 SQLite API call sites and 15 `withExclusiveTransactionAsync` call sites, one of which is the migration runner.

## Repository module inventory

Common behavior unless a row says otherwise: functions throw/reject on SQLite errors; callers handle them; there is no structured domain-error hierarchy, automatic retry loop, actor/role argument, or repository-level authorization. Row mappers return current camelCase domain shapes. Formal unit tests do not exist; safe `check:*` scripts provide targeted structural and smoke coverage as listed in [`validation-and-test-inventory.md`](validation-and-test-inventory.md).

| Module | Responsibilities and tables | Transaction, validation, idempotency, and callers | Duplication and future-boundary assessment |
| --- | --- | --- | --- |
| [`appSettings.ts`](../../src/db/repositories/appSettings.ts) | Read and upsert `app_settings`; typed string/boolean/number/JSON values | Single statements; unique key; preference/setup services call it; parse errors fall back or surface according to caller | **Likely sync candidate only for approved shared settings**; absence/default semantics need a contract |
| [`branches.ts`](../../src/db/repositories/branches.ts) | Branch create/read/update/count over `branches` | No module-owned multi-write transaction; owner setup/settings and direct business-settings screen call it; caller validates business context | Location identity boundary; current Branch/stall terminology must be preserved |
| [`businesses.ts`](../../src/db/repositories/businesses.ts) | Business create/read/update/count over `businesses` | Single statements; owner setup/settings and direct business-settings screen call it | Candidate identity/config boundary; no membership/authorization context |
| [`fixedCosts.ts`](../../src/db/repositories/fixedCosts.ts) | Create/list/archive fixed costs; list/check/create payments | Read-before-write payment duplicate check is not a transaction or unique constraint; service calls it; active payment writer uses `paid` | Finance sync candidate, but occurrence identity and archive semantics block a safe contract |
| [`ingredientLots.ts`](../../src/db/repositories/ingredientLots.ts) | Read/create lots and ingredient movements; adjust/archive lot state | Repository operations are single statements; `groceryPool` service owns purchase/adjustment transactions and numeric validation | Lot boundary is material; selected-lot, cost, units, and history must be versioned |
| [`ingredients.ts`](../../src/db/repositories/ingredients.ts) | Ingredient catalog create/read/update/count | Single statements; grocery/recipe services call it | Candidate catalog boundary; name/unit identity is not canonicalized |
| [`inventoryMovements.ts`](../../src/db/repositories/inventoryMovements.ts) | Create/list/count finished-product movements | Single insert/read; stock-changing services usually insert within their own transaction | Strong audit/event candidate, but reversal/sign semantics are unresolved |
| [`ownerAlerts.ts`](../../src/db/repositories/ownerAlerts.ts) | Create/find/list/count/resolve product alerts | Single statements; owner home/notifications and kiosk stock call directly; no actor context; repository handles legacy active/open reads | Mostly local workflow; status vocabulary mismatch requires compatibility mapping |
| [`pilotDataReset.ts`](../../src/db/repositories/pilotDataReset.ts) | Hard-delete all 23 application tables | Own exclusive transaction, child-first order; invoked by pilot-data service; no authorization inside repository | Not a sync boundary; destructive local maintenance boundary |
| [`problemReports.ts`](../../src/db/repositories/problemReports.ts) | Create/get/list/count `problem_reports` | Single statements; service validates and creates `open`; no resolver writer, retry, or remote upload | Diagnostics boundary only after privacy, schema-version, and status decisions |
| [`productionBatches.ts`](../../src/db/repositories/productionBatches.ts) | Read production batches/usages and aggregate production cost | Read-only repository; production service owns writes with raw SQL | Candidate history boundary; write semantics live elsewhere |
| [`products.ts`](../../src/db/repositories/products.ts) | Product create/read/update/count | Single statements; inventory screen calls directly; services also query products directly; generic update permits stock values without a database non-negative constraint | High duplication risk; catalog versus branch-stock boundary is unresolved |
| [`recipeIngredientLines.ts`](../../src/db/repositories/recipeIngredientLines.ts) | Create/list/count recipe ingredient lines | Single inserts; recipe service creates them inside its transaction; no general update/delete path | Recipe component boundary; catalog/custom tagged-union semantics required |
| [`recipes.ts`](../../src/db/repositories/recipes.ts) | Recipe create/read/list/header update/count | Single statements; recipe service owns create-with-lines transaction and uses header update for archival | Candidate recipe boundary; versioning/history rules unresolved |
| [`sales.ts`](../../src/db/repositories/sales.ts) | Generic create Sale, SaleItems, optional Receipt; list/count | Own exclusive transaction but is not the live kiosk checkout path; lacks stock deductions, movements, checkout token, cook COGS, and offline queue | **Confirmed duplicate/divergent sale writer**; not safe as the sole canonical boundary |
| [`shared.ts`](../../src/db/repositories/shared.ts) | Common DB type, ISO timestamp helper, bounded table-count query | Dynamic count query uses an allow-list; used across repositories | Infrastructure helper, not a domain sync boundary |

## Service module inventory

Common behavior unless noted: services are called from screens/components or other services; failures normally throw and are rendered as UI errors. They do not receive an authenticated actor, owner membership, or seller identity. Targeted check scripts cover the most protected workflows, but no device-level integration harness exists.

| Module | Responsibility and data boundary | Transactions, retry/idempotency, callers, and returned shapes | Shared Contracts / risk assessment |
| --- | --- | --- | --- |
| [`fixedCosts.ts`](../../src/services/fixedCosts.ts) | Fixed-cost creation, overview, payment, archive, and period occurrence calculation | Uses repositories; duplicate payment is a non-atomic read-before-write; owner fixed-costs and profit reports call it | Finance boundary blocked by occurrence, archive, date, and money decisions |
| [`groceryPool.ts`](../../src/services/groceryPool.ts) | Ingredient purchase/search/cost history and lot adjustment | Two exclusive transaction paths: purchase and adjustment; validates positive quantities/cost and limited unit conversions; owner grocery calls it | Strong lot workflow boundary; selected-lot and precision rules must be retained |
| [`kioskPreferences.ts`](../../src/services/kioskPreferences.ts) | Favorites and recent-product settings | App-setting reads/upserts; kiosk selling UI calls it; no retries | Likely local-only preference boundary until approved otherwise |
| [`kioskSales.ts`](../../src/services/kioskSales.ts) | Kiosk context, checkout, recent orders, shift summary | Raw SQL; live checkout owns exclusive transaction; validates cart/context, enforces prepared stock, records Sale/Items/movements/usages/receipt/queue; unique token reread handles duplicate submission | Primary commerce boundary; most critical source for sale and COGS contracts |
| [`localAnalytics.ts`](../../src/services/localAnalytics.ts) | Dashboard, records, payment/top-product summaries, lifecycle and logbook queries | Raw read SQL; no transaction snapshot across the whole report; returns query-time shapes | Read model only; formulas/filters are evidence, not canonical writes |
| [`offlineQueue.ts`](../../src/services/offlineQueue.ts) | In-memory initial UI status descriptor | No database access despite its name; no consumer, retry, or uploader | **Confirmed disconnected stub**, not a sync implementation |
| [`ownerAccess.ts`](../../src/services/ownerAccess.ts) | Owner PIN/biometric enrollment, verification, throttle state, and clearing | SecureStore/LocalAuthentication, not SQLite; UI owner gate calls it; sensitive values were not inspected | Security boundary requires separate approved authentication/threat model |
| [`ownerSetup.ts`](../../src/services/ownerSetup.ts) | First-run state and active business/branch context | Three exclusive context-switch transactions; raw queue-count read; settings/business/branch repositories; welcome/context screens call it | Context boundary; branch/business membership semantics unresolved |
| [`pilotData.ts`](../../src/services/pilotData.ts) | Transactional demo seed and local reset orchestration | Seed owns exclusive transaction; reset clears SecureStore then invokes exclusive DB reset, so cross-store reset is not atomic | Development/pilot maintenance, not a canonical production sync boundary |
| [`problemReports.ts`](../../src/services/problemReports.ts) | Validate, collect diagnostics, save/list/read/copy/share reports | Raw context reads plus repository persistence; Expo Crypto UUID; no upload/retry/resolver | Diagnostics boundary blocked by privacy, version, and ownership decisions |
| [`production.ts`](../../src/services/production.ts) | Plan/validate/record ingredient-backed production and summaries | Raw SQL write transaction checks unit compatibility and lot remaining quantity, records usage/batch/output movement, and resolves alert | Protected inventory/COGS boundary with strong local atomicity |
| [`profitReports.ts`](../../src/services/profitReports.ts) | Per-stall and consolidated revenue/COGS/fixed-cost/spoilage/profit reports | Raw read SQL plus fixed-cost range service; no report snapshot or rounding layer; owner reports call it | Read contract depends on date, archive, money, and cancellation decisions |
| [`recipes.ts`](../../src/services/recipes.ts) | Create recipe with lines, costing/makeability overview, archive, previews | Exclusive create-with-lines transaction; validation for custom/lot lines and units; no line edit workflow | Recipe command/read boundary; selected-lot and legacy-batch semantics unresolved |
| [`shareReceipt.ts`](../../src/services/shareReceipt.ts) | Copy/share receipt text | Clipboard/native Share only; no database or retry | Presentation adapter, not structured receipt export |
| [`stockOps.ts`](../../src/services/stockOps.ts) | Low-stock notification, legacy cooked batch, finished-product spoilage | Raw SQL; exclusive cooked and spoilage transactions; quantity guards and cost snapshots; owner inventory flows call it | Protected inventory boundary; legacy production and reversal semantics unresolved |
| [`syncStub.ts`](../../src/services/syncStub.ts) | Describes current local-only sync state | No database/network behavior | Explicit evidence that cloud sync is deferred |
| [`themePreferences.ts`](../../src/services/themePreferences.ts) | Load/save theme mode | Runs migrations then uses app settings; mirrored by theme store/AppShell | Local presentation preference unless later approved |
| [`transfers.ts`](../../src/services/transfers.ts) | Transfer cost preview, transfer recording, transferable-product query | Raw SQL; exclusive source decrement, destination reuse/clone, transfer row, and paired movements; destination name lookup occurs before transaction | Protected boundary; same-name destination merge and concurrency are high-risk |

## Transaction boundaries

The following are **Confirmed** `withExclusiveTransactionAsync` sites:

| Owner | Transaction purpose | Atomic inside SQLite | Important limitation |
| --- | --- | --- | --- |
| Migration runner | One migration `up` batch plus ledger insert | Yes, per migration | Ten migrations are not one all-or-nothing series |
| Pilot reset repository | Child-first hard deletion of 23 application tables | Yes | SecureStore clearing occurs outside/before this transaction |
| Generic sales repository | Sale, items, optional receipt | Yes | Not live checkout; omits protected side effects |
| Grocery service ×2 | Purchase with lot/movement; lot adjustment with movement | Yes | No active ingredient-spoilage workflow |
| Kiosk sales service | Complete sale and all live checkout side effects | Yes | Cook-upon-order lot update result is not checked before history inserts |
| Owner setup service ×3 | Active business/branch context changes | Yes | Authorization is caller/UI responsibility |
| Pilot seed service | Demo business/branch/products/opening movements/settings | Yes | Development/pilot data only |
| Production service | Lot deductions, usages, batch, output stock/movement, alert | Yes | Finished product remains scalar stock |
| Recipe service | Recipe plus ingredient lines | Yes | No recipe-line edit transaction exists |
| Stock operations ×2 | Legacy cooked batch; finished-product spoilage | Yes | No explicit reversal/compensation |
| Transfer service | Source/destination stock, transfer, paired movements | Yes | Destination lookup precedes transaction |

An exception from a callback is expected to reject and roll back that SQLite transaction. This is **Likely** from the Expo API contract and the code’s throw behavior; it was not revalidated on a physical device in this task.

## UI and state bypass inventory

- **Confirmed direct route-to-repository calls:**
  - [`app/owner/business-settings.tsx`](../../app/owner/business-settings.tsx) → businesses and branches.
  - [`app/owner/inventory.tsx`](../../app/owner/inventory.tsx) → products.
  - [`app/owner/index.tsx`](../../app/owner/index.tsx) → owner alerts.
  - [`app/owner/notifications.tsx`](../../app/owner/notifications.tsx) → owner alerts.
  - [`app/kiosk/stock.tsx`](../../app/kiosk/stock.tsx) → owner alerts.
- **Confirmed:** These routes bypass a service/use-case layer but do not bypass repositories and do not access raw SQLite.
- **Confirmed:** Five Zustand modules exist under [`src/state`](../../src/state). None uses Zustand persistence middleware or calls SQLite directly.
- **Risk:** Validation, role assumptions, and orchestration are distributed between screen, service, and repository layers; a future sync implementation cannot safely assume one repository is the only writer.

## Error, retry, idempotency, and authorization behavior

- **Confirmed:** Most SQLite errors propagate as thrown promises. There is no shared typed domain-error or retry policy.
- **Confirmed:** Live checkout is the only current durable idempotency path. A non-null `checkout_token` has a partial unique index; a uniqueness race is re-read to return the existing sale.
- **Confirmed:** Fixed-cost payment duplicate prevention is not durable idempotency because it is an unguarded read-before-write check.
- **Confirmed:** `offline_queue.attempt_count` and `last_error` exist, but no current worker increments or writes them.
- **Confirmed:** Services and repositories do not accept an actor or authorization context. Owner-only enforcement is primarily route/access-gate orchestration.
- **Unresolved:** Which command failures are retriable versus permanent, and which side owns retry, conflict, and authorization once cloud connectivity exists.

## Likely findings

- The most defensible future sync boundaries are protected domain commands plus immutable/snapshot-rich results, not generic table CRUD.
- Read services (`localAnalytics`, `profitReports`) are better treated as mobile read-model evidence than cross-system write contracts.
- Direct SQL is deliberate in complex workflows to keep a single SQLite transaction, but it increases the cost of extracting a single repository interface.

## Unresolved findings

- Whether the generic sales repository is legacy/dead code or intended for a second future workflow.
- Whether destination product name matching in transfers is intentional product identity.
- Whether direct screen-to-repository calls should remain supported compatibility paths.
- The intended retry and terminal-state model for the offline queue.
- The lower-layer authorization design for owner-only mutations and reset.

## Risks

1. Calling the generic `createSale` instead of `completeKioskSale` would omit stock, COGS, movement, queue, and token behavior.
2. Adding a network adapter beneath only repositories would miss eight raw-SQL services.
3. Applying retries to non-idempotent multi-row operations could duplicate stock/accounting effects.
4. UI-only authorization is insufficient for a future remote command boundary.
5. Reimplementing analytics formulas server-side without matching mobile filters, dates, and snapshots could produce divergent reports.

## Shared Contracts implications

- Contract discovery must trace all current writers, not only repository exports.
- Checkout, production, grocery purchase/adjustment, spoilage, transfer, recipe creation, and fixed-cost occurrence need command-level compatibility worksheets.
- Retry/idempotency/error semantics must be explicit per command.
- Repository DTOs are current internal shapes, not automatically approved canonical DTOs.
- Authorization and sync are separate future designs and remain out of scope at this gate.

## Evidence sources and files inspected

- [`src/db/client.ts`](../../src/db/client.ts), [`src/db/migrations/index.ts`](../../src/db/migrations/index.ts)
- Every module under [`src/db/repositories`](../../src/db/repositories)
- Every module under [`src/services`](../../src/services)
- Every store under [`src/state`](../../src/state)
- Route callers under [`app`](../../app)
- [`package.json`](../../package.json) and all `scripts/check-*.js`

## Commands executed

- `find` and `rg --files` enumerated repositories, services, stores, and routes.
- `rg` traced exports, imports, SQLite APIs, raw SQL, transaction wrappers, repository calls, retry/idempotency fields, and SecureStore use.
- `nl -ba` and `sed -n` inspected all complex writers and representative readers.
- Read-only Node/TypeScript parsers counted 16 repository modules, 18 service modules, exports, 141 SQL API sites, and 15 exclusive transaction sites.
- `git status --short` and scoped diffs checked that no implementation file was modified.

## Limitations

- No physical-device concurrency, process interruption, disk-full, or transaction rollback injection was run.
- Static reachability does not prove that every exported function is exercised in production.
- No formal code-coverage tool or unit-test runner is configured.
- Network retry behavior cannot be tested because no active network sync implementation exists.

## Next approval gate

Before MOB-2, approve which current command/read boundaries are compatibility-critical and disposition the divergent sale writer, offline queue, transfer identity, fixed-cost occurrence, and authorization decisions in [`unresolved-semantic-decisions.md`](unresolved-semantic-decisions.md). This map does not authorize refactoring.
