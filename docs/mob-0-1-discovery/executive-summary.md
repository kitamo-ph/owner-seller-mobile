# MOB-0 / MOB-1 Discovery Executive Summary

## Purpose

Summarize repository relocation/authority verification and the evidence-based Android domain/SQLite inventory for a future Shared Contracts handoff. This is a discovery result, not milestone acceptance or implementation authorization.

## Scope and inspection context

- **Inspection date:** 2026-07-25
- **Repository:** `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile`
- **GitHub authority:** `https://github.com/kitamo-ph/owner-seller-mobile`
- **Branch:** `codex/pre-internal-hardening`
- **HEAD:** `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4`
- **Protected package:** `ph.kitamo.app`
- **Scope:** MOB-0 repository identity/relocation integrity and MOB-1 current offline domain, SQLite, migrations, services, semantics, invariants, and compatibility evidence.
- **Excluded:** Canonical contracts, cloud sync, Clerk, Supabase, Platform API, authentication, schema/data migration, behavior changes, signing changes, builds, commits, and pushes.

Evidence labels: **Confirmed** is directly supported by inspected local source/config/Git/DDL or isolated tests; **Likely** is supported but not live-device/remote verified; **Unresolved** needs evidence or approval; **Proposed for later review** is not current behavior.

## MOB-0 result

| Requirement | Result |
| --- | --- |
| Repository identity | **Confirmed:** requested path, resolved path, and Git root are the same authoritative repository |
| Remote | **Confirmed:** sole observed `origin` fetch/push URL is `https://github.com/kitamo-ph/owner-seller-mobile.git` |
| Branch | **Confirmed:** `codex/pre-internal-hardening`, tracking its origin branch and locally reported up to date |
| Baseline commit | **Confirmed:** HEAD is exactly `6ed9ace`; the expected commit exists and is an ancestor |
| Worktree | **Confirmed:** clean before discovery; final changes are confined to the new documentation directory |
| Worktrees/nested repositories | **Confirmed:** one worktree; no nested Git repository found |
| Android package | **Confirmed:** effective resolved package remains `ph.kitamo.app` |
| Expo identity | **Confirmed:** name `KitaMo`, slug `kitamo-android`, owner `kitamoandroidapp`, EAS project ID `d2ab769c-4916-4efa-ab1e-a2dfdc638607` |
| Version | **Confirmed:** `1.0.0`; Android versionCode `2` |
| Static/dynamic chain | **Confirmed:** static `app.json`; no dynamic app config or identity environment override found |
| Stale rename references | **Confirmed:** no `KitaMo_android_app`, obsolete GitHub URL, rename-sensitive script, CI workflow, or badge target found |
| Other absolute path | **Confirmed:** `README.md:700` names a separate PWA repository path; it is non-portable but not the relocated Android path and was left unchanged |
| Protected AAB | **Confirmed:** present, ignored/untracked, 57,120,066 bytes, SHA-256 `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`; read only for checksum and not content-inspected or modified |

### MOB-0 blockers and risks

- No source/config identity blocker was found.
- **Unresolved:** remote GitHub rules/object availability, EAS dashboard ownership, signing lineage, AAB internals, Play readiness, and 16 KB compatibility were not revalidated.
- The AAB is protected only by an ignored directory and documented checksum; it is not immutable or recoverable from Git.
- The separate PWA absolute README path remains a documentation-portability risk, not an Android relocation error.

### MOB-0 recommended disposition

**Conditionally Accept.** Local repository authority, baseline, package, Expo identity, and relocation integrity are sufficiently evidenced. Acceptance should explicitly acknowledge that remote governance/signing/artifact internals were outside scope and decide whether the protected local AAB needs an immutable external backup/checksum record. No active stale Android reference requires a change.

## MOB-1 result

| Inventory | Confirmed count |
| --- | ---: |
| Runtime SQLite tables | 24: 23 application tables + `schema_migrations` |
| Runtime columns | 334 |
| Ordered migrations | 10, up-only |
| Foreign keys | 60: 29 CASCADE + 31 SET NULL |
| Explicit named indexes | 41, including one partial unique checkout-token index |
| Triggers / views | 0 / 0 |
| Persisted application entities | 23 |
| Repository/service module boundaries | 34: 16 repository/helper + 18 service modules |
| SQLite API / exclusive transaction sites | 141 / 15 |
| Persisted/typed persisted vocabularies | 27 |
| Identified protected business invariants | 21 |
| Unresolved semantic decisions | 21 |

