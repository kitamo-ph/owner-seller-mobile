# KitaMo Android — Independent Pre-Release Audit

> Historical versionCode 1 evidence. The artifact and every operator instruction
> to upload it are **Superseded — do not upload**. The audit findings, hashes,
> and attestation below remain preserved as dated evidence. Use the
> [versionCode 2 AAB verification](versioncode-2-aab-verification.md) for the
> current Internal Testing candidate.

**Auditor:** Claude (independent review, adversarially verified)
**Date:** 2026-07-16
**Audit branch:** `codex/gabi-redesign`
**Docs commit:** `f87eb5e`  **App commit in AAB:** `376b2f1`  **`main` (untouched):** `9aecc0f`
**Artifact:** `release-artifacts/KitaMo-1.0.0-production-eas-376b2f1.aab`
**Method:** Read-only. Binary unpacked/inspected under a temp dir; every source-level claim traced to `file:line`; a 9-area multi-agent pass produced candidate findings which were then adversarially re-verified against the cited code. Findings below reflect the lead auditor's independent confirmation, not the prior QA.

> **Bottom line:** No Critical or High confirmed defect in the binary or in accounting/transaction logic. The app is technically ready for a closed Internal Testing track. The one true prerequisite is operational (a real hosted privacy-policy URL + support email in Play Console). Overall: **CONDITIONAL GO** — see the end of this document.

---

## 1. Verification runs (all green)

| Check | Result |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ pass |
| `expo lint` | ✅ pass (0 problems) |
| owner-context suite | ✅ ALL PASSED |
| pricing suite | ✅ ALL PASSED |
| recipe-costing suite | ✅ ALL PASSED |
| production-math suite | ✅ ALL PASSED |
| order-COGS suite | ✅ ALL PASSED |
| fixed-cost suite | ✅ ALL PASSED |
| pilot-scenario suite | ✅ ALL PASSED |
| migrations + checkout-idempotency suite | ✅ ALL PASSED (9 applied → 0 on rerun; duplicate checkout token rejected; 1 sale per token) |
| `expo export --platform android` | ✅ Hermes bundle built |
| Expo Doctor | ⚠️ 17/18 — one patch mismatch (`expo` 54.0.35 vs 54.0.36) |
| `npm audit` (prod) | ⚠️ 13 moderate, all in Expo **build tooling** (see §7) |

---

## 2. Release artifact integrity — CONFIRMED CLEAN

Independently verified from the signed AAB:

| Property | Finding |
|---|---|
| **SHA-256** | `51c515df2b9da82687f68fd553e4f4936801c77bea650c44190ae4538fa6efcd` — **matches** expected |
| Package / version / versionCode | `ph.kitamo.app` / `1.0.0` / `1` — **match** |
| minSdk / targetSdk / compileSdk | 24 / 36 / 36 — **match** |
| `allowBackup` | `false` ✅ |
| Debuggable | **not** debuggable (no `android:debuggable`) ✅ |
| Cleartext traffic | No network security config; **INTERNET permission is explicitly blocked** in `app.json` (`blockedPermissions`), so no network is reachable at all ✅ |
| Permissions | `USE_BIOMETRIC`, `USE_FINGERPRINT`, `VIBRATE`, `ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE`, plus the auto-added dynamic-receiver-not-exported permission. **No INTERNET / storage / SYSTEM_ALERT_WINDOW** (all blocked). ✅ |
| Signing cert | Self-signed RSA-2048, SHA256withRSA, valid to 2053-11-26. Consistent for a Play-managed / internal-testing upload. ⚠️ Not timestamped (immaterial — Play re-signs for distribution). |
| 16 KB page compatibility | **All 20 native `.so` (arm64-v8a) report LOAD alignment `2**14`** ✅ — compatible with Android 15 16 KB pages. |
| Native libs | Only expected RN/Expo/Hermes/Reanimated/SQLite/Screens/gesture/image libs. `libexpo-sqlite.so` present (expected). **No unexpected libraries.** |
| Secrets / endpoints / env / tokens / sourcemaps | JS ships as **Hermes bytecode**; string scan found **no** Supabase keys, `sb_publishable`/`sb_secret`, `anon_key`, `service_role`, API keys, or bearer tokens. Only framework doc URLs. **No `.map` sourcemaps** in the bundle. `app.config` embedded in the bundle contains no secrets. ✅ |
| Exported components | See §2a. |

