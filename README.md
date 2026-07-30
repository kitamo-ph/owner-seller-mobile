# KitaMo Android

Expo SDK 54 React Native foundation for the local-first KitaMo Android MVP.

## Current Phase

Android seller finalization for Google Play Internal Testing.

The Android app is the seller-product source of truth. The original PWA is frozen and may be consulted only for selected visual ideas; its cloud, AI, OCR, authentication, Customer, and experimental business logic are not part of this app.

### Release identity

- App name: **KitaMo**
- Android package: **`ph.kitamo.app`**
- Version name/code: **`1.0.0` / `2`**
- Expo SDK 54 / React Native 0.81 / New Architecture
- Branded icon, adaptive icon, splash, Play icon, and feature graphic are present.
- Android backup is disabled because this release has no account, backup, or restore service.

### Local-only release boundary

- SQLite remains authoritative for sales, products, grocery lots, recipes, production, cook-upon-order COGS, transfers, spoilage, fixed costs, and reports.
- The runtime Supabase client and dependency have been removed. There is no auth, cloud sync, analytics, ads, AI API, OCR/camera, Bluetooth, Customer Mode, or LGU Mode.
- `offline_queue` remains a durable local record of future sync intent. The UI calls these **local saves** because no sync worker exists in this release.
- Owner-only screens can be protected with a salted local PIN and optional Android biometric confirmation. Secure data is stored with Expo SecureStore.
- Checkout uses an exclusive SQLite transaction plus a unique checkout token, so retries cannot decrement stock or create receipts twice.

### Owner hub and shared-device Kiosk

- Owner Home is the business and stall command center. The upper-right actions open the local Notification Center and Settings.
- Existing `owner_alerts` records appear in a local active/resolved Notification Center. These are same-device alerts only; there are no push notifications or remote seller pings.
- Stalls are prominent on Home with today's revenue, sold cost, net profit, report access, and an `Open Kiosk` action.
- Every Owner-to-Kiosk entry requires an active stall selection and confirmation. Direct Kiosk operational routes are returned to the stall picker unless the current app session has confirmed a stall.
- Kiosk remains a shared-device pilot mode. There are no seller accounts, join codes, remote approvals, scheduled shifts, or multi-device assignments in this release.
- Settings is now an index for Business & Stalls, Owner Access & Security, local alerts, privacy, Pilot Guide, and About KitaMo. Existing business, security, and local-data controls remain on the Business & Stalls screen.
- Owners can create and switch among multiple local businesses. Each business remembers only its last valid active stall; invalid, inactive, or missing stored context appears empty until the owner deliberately selects again.
- A compact context strip stays above Owner and Kiosk navigation. Persistent Owner context never acts as a Kiosk session grant; Kiosk confirmation remains transient and is lost when the app process closes.
- `All stalls` is used only for business-wide summaries, alerts, and reports. Operational actions continue to require the explicit stall context already required by their existing engines.

### Profit contract

```text
Revenue
- Sold COGS
- Fixed Costs
- Spoilage
= Net Profit
```

### Local checks

```sh
npm run typecheck
npm run lint
npm run check:owner-context
npm run check:pricing
npm run check:recipes
npm run check:production
npm run check:cogs
npm run check:fixedcosts
npm run check:pilot
npm run check:migrations
npx expo-doctor
EXPO_NO_DOTENV=1 npx expo export --platform android
```

Use Node `20.19.4` or newer. EAS profiles pin Node `20.19.4`.

### Build commands for later versions

The versionCode 2 Internal Testing AAB is already designated and must not be
rebuilt or replaced. Any later build must use versionCode 3 or higher.

```sh
eas login
eas build:configure
eas build -p android --profile preview
eas build -p android --profile production
```

