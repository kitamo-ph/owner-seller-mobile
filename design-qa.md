# Gabi Redesign Design QA

## Stage 3: Kiosk Selling, Checkout, Receipt, and Orders

Reference sources:

- `KitaMo Redesign.dc.html` from the approved Turn 4 package
- `KitaMo Prototype.dc.html` from the approved Turn 4 package
- `handoff/kitamo-tokens.json` version 3.1.0
- `handoff/codex-migration-notes.md`, sections 9-11 and 15

Test target:

- Android API 35 16 KB emulator
- 360 x 800 logical viewport
- Araw and Gabi themes
- 100% and 130% system font scales

Compared states:

- explicit stall picker and confirmation
- Sell with categories, favorites, recents, product states, and inline quantity controls
- floating cart and Kiosk dock
- Checkout with discount, cash, GCash reference validation, tender, and change states
- completed receipt and reopened receipt from Orders
- Stock and pending local-save count after checkout
- force-close and theme-preference recovery

Verified:

- every operational route shows the confirmed business and stall context
- BENTA still crosses the explicit stall-selection and confirmation boundary
- invalid or expired Kiosk context explains the reset before returning to the picker
- category, favorites, recent-product, stock, bundle, and cart behavior remain wired to the existing services and store
- rapid repeated confirmation taps created one sale, one receipt, and one stock decrement
- Coke Mismo changed from 12 to 11 bottles exactly once; pending local saves changed from 0 to 1
- non-cash checkout remains disabled until a reference number is supplied
- cash tender and change are display-only and do not alter the sale contract
- receipt success remounts at the top instead of inheriting Checkout scroll position
- Orders reloads the persisted sale and receipt from SQLite after navigation and process restart
- Gabi preference persisted after force-close; the resolved Kiosk theme remained stable for the session
- product titles, cards, controls, dock, and notices remain readable at 130% text scale
- normal tap-based Kiosk navigation produced no JavaScript, Android runtime, SQLite, or font-loading errors in focused logcat

Automated gates:

- `npm run typecheck`
- `npm run lint`
- `npm run check:owner-context`
- `npm run check:pricing`
- `npm run check:recipes`
- `npm run check:production`
- `npm run check:cogs`
- `npm run check:fixedcosts`
- `npm run check:pilot`
- `npm run check:migrations`
- production Android export with Expo

Approved implementation constraints retained:

- no product photography because no real source asset is stored
- receipt sharing remains light, readable text
- no seller accounts, QR joining, remote approvals, scheduled shifts, push notifications, or cloud sync
- no schema, migration, repository, or protected business-engine changes
- bundle pricing, checkout idempotency, inventory, COGS, and reporting formulas remain authoritative

Non-blocking environment observation:

- Repeated external Expo Go deep-link relaunches produced the previously observed Fabric `MissingViewState` development overlay once. It did not reproduce during ordinary in-app navigation, caused no persisted-data damage, and is not present in the production Android export.

Design deviations:

- product photography is omitted because the local product contract has no image source
- optional cash tender/change remains presentation-only and is not persisted
- shared receipts remain text-based and light by design

Remaining visual issues: none at P0, P1, or P2.

final result: passed

## Stage 4: Inventory and Product Management

Reference sources:

- `KitaMo Redesign.dc.html`, Tindahan and Paninda sections from the approved Turn 4 package
- `KitaMo Prototype.dc.html` from the approved Turn 4 package
- `handoff/kitamo-tokens.json` version 3.1.0
- `handoff/codex-migration-notes.md`, Grocery-to-Production terminology and protected-engine notes

Test target:

- Android API 35 16 KB emulator
- 360 x 800 logical viewport
- Araw and Gabi themes
- 100% and 130% system font scales

Compared states:

- Tindahan tabs and Paninda overview
- active Owner business and stall context
- stock summaries, search, filters, product rows, and bundle status
- product action sheet, edit form, manual cooked-stock form, and spoilage form
- Kiosk Stock after explicit stall selection and confirmation
- local network and pending-save status

Verified:

- Paninda, Grocery, and Recipes remain distinct destinations within Tindahan
- the active business and stall are visible before Owner stock actions
- product quantities, thresholds, costs, prices, bundle labels, and Kiosk Stock all read the existing local contracts
- no capacity meter or product photography is shown without a real source field
- product actions remain reachable above the Owner dock and Android gesture area in a modal bottom sheet
- manual cooked stock is explicitly labeled as no-recipe stock-in and points recipe-based work to Niluto
- spoilage remains an explicit destructive stock-out flow with the existing validation and service
- edit, manual stock-in, and spoilage forms open without an automatic mutation; QA did not save test changes
- Kiosk Stock is reachable only inside a confirmed stall-specific Kiosk session
- Araw and Gabi contrast, card hierarchy, controls, and financial values remain readable at 360 x 800
- 130% text preserves tab labels, summaries, product names, price/cost values, action labels, and touch targets
- scrolled content is masked behind the transparent Android status bar to prevent text/icon overlap
- normal Inventory scrolling and action-sheet interaction produced no React Native, Expo, or Android runtime errors in focused logcat

Automated gates:

- `npm run typecheck`
- `npm run lint`
- `npm run check:owner-context`
- `npm run check:pricing`
- `npm run check:recipes`
- `npm run check:production`
- `npm run check:cogs`
- `npm run check:fixedcosts`
- `npm run check:pilot`
- `npm run check:migrations`
- Expo Doctor: 18/18 checks passed
- production Android export with Expo; Hermes bundle 3.99 MB

Approved implementation constraints retained:

- no product photography because the local product contract has no image source
- no capacity meter because the local product contract has no capacity field
- no schema, migration, repository, stock-service, or protected business-engine changes
- no seller accounts, remote alerts, cloud sync, or other non-pilot capability

Design deviations:

- source photography and capacity meters are omitted because the required data is unavailable
- exact product actions use a bottom sheet instead of expanding inline so every control remains reachable on 360 x 800 and at 130% text
- Kiosk low-stock pings remain local SQLite Owner alerts on the same device

Remaining visual issues: none at P0, P1, or P2.

final result: passed

## Stage 5: Grocery Stock and Exact Lot Presentation

Reference sources:

- `KitaMo Redesign.dc.html`, sections 4c and 1c from the approved Turn 4 package
- `KitaMo Prototype.dc.html` from the approved Turn 4 package
- `handoff/kitamo-tokens.json` version 3.1.0
- `handoff/codex-migration-notes.md`, Grocery-to-Recipe contract

Implemented states:

- Tindahan Grocery segment with active Owner business/stall context
- remaining grocery value, lot, ingredient, low-stock, and recent-purchase summary
- ingredient-grouped scanning with a distinct card for every purchase lot
- exact brand, source, purchase date, original quantity, remaining quantity, value, total purchase cost, and unit cost
- lot depletion meter based only on real purchased and remaining quantities
- batched read-only recipe-usage count per lot
- search across ingredient, brand, and source
- compact `Dagdag bili` sheet with required fields first and optional traceability fields collapsed
- live cost-per-unit preview and same-unit comparison with the latest matching lot
- loading, empty, no-result, validation, saving, and local-success states

Verified by automated gates:

- `npm run typecheck`
- `npm run lint`
- `npm run check:owner-context`
- `npm run check:pricing`
- `npm run check:recipes`
- `npm run check:production`
- `npm run check:cogs`
- `npm run check:fixedcosts`
- `npm run check:pilot`
- `npm run check:migrations`
- production Android export with Expo; Hermes bundle 4.00 MB

Protected behavior retained:

- `addGroceryPurchase()` remains the only write path
- each purchase still creates its own ingredient lot and movement in one existing transaction
- exact lot costs are not averaged, merged, or reassigned
- unit conversion, recipe snapshots, production deductions, COGS, and profit logic are unchanged
- the only service addition is one batched read-only recipe-line query used by the Grocery screen
- no schema or migration change

Design deviations:

- the approved system date picker is deferred; the existing optional ISO date field remains inside the collapsed details section to avoid adding a dependency during this stage
- `cooks left` is omitted because one lot may feed multiple recipes and the current contract has no single honest value; the UI shows batched recipe usage count instead
- no ingredient photography is shown because no image source exists

Pending QA debt:

- 360 x 800 Araw/Gabi screenshots, purchase-sheet keyboard behavior, 130% text, and focused logcat are pending because the emulator/ADB approval quota became unavailable after Stage 4
- Expo Doctor was already 18/18 immediately before this dependency-free stage; its repeat invocation was blocked by the same tooling quota