### 2a. Exported components — reviewed, framework-standard, safe

- **`MainActivity` (`exported=true`)** — launcher + a `VIEW/BROWSABLE` filter for the custom scheme `kitamo`. Standard Expo Router entry. The custom scheme is a navigation channel only (no `autoVerify`, no `https` App Links) and cannot reach Owner data (see §2b).
- **`ClipboardFileProvider` (`exported=true`)** — standard `expo-clipboard` FileProvider; per-URI grant model; exposes nothing without an explicit grant. Not an app-specific exposure.
- **`FileSystemFileProvider`, `SharingFileProvider` (`exported=false`, `grantUriPermissions=true`)** — framework default, safe.
- **`ProfileInstallReceiver` (`exported=true`, `permission=android.permission.DUMP`)** — androidx profile-installer default; DUMP is a signature/privileged permission, not third-party callable. Safe.
- `expo.modules.updates.ENABLED=false` — no OTA update channel. ✅

### 2b. Deep-link → PIN-gate boundary — CONFIRMED SAFE
`OwnerAccessGate` wraps the **entire** `app/owner` Stack (`app/owner/_layout.tsx:32`). Any `kitamo://owner/*` deep link still renders inside the gate, so a deep link cannot bypass the Owner PIN. Param-driven screens (`reports?stallId=`, `recipe-detail?recipeId=`, `production?recipeId=`, `kiosk?branchId=`) bind params as **SQL parameters** and only look up rows the local user already owns — no injection, no privilege escalation. **Confirmed / Informational.**

---

## 3. Findings

Severity key: **Critical** (data loss / exploit / materially wrong accounting / Play-blocking) · **High** (likely crash / privacy exposure / cross-tenant leakage) · **Medium** (credible reliability/security/compliance/migration risk) · **Low** (defensive improvement) · **Informational** (expected limitation).

Each finding: title · severity · file:line · evidence · impact · minimal fix · blocks Internal Testing? · confidence · confirmed vs hypothesis.

### CONFIRMED DEFECTS

#### F-1 · Full local data wipe erases the Owner PIN with no PIN re-entry — Medium
- **File:** `app/owner/business-settings.tsx:451` → `468` → `src/services/pilotData.ts:143-146`
- **Evidence:** `confirmClearPilotData` shows an `Alert` confirm, then `clearPilotData()` calls `clearLocalPilotData()`, which runs `clearOwnerAccess()` (deletes PIN hash/salt/biometric from secure-store) **and** deletes every data table — **without calling `verifyOwnerPin`**. By contrast, the *less* destructive `removeOwnerLock()` (line 428-436) **does** require `verifyOwnerPin` (line 432). After the wipe, `disableOwnerProtection()` leaves the device with no lock.
- **Impact:** If the owner leaves the phone with Owner Mode already unlocked (or never set a PIN), a cashier can, in two taps + a confirm, erase the entire local audit trail (concealing prior theft) and drop the device to no protection — while the milder "remove lock" action asks for the PIN. Security-control asymmetry on the most destructive action.
- **Fix:** Require `verifyOwnerPin` before the wipe (mirror `removeOwnerLock`), and/or preserve the Owner lock across a data reset so the device never silently drops to unprotected.
- **Blocks Internal Testing:** No (requires physical access to an already-unlocked device; a confirm dialog exists; local-only closed pilot). **Confidence:** High. **Confirmed.**

