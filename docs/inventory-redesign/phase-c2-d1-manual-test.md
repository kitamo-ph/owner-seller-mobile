# Phase C2–D1 Recipe, Paninda, and Grocery owner test guide

Verification governance for the accepted implementation is corrected in
[phase-c2-d1-verification-correction.md](./phase-c2-d1-verification-correction.md).
Approved persistence and confirmation deviations are recorded in
[phase-c2-d1-design-decisions.md](./phase-c2-d1-design-decisions.md).

## Purpose and release boundary

Use this guide on a physical Android phone through Expo Go after the automated
Phase C2–D1 checks pass. This is an owner-test candidate, not a Play release or
an AAB verification run.

The test must not rebuild or modify the protected versionCode 2 AAB. It must
not change the Android package `ph.kitamo.app`, Expo project identity, signing
credentials, version `1.0.0`, or versionCode `2`.

Use a test business and stall. Do not use production Play data for this
development pass.

## Start the app

From the authoritative repository:

```bash
cd ~/Documents/KitaMo-ph/owner-seller-mobile
npm run start -- --tunnel
```

Open Expo Go on the Android phone and scan the QR code. Keep the terminal open
so development-safe diagnostics remain available if a screen fails.

## Evidence to record

For every scenario, record:

- pass or fail;
- device model and Android version;
- app commit and local schema version;
- the exact screen and action where a failure occurred;
- the visible error or unexpected result;
- whether Android Back, closing, or reopening changed the result; and
- screenshots for visual, reachability, or classification failures.

Do not work around a failure by deleting historical records, resetting Git,
rewriting SQLite, rebuilding the protected AAB, or manually changing internal
IDs.

## Scenario A — Paninda action sheet and lifecycle

1. Open `Paninda` and keep the default `Active` filter.
2. Open an active direct-resale product's three-dot menu.
3. Increase the phone font size, return to the app, and reopen the menu.
4. Confirm the title and `Close` action remain visible.
5. Scroll through the action content without dragging the decorative handle.
6. Confirm every eligible action is reachable and no action is clipped.
7. Confirm the stock-loss action is labelled `Record spoilage`, not Delete.
8. Tap outside the sheet and confirm it closes.
9. Reopen it, press Android Back, and confirm it closes.
10. Choose `Archive`, cancel once, then confirm it.
11. Confirm the item leaves `Active`, remains under `Archived`, and is absent
    from normal Kiosk selection.
12. Create an unused direct-resale item and use permanent delete.
13. Confirm deletion requires deliberate owner confirmation and the unused
    item disappears.
14. Attempt deletion on an item with stock movements, Recipe, production, or
    sales history.
15. Confirm deletion is blocked with a history-specific explanation and
    Archive remains available.

Expected safety result:

- the sheet remains bounded, safe-area aware, and scrollable at large fonts;
- archive preserves history;
- permanent deletion is fail-closed and atomic; and
- spoilage remains a stock movement, never a deletion synonym.

## Scenario B — Sausage package conversion

1. Open `Recipe Book` and create `Sausage Sushi` as a finished product per
   piece or serving.
2. Add Sausage using `Package breakdown`.
3. Enter package cost `₱250`.
4. Enter packages purchased `1`.
5. Enter `18` pieces per package.
6. Enter `4` portions per piece.
7. Enter Recipe usage `1 portion`.
8. Before adding, confirm the preview shows:
   - `1 pack → 18 pieces → 72 portions`;
   - `₱250 ÷ 72`; and
   - approximately `₱3.47` for one sushi.
9. Add the ingredient, then choose `Edit` on the same line.
10. Change `4 portions per piece` to another positive value.
11. Confirm the calculation updates immediately.
12. Save and confirm the same ingredient line is updated rather than
    duplicated.
13. Reopen the line and confirm the package chain remains visible.

Expected safety result:

- every conversion step and the resolved costing factor survive autosave;
- no floating-point equality error blocks a valid calculation; and
- editing does not delete and recreate the Recipe line.

## Scenario C — Edit a prepared estimate

1. Add a quick estimate named `Sushi Rice`.
2. Enter estimated cost `₱80` for `1 kg`.
3. Enter usage `27 g` per Sausage Sushi.
4. Confirm the preview is `₱2.16 estimated cost`.
5. Add the line and confirm Step 2 displays `Sushi Rice`, its prepared-base
   classification, estimate state, quantity, and cost.
6. Reopen the line with `Edit`.
7. Change its name, reference amount, and usage amount.
8. Save and confirm the same line ID is updated once.
9. Use `Replace source`, cancel, and confirm the original line remains.
10. Continue to Step 3.
11. Confirm Step 3 shows the same resolved name, classification, source,
    conversion summary, quantity, and cost state as Step 2.
12. Use Step 3 `Edit` and confirm it returns to Step 2 with the selected line
    open.

Expected safety result:

- shared Grocery ingredient names are not renamed from the Recipe-line form;
- owner-estimate evidence is versioned or superseded safely; and
- stale autosave revisions fail without duplicating the line.

## Scenario D — Unified ingredient library

1. In a Recipe's ingredient step, choose `Choose from Library`.
2. Confirm the picker is searchable and grouped into:
   - Purchased Ingredients;
   - Prepared Recipes;
   - Estimated Prepared Items;
   - Prepared Drafts; and
   - Legacy Recipe Inputs.
3. Confirm completed prepared Recipes are visible and selectable with their
   pinned version and cost state.
