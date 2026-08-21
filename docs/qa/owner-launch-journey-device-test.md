# Owner Launch Journey — Physical Android Device Test

## Status and scope

- Gate: Turn 6 onboarding through Turn 7 sale and Home/Kita refresh
- Test type: manual acceptance test on a physical Android device
- Data: disposable tester-owned data only; do not use demo seed data
- Package identity: `ph.kitamo.app`
- Result: not executed by this document; complete the record below on-device

Do not attach customer data, credentials, PINs, or full receipt contents to a
defect report. Stop at the first visible defect, preserve the local state, and
record the screen and action that exposed it.

## Execution record

```text
Application commit:
Build/install source:
Device model:
Android version:
Screen size / font scale:
Network state:
Tester:
Date and timezone:
Overall result: PASS / FAIL / BLOCKED

First visible defect:
Screen/route:
Action immediately before it:
Expected:
Actual:
Can reproduce after restart: YES / NO / NOT TRIED
Evidence or defect ID:
```

## A. Fresh onboarding and restart

1. Start from a fresh install or clear the app's local data.
2. Enter the tester's name.
3. Choose `Owner`.
4. Create `Rovs Snack Stall` with a valid business type and location.
5. Create the inherited `Main Stall`.
6. Continue to Owner Home.
7. Force-close and reopen the app.

Expected:

- Name → Owner → Business → Stall completes without demo data.
- Home opens with the new business and stall context.
- Restart opens Owner mode; onboarding does not repeat.
- No Product, Recipe, Ingredient, stock, or selling price is fabricated.

## B. Grocery purchases

Record these real known-price purchases:

| Ingredient | Purchase | Total cost | Expected saved evidence |
| --- | ---: | ---: | --- |
| Hotdog | 1 pack | ₱120 | One purchase lot; package identity retained |
| Bread | 12 pcs | ₱60 | One 12-pc purchase lot |
| Mangga | 1 pcs | tester value | One naturally countable lot |

After every save, close the sheet and confirm the new lot is visible without
restarting the app. Reopen Grocery after visiting another screen and confirm
all three lots and known prices remain visible.

## C. Simple finished Recipe

1. Create `Hotdog Sandwich` as a prepared-before-selling finished Product.
2. Set expected output to `1 pcs`.
3. Add Hotdog from its recorded Grocery lot.
4. Choose `Package breakdown` and enter `1 pack = 12 pcs`.
5. Use `1 pcs` Hotdog per sandwich.
6. Add Bread and use `1 pcs` per sandwich.
7. Review identities, quantities, units, conversion evidence, and known costs.
8. Mark the Recipe ready/publish it.

Expected:

- No implicit `pack → pcs` conversion is invented; the owner-entered 12-piece
  breakdown is saved as the conversion evidence.
- The expected ingredient cost is ₱10 Hotdog + ₱5 Bread = ₱15 per sandwich.
- Publication creates the finished Product projection but does not list it.
- The published Recipe is visible immediately and offers `Mag-production`.

## D. Native Production

1. Open Production from the published Recipe.
2. Select `Main Stall` and target `5 pcs`.
3. Review the exact requirements and execute Production once.

Expected immediately after save:

- Hotdog lot decreases by 5 pcs-equivalent, leaving 7 pcs-equivalent.
- Bread lot decreases from 12 pcs to 7 pcs.
- Hotdog Sandwich Product scalar becomes 5.
- One exact Product stock lot exists with 5 remaining and the saved batch cost.
- Because the Product is unlisted, the primary success action is
  `Ilagay sa Tindahan`, never Benta.
- Paninda shows the stock without an app restart.

## E. Paninda listing

1. Continue to the exact Hotdog Sandwich Product.
2. Confirm it is `Kulang pa`/unlisted and has 5 stock.
3. Enter selling price `₱35`.
4. Choose `Ilagay sa Tindahan`.

Expected:

- Listing is an explicit owner action; Production did not perform it.
- The Product changes to `Nabebenta` only after listing succeeds.
- The screen offers `Benta na — buksan ang Kiosk` only when the authoritative
  active-stall readiness says it is Kiosk-eligible.

## F. Benta, checkout, and receipt

1. Open Benta/Kiosk and confirm `Main Stall`.
2. Confirm Hotdog Sandwich is visible at ₱35.
3. Add 1 to the cart and complete a cash checkout.
4. Keep the receipt screen open long enough to record its transaction number.

Expected:

- Checkout succeeds once and creates one Sale, Sale Item, receipt, and stock
  movement under the same local transaction.
- Finished Product scalar decreases from 5 to 4.
- The exact production Product lot also decreases from 5 to 4; no scalar/lot
  drift is introduced.
- In this one-batch scenario, saved COGS is ₱15 and gross profit before fixed
  costs or spoilage is ₱20.
- Receipt offers `Bagong benta`, Orders, and `Owner Home / Kita`.

## G. Post-sale refresh and persistence

1. From the receipt, open Owner Home / Kita.
2. Confirm today's sale count, revenue, COGS, and Kita reflect the sale.
3. Open Paninda and confirm finished stock is 4.
4. Open Grocery and confirm Hotdog and Bread remain at 7 pcs-equivalent each.
5. Open Orders/Logbook and confirm the sale and receipt exist.
6. Force-close and reopen the app, then repeat the checks.

Expected:

- Home/Kita and recent sale data refresh when Home regains focus.
- Paninda, Grocery, Orders, and reports read current SQLite state on focus.
- Restart preserves onboarding completion, business/stall context, Recipe,
  lots, listing, sale, receipt, Product stock, and financial totals.

## H. Countable-unit guard

Use the Mangga lot in a disposable draft Recipe with `1 pcs` usage.

Expected:

- `pcs → pcs` is accepted without mass/volume conversion.
- `pcs → g`, `pcs → mL`, and `pack → g` remain blocked unless the owner enters
  explicit valid conversion evidence.

## Acceptance result

```text
Onboarding/restart: PASS / FAIL / BLOCKED
Grocery/known prices: PASS / FAIL / BLOCKED
Recipe/package breakdown: PASS / FAIL / BLOCKED
Production/exact raw deductions: PASS / FAIL / BLOCKED
Paninda/listing: PASS / FAIL / BLOCKED
Benta/checkout/receipt: PASS / FAIL / BLOCKED
Product-lot/scalar agreement: PASS / FAIL / BLOCKED
Home/Kita refresh: PASS / FAIL / BLOCKED
Restart persistence: PASS / FAIL / BLOCKED
Countable pcs guard: PASS / FAIL / BLOCKED
```