#### F-2 · Owner-PIN brute-force throttle is in-memory only; reset by force-quit/relaunch — Medium
- **File:** `src/components/owner/OwnerAccessGate.tsx:28-29` (state), enforcement `86`, `107-116`
- **Evidence:** `failedAttempts` and `cooldownUntil` are React `useState`, never persisted. After `MAX_PIN_ATTEMPTS=5` a 30 s cooldown is set **and `failedAttempts` is reset to 0**. Neither `ownerAccessStore` nor `ownerAccess.ts` persists attempt state (only `PIN_HASH_KEY`/`PIN_SALT_KEY`). Killing and relaunching the app reinitializes both to 0. PIN space is only 4–6 digits (`ownerAccess.ts:20`, `/^\d{4,6}$/`).
- **Impact:** On a shared/lost unlocked device, an attacker gets effectively unlimited attempts (5 per relaunch, seconds each), reducing a 4-digit PIN to a short brute force and reaching costs/profit/reports and the F-1 wipe control.
- **Fix:** Persist attempt count + a monotonic lockout timestamp (secure-store or `app_settings`), enforce cooldown from persisted state, apply escalating backoff, and do not zero the counter merely because a cooldown elapsed.
- **Blocks Internal Testing:** No (physical-access, local-only). **Confidence:** High. **Confirmed.**

#### F-3 · `offline_queue` grows unbounded; owner-facing "Local save queue" count only ever rises — Low
- **File:** `src/services/kioskSales.ts:558` (insert); no consumer anywhere (`syncStub.ts`, `offlineQueue.ts` are no-ops)
- **Evidence:** Every completed sale inserts one `status='pending'` `offline_queue` row. No code updates/deletes/drains it. `pendingQueueCount` (surfaced as "Local save queue: N" / "N local saves" in `NetworkStatusBadge` / `PilotStatusCard`) is `COUNT(*) WHERE status='pending'`, so it climbs monotonically with sales.
- **Impact:** (a) Slow but strictly monotonic DB growth (one small JSON row per sale). (b) UX/trust: an ever-rising "pending" number implies unsynced/at-risk data even though sync is intentionally deferred and local SQLite is the source of truth. `ask.tsx` does clarify "Cloud sync is not active yet," which softens this.
- **Fix:** Either stop enqueuing until a real sync consumer exists, or prune/cap the queue after commit; and reconsider surfacing a perpetually-growing "pending" number pre-sync (e.g. label it "saved locally").
- **Blocks Internal Testing:** No. **Confidence:** High. **Confirmed.**

#### F-4 · All money persisted as SQLite `REAL` (float); no centavo rounding at checkout/aggregation — Low
- **File:** `src/db/migrations/001_initial_schema.ts:63` (`amount`, `discount`), and `price/cost/line_total/unit_price/unit_cost/discount_amount/cogs_*` columns throughout
- **Evidence:** Money columns are `REAL`. Checkout persists `total = subtotal - discount` and COGS (`cogsTotal / quantity`) without rounding to 2 dp; reports `SUM(amount)` over `REAL`. Display uses `toFixed(2)` (`pricing.ts:21`, `receipts.ts:27`), which masks — but does not prevent — sub-centavo drift. The team already uses epsilon guards in lot math (`kioskSales.ts:467-470`, `+ 0.000000001`), showing float-awareness.
- **Impact:** Displayed subtotals/COGS/Net Profit can differ from an exact-decimal computation by a fraction of a centavo, and running SUMs can accumulate drift over many rows. Immaterial at pilot scale and hidden by formatting; matters more at scale and for future cloud reconciliation where exact equality is compared.
- **Fix:** Round money to 2 dp at the persistence boundary in `completeKioskSale`/`planOrderCogs`, or migrate to integer centavos. Deferrable.
- **Blocks Internal Testing:** No. **Confidence:** High (float storage) / Medium (materiality). **Confirmed storage, hypothesis on user-visible impact at pilot scale.**

