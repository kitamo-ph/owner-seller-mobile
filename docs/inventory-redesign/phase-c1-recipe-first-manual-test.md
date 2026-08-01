# Phase C1 Recipe-first owner test guide

## Purpose

Use this checklist to verify the focused Recipe Book and recipe-creation
changes on a local development database. This is not a Play release or an AAB
verification run.

The test must not change the protected Android package, Expo project, signing
credentials, version `1.0.0`, versionCode `2`, or the protected versionCode 2
AAB.

## Start the app in Expo Go

From the authoritative repository:

```bash
cd ~/Documents/KitaMo-ph/owner-seller-mobile
npm run start -- --tunnel
```

Open Expo Go on the Android test phone and scan the QR code. Keep the terminal
open during testing so runtime errors remain visible.

Use a test business and stall. Do not use production Play data for this
manual-development pass.

## Evidence to record

For every scenario, record:

- pass or fail;
- the exact screen and action where a failure occurred;
- the visible error or unexpected result;
- whether closing and reopening the app changed the result; and
- a screenshot when the result is visual.

Do not work around a failure by deleting historical data or rebuilding the
protected AAB.

## Scenario 1 — Sausage Sushi per piece

1. Open `Recipe Book`.
2. Tap the floating `+`.
3. Select `Create a new recipe`.
4. Select `Finished product sold per piece or serving`.
5. Enter `Sausage Sushi`.
6. Leave the selling price blank.
7. Continue to ingredients. Confirm no batch output or yield was requested.
8. Add sausage with:
   - purchase cost `₱250`;
   - `18` sausages in the pack;
   - `4` portions from each sausage; and
   - `1` portion used for one sushi.
9. Confirm the preview is approximately `₱3.47` per sushi.
10. Add a temporary prepared ingredient:
    - name `Sushi Rice`;
    - estimated cost `₱80`;
    - reference quantity `1 kg`; and
    - usage `27 g` per sushi.
11. Confirm the preview is `₱2.16` per sushi and is labelled
    `Estimated cost`.
12. Add Japanese mayonnaise with:
    - purchase cost `₱300`;
    - purchased quantity `500 mL`; and
    - usage `5 mL` per sushi.
13. Confirm the preview is `₱3.00` per sushi.
14. Review the ingredient list and total cost per piece.
15. Confirm the blank selling price is shown as `No price yet`, not `₱0`.
16. Select `Save Draft`.
17. Leave the screen, reopen Recipe Book, and resume `Sausage Sushi` from
    `Drafts`.
18. Confirm the name, all ingredient lines, cost sources, and calculated
    values survived.
19. Add a selling price.
20. Select `Mark Ready`.
21. Confirm the library card shows text for cost status, production
    readiness, and Kiosk readiness.
22. Confirm no utensil, carry-bag, tissue, or optional condiment was required
    as a recipe ingredient.

Expected safety result:

- no Product had to be created in Paninda first;
- `Sausage Sushi` was named once;
- exactly one catalog/Product identity represents it;
- the inactive draft did not appear in Kiosk; and
- an estimated or incomplete recipe did not become Kiosk-ready.

## Scenario 2 — Complete Sushi Rice later

1. In Recipe Book, search for `Sushi Rice`.
2. Open the estimated prepared ingredient.
3. Select `Create or complete batch recipe`.
4. Add `Cooked Rice`.
5. Add vinegar, sugar, salt, or the chosen seasoning inputs.
6. Confirm ingredients can be entered before yield.
7. On the summary step, enter the expected Sushi Rice output.
8. Save or mark the prepared recipe ready.
9. Confirm the same Sushi Rice item remains in the library; no duplicate item
   was created.
10. Confirm the current cost source is recipe-derived and the prior `₱80/kg`
    owner estimate remains visible in its cost history.
11. Return to the Sausage Sushi draft or its next immutable edit version.
12. Confirm future costing can use the completed Sushi Rice recipe.
13. Confirm the UI explains that previous production and sales retain their
    recorded cost snapshots.

Expected safety result:

- stable Sushi Rice catalog identity;
- prior estimate preserved and superseded, not deleted;
- future definition uses an exact prepared-recipe version; and
- no historical production or COGS record is rewritten.

## Scenario 3 — Nested Cooked Rice

1. Start or resume the Sushi Rice batch recipe.
2. From its ingredient step, select the action to create a new prepared
   ingredient.
3. Enter `Cooked Rice`.
4. Navigate into the nested editor.
5. Close and reopen the app before completing it.
6. Resume the nested Cooked Rice draft.
7. Complete or save Cooked Rice.
8. Return to Sushi Rice.
9. Confirm Cooked Rice was inserted automatically.
10. Confirm all prior Sushi Rice inputs remained.
11. Complete Sushi Rice and return to Sausage Sushi.

Expected safety result:

- parent draft and placeholder were persisted before nested navigation;
- stale or interrupted nested creation did not create an orphan or duplicate;
- Back did not silently discard work; and
- unpublished drafts remained unavailable to production and Kiosk.

## Scenario 4 — Direct resale remains in Bagong Paninda

1. Open Paninda and use `Bagong Paninda`.
2. Add `Coke` as a purchased retail item.
3. Confirm no recipe is requested.
4. Confirm Coke remains accessible through the existing direct-resale flow.
5. Confirm Recipe Book is not a mandatory step for Coke.

Expected compatibility result:

- existing Bagong Paninda behavior remains available for direct resale; and
- the Recipe Book flow did not reclassify or rewrite the legacy Product.

## Scenario 5 — Library search, groups, and cost filters

1. Open Recipe Book and inspect `All`.
2. Open each relevant group:
   - `Recipes`;
   - `Prepared Bases`;
   - `Ingredients`;
   - `Selling Items`;
   - `Resale Products`;
   - `Drafts`; and
   - `Archived`.
3. Apply `Actual cost`.
4. Apply `Estimated cost`.
5. Apply `No price yet`.
6. Apply `Cost incomplete`.
7. Search for `Sushi Rice`.
8. Confirm status remains readable without relying on color.
9. Confirm Drafts are visible but are not marked production- or Kiosk-ready.
10. Confirm archived entries remain available through the archive group but
    are absent from normal production and Kiosk selection.

## Scenario 6 — Edit, duplicate, archive, and safe delete

1. Edit an unused draft and confirm it updates the same draft identity.
2. Mark a recipe ready, then edit it.
3. Confirm the edit creates a new immutable version instead of rewriting the
   previous version.
4. Duplicate Sausage Sushi as a related recipe.
5. Rename the duplicate and change at least one ingredient amount.
6. Confirm the duplicate has its own item/family identity and did not copy
   stock, sales, or Kiosk readiness.
7. Archive an item with retained history.
8. Confirm history remains readable.
9. Create an unused draft and delete it.
10. Attempt to delete a referenced or published item.
11. Confirm deletion is blocked with an understandable reason and Archive is
    offered as the safe action.

## Scenario 7 — Production navigation boundary

1. Tap the Recipe Book `+`.
2. Select `Cook or produce from an existing recipe`.
3. Confirm the app opens the existing production/Paninda flow.
4. Confirm Recipe Book defines per-piece inputs and Paninda asks for the
   actual production quantity.
5. Confirm an estimated, unresolved, or nested recipe is not presented as
   safely executable by the legacy flat production path.

This phase does not redesign the production transaction engine or implement
Kiosk supply deduction.

## Stop and report

Stop after these scenarios. Report failed steps before requesting unrelated
feature work. Do not rebuild or upload an AAB as part of this checklist.
