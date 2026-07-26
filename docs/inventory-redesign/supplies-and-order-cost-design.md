# Supplies and order-cost design

## Domain placement

A supply or packaging item is a `catalog_items` record classified `supply_packaging` with an exact Ingredient binding. It uses proven Ingredient lots and movements when stock tracking is enabled.

Supply categories:

- packaging;
- utensil;
- condiment;
- disposable;
- cleaning supply;
- other consumable.

A supply can have optional cost, unit, low-stock threshold, `track_stock`, lifecycle, and default rules. It is not an ordinary sale Product, recipe output, or Kiosk tile. A separately supported customer charge would require an explicit Product/charge design and is not implied here.

Recipe-level packaging consumed during production may be an immutable recipe-version line. Order-level supplies used when handing over a sale are controlled by supply usage rules and recorded at checkout. The two paths remain distinguishable.

## Rule model

`supply_usage_rules` is versioned/audited and contains:

- supply catalog item and Ingredient binding;
- scope;
- optional target Product or recipe version;
- trigger quantity and suggested supply quantity;
- supply unit;
- behavior;
- business/branch scope;
- effective/archived timestamps; and
- cost/stock warnings.

Scopes:

- `per_product`: for each target Product, such as one wrapper per Musubi;
- `per_quantity`: ceiling groups, such as one pair of chopsticks per two Musubi;
- `per_order`: one bag or tissue for the whole order.

Behaviors:

- `required`: automatically included and cannot be removed below the calculated minimum;
- `default_editable`: included but seller may edit or remove;
- `suggested_optional`: visible suggestion, seller chooses;
- `requested_only`: absent until the seller adds it.

Rules produce suggestions only. The reviewed actual quantities become the checkout input and durable evidence.

## Suggestion calculation

1. Batch-load active rules for all cart Product IDs plus order rules.
2. Calculate each rule independently from current cart quantities.
3. Aggregate the same supply/unit across rules while preserving rule contributions and required minima.
4. Apply the seller's persisted review edits.
5. Display required, default, suggested, and requested-only behavior clearly.
6. Validate known available stock without mutating it.

Per-quantity rules use an explicit rounding rule, normally:

```text
suggested = ceil(product quantity / trigger quantity) × supply quantity
```

The rule stores that behavior; no implicit formula is inferred from labels.

## Kiosk review state

The current cart remains in `kioskStore`. Extend it with:

- supply review lines;
- required minima and rule contribution IDs;
- last cart revision reviewed; and
- review completion bound to the existing checkout token.

Changing a cart Product invalidates the review and recalculates suggestions. `clearCart` clears supply state and rotates the checkout token. UI state is not accounting evidence; only the atomic checkout writes actual usage.

The new route is:

```text
/kiosk/sell
  → /kiosk/review-order
  → /kiosk/checkout
```

The review screen edits Product quantities and supplies. The existing checkout remains focused on discount, payment, confirmation, and receipt.

## Checkout input and validation

Checkout receives:

- existing cart lines and snapshots;
- existing checkout token;
- reviewed supply lines with quantity/unit;
- contributing rule IDs and required minimum;
- cart/review revision; and
- cost category.

Before writing:

- token lookup returns an already committed sale immediately;
- cart and review revisions must match;
- required minima must be satisfied;
- quantities must be finite and non-negative;
- supply item, unit, lifecycle, and context must be valid;
- tracked stock must have sufficient explicit lot allocations; and
- untracked supply remains recorded with a cost snapshot but is not deducted.

## Atomic checkout extension

Supply planning and candidate reads occur before the write transaction. The existing exclusive checkout transaction is extended to:

1. Recheck checkout-token idempotency.
2. Revalidate Products, Product stock, reviewed rules, supply lots, and allocations.
3. Create the sale and sale items.
4. Apply existing prepared Product deductions and cook-upon-order logic, with guarded results checked.
5. Insert exact Product/Ingredient COGS snapshots.
6. Deduct every tracked supply lot with guarded updates.
7. Insert supply movement, `sale_supply_usages`, and lot-usage rows.
8. Create receipt and offline queue records.
9. Complete the token-backed sale.

Any failure rolls back sale, Product/Ingredient/supply quantities, all movements/usages, receipt, queue row, and token result. Retrying a committed token returns the existing sale and never recalculates or rededucts supplies.

The existing cook-upon-order unchecked Ingredient-lot update is a blocker for extending checkout and must be corrected with regression coverage before supply deductions ship.

## Cost categories

Persist exact, unrounded supply contributions and classify them as:

- packaging cost;
- utensil and condiment cost; or
- other supply cost.

Order reporting presents:

```text
Product COGS
Packaging cost
Utensil and condiment cost
Other supply cost
Total order cost
```

These values remain separate from Product COGS in storage and reporting. Optional receipt display may summarize supplies, but omitting them from customer-facing output does not remove accounting evidence.

## Shortage behavior

- The review screen warns before payment.
- Required tracked supply shortage blocks confirmation unless the owner changes the rule/item in owner mode.
- Optional supply shortage allows removal or quantity reduction.
- Untracked supplies warn that stock is not monitored.
- Seller mode cannot create a lot, change cost, archive a supply, or override a required minimum.

## Missing costs

A supply with unknown unit cost can be defined, stocked, suggested, and recorded. Checkout marks supply cost incomplete; it never fabricates a zero-known cost. Missing Prices offers the owner a focused correction path.

## Required checks

- all three rule scopes and four behaviors;
- rule aggregation and required minima;
- cart change invalidates prior review;
- optional edit/removal and required protection;
- tracked/untracked supply behavior;
- shortage;
- exact split-lot deduction and cost categories;
- checkout failure rollback;
- same-token retry with no duplicate sale, usage, movement, receipt, queue, or deduction;
- owner/Kiosk capability boundary; and
- report and receipt regression.