#### F-5 · Kiosk **Sell** renders the full product catalog with no windowing/cap — Low
- **File:** `app/kiosk/sell.tsx` (product grid `.map`, ~`263`)
- **Evidence:** Sell maps the entire product list into a non-virtualized grid. (The commit-`376b2f1` bounded-render fix was applied to `inventory.tsx`, which **does** slice with a "show more"; Sell was not given the same treatment.)
- **Impact:** A stall with hundreds of products sees slower Sell mount + higher memory on low-end devices. Real POS catalogs are dozens of items, so this is a scalability edge, not a functional bug.
- **Fix:** Apply the same bounded-render slice used in `inventory.tsx`, or convert to `FlatList`.
- **Blocks Internal Testing:** No. **Confidence:** High. **Confirmed.**

#### F-6 · Sensitive screens not `FLAG_SECURE` — recents thumbnail / screenshot exposure — Informational
- **File:** `app/owner/_layout.tsx:31`; kiosk receipt `app/kiosk/checkout.tsx` (completed-sale card)
- **Evidence:** No `expo-screen-capture` / `FLAG_SECURE` anywhere (grep: none). Owner reports/costs and the completed-sale receipt (totals, transaction no.) render without a secure window. `OwnerAccessGate` locks Owner Mode on backgrounding (`OwnerAccessGate.tsx:62-69`), partially mitigating the owner recents snapshot but not foreground screenshots and not the kiosk receipt.
- **Impact:** Financials could appear in the app-switcher preview or a screenshot. Low real-world risk for a single-owner local app.
- **Fix (optional):** `preventScreenCaptureAsync()` on owner report/receipt routes. Not required for internal testing.
- **Blocks Internal Testing:** No. **Confidence:** Medium. **Hypothesis (behavioral), code-confirmed absence of protection.**

#### F-7 · Receipt text copied to clipboard is readable by other foreground apps/IMEs — Informational
- **File:** `src/services/shareReceipt.ts:5`
- **Evidence:** `copyReceiptText()` puts full receipt text on the Android clipboard — standard for a copy feature. **No PIN/credential is ever placed on the clipboard.**
- **Impact:** Minor exposure of non-secret receipt text while pasting. **Fix:** none required. **Blocks:** No. **Confidence:** High. **Confirmed / accepted.**

#### F-8 · Placeholder privacy-policy URL, website, and support email in store listing — Low (operational, gates rollout)
- **File:** `docs/play-store/store-listing-draft.md:70-72` (`support@REPLACE-ME.example`, `https://REPLACE-ME.example/privacy`)
- **Evidence:** Contact/links are `.example` placeholders. Play Console requires a real, publicly-hosted **Privacy Policy URL** (App Content) and support email before a track can publish.
- **Impact:** Rollout cannot complete until a real hosted URL + support email are supplied. Not a binary/code defect.
- **Fix:** Host the privacy policy (content already drafted) at a real URL; set a real support email; fill both into the store listing + App Content.
- **Blocks Internal Testing:** **Yes — operationally** (Play Console prerequisite; nothing to change in the app). **Confidence:** High. **Confirmed.**

#### F-9 · Public privacy policy mentions Expo Go dev-time Wi-Fi loading — Low
- **File:** `docs/play-store/privacy-policy-draft.md:43`
- **Evidence:** A paragraph describes Expo Go loading over local Wi-Fi from the dev machine (with a clarifying "not part of the installed app" sentence).
- **Impact:** A reviewer of the *public* policy could infer the shipped app does network loading, contradicting the no-transmission posture.
- **Fix:** Remove/re-scope that paragraph from the version published at the public URL. **Blocks:** No. **Confidence:** High. **Confirmed.**

#### F-10 · `markFixedCostPaid` uses check-then-insert with no unique constraint — Low
- **File:** `src/services/fixedCosts.ts:163-177`
- **Evidence:** A read-time duplicate guard (`hasFixedCostPayment`) precedes `createFixedCostPayment`; no DB unique index on `(fixed_cost_id, due_date)`. A rapid double-tap could insert two payment rows for one occurrence.
- **Impact:** **Net Profit is unaffected** — `calculateFixedCostsForRange` counts scheduled *occurrences*, not payment rows. Only the payments/"paid this month" cash-flow view could double-count an occurrence. Single-user app; low probability.
- **Fix:** Add a partial `UNIQUE(fixed_cost_id, due_date) WHERE deleted_at IS NULL` and treat the insert conflict as "already paid"; and/or disable the button while saving.
- **Blocks Internal Testing:** No. **Confidence:** Medium. **Confirmed mechanism; workflow verifier rated the profit impact REFUTED (Net Profit safe), which I concur with — hence Low.**