### Persistence and migration summary

- **Confirmed:** `expo-sqlite 16.0.10` opens one memoized `kitamo_local.db` handle and enables foreign keys.
- **Confirmed:** migration IDs/list/ledger drive execution. `schemaVersion = 10` is descriptive and has no discovered runtime consumer.
- **Confirmed:** each missing migration and its ledger insert execute in an exclusive transaction; same-handle callers are serialized.
- **Confirmed:** fresh isolated replay applies 10 then 0 on rerun and produces the 24-table/334-column/41-index inventory.
- **Confirmed:** migrations are additive and have no down path, schema checksum, drift repair, table rebuild, column drop/rename, or data transformation.
- **Unresolved:** live-device schema/data drift and every historical upgrade state; no user database was opened.

### Entity, repository, and service summary

- **Confirmed:** 23 persisted application entities; 19 explicit domain models and four table-only shapes (ReceiptRecord, OfflineQueueItem, SaleIngredientUsage, ProductTransfer).
- **Confirmed absent:** durable Owner/Seller/User/Membership, persisted shift/draft, refund/cancel, general expense, finished-product lot, bundle components, import/export/backup/restore, and cloud revision/conflict.
- **Confirmed:** eight services issue SQL directly, and five screens call repositories directly. No screen or Zustand store calls SQLite directly.
- **Confirmed:** live checkout is not equivalent to generic repository `createSale`; the generic path omits stock, movements, token, cook COGS, and outbox behavior.
- **Confirmed:** no service/repository accepts an actor or role context; owner access is a local UI/service gate rather than lower-layer authorization.

### Semantic summary

- IDs are local `TEXT` strings; most use time + short random text, while ProblemReport uses an Expo Crypto UUID.
- UTC ISO instants and device-local `YYYY-MM-DD` business dates coexist without a persisted IANA timezone.
- Money and quantities use SQLite `REAL`/JavaScript `number`; no stored scale or systematic calculation rounding exists.
- Ingredient conversions support same unit plus `g`↔`kg` and `ml`↔`L`; no general pack/product-unit conversion exists.
- Twenty-two tables contain sync/deletion-shaped metadata, but current writers use only local/pending and no uploader/conflict/revision protocol exists.
- No normal writer creates a `deleted_at` tombstone; archive/deactivate statuses and hard pilot reset are the actual lifecycle paths.
- Twenty-seven persisted vocabularies were inventoried; OwnerAlert `open` versus typed `active` is a confirmed legacy mismatch.

### Protected logic confirmed

- Checkout all-or-nothing local transaction and non-null token idempotency.
- Prepared stock guards and cook-upon-order estimated/shortfall behavior.
- Single-product bundle pricing rules.
- Selected grocery lots, limited unit conversions, and cost/source snapshots.
- Atomic grocery purchase/adjustment and production.
- Scalar finished-product stock, produced-average/simple/cook COGS sources.
- Atomic finished-product spoilage and transfer workflows.
- Fixed-cost due-occurrence accrual and current archive behavior.
- Exact revenue, sold-COGS, gross-profit, and net-profit formulas; transfers/production/unsold inventory excluded as current code specifies.
- Append-oriented movement/usage/receipt/batch snapshots.
- Owner-versus-kiosk UI boundary and PIN-gated reset orchestration.

### Major data-loss and contract-mapping risks

1. Local ID collision/remapping and absent seller/membership attribution.
2. Binary floating-point money/quantity conversion and unapproved rounding.
3. UTC instant versus local-date/timezone reinterpretation.
4. Selected-lot behavior, scalar finished stock, and stored COGS provenance.
5. Dormant tombstone fields, archive-effective dates, and absent cancellation/reversal.
6. Unversioned offline queue payload with no retry/conflict consumer.
7. Cook-upon-order guarded-update/history divergence under a race.
8. Fixed-payment duplicate race and historical-report change after archive.
9. Transfer destination same-name merge without unique product identity/type/unit compatibility.
10. Generic Sale writer and service/repository layering duplication.