EAS remains linked to [`@kitamoandroidapp/kitamo-android`](https://expo.dev/accounts/kitamoandroidapp/projects/kitamo-android). The designated Internal Testing artifact is `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`, version `1.0.0` / versionCode `2`, with SHA-256 `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`. Its signer exactly matches the independently verified EAS production upload certificate. The signing-identity block is cleared; Play upload remains owner-blocked on the privacy URL, support email, tester list, Console declarations, and Play app access. See the [versionCode 2 verification record](docs/release/versioncode-2-aab-verification.md).

Workstation setup, AVDs, EAS ownership, and human-owned prerequisites are recorded in [`docs/release/release-engineering-environment.md`](docs/release/release-engineering-environment.md).

## Previous Phase

Chapter 2 Phase 7: Google Play Internal Testing Upload Preparation.

Historical versionCode 1 operator guidance: **Superseded — do not upload**.

Upload materials and the manual Play Console path are prepared. Nothing is uploaded or published; no build was run.

### Release route

**Internal Testing is the target** (up to 100 email testers, instant, no review wait) — not public production. A new personal Play Console account generally needs Closed Testing with ≥12 testers for 14 continuous days before production unlocks. Google Play only *distributes* the app; KitaMo has no backend, so "publishing" just means making the installable app available to chosen testers. Full plan: [`docs/release/google-play-internal-testing-execution.md`](docs/release/google-play-internal-testing-execution.md).

### Package name — decided: `ph.kitamo.app`

`android.package` is now the permanent production id `ph.kitamo.app` (no `.pilot` suffix). It becomes immutable on first upload and carries through Internal → Closed → Production. The app title `KitaMo (Pilot)` stays editable in the Console.

### Config audit (clean)

versionName `0.1.0`, versionCode `1`, `permissions: []`, Expo SDK 54 → target API 35. No forbidden-capability dependencies, zero network calls in app code, no ads/analytics/auth/payment/Bluetooth/camera/location SDKs. `eas.json` `production` profile builds an `.aab` (required by Play).

### New docs

- [`docs/release/google-play-internal-testing-execution.md`](docs/release/google-play-internal-testing-execution.md) — release route + package decision
- [`docs/release/play-console-upload-checklist.md`](docs/release/play-console-upload-checklist.md) — 14-step manual upload path + versionCode discipline
- [`docs/release/play-console-app-content-checklist.md`](docs/release/play-console-app-content-checklist.md) — Data Safety, App Access (no login), permissions, financial-category REVIEW
- [`docs/release/tester-plan.md`](docs/release/tester-plan.md) — 5–10 seller testers, 12–15 total, 2-month night-market pilot
- [`docs/roadmap/chapter-3-supabase-plan.md`](docs/roadmap/chapter-3-supabase-plan.md) — high-level backend direction (not implemented)
- [`docs/roadmap/chapter-3-identity-access-plan.md`](docs/roadmap/chapter-3-identity-access-plan.md) — approved future owner/seller identity, approval, assignment, shift, and multi-device model (not implemented)

## Previous Phase

Chapter 2 Phase 6: Final Release Readiness, Refactor, Performance, and Codex Handoff.

Engineering closure after the Phase 4 finance-manager UX. Google Play **Internal Testing** is the next step (nothing published yet).

### What this phase did

- **Phase 4 audit**: confirmed `localAnalytics.ts` is read-only (0 write ops), no SQLite schema changes, and no checkout/recipe/production/COGS/fixed-cost math was rewritten. Seller labels verified consistent (Grocery Stock, Paninda, Recipe Cost, Niluto, Bayarin, Logbook, Kita Report, Puhunan / Cost, Natirang paninda, Nasayang).
- **Safe refactor**: extracted the identical `formatQuantity` helper (was copy-pasted in six screens) into `src/components/ui/KitaMoUI.tsx`; removed the redundant third "Start Selling" entry on Home. No logic touched.
- **Performance/usability**: dashboard reads kept sequential on the shared SQLite handle (SDK 54 safety); screen titles now cap large-font scaling at 1.3× and wrap instead of overflowing. FlatList intentionally avoided inside `ScreenScroll` (nested-scroll hazard; pilot lists are small) — see the Codex handoff doc.
- **Release docs**: [`docs/release/final-release-readiness.md`](docs/release/final-release-readiness.md) and [`docs/release/codex-ui-handoff.md`](docs/release/codex-ui-handoff.md).

### Phase 4 recap (finance-manager UX)

Home is now a finance dashboard (Today's Money grid, Quick Add, per-stall performance cards, Needs Attention, grouped Quick Tools); Records became the **Logbook** money timeline (benta/grocery/niluto/bayarin/nasayang/lipat, date-grouped); the **Kita Report** leads with `Tubo = Benta − Puhunan − Bayarin − Nasayang` and moves COGS into Advanced details.

### Next: Google Play Internal Testing

Draft materials are in `docs/play-store/`; the manual upload path is in the release-readiness doc. Do not publish until real-phone QA and the Data Safety REVIEW items are complete.

### Codex handoff

If Codex (or another agent) does UI polish next, it must read [`docs/release/codex-ui-handoff.md`](docs/release/codex-ui-handoff.md): safe vs off-limits files, labels to preserve, and the check commands that prove business logic wasn't touched.

### Moved to Chapter 3

- **Bluetooth printing** (no longer Chapter 2).
- Supabase / any backend, cloud sync, and accounts/auth.
- Real Lis AI, OCR/camera, payment gateway, Customer Mode, LGU dashboard.

## Previous Phase

Chapter 2 Phase 3: Play Store Internal Testing Preparation.

Historical versionCode 1 operator guidance: **Superseded — do not upload**.

All materials for Google Play **internal testing** are drafted — nothing has been uploaded or published, and no Play Console action has been taken.

### Internal testing documents (`docs/play-store/`)

- [`internal-testing-checklist.md`](docs/play-store/internal-testing-checklist.md) — Console account, signing, EAS build, upload, tester list, smoke test, next-build/rollback process.
- [`store-listing-draft.md`](docs/play-store/store-listing-draft.md) — name, descriptions, category, keywords, honest not-yet list, placeholders for support email/privacy URL.
- [`privacy-policy-draft.md`](docs/play-store/privacy-policy-draft.md) — plain-language local-first policy (draft, not legal advice; must be hosted at a URL before submission).
- [`data-safety-draft.md`](docs/play-store/data-safety-draft.md) — conservative Play Data Safety answer guide grounded in a code/dependency audit, with **REVIEW** flags for anything to confirm against the final build.
- [`internal-tester-guide.md`](docs/play-store/internal-tester-guide.md) — install steps, 10-step Taglish test scenario, bug format, known limitations.
- [`screenshot-plan.md`](docs/play-store/screenshot-plan.md) — 11 shots with purpose, captions, and exact data setup.
- [`release-notes-internal.md`](docs/play-store/release-notes-internal.md) — 0.1.0 (1) internal release notes.

### Config audit result

- `app.json`: display name **KitaMo (Pilot)**, package `ph.kitamo.app`, version `0.1.0` / versionCode `1`, portrait, keyboard resize, `permissions: []`. The built manifest carries only framework-level `INTERNET` (unused by app features at runtime), `ACCESS_NETWORK_STATE` (online/offline badge), and `VIBRATE` (haptics). **No camera, location, contacts, microphone, Bluetooth, or storage permissions.**
- Dependency audit: no analytics, ads, crash-reporting, auth, or payment SDKs; the app's own code makes zero network requests.
- `eas.json` profiles ready (development/preview/production). Still manual before the first build: `eas login` + `eas build:configure` (writes the EAS project id — needs the owner's Expo account), real icon/splash assets, and a hosted privacy policy URL.

**Caution: do not publish.** Upload only after real-phone QA, the Data Safety REVIEW items, and Play Console pre-launch checks are complete.

## Previous Phase

Android Phase 14+15+16: QA Hardening, Seller Pilot Readiness, and Android Build Readiness.

The app is now pilot-ready: full-engine QA pass, seller-facing pilot guide, tester checklist, and Android build configuration (without publishing).

### QA hardening (Phase 14)

- Full-flow audit across first launch, setup, Grocery Pool, Recipes, Production, Kiosk, cook-upon-order COGS, transfers, spoilage, fixed costs, Records, Insights, and Reports. Fixes:
  - Production now offers **prepared-before-selling recipes only** (as designed) — cook-upon-order recipes are costed automatically at sale time and never hold finished stock; producing them ahead would have created stock that never decremented. A friendly note explains this when only cook-upon-order recipes exist.
  - Kiosk Stock shows a **"Made to order"** badge for cook-upon-order products instead of a misleading "Out of stock" + Notify Owner.
- A banned-word sweep confirms no SQLite/schema/migration/queue/debug/Phase wording in seller-visible strings; all 22 local tables are covered by Clear Local Data; fresh/demo boundaries re-verified (fresh empty, demo only via Try Demo Data, no auto-seeded engine data).
- New `npm run check:pilot`: one end-to-end pure-math story — grocery purchase → recipe costing → production scaling → bundle-priced sale → sold COGS → cook-upon-order partial-stock estimation → daily fixed cost → gross and net profit — chained across all six domain modules.

### Seller pilot readiness (Phase 15)

- In-app **Pilot Guide** (Settings → Pilot Guide): what KitaMo tracks, a 10-step walkthrough, what is not in the pilot, and the privacy note "This pilot stores data on this device only."
- Tester document: [`docs/pilot/android-seller-pilot-checklist.md`](docs/pilot/android-seller-pilot-checklist.md) — setup, scenario checklist with expected results, feedback questions, and a bug-report format.

### Android build readiness (Phase 16)

- At that phase, `app.json` had the Android package and build profiles but still used placeholder branding. The current release section above supersedes this historical state with final branded assets and explicit permission removal.
- Minimal `eas.json` with `development` (dev client APK), `preview` (internal APK), and `production` (app bundle) profiles. **No build has been run and nothing is published** — see Build commands below.

### Build commands (documented, not executed)

```sh
# one-time: npm install -g eas-cli && eas login
eas build -p android --profile preview   # internal test APK
eas build -p android --profile production  # Play-ready app bundle (later)
```

Play Store listing completion and signing were deferred at that phase. The current release section above lists the smaller set of external gates that remain.

## Previous Phase

Android Phase 13.5: Mobile Shell, Safe Area, and Navigation UX Fix.

Real-phone testing showed shell problems: content spilling into the Android status bar, the bottom tabs overlapping the system navigation area, hidden save buttons on long screens, and Kiosk/Settings being hard to find. This phase fixes the shell and navigation only — no business logic, schema, or accounting changes.

### Shell and safe area

- The app shell now uses `react-native-safe-area-context` (`SafeAreaProvider` in AppShell; React Native's own `SafeAreaView`, which is a no-op on Android, was the root cause of the status-bar spill). `ScreenScroll` applies the top inset to every screen and pads scroll content past the bottom navigation plus the gesture/nav-bar inset, so the last card or save button on any screen scrolls fully into view.
- The bottom navigation sits above the Android system navigation using the bottom inset (minimum 10), with slightly tighter icons and a cleaner active indicator. Tabs stay Home / Helper / Records / Inventory / Insights.
- `android.softwareKeyboardLayoutMode: "resize"` keeps form save buttons visible while typing.
- Headers are more compact: smaller KitaMo brand mark and screen titles, tighter top-bar spacing — more breathing room without redesigning the visual language.

### Kiosk and Settings discoverability

- Home now has a primary action row right under the business card: a filled forest-green **Start Selling** button ("Open Kiosk") and a **Settings** button — both visible on the first screen without scrolling. A gear icon also sits in the Home header.
- The quick-actions card is now an **Owner Tools** grid in priority order: Start Selling, Settings, Inventory, Grocery Pool, Recipes, Production, Transfers, Fixed Costs, Profit Reports. Kiosk is intentionally not a bottom tab; Home is the entry point.
- Inventory's engine links are a proper two-column chip grid (Grocery Pool, Recipes, Production, Transfers).

### Local Helper (formerly "Ask KitaMo")

- The Ask tab is now labeled **Helper**, the screen is titled **Local Helper** with the subtitle "Quick answers from this phone's local records.", and a note states plainly: "Local helper only — walang AI. Full Lis AI is not enabled in this pilot." All copy implying future/current AI was removed. The route and deterministic local answers are unchanged — still no API calls.

## Previous Phase

Android Phase 12+13: Fixed Costs and Profit Reports.

Owners can now track recurring and one-time stall expenses (rent, sweldo, kuryente, tubig, transport, LPG, market fees, internet/load, iba pa) and see true per-stall and whole-business profit.

### Fixed costs (Phase 12)

- Migration `008_fixed_costs` adds `fixed_costs` (name, category, stall or whole-business, amount, frequency, anchor due date, optional end date, active/archived) and `fixed_cost_payments` (one row per paid occurrence). Both covered by Clear Local Data.
- **Recurrence is computed, never materialized**: occurrences derive deterministically from the anchor date — daily, weekly (every 7 days), monthly (same day, clamped to month end: a Jan 31 rent falls due Feb 28), or one-time — in pure math (`src/domain/fixedCostSchedule.ts`, verified by `npm run check:fixedcosts`). Custom calendars are deferred; use one-time entries for irregular bills.
- **Mark paid** settles the oldest unpaid occurrence first (overdue before upcoming) and can never pay the same occurrence twice (duplicate guard + tap lock). **Archive** stops future occurrences but keeps payment history.
- Due soon = next unpaid occurrence within 7 days; overdue = unpaid occurrence in the past. The Fixed Costs screen shows Due soon / Overdue / Paid this month / This-month total; Owner Home shows a compact "Bayarin" notice when anything is due or overdue; Insights shows the month's fixed-cost total. Automatic reminders/push notifications are deferred — status is visible in-app only.

### Profit reports (Phase 13)

- The Profit Reports screen (from Home, Insights, Records, Fixed Costs) supports Today / This week (Mon–Sun) / This month / All local ranges.
- **Consolidated report**: revenue, sold COGS, gross profit, fixed costs, spoilage loss, net profit, plus informational unsold-goods value, remaining grocery value, transfer activity, best stall, top products, and warnings (estimated COGS, low grocery stock, overdue fixed costs).
- **Per-stall cards**: revenue, sold COGS, gross profit, that stall's own fixed costs, spoilage, net profit, unsold value, production spend, transfer in/out, best seller, and an estimated-cost badge. Business-wide fixed costs (no stall) count only in the consolidated report and are labeled as such.
- **Accounting rules** (also in `docs/food-business-engine.md`): sold COGS is recognized at sale (estimated COGS included but flagged); unsold finished goods and remaining groceries are inventory, never expenses; spoilage is a loss when recorded; fixed costs are expenses of the period their due dates fall in (paid or not — payments are cash-flow tracking); transfers move value between stalls and never touch profit; production spend is informational because counting it alongside sold COGS would double-count. Net profit = revenue − sold COGS − fixed costs − spoilage. Pure math in `src/domain/profitMath.ts`.

### Phase 12+13 deferred

- Automatic reminders / push notifications for due bills.
- Payroll automation, tax reporting, and accounting export.
- Custom recurrence calendars (every-15th-and-30th etc.).
- Cloud sync and Play Store release work, as always.

## Previous Phase

Android Phase 10+11: Selling COGS and Finished Goods Lifecycle.

Every kiosk sale now records its cost of goods sold, cook-upon-order products sell without ever being blocked by missing inventory, and finished goods have a full lifecycle: produced → sold / spoiled / transferred, with value following the goods.

### Selling COGS (Phase 10)

- Migration `007_selling_cogs` adds COGS columns to `sale_items` (`cogs_total`, `cogs_per_unit`, `cogs_source`, `cogs_is_estimated`, `related_recipe_id` — all additive, old sales stay valid) plus `sale_ingredient_usages` (per-sale ingredient usage and shortfall records) and `product_transfers`.
- **Product mode is derived from the latest active recipe**: a product whose latest active recipe is `cook_upon_order` sells made-to-order; everything else is prepared-before-selling. No product-table change.
- **Cook-upon-order sales never block.** The Sell screen shows a "Made to order" badge and allows adding at zero stock; checkout computes recipe COGS per item: each line deducts what its selected lot actually has (never negative, never other lots), any missing part is estimated at that same lot's price, and a fully missing lot falls back to the recipe's save-time snapshot price. Actual and estimated parts are recorded per line in `sale_ingredient_usages` with shortfall quantities; the sale item is marked `cook_upon_order_actual` or `cook_upon_order_estimated`. Finished stock is not touched for made-to-order items. All of this happens inside the existing single checkout transaction — duplicate-tap protection, bundle pricing, receipt totals, and the pending-save queue are unchanged.
- **Prepared-before-selling COGS** uses the average produced unit cost from production batches (`production_average`); products with no production history fall back to their owner-entered cost (`simple`). Exact FIFO cost layers are a documented deferral — averages keep checkout simple and safe.
- Verified by `npm run check:cogs` (22 assertions: full-stock actual, partial actual/estimated split, snapshot fallback, custom-line scaling, shared-lot draining across items, lots never negative, gross profit math).

### Finished goods lifecycle (Phase 11)

- **Unsold goods value**: stock on hand × average produced cost per product, shown in Insights ("Unsold goods").
- **Spoilage value**: Nasayang now values the loss at the average produced unit cost when production history exists (owner-entered cost otherwise) — same guards as before, still one transaction, still never negative.
- **Transfers**: the new Transfers screen (from Inventory) moves finished goods between stalls: pick a product, destination stall, quantity — one transaction decrements the source, increments a same-named product on the destination stall (cloning the product row there if none exists, noted in the result), records the transfer with its moved value, and writes paired `transfer_out`/`transfer_in` movements. Negative stock blocked; needs at least two stalls.
- Records shows transfer movements with "Lipat in/out" badges; Insights adds COGS today, Gross profit (benta minus puhunan), Unsold goods, and Sayang today metrics, plus a friendly "Estimated cost used" note when cook-upon-order sales had to estimate ("Inventory was low, kaya recent price ang ginamit ni KitaMo."). Home's Tubo now uses real COGS automatically.

### Phase 10+11 deferred

- Fixed costs and consolidated per-stall/business profit reports (next phases).
- FIFO production cost layers (average produced cost is the documented MVP).
- Editing/undoing transfers; transferring shared (no-stall) products.
- Cloud sync, as always.

## Previous Phase

Android Phase 9: Production per Stall with Ingredient Deduction.

Owners can now record recipe-based production: pick a stall, pick a recipe, enter how many pieces were produced, and save. One SQLite transaction deducts the required ingredient quantities from the recipe's selected Grocery Pool lots, increases the finished product's stock, records the production batch with its COGS assigned to the chosen stall, and writes ingredient-usage and product stock-in movements. This is for prepared-before-selling products; cook-upon-order COGS stays deferred.

### Production (Phase 9)

- Migration `006_production` adds `production_batches` (stall, recipe, output product, quantity, batch multiplier, total cost, cost per unit) and `production_ingredient_usages` (per-line usage with lot, quantity, cost, and label snapshots). The existing simple `recipe_batches`/Niluto flow is untouched; both tables are covered by Clear Local Data.
- **Fractional batches supported**: producing 12 pieces from a 5-per-batch recipe scales every ingredient and cost by 2.4. Verified by `npm run check:production` (multiplier, scaled deductions like 100 g/batch × 2 batches = 0.2 kg from a kg lot, cost scaling, shortfall blocking, exact-remaining allowance, shared-lot aggregation, unit rejection).
- **Deduction rules**: only the recipe's selected lots are touched — never other lots of the same ingredient. Lines sharing one lot are combined before the availability check. If a selected lot is short, production is blocked with a friendly message ("Not enough Soy sauce (Kikkoman). Need 20 ml, available 10 ml.") — production plans ahead, so unlike future cook-upon-order it must block. Lot remaining quantities can reach exactly zero (lot flips to depleted) but never negative, guarded both in the plan and again at the SQL level inside the transaction.
- **Custom cost lines** scale into production COGS but never deduct grocery stock, with the note shown in the preview.
- **Stall assignment**: the batch, its COGS, and the product stock-in movement are recorded under the selected stall; unsold finished goods stay on that stall's product until sold, spoiled, or transferred (transfers still deferred). No manual grocery allocation exists anywhere.
- The Production screen (Owner Home, Inventory's Niluto section, and Recipes link to it) shows stall and recipe pickers, the recipe's cost/makeable/bottleneck details, and a live preview of ingredient requirements, shortfalls, total cost, cost per unit, and the resulting stock increase. Save is disabled while the plan has shortfalls or unit issues; duplicate taps are locked; a "Latest production" summary card appears after saving.
- Producing above a product's low-stock threshold auto-resolves its active low-stock alert (same rule as the simple Niluto flow). Low grocery stock stays visible in the Grocery Pool and Insights.
- Records shows a "Niluto / Production" card with recent batches (recipe → product, quantity, stall, cost); the product stock-in also appears under stock movements with the Niluto badge. Insights adds a Production metric (today's production COGS + items produced).

### Phase 9 deferred

- Cook-upon-order selling and COGS estimation/shortfall logging at sale time.
- Finished-goods transfers between stalls.
- Fixed costs and consolidated profit reports.
- Ingredient-level low-stock alerts in the owner alert system (Grocery Pool shows low stock for now).

## Previous Phase

Android Phase 8C+8D: Recipe Builder and Recipe Costing.

Owners can now create recipes for sellable products, picking specific ingredient lots from the Grocery Pool — the exact brand and source, not an average. Recipe costing, makeable quantity, and bottleneck detection are live. No ingredient deduction happens yet: saving or costing a recipe never changes grocery stock.

### Recipes (Phase 8C+8D)

- Migration `005_recipes` adds `recipes` (linked to a sellable product as output, with output quantity/unit, production mode, notes) and `recipe_ingredient_lines` (either a selected ingredient lot or a custom-cost line). Both are wiped by Clear Local Data.
- **Selected-lot costing**: a line stores the chosen lot and snapshots its cost per unit at save time. If the owner picked Kikkoman at ₱180/L, the line costs from Kikkoman — never averaged with the ₱45 local soy sauce, and never swapped. Snapshots keep saved recipes stable even if a lot is later depleted or archived.
- **Unit conversion**: kg↔g and L↔ml only (10 kg rice at ₱650 → 100 g line = ₱6.50; 1 L soy sauce at ₱180 → 10 ml = ₱1.80). Incompatible units (e.g. ml into a kg lot, pack into anything else) are rejected with a friendly message — never silently miscomputed.
- **Custom cost lines**: when an ingredient is not in the pool, the owner types a name and cost. Custom lines are flagged, included in recipe cost, and clearly marked as not deducted from and not checked against grocery stock.
- **Makeable quantity + bottleneck**: computed live from current lot remaining quantities (lines sharing one lot are aggregated first). Example: rice supports 10 batches but soy sauce only 3 → makeable 15 sushi, bottleneck soy sauce. Custom lines never limit makeable quantity.
- The Recipes screen (Owner Home quick action, Inventory, and Grocery Pool links) shows summary metrics (active, average cost per unit, low-makeable, custom-cost recipes), recipe cards with per-batch/per-unit cost, makeable badge, bottleneck, production-mode badge (Prepared before selling / Cook upon order), and a create form with a searchable lot picker (name, brand, source), live line-cost and batch-cost previews, custom-cost lines, strict number parsing, and a duplicate-save lock. Recipe + lines save in one SQLite transaction.
- Insights adds a Recipes metric (active count + low-makeable count). Pure costing math lives in `src/domain/recipeCosting.ts`, verified by `npm run check:recipes`.
- Production mode is informational for now: `cook_upon_order` recipes do not change kiosk behavior yet.

### Phase 8C+8D deferred

- Ingredient deduction (production per stall or cook-upon-order).
- Cook-upon-order COGS estimation and shortfall logging at sale time.
- Editing recipe ingredient lines after save (archive and recreate for now).
- General unit conversion (pack sizes, cups); fixed costs; consolidated reports.

## Previous Phase

Android Phase 8A+8B: Food Business Engine Plan + Grocery Pool Foundation.

Phase 8A produced the full Food Business Engine architecture plan in [`docs/food-business-engine.md`](docs/food-business-engine.md) — grocery pool, ingredient lots, recipe builder, per-stall production, cook-upon-order, fixed costs, and consolidated reporting, phased 8B through 8G.

Phase 8B implements only the foundation: a central Grocery Pool where the owner records every grocery/ingredient purchase as a lot with brand, source, quantity, unit, and cost. Ingredients are separate from sellable products — nothing changes in the existing product, kiosk, or sale flows.

### Grocery Pool (Phase 8B)

- `ingredients` holds the concept ("Soy sauce", default unit, category, low-stock threshold); `ingredient_lots` holds each actual purchase ("Kikkoman, 1L, ₱180, from grocery") with remaining quantity, computed cost per unit, and status; `ingredient_movements` records purchases and manual adjustments as an audit trail. All three are cleared by Clear Local Data and created by migration `004_grocery_pool`.
- The same ingredient can hold many lots with different brands, sources, and prices (Kikkoman ₱180/L next to local brand ₱45/L) — this is the base the recipe builder will select from.
- Recording a purchase is one SQLite transaction: find-or-create the ingredient (case-insensitive name match), create the lot, write the purchase movement. Quantity and total cost must be positive; remaining stock can never go negative; cost per unit = total cost ÷ quantity.
- The Grocery Pool screen (Owner Home quick action, or from Inventory) shows remaining grocery value, ingredient count, low-stock ingredients, recent purchases, an add form with a live cost-per-unit preview, and a searchable list matching ingredient name, brand, and source. Strict number input (walang comma), duplicate-tap lock, feedback beside the form.
- Units supported: g, kg, ml, L, pcs, pack — stored as entered. Low-stock math converts only kg↔g and L↔ml; lots in other units still count toward value but are skipped in the threshold comparison until unit conversion lands with recipe costing.
- Insights shows a Grocery metric (remaining value + low-stock ingredient count). The central pool is business-level: there is no manual allocation of groceries to stalls, ever — later phases reduce the pool through actual production or cook-upon-order usage.
- Fresh mode starts with an empty pool; demo mode does not auto-create grocery records.
- Also fixes an inherited product-edit bug: partial product updates re-applied schema defaults, so editing a product without touching the stock field could reset its stock to zero. Product and ingredient updates now use defaults-free update validation, so omitted fields are truly preserved.

### Phase 8B deferred (designed in the plan, not built)

- Recipe builder and searchable ingredient selection in recipes.
- Ingredient deduction (production or cook-upon-order).
- Cook-upon-order COGS estimation, shortfall logging, and recent-price fallback.
- Custom ingredient cost fallback lines.
- General unit conversion (pack sizes etc.).
- Fixed costs and per-stall/consolidated profit reports.

## Previous Phase

Android Phase 7.5: End-to-End QA Hardening and Seller Pilot Cleanup.

This phase walked every seller flow end to end (first run, Owner Home, Settings, Inventory, Cook/Spoilage, Kiosk sell/checkout/receipt/orders/stock/shift, Ask, Records, Insights, alerts) and fixed the bugs, stale totals, edge cases, and copy issues found. No new features, schema changes, or integrations were added.

Phase 7 added the operational layer for food sellers: local-only owner alerts, Notify Owner in Kiosk Stock, the Cook/Niluto batch flow, Spoilage/Nasayang logging, and owner alert visibility in Home and Insights. Everything remains local-first SQLite; no push notifications, cloud sync, auth, AI, camera, Bluetooth, Customer/LGU mode, or release work.

### Phase 7.5 fixes

- Owner Home "Today's Kita", Benta, and Tubo now use today's sales only (they previously showed all-time totals), and Tubo now shows benta minus recorded product cost instead of repeating gross sales.
- Editing a product no longer silently reverts stock changes that happened while the edit form was open (kiosk sales, cooking, spoilage): stock is only written when the seller actually edits the stock field.
- Editing a product no longer silently moves it to the active stall or force-reactivates it.
- A reference number typed for GCash/Maya/bank is no longer saved onto the sale (or printed on the receipt) when the seller switches back to cash before checkout.
- Invalid discount input now blocks checkout with a friendly message instead of being silently treated as zero.
- Demo seeding now runs in one SQLite transaction (no partial demo data if interrupted) and the first-run buttons have a double-tap lock, so demo data cannot be created twice.
- Deactivating the currently active stall clears the stall context and requires deliberate reselection; KitaMo never silently reassigns or reactivates a stall.
- Cooking a low-stock product back above its threshold now auto-resolves its active low-stock alert, so Notify Owner can fire again on the next shortage.
- Unsaved Business Profile edits are no longer wiped when a stall is added, edited, or selected.
- Number fields (stock, prices, bundle, cook/spoilage quantities, discount) now reject commas and non-numeric input with a friendly message instead of silently saving 0.
- Insights now shows Products, Low stock, Alerts, and Stock watch even before the first sale (sales metrics still appear only after real sales).
- Error messages now render in red consistently in Settings, Inventory, and Checkout; Cook and Spoilage feedback now appears next to their own Save buttons.
- Taps on Save/Checkout buttons now work on the first tap while the keyboard is open.
- Receipt text no longer includes the internal sale ID or sync wording; it now ends with "Saved locally on this device."
- Removed the non-functional dropdown caret on the Home business pill; Orders and Inventory no longer flash empty/form states while loading; returning users no longer see the first-run chooser flash; Kiosk Stock empty state no longer repeats the same sentence three times; assorted Taglish copy cleanups ("Pending saves", Settings subtitle, share feedback).

### Verified in this pass

- Bundle pricing regression (unit 20, bundle 8-for-150): qty 7/8/9/16/17 = 140/150/170/300/320 through the shared pricing helper used by cart, checkout, sale rows, receipts, and Records/Insights totals. Run `npm run check:pricing` to re-verify.
- Sale, cook, and spoilage writes are each one SQLite transaction; negative stock is blocked at the SQL level (`stock_qty >= ?` guards); duplicate submissions are blocked by synchronous tap locks on checkout, cook, spoilage, notify, resolve, and first-run actions.
- Fresh mode starts empty; demo data appears only after Try Demo Data; Clear Local Data returns to the first-run choice.
- No SQLite, migration, or queue implementation wording appears in seller-facing screens.

### Known limitations (honest)

- Shift Summary shows all sales saved on the phone (there is no shift open/close yet); the subtitle says so.
- Service-type products still track a stock quantity; give them a high stock number for now so they stay sellable.
- Owner Home previews active alerts; the local Notification Center provides active/resolved history and business/stall filters.
- Expenses (Gastos) are not recorded yet, so Tubo is benta minus product cost only.

## Run

```sh
npm install
npm run typecheck
npm run lint
npm run check:owner-context
npm run check:pricing
npm run check:recipes
npm run check:production
npm run check:cogs
npm run check:fixedcosts
npm run check:pilot
npm run check:migrations
npm run start
```

For Android:

```sh
npm run android
```

## Included

- Expo SDK 54 React Native with TypeScript.
- Expo Router route structure for Owner and Kiosk areas.
- First-run choice for Fresh Business or explicit Demo Data.
- Owner Home setup guidance and pilot status.
- Owner Settings business profile form backed by SQLite.
- Owner Settings stores/stalls form backed by SQLite branches.
- Owner Inventory product setup and product list backed by SQLite products.
- Kiosk entry gate for active business, active stall, and product readiness.
- Kiosk Sell product list, stock-aware cart, and quantity controls.
- Bundle pricing parity for Kiosk cart, checkout, sale item totals, and receipts.
- Kiosk Checkout for cash, GCash, Maya, bank transfer, other payment methods, reference capture, and optional discount.
- Local sale transaction with sale items, stock decrement, inventory movement, receipt record, and pending offline queue entry.
- Receipt display with clipboard copy and native share sheet when available.
- Kiosk Orders, Stock, and current local Shift summary screens.
- Local-only Ask KitaMo suggested questions and deterministic answers.
- Owner Records tab for local sales, receipts, filters, and recent stock movements.
- Owner Insights tab for today's sales, payment breakdown, product counts, low-stock count, active alert count, and top products.
- Local-only owner alerts with severity, active/resolved status, and resolve action in Owner Home.
- Kiosk Stock low/out-of-stock badges with a Notify Owner action that creates a local alert.
- Cook/Niluto batch flow in Owner Inventory that records a recipe batch, increases finished product stock, and logs a cooked inventory movement in one transaction.
- Spoilage/Nasayang flow in Owner Inventory that decreases stock and logs a spoilage inventory movement with negative-stock protection.
- Online / Offline local-mode indicator using Expo Network.
- Pending offline queue visibility in Owner and Kiosk flows.
- Shared KitaMo UI primitives for screen shells, cards, metric cards, pills, buttons, empty states, list rows, and icon-based bottom navigation.
- Theme token foundation with light, dark, and system-ready mode support.
- Zustand stores for app, kiosk, and theme state.
- SQLite client, migration runner, and initial local schema.
- Typed repositories for businesses, branches, products, sales, inventory movements, app settings, and local data reset.
- Manual demo seed function.
- Explicit Clear Local Pilot Data service function.

## SQLite Foundation

The local database is `kitamo_local.db`, opened through `src/db/client.ts`.

Migrations live in `src/db/migrations/` and are tracked in the `schema_migrations` table. `runMigrations()` is safe to call repeatedly. Migration `001_initial_schema` creates the local tables, migration `002_owner_setup_fields` adds owner setup notes fields to businesses and branches, migration `003_owner_alert_fields` adds `severity` and `product_id` to `owner_alerts`, and migration `004_grocery_pool` adds the grocery pool tables.

The initial schema creates:

- `businesses`
- `branches`
- `products`
- `sales`
- `sale_items`
- `inventory_movements`
- `recipe_batches`
- `owner_alerts`
- `receipt_records`
- `offline_queue`
- `app_settings`

Migration `004_grocery_pool` adds:

- `ingredients`
- `ingredient_lots`
- `ingredient_movements`

Migration `005_recipes` adds:

- `recipes`
- `recipe_ingredient_lines`

Migration `006_production` adds:

- `production_batches`
- `production_ingredient_usages`

Migration `007_selling_cogs` adds COGS columns to `sale_items` plus:

- `sale_ingredient_usages`
- `product_transfers`

Migration `008_fixed_costs` adds:

- `fixed_costs`
- `fixed_cost_payments`

## Fresh Mode

Fresh mode is empty by default. The app does not auto-seed demo products, records, inventory, alerts, or pseudo business data.

The first-run screen offers:

- Start Fresh Business
- Try Demo Data

Choosing Start Fresh Business only marks first-run setup as complete and routes to Owner setup. It does not create a business, stall, product, sale, inventory movement, alert, or insight.

## Demo Data

`seedDemoData()` in `src/services/pilotData.ts` creates one demo business, one demo stall, and a small product list only when explicitly called. It is not called automatically at startup.

The first-run Try Demo Data action calls that seed function and then routes to Owner setup.

## Owner Setup

Owner Home reads the local database and shows:

- business profile status
- stall/store status
- product count
- active stall
- local database status
- pending offline queue count
- fresh/demo mode

Phase 5.8 presents this as a more compact seller dashboard with a smaller KitaMo top bar, active business context, Today's Kita hero card, controlled metric sizing, setup status, quick actions, and a polished empty state when no local sales exist.

Owner Settings supports creating, editing, and switching local businesses; adding/editing stalls or stores; and selecting the active stall. `app_settings.activeBranchId` keeps the current selection, while a per-business setting remembers only an explicitly selected valid stall.

Owner Settings separates Business Profile, Store / Stall, Pilot App Status, and Data & Privacy. SQLite/native errors are logged in development and shown to users as short friendly messages.

Phase 5.7 adds a Business Profile-style summary card while preserving the same local create/edit flows.

Owner Inventory supports creating/editing local products and listing stock quantities with low-stock badges. It does not edit inventory movements yet.

Owner Inventory uses a cleaner product setup/list baseline with compact fields, product cards, stock, unit, price, and low-stock badges.

Phase 5.8 keeps Inventory summary cards for Products, Low Stock, and Stock Value, then prioritizes the product list before the Add Product form. The form expands when adding/editing products so saved products stay easier to scan. Recipe/batch cooking remains deferred.

## Ask, Records, And Insights

Ask KitaMo is local-only in Phase 6. It does not call Lis, OpenAI, Anthropic, or any remote API. Suggested questions answer from SQLite-backed local summaries:

- today's sales total
- today's transaction count
- pending saves
- product and low-stock counts
- top product from local `sale_items`

Records shows local SQLite records only. It includes summary cards, Today/All/Cash/GCash-Maya-Bank filters, local sale cards, receipt text expansion, and recent inventory movement rows where available. It does not export, edit, delete, or sync records.

Insights shows simple local summaries only: today's sales, transactions, average sale, payment breakdown, product count, low-stock count, top products, and pending saves. It does not use fake sales data in fresh or demo mode; insights appear after real local sales exist on the device.

## Stock Alerts, Cook, And Spoilage

Phase 7 adds local-only operational flows on top of the existing tables. All alerts, batches, and spoilage records stay in SQLite on the device. There are no push notifications, background jobs, or cloud sync.

Owner alerts live in `owner_alerts` with severity (`info` / `warning` / `critical`) and status (`active` / `resolved`). The `src/db/repositories/ownerAlerts.ts` repository supports creating alerts, listing active and recent alerts, counting active alerts, and marking an alert resolved.

Notify Owner lives in Kiosk Stock. Low-stock and out-of-stock products show a Notify Owner action that creates a local owner alert (for example, "Low stock: Sushi Roll"). Duplicate protection works two ways: a synchronous tap lock prevents rapid double taps, and an existing active alert for the same product is reused instead of duplicated — the row then shows "Owner notified".

Owner Home shows active alerts with title, message, severity badge, created time, and a Resolve button, plus a compact active-count pill. Insights shows an active alert count metric.

Cook/Niluto lives in Owner Inventory. The seller picks a finished product, enters how many pieces were produced, and saves. One SQLite transaction inserts a `recipe_batches` row, increases the product stock, and inserts a `cooked` inventory movement. Ingredient deduction is intentionally deferred — cooking only increases finished goods stock and does not consume ingredient products yet.

Spoilage/Nasayang also lives in Owner Inventory. The seller picks a product, enters how many pieces were wasted, and optionally adds a reason. One SQLite transaction decreases the product stock and inserts a `spoilage` inventory movement. Spoilage can never push stock below zero; the save is blocked with a friendly message instead.

Cook and spoilage movements appear in Owner Records under recent stock movements with Niluto and Nasayang badges. Fresh mode starts with no alerts, batches, or spoilage records; demo products can be used with these flows, but demo mode never auto-creates alerts, batches, or spoilage rows.

## Kiosk Selling

Kiosk Mode requires:

- an active business profile
- an active stall/store
- at least one local product

If products are missing, Kiosk shows: “Add products in Owner Inventory first.”

The Sell screen reads active-stall products from SQLite, shows stock and low-stock/out-of-stock status, and stores the cart in Zustand for simple navigation between Sell and Checkout.

Phase 5.8 tightens Kiosk entry, Sell, and cart surfaces with smaller headers, compact product rows, clearer totals, and easier checkout scanning. Sale transaction behavior is unchanged.

## Bundle Pricing

Android Kiosk checkout matches the validated PWA bundle pricing rule. If a product has a valid bundle quantity and bundle price, checkout applies as many full bundles as possible, then prices the remaining units at the normal unit price.

Example: unit price `PHP 20`, bundle `8 for PHP 150`:

- quantity `7` = `PHP 140`
- quantity `8` = `PHP 150`
- quantity `9` = `PHP 170`
- quantity `16` = `PHP 300`
- quantity `17` = `PHP 320`

Bundle pricing never increases the line total above normal `unit price x quantity`. If a bundle is missing, invalid, or not cheaper than normal pricing, the line uses normal unit pricing.

Kiosk Sell displays available bundle offers on product rows and shows “Bundle applied” in the cart only when the bundle affects the line total. Checkout, receipt text, `sale_items.line_total`, and `sale_items.bundle_applied` use the same pure pricing helper in `src/domain/pricing.ts`.

## Checkout And Payments

Checkout supports:

- cash
- GCash
- Maya
- bank transfer
- other

Cash can complete without a reference number. Non-cash payments require a reference number before checkout completes. Duplicate checkout is guarded by both a synchronous save lock and a saving state so rapid repeated taps cannot create duplicate sales. Failed saves release the lock and re-enable checkout safely.

When checkout succeeds, one local SQLite transaction:

- inserts the sale
- inserts sale items
- decrements product stock
- inserts stock-out inventory movements
- inserts the receipt record
- inserts a pending `offline_queue` row for future sync

If any part fails, the transaction rolls back.

Phase 5.8 keeps the checkout/receipt layout compact with clean payment options, a controlled total card, receipt summary, and copy/share actions. It does not change duplicate checkout protection or receipt generation.

## Offline Proof

The app uses Expo Network to show:

- `Online`
- `Offline / Local mode`
- pending queue count

The indicator appears in the Owner Pilot Status card and Kiosk entry/sell screens. This is status-only; it does not start cloud sync.

## Pending Queue

Each completed local sale inserts one pending `offline_queue` row with `entity_type = sale` and `operation = create`.

Pending queue count is read from SQLite and shown in:

- Owner Home / Pilot Status
- Kiosk entry
- Kiosk Sell
- Kiosk Shift

Supabase/cloud sync is still deferred. Queue rows remain local proof of future sync intent.

## Persistence Expectation

Screens reload durable data from SQLite on mount/focus:

- products and stock
- active business/stall settings
- orders and receipt records
- shift totals
- pending queue count

Cart contents remain lightweight Zustand state and are not expected to survive a force close yet. Completed sales, stock decrements, receipts, and queue rows are durable.

For SDK 54, owner status and local count reads are performed sequentially on the SQLite handle to avoid native prepared-statement lifecycle errors during settings load.

## Receipts

Receipts are generated from structured local sale data and include business, stall, transaction number, sale ID, date/time, items, subtotal, discount, total, payment method, reference number when present, and a local/offline note.

Receipt text can be copied to the clipboard. The app uses the native share sheet when available; Bluetooth printing is still deferred.

## Local-Only Storage

All Phase 5 data is stored locally in SQLite on the device. There is no cloud sync, login, telemetry, remote AI, camera extraction, Bluetooth printing, or production staff security in this phase.

The Phase 5.8 polish is UI-only. It does not change business logic, the SQLite schema, cloud services, AI, camera/OCR, Bluetooth printing, Customer/LGU modes, or release work.

## Clear Local Pilot Data

`clearLocalPilotData()` clears local KitaMo SQLite tables, including businesses, branches, products, sales, sale items, inventory movements, recipe batches, owner alerts, receipt records, offline queue rows, and app settings.

Because `app_settings` is cleared, the first-run choice appears again when the app starts from the root. Demo data is not recreated unless Try Demo Data is selected again.

## Intentionally Deferred

- Supabase sync.
- Login, Clerk, or auth.
- Lis API or live AI.
- Camera, OCR, voice, or file extraction.
- Bluetooth printing.
- Customer Mode.
- LGU Mode.
- Play Store production release work.
- Supabase sync processing for `offline_queue`.
- Real Lis AI or multi-agent Ask.
- Records export/download.
- Advanced analytics or chart libraries.
- Full staff permissions and shift open/close workflow.
- Recipe ingredient deduction and batch costing for Cook/Niluto.
- Push notifications for owner alerts.
- Expense (Gastos) recording.
- A dedicated alerts list screen.
- Stock-free selling for service-type products.

## PWA Safety

The reference PWA repo lives at `/Users/rovs/Documents/KitaMo`. Do not modify it from this Android project. Adapt only simple, safe domain ideas when explicitly needed.