### HYPOTHESES / FORWARD-LOOKING (not confirmed as current defects)

#### H-1 · Cook-upon-order records ingredient movements/usages even if the guarded lot UPDATE changes 0 rows — Informational
- **File:** `src/services/kioskSales.ts:459-533` (esp. `463`)
- **Evidence:** Inside the sale transaction, `ingredient_lots` is updated best-effort (`WHERE ... remaining + eps >= qty`); the `ingredient_movements` insert and `sale_ingredient_usages` insert run **unconditionally**, and the code comment states this is deliberate ("a cook-upon-order sale never fails because grocery stock moved"). If a lot was archived/drained between the pre-transaction snapshot and the write, the movement ledger will not reconcile 1:1 against lot `remaining_quantity`.
- **Impact:** **COGS/order costing stays correct** (protected cook-upon-order path; shortfall is captured as estimated). Only the movement ledger vs lot balance can diverge in a rare race. This is an intended trade-off, not a defect.
- **Fix:** None recommended (protected design). If exact reconciliation is later wanted, capture `updateResult.changes` and record only the applied quantity (shortfall is already stored on `sale_ingredient_usages`). **Blocks:** No. **Confidence:** Low. **Hypothesis.**

#### H-2 · `listOccurrences` caps at `MAX_OCCURRENCES=5000` — Low (not pilot-relevant)
- **File:** `src/domain/fixedCostSchedule.ts:105`
- **Evidence:** Occurrence generation is capped at 5000 from the anchor. A *daily* fixed cost anchored >~13.7 years before an "all"-range report would be undercounted.
- **Impact:** Would overstate Net Profit for that range — **but not exploitable in the pilot** (fresh app, versionCode 1; no anchors that old can exist). **Fix:** iterate from `max(anchor, rangeStart)` or raise/remove the cap for daily frequency. **Blocks:** No. **Confidence:** Medium. **Hypothesis / future.**

#### H-3 · No index on `sales.happened_at` / `sale_items.business_id`; "All local" reports full-scan — Informational
- **File:** `src/services/profitReports.ts` (~`160`); schema `001`
- **Evidence:** Report/Logbook queries filter/sort on `business_id` + `happened_at` with no covering index.
- **Impact:** Imperceptible at pilot volumes; report load could grow after multiple years of daily sales. **Fix:** add `idx_sales(business_id, happened_at)` and `idx_sale_items(business_id)` in a **forward** migration when large datasets are expected. **Blocks:** No. **Confidence:** Medium. **Hypothesis / future.**

#### H-4 · Focus effects re-load with `setLoading(true)` (skeleton flash) and some lack an in-flight guard — Low / Informational
- **File:** `app/owner/records.tsx:75`, `:97` (and Reports)
- **Evidence:** Every screen focus refetches and blanks to skeletons; Records/Reports focus effects don't set an `active` cancellation flag (kiosk/inventory screens do).
- **Impact:** Cosmetic jank on back-navigation; benign "set state after unmount" (RN tolerates, no crash). Data is correct. **Fix:** keep prior data during refetch; mirror the `active`-flag cleanup used elsewhere. **Blocks:** No. **Confidence:** High (behavioral) / cosmetic. **Confirmed-cosmetic.**

---

## 4. Areas reviewed and found sound (no material issue)

