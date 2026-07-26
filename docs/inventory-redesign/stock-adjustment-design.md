# Stock adjustment design

## Objective

Inventory mismatches are recorded as auditable movements. The app must not fix a mismatch by deleting an item/lot or overwriting a quantity without a reasoned history event.

## Reasons and accounting classification

| Owner-facing reason | Movement/accounting class | Product COGS? |
| --- | --- | ---: |
| Personal or household use | Owner withdrawal | No |
| Spoilage | Inventory loss / spoilage | No; reported separately |
| Damaged | Inventory loss / damage | No; reported separately |
| Expired | Inventory loss / expiry | No; reported separately |
| Free sample or promotion | Promotional usage | No; separate promotion cost |
| Counting correction | Stock variance | No |
| Lost or missing | Review-required variance | No |
| Returned to supplier | Supplier return | No; separate return value |
| Other | Owner-selected review category plus note | No unless a future explicit rule says otherwise |

Existing finished-product spoilage behavior remains recognized by reports. New structured categories extend reporting without reclassifying historical movements.

## Entities

`stock_adjustments` is the immutable header:

- business/branch and owner authorization context;
- subject kind and Product/Ingredient ID;
- optional selected lot;
- reason code and required note rules;
- requested operation (`delta`, `set_count`, or `mark_empty`);
- recorded before, entered after, and delta quantities/units;
- accounting class;
- created timestamp; and
- idempotency/request token for local double-submit protection.

`stock_adjustment_allocations` records each affected Ingredient or Product lot:

- lot kind/ID;
- before quantity;
- signed delta;
- after quantity;
- unit/conversion snapshot; and
- linked movement ID.

Existing `ingredient_movements` or `inventory_movements` remains the stock ledger. The adjustment header supplies structured audit context; it does not replace movement rows.

## Adjust stock flow

1. Owner access is required.
2. Load current stock and relevant lots.
3. Owner enters counted quantity or delta and chooses a reason.
4. Show before, after, difference, accounting treatment, and affected lots.
5. Require a note for `Other` and review-required loss.
6. Confirm once.
7. Execute the adjustment transaction.
8. Show the immutable audit result.

Direct stock editing in the item-definition form is removed from the native target workflow. The compatibility path remains only until all callers use the adjustment service.

## Mark Stock as Empty

The action:

- shows recorded remaining quantity;
- requires an owner-selected reason;
- supports one selected lot or all stock for one item/context;
- allocates the full remaining quantity as negative adjustments;
- writes movement and adjustment evidence;
- sets quantities to zero through guarded domain updates; and
- never deletes or archives the item or lot.

For total Ingredient/supply stock, all positive compatible lots are included. For Product stock, all active Product lots plus the compatibility scalar balance must reconcile before the action proceeds.

## Atomic transaction

An exclusive transaction:

1. Validates owner/business/branch and request-token uniqueness.
2. Re-reads current quantities.
3. Resolves and validates explicit allocations.
4. Inserts the adjustment header.
5. Applies each guarded lot or scalar update.
6. Inserts each stock movement and allocation row.
7. Updates lot status when remaining quantity reaches zero.
8. Updates Product scalar compatibility stock where applicable.
9. Updates low-stock alert state.

Any failure rolls back the header, all quantities, movements, statuses, and alerts. Every update checks affected-row count. Retrying the same committed token returns the original adjustment and makes no second deduction.

## Bounds and units

- Remaining quantity cannot fall below zero beyond the shared tolerance.
- Ingredient lot remainder cannot exceed purchased quantity unless a separately supported return/recount rule explicitly permits it.
- Set-count and mark-empty use current database values, not stale UI values.
- Unit conversion must be same-family or an owner-configured Item conversion with a snapshot.
- A positive correction does not fabricate a purchase lot/cost. It creates an adjustment-origin lot or an explicitly cost-incomplete balance according to item kind.

## Reporting

Profit/report queries keep categories distinct:

- sold Product COGS;
- packaging;
- utensil/condiment;
- spoilage/damage/expiry;
- promotion;
- owner withdrawal;
- stock variance;
- supplier return; and
- fixed costs.

Owner withdrawal and counting correction must never enter Product COGS. Historical report behavior is preserved for old movement types.

## Archive/delete interaction

An adjustment creates history. After any adjustment:

- permanent delete is denied;
- archive remains allowed;
- the item and lot remain resolvable in history; and
- mark-empty does not imply archive.

## Required checks

- each reason maps to the documented class;
- personal use does not contaminate COGS;
- spoilage remains in its established report category;
- counting correction and unknown loss stay separate;
- one-lot and all-lot mark-empty;
- product and ingredient/supply adjustment;
- owner gate;
- stale quantity and overconsumption rejection;
- request retry idempotency;
- failure injection after every material write; and
- preserved movement/history visibility after archive.