### MOB-2 readiness

**Conditionally ready for an approval-gated design phase, not implementation.** The source inventory is sufficiently complete for selecting a first compatibility slice, but MOB-2 must cite and disposition the blocking decision IDs. Live database fixtures, canonical owners, and reconciliation rules remain absent.

### MOB-1 recommended disposition

**Conditionally Accept.** Evidence coverage is broad, mechanically cross-checked, and the full safe validation suite passes. Acceptance should preserve the limitations: no physical device/live database, no complete service-level failure/concurrency suite, no canonical decisions, and 21 approval-gated semantic items. MOB-1 should not be treated as approval to implement MOB-2.

## Validation result

- **Passed:** `npm run typecheck`.
- **Passed:** `npm run lint`.
- **Passed:** all ten focused scripts: owner context, owner PIN security, pricing, recipes, production, COGS, fixed costs, pilot scenario, migrations, and problem reports.
- **Passed:** migration first-run/rerun behavior and duplicate checkout-token rejection in an OS-temporary database.
- **Passed:** all seven generated JSON files parse; declared counts match; all 21 semantic decisions contain the 19 required fields.
- **Passed:** `git diff --check` for tracked diffs plus an explicit whitespace/final-newline scan for the entirely untracked discovery directory.
- **Passed:** final scope/status check—only `?? docs/mob-0-1-discovery/`; no functional/config/lockfile/release file changed.
- **Passed:** Markdown required-section and cross-reference QA; all 157 relative links resolve.
- **Skipped:** `npm test` because no test script/runner exists.
- **Skipped:** Expo start/Android, native prebuild, EAS build/submit, AAB analysis, emulator/device, Play Console, and network sync because they are interactive, mutating, credential/artifact-affecting, unavailable, or outside this discovery gate.

## Risks

The primary milestone risk is confusing documentation completeness with semantic approval. The inventories expose current behavior and defects/ambiguities; they do not endorse them as future design.

## Shared Contracts implications

- Mobile remains authoritative for current offline behavior at this commit.
- Generated JSON is evidence, not a production contract package.
- Contract work must preserve legacy source/provenance and cite decision/invariant IDs.
- No compatibility mapping is `Approved`; Shared Contracts authority begins only after the next explicit gate.

## Evidence documents and generated inventories

Thirteen reports and seven machine-readable inventories are present under this directory. The complete paths are listed in the task handoff and all reports link to their primary source evidence.

## Files inspected

- Git metadata and `.gitignore`
- `README.md`, release documentation, and all tracked docs/scripts/config relevant to relocation
- `app.json`, `eas.json`, `package.json`, `package-lock.json`, TypeScript/ESLint config
- Every migration and repository under `src/db`
- Relevant domain modules, all 18 services, all five Zustand stores, and all route consumers
- All ten `scripts/check-*.js`
- No secret values, signing material, protected artifact internals, or private user/business records

## Commands executed

- Mandatory Git/path preflight commands (`pwd`, Git root/remote/status/branch/HEAD/worktree/baseline checks).
- Targeted `rg`/`find` stale-path, identity, source, persistence, and consumer searches.
- Static/resolved Expo config inspection with dotenv/telemetry disabled.
- Protected artifact `stat`, ignore/tracking checks, and SHA-256 only.
- Isolated migration replay plus SQLite metadata PRAGMAs; temporary database removed.
- Read-only Node inventory/cross-check scripts and JSON parsing.
- npm dependency inventory, typecheck, lint, and all ten safe focused checks.
- Final Git/diff/file-scope commands documented in the validation report.

## Limitations

- No GitHub/EAS/Play remote control-plane verification.
- No AAB content/signature/native-manifest inspection.
- No live device database, private records, physical device, performance, battery, RAM, mobile-data, or process-failure testing.
- No full app-level integration/E2E/coverage harness.
- No Shared Contracts/backend repository or stakeholder decision record was inspected.

## Next approval gate

At Verification Pause A, explicitly disposition MOB-0 and MOB-1. If accepted, assign decision owners and authorize only the intended MOB-2 design slice. Do not change stale references, mappings, authentication, cloud connectivity, migrations, or production behavior without separate authority.