- **SQLite integrity & concurrency.** Single memoized connection (`db/client.ts`) with `PRAGMA foreign_keys = ON` set at open; grep found no other `openDatabase*` call, so every repository/migration/transaction shares the FK-on connection. Migrations are **serialized** via a per-DB `WeakMap` promise queue and each runs in `withExclusiveTransactionAsync` with `INSERT OR IGNORE` (idempotent; concurrent-startup safe; rerun applies 0). Every multi-write op — checkout, `recordProduction`, `recordTransfer`, spoilage/cooked-batch (`stockOps`), recipe save, grocery pool — is wrapped in an exclusive transaction with guarded `UPDATE … WHERE stock/remaining >= ?` and `changes` checks. `fixedCosts` writes are single-statement (atomic) except the F-10 double-tap window.
- **Checkout idempotency & double-tap.** Unique `checkout_token` (migration 009, partial unique index) + exclusive transaction + stock guard (`stock_qty >= ?`, `changes !== 1` → throw) + catch-and-return-existing on constraint violation. The store generates one stable token per cart, and `clearCart()` **nulls it after success** (`checkout.tsx:131`), so a legitimate identical *next* sale is **not** silently deduped. UI adds `savingRef` + `completedSale` guards. Force-close mid-checkout leaves either a complete sale or nothing (atomic). **Robust.**
- **Startup sequencing.** `app/index.tsx` → `loadOwnerSetupStatus` runs `runMigrations` as its first step (`ownerSetup.ts:159`); every data service does the same before any query. No screen can read a table before its migration applies.
- **Accounting correctness.** Profit formula (`Revenue − Sold COGS − Fixed Costs − Spoilage`), COGS source precedence (`cook_upon_order` > `production_average` > `simple`), bundle math, discount validation (`0 ≤ discount ≤ subtotal`), selected-lot exact costing, and cross-cart lot sharing all trace correctly and pass the pure-math + pilot suites. Aggregate queries scope by `business_id` (+ `branch_id` for kiosk/shift), so **no cross-business/stall leakage** was found. Transfers/unsold are excluded from net-profit inputs (fixed-cost suite confirms).
- **Records/Logbook is append-only** — no edit/delete path in `records.tsx`, which is good for auditability (a cashier cannot alter individual past records; the only destructive lever is the F-1 full wipe).
- **Error handling.** `logDevError` logs **only in `__DEV__`** (no sensitive production logs); `getUserSafeErrorMessage` scrubs SQLite/native detail before showing users. No excessive error detail.
- **`pilotDataReset`** deletes `resettableTables` in **child-before-parent** order under an exclusive transaction; table names come from a constant (no injection); `schema_migrations` is preserved.

---

## 5. Dependency & supply-chain

- **13 moderate advisories, all in Expo build/CLI tooling** (`postcss` <8.5.10 XSS-in-stringify, `uuid` <11.1.1 buffer-bounds, `@expo/config`, `@expo/cli`, `@expo/metro-config`, `xcode`, `@expo/prebuild-config`, and transitively `expo-constants/expo-linking/expo-router/expo-asset`). These run at **build/dev time**; none execute in the shipped Hermes bytecode. The only "fix available" collapses to `expo@57` (a breaking major).
- **Recommendation:** **Defer.** Per the audit's own constraint, a breaking Expo upgrade is not warranted to clear moderate *tooling* advisories with no runtime exposure. Re-evaluate at the next planned Expo bump.
- **Expo Doctor:** one patch mismatch (`expo` 54.0.35 vs 54.0.36). Cosmetic; align at next dependency pass (`npx expo install --check`). No runtime risk.
- **Runtime deps** are all first-party Expo/RN modules (sqlite, secure-store, local-authentication, crypto, clipboard, sharing, haptics, network, linear-gradient, router, reanimated, zustand, zod). No abandoned or surprising packages; no custom post-install scripts observed in the app package.

---

## 6. Future Supabase / online-readiness risks (implement nothing now)

Tenant scoping is already good: **every business table (migrations 001–009) carries `business_id NOT NULL` with an FK to `businesses ON DELETE CASCADE` and a `business_id` index** — a solid base for RLS. `app_settings` is the only unscoped table (intentionally device-local). Forward risks to design for **before** enabling sync (none affect the local pilot):