4. Confirm an estimated prepared item is visible and selectable as estimated
   evidence.
5. Confirm an incomplete-cost prepared Recipe remains visible, explains that
   the parent cost will remain incomplete, and can be selected when allowed.
6. Confirm a prepared draft is visible with `Continue Recipe`.
7. Confirm purchased ingredients are visible without guessing whether to
   search Grocery or Prepared Recipes.
8. Search `Sushi Rice` and verify the correct grouped results.
9. Search for a missing name and confirm the empty state explains the current
   search rather than claiming the library is empty.
10. Confirm disabled rows state exactly what must be completed before
    selection.

Expected safety result:

- records are explained rather than hidden solely because cost is missing;
- prepared versions remain pinned; and
- exact-lot selection remains available where provenance requires it.

## Scenario E — Apple Cider prepared-recipe chain

1. In Grocery, record `Apple Cider` with price `₱900` and quantity
   `5 US gallons`.
2. Confirm `US gallon` is explicit and is not labelled only `gallon`.
3. Confirm the app preserves the entered `5 US gallons` while showing its
   normalized volume evidence.
4. Confirm `Imperial gallon` remains a different selectable standard.
5. Create the prepared Recipe `Sushi Seasoning`.
6. Add Apple Cider and the chosen additional ingredients.
7. Enter expected output `400 mL` and publish the definition.
8. Create the prepared Recipe `Sushi Rice`.
9. Add the exact published Sushi Seasoning version.
10. Choose one explicit cup standard:
    - Metric cup — 250 mL;
    - US cup — approximately 236.588 mL; or
    - a custom business cup with its entered mL size.
11. Enter one selected cup of seasoning per `1,000 g` of Cooked Rice.
12. Review the propagated cost and the complete conversion path.
13. Edit Sushi Seasoning and publish a future version.
14. Confirm the existing Sushi Rice definition stays pinned to the original
    seasoning version until explicitly edited.

Expected safety result:

- no universal mass-to-volume conversion is invented;
- cup size and gallon standard are explicit and persisted;
- cost flows through exact prepared Recipe versions; and
- later edits do not rewrite historical Recipe, production, or COGS evidence.

## Scenario F — Mark Ready visibility and Paninda cleanup

1. Open Recipe Book and select the `Drafts` filter.
2. Resume a prepared-base draft and select `Mark Ready`.
3. Confirm Recipe Book reloads and clears any incompatible Draft/cost filter.
4. Confirm the published item appears under `Prepared Recipes` and is visibly
   highlighted with `Recipe ready`.
5. Confirm the next valid action is explained, including any missing
   production setup.
6. Repeat with a finished-product Recipe and confirm it appears under
   `Finished Recipes`.
7. Confirm `Recipe recorded` is a badge/status and does not override the
   item's classification section.
8. Open Paninda `Active` and confirm the prepared base, editing draft, failed
   draft, and abandoned native Product projections are absent.
9. Open `Needs Setup` and confirm only eligible incomplete finished or resale
   items appear there.
10. Confirm a ready Recipe-backed finished item offers `Open Recipe` and
    `Produce from Recipe`, not manual cook as its primary action.
11. Confirm `Bagong Paninda` is focused on direct-resale products and provides
    a Recipe Book link for cooked or prepared items.

Expected safety result:

- classification controls visual grouping;
- native draft projections never pollute ordinary Paninda; and
- legacy active Products remain available through compatibility rules.

## Scenario G — Grocery without a price

1. Open Grocery and add `Rice` with quantity `50 kg`.
2. Leave purchase cost blank and save.
3. Confirm the lot is saved as `No Price`, not authoritative `₱0`.
4. Open the `Missing Prices` filter and confirm the lot appears.
5. Add the unknown-price Rice lot to a Recipe.
6. Confirm its resolved name and Grocery-lot source are visible.
7. Confirm the Recipe becomes `Cost Incomplete`; no profit is fabricated.
8. Return to Grocery and complete the missing price.
9. Confirm future Recipe evidence can use the completed price.
10. Confirm an entered zero remains distinguishable as a known zero.
11. Attempt to correct a known price already referenced by immutable history.
12. Confirm historical COGS is not rewritten and the app directs the owner to
    record new evidence where required.
13. Test `Add another purchase`, `View recipes using this ingredient`, stock
    adjustment, and `Mark lot empty` where eligible.

Expected safety result:

- unknown cost persists with nullable authoritative evidence;
- missing price can be completed without rewriting earlier snapshots; and
- quantity, lots, and movements remain intact.

## Scenario H — Native Recipe production readiness

1. Open `Niluto / Production`.
2. Confirm existing executable legacy flat Recipes remain listed and usable.
3. Confirm published native finished and prepared Recipes appear in the
   native readiness section with their real names and classifications.
4. Confirm incomplete native Recipes remain visible with explicit blockers.
5. Open a nested native Recipe.
6. Confirm it shows:

   ```text
   Preparation plan ready; staged production will be enabled in the next production phase.
   ```

7. Confirm reviewing or calculating readiness creates no Ingredient movement,
   Product stock change, production batch, or partial stage execution.
8. Confirm no native Recipe is sent through the legacy flat executor.

Expected safety result:

- planning/readiness is non-mutating;
- legacy production remains intact; and
- nested staged execution stays visibly deferred rather than hidden or
  partially committed.

## Stop and report

Stop after these scenarios. Report failed steps before requesting Kiosk supply
work, cloud work, or final release validation. Do not build or upload an AAB as
part of this checklist.