Remaining code or business-logic issues: none known.

final result: automated gates passed; device visual gate pending

## Stage 6: Recipe Builder and Recipe Detail

Implemented states:

- Gabi recipe catalog and exact-lot three-step builder
- explicit ingredient-lot selection with brand, source, purchase date, remaining quantity, and cost
- strict compatible-unit controls and blocked incompatible selections
- custom cost lines that stay outside stock math
- live batch cost, per-unit cost, current product margin, makeable quantity, and bottleneck summary
- read-only Recipe Detail with saved lot snapshots and advisory price guidance
- explicit handoff from Recipe Detail to Niluto without changing the product selling price

Protected behavior retained:

- existing recipe validation, snapshot, makeable, and unit-conversion services remain authoritative
- no schema, migration, pricing write, or automatic recipe versioning was added
- recipe ingredient lines remain read-only after save

Design deviations:

- no ingredient photography is shown because no source data exists
- suggested selling price remains advisory only

Pending QA debt:

- 360 x 800 Araw/Gabi, 130% text, and focused logcat checks are pending because emulator/ADB approval is unavailable

final result: automated gates passed; device visual gate pending

## Stage 7: Niluto and Production

Implemented states:

- explicit stall and prepared-recipe selection
- one quantity control with 1 batch, 2 batch, and capped MAX actions
- fractional-production explanation through the existing planner
- exact per-lot before-and-after deduction preview
- custom cost-only lines, shortage blocking, and incompatible-unit blocking
- review step before the existing atomic production write
- success state with finished-stock increase, production cost snapshot, and local batch ID
- stall-specific `Benta na` handoff that still requires Kiosk confirmation
- recent local production list

Protected behavior retained:

- `recordProduction()` remains the only production write path and duplicate guard
- exact lot deductions, makeable math, finished-stock increase, and cost snapshots are unchanged
- no schema, migration, planning, or supplier feature was added

Design deviations:

- `Bumili` opens Grocery without preselecting an ingredient because no safe route contract exists

Pending QA debt:

- 360 x 800 Araw/Gabi, 130% text, confirmation taps, and focused logcat checks are pending because emulator/ADB approval is unavailable

final result: automated gates passed; device visual gate pending

## Stage 8: Kita Reports and Operational States

Implemented states:

- unified `Kita` navigation with Report, Logbook, and Bayarin segments
- range-based profit hero using the protected formula exactly as implemented by the engine
- consolidated financial hierarchy, per-stall results, top products, estimated-cost warning, and operational alerts
- one local Logbook timeline for Benta, Grocery, Niluto, Bayarin, Nasayang, and Lipat
- receipt/detail expansion without changing the text-based receipt contract
- fixed-cost due hierarchy, overdue and due-soon emphasis, local payment/archive confirmations, and add form
- focused Lipat flow with explicit source/destination, capped quantity, exact read-only cost preview, before/after stock, and atomic-save notice
- loading skeletons after the shared delay, honest empty states, retry states, precise validation, explicit disabled tokens, and local success states
- legacy Insights route redirects to the consolidated Kita Report

Protected behavior retained:

- the profit formula remains `Revenue - Sold COGS - Fixed Costs - Spoilage = Net Profit`
- report, Logbook, fixed-cost, and transfer write contracts remain unchanged
- transfer cost preview is one read-only selection query using the same produced-average/product-cost basis as the existing write path
- no schema or migration change
- transfer stock and value still save atomically through `recordTransfer()`

Design deviations:

- receipts remain text-based and shared output stays light
- the existing ISO date field remains in Bayarin to avoid adding a date-picker dependency
- long lists remain in the existing scroll container pending profiling; no preemptive nested virtualization was introduced

Pending QA debt:

- 360 x 800 Araw/Gabi, 130% text, form keyboard behavior, focused logcat, and transfer/fixed-cost mutation taps are pending because emulator/ADB approval is unavailable

final result: automated gates passed; device visual gate pending

## Stage 9: Gabi Night and State Catalog Completion

Implemented states:

- token-only Araw and Gabi colors across shared controls and remaining Kiosk surfaces
- explicit solid disabled backgrounds and text in shared buttons, fields, onboarding choices, business/stall management, and development controls
- Gabi Kiosk Shift summary with stall-local totals, payment breakdown, pending queue count, loading skeleton, retry state, and honest pilot-scope notice
- token-backed theme preview in Settings
- token-backed selected rows, change card, status badges, warning borders, and danger borders
- zero non-token hex colors in `app/` and `src/components/`

Theme contract retained:

- light, dark, and system preferences remain supported by the persisted theme service
- Settings intentionally exposes manual Araw/Gabi first
- a confirmed Kiosk session keeps its resolved theme through `kioskSessionThemeMode`
- a requested preference is deferred until the Kiosk session unlocks
- shared receipt content remains light and text-based; in-app receipt surfaces follow the resolved app theme
- StatusBar foreground and background follow the resolved theme

State catalog checks:

- loading skeletons wait for the shared 300 ms delay unless an existing first-load screen explicitly requests immediate display
- error surfaces include an in-place retry where the action is recoverable
- destructive and financial warnings use explicit Gabi tokens
- disabled controls no longer rely on opacity-only styling
- remaining opacity usage is limited to pressed feedback and a decorative divider, not disabled state

Pending QA debt:

- 360 x 800 Araw/Gabi comparison screenshots, 130% font-scale inspection, persisted relaunch, Kiosk session-lock interaction, and focused logcat remain pending because emulator/ADB approval is unavailable

final result: static token audit and automated gates passed; device visual gate pending

## Stage 10: Final Redesign Audit

Automated gates completed:

- `npm run typecheck`
- `npm run lint`
- `npm run check:owner-context`
- `npm run check:pricing`
- `npm run check:recipes`
- `npm run check:production`
- `npm run check:cogs`
- `npm run check:fixedcosts`
- `npm run check:pilot`
- `npm run check:migrations`
- `git diff --check`
- static non-token color audit across `app/` and `src/components/`
- production Android export with Expo; Hermes bundle 4.04 MB
- public Expo config audit: `KitaMo`, `ph.kitamo.app`, version `1.0.0`, versionCode `1`, SDK 54, backup off
- tracked-source credential scan found no Supabase, public environment, API-key, service-role, or secret references
- `.env.local` is not tracked

Protected-diff audit:

- no schema, migration, domain-math, pricing, checkout transaction, COGS, fixed-cost schedule, spoilage, or profit-engine file changed
- service additions are read-only Grocery recipe-usage aggregation and transfer cost preview only
- existing Grocery, Recipe, Production, Transfer, Fixed Cost, and Checkout write services remain authoritative
- the profit formula remains `Revenue − Sold COGS − Fixed Costs − Spoilage = Net Profit`

Final review update:

- physical-phone manual QA through Expo Go was approved by the product owner
- accepted assessment: UI 9.5/10, UX 9/10, similarity to the approved Claude design 8.5/10
- first launch, Owner and Kiosk navigation, Araw/Gabi presentation, and the redesigned operational surfaces were accepted without a redesign blocker
- Expo Doctor rerun passed 18/18
- production Android export passed with a 4.04 MB Hermes bundle
- typecheck, lint, owner-context, pricing, recipe, production, COGS, fixed-cost, pilot, migration, and duplicate-checkout-token checks passed
- the dormant development verification panel, its disabled feature flag, and unused QA-only snapshot/integrity helpers were removed before the Stage 10 commit
- no temporary QA route or emulator-only runtime path remains
- Fresh and Demo data remain isolated; Demo still requires an explicit first-run choice and is never seeded automatically

Post-pilot improvement:

- the first-launch Fresh-or-Demo chooser remains unchanged for this approved pilot
- after pilot evidence is reviewed, prefer Fresh by default and move Demo into Settings or the Pilot Guide

Remaining external release evidence:

- focused ADB logcat and measured real-device RAM, battery, data, launch, long-session, and background/foreground checks require a physical phone exposed through ADB
- Google Play upload, listing completion, tester setup, and pre-launch report require the owner-controlled Play Console entry and final public support/privacy details

Git checkpoint status:

- Stages 4–9 were committed independently on `codex/gabi-redesign`
- Stage 10 contains final audit documentation and QA-only cleanup
- `main` remains untouched and must not be merged before the final review gates are accepted

final result: redesign implementation and automated QA passed; external device measurements and Play Console execution remain release gates