- **R-1 · Weak IDs for cross-device merge.** `src/domain/ids.ts` uses `Math.random()` (6 base36 chars) + `Date.now()`. Single-device collisions are negligible; once devices merge into a shared cloud, same-ms + same-6-char collisions become possible. Migrate to UUIDs (already planned) with a per-install/device component. `expo-crypto.randomUUID` is already used for the PIN salt, so a strong generator is on hand. **Medium (future).**
- **R-2 · Human `transaction_no` inherits the weak 6-char suffix** (`kioskSales.ts:114`) with no uniqueness constraint — two stalls on the same date could collide after a cloud merge. When migrating IDs, make `transaction_no` globally unique (per-device/stall prefix or business-scoped counter). **Informational (future).**
- **R-3 · Conflict resolution would rely on the unverified device wall-clock** (`repositories/shared.ts` `updated_at`). Clock skew/tamper could let a stale/forged row win last-write-wins on non-append tables (products, ingredients). Use the planned integer `version` counter as the primary tiebreaker + a server-assigned timestamp. **Medium→Informational (future).**
- **R-4 · `sync_status` lifecycle has no driver.** Business rows are created `'local'` and never transition to `'pending'` (only `offline_queue` rows are `'pending'`). A naive future sync scanning `WHERE sync_status='pending'` would push nothing. Decide the canonical push signal when building sync, and plan a backfill. **Low (future).**
- **R-5 · `deleted_at` soft-delete columns are dormant;** lifecycle uses `active=0` / `status='archived'`. A soft-delete-based sync wouldn't propagate archive/deactivate as deletes (an item deactivated on one device could reappear as active after a pull). Pick one canonical delete signal before sync. **Low (future).**
- **R-6 · `offline_queue` only logs sale-creates and never drains** (same root as F-3). A future sync must be driven by per-row `sync_status`, not this queue, or the queue must be extended to all entities + drained. **Low (future).**
- **R-7 · Missing `origin_device_id` / `version` / `seller_user_id` columns.** When added, every pilot-era row will be NULL for these; conflict ordering (`version`) and RLS insert checks (`seller_user_id = auth.uid()`) need a deterministic backfill (`version=1`, stable device id, owner identity). Plan the backfill in the Phase C/D migration. **Informational (future).**
- **R-8 · Device-clock timestamps** (§9) also affect future auditability — stamp server-authoritative time on sync and flag divergent device time.

The `docs/supabase/*` and `docs/roadmap/chapter-3-*` plans already anticipate most of this (UUIDs, version counters, RLS by `business_id`); the notes above are the concrete code touch-points.

---

## 7. Abuse & misuse summary

| Scenario | Current behavior | Verdict |
|---|---|---|
| Dishonest cashier edits/deletes a single record to hide theft | Logbook is **append-only**; no per-record edit/delete | Mitigated |
| Cashier wipes the whole audit trail | **F-1**: full wipe reachable without PIN re-entry (Owner Mode unlocked) + removes the lock | **Medium — fix recommended** |
| Repeated PIN guessing | **F-2**: throttle resets on relaunch | **Medium — fix recommended** |
| Lost/shared phone, Owner Mode never PIN'd | Owner protection is **opt-in / off by default** (`ownerAccessStore.ts:18`) with a visible nudge | Informational (deliberate onboarding choice; consider prompting to set a PIN before first kiosk hand-off) |
| Manipulated device clock | Sale timestamps + report/Logbook buckets derive from the **device clock** (`repositories/shared.ts:12`) | Informational (inherent offline limitation; stamp server time at sync) |
| Accidental double taps (checkout) | Idempotent (token + guards) | Safe |
| Force-close during a sale / any write | Exclusive transactions → all-or-nothing | Safe |
| Wrong business/stall selected | Kiosk requires explicit stall confirm each session (`kiosk/index.tsx`); aggregates scope by business+branch | Safe |
| Local SQLite tampering | DB is **unencrypted**; sandbox adequate on non-rooted devices; `allowBackup=false` blocks `adb backup` | Informational (acceptable for pilot; SQLCipher if threat model tightens) |

---

## 8. Severity roll-up

| Severity | Count | Items |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 2 | F-1 (wipe without PIN), F-2 (PIN throttle reset) |
| Low | 5 | F-3, F-4, F-5, F-8 (operational rollout gate), F-10 |
| Informational | Several | F-6, F-7, F-9, H-1..H-4, R-1..R-8, abuse notes |

No finding is a Critical/High code defect. The single item that gates *rollout* is operational (F-8).

---

## 9. Final recommendation

### Overall: **CONDITIONAL GO** for Google Play **Internal Testing**

The binary is release-ready: SHA-256 verified, correctly signed, minimal blocked-down permissions, no INTERNET/no network reachable, no secrets in the bundle, 16 KB-aligned, `allowBackup=false`, not debuggable, and the accounting/idempotency/migration core is sound and test-green. The condition is a Play Console operational prerequisite, not a code change.

**Internal Testing blockers (must clear before the track can publish):**
1. **F-8 — Provide a real hosted Privacy Policy URL + support email** in the store listing / App Content (content is already drafted). This is the only true gate.
2. Complete/confirm the **Data Safety** form in Play Console (the draft is conservative and defensible: no data collected/transmitted; encryption-in-transit N/A). Clear the doc's own **REVIEW** markers against Google's pre-launch report.

**Recommended to fix soon (not blocking, security-hardening):**
- **F-1** — require the Owner PIN before a full local wipe (and/or preserve the lock across reset).
- **F-2** — persist PIN attempt count + lockout so relaunch can't reset the throttle.

**Safe to defer until after Internal Testing:**
- F-3 (`offline_queue` growth / "pending" label), F-4 (float money → centavo rounding), F-5 (Sell list windowing), F-9 (scope Expo-Go paragraph out of the public policy), F-10 (unique index on fixed-cost payments), H-2/H-3 (occurrence cap, report indexes), H-4 (skeleton flash / focus guards), the 13 moderate **build-tooling** advisories, and the `expo` 54.0.35→.36 patch alignment.

**Future Supabase/backend risks to design for (before enabling sync):** R-1 UUID/device-scoped IDs · R-2 globally-unique `transaction_no` · R-3 version-counter (not device clock) conflict resolution · R-4 `sync_status` push driver · R-5 canonical soft-delete signal · R-6 queue drain/reconciliation · R-7 backfill `origin_device_id`/`version`/`seller_user_id` · R-8 server-authoritative timestamps.

### Top 5 metrics to monitor during the pilot
1. **Checkout success vs. failure rate** (and any "not enough stock" / discount-validation rejections) — the core money path; watch for idempotency re-returns and transaction throws.
2. **Sale-to-report reconciliation** — do Kiosk shift totals, Reports Net Profit, and the Logbook agree for the same period? Catches any float drift (F-4) or scoping regression early.
3. **`offline_queue` / "Local save queue" count growth** (F-3) — confirm it only reflects sales and isn't alarming testers; validates the deferred-sync UX.
4. **Owner-Mode friction & lockouts** — PIN unlock success rate, lockout hits (F-2), and any accidental full-data wipes (F-1); confirms the access model works for real owners.
5. **App stability on low-end devices** — cold-start time, crash/ANR rate, and Sell/Reports screen responsiveness as local data grows (F-5, H-3), especially on 2–4 GB Android Go phones.

---

## 10. Integrity attestation

**No application source files, configuration, Git state, or the AAB were modified during this audit.**

- Working tree: **clean** (`git status --porcelain` empty except this untracked report, which is **not** staged or committed).
- `HEAD` remains `f87eb5e`; `main` remains `9aecc0f`.
- AAB SHA-256 re-checked post-audit: `51c515df2b9da82687f68fd553e4f4936801c77bea650c44190ae4538fa6efcd` (unchanged).
- The binary was unpacked only into a temporary directory outside the repo; no audit artifacts were placed in tracked application directories.

*This report is written to `docs/release/claude-independent-pre-release-audit.md` and left uncommitted per instruction. No fixes will be applied without explicit approval of specific findings.*
