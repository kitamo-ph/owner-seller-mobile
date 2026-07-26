# Target user model

## Purpose

The redesign gives a beginner four distinct questions to answer:

| Area | Beginner question | Owns |
| --- | --- | --- |
| Paluto | What is it, and how is it made? | Item definitions, recipes, classifications, drafts, lifecycle, selling intent, and supply defaults |
| Grocery | What did I buy, and how much did it cost? | Optional purchasing detail, lots, suppliers, receipts, expiry, missing purchase costs, and recipe shopping lists |
| Paninda | What did I actually prepare today? | Production plans, staged preparation, actual consumption, actual yield, output stock, and production history |
| Kiosk | What am I selling now? | Cart, final order review, actual supplies, payment, and the existing atomic checkout |

Home remains the existing owner landing experience. It may receive a small label or link correction, but it is not a redesign target. The core Kiosk sale and checkout flow also remains intact apart from the required order-review step.

## Six owner-facing classifications

The six classifications live in an additive `catalog_items` semantic profile. Explicit `legacy_item_bindings` preserve and connect every existing Product or Ingredient identity; neither legacy table is replaced or merged by name.

| Classification | Persisted compatibility side | Purchased | Produced | Normally sellable | Normally shown in Kiosk |
| --- | --- | ---: | ---: | ---: | ---: |
| Purchased ingredient | Catalog item bound to `ingredients` | Yes | No | No | No |
| Prepared ingredient or base | Catalog item with a stock-bearing Product projection and recipe | No | Yes | Only by explicit choice | No |
| Finished product | Catalog item with a Product projection, usually plus a recipe | Sometimes | Usually | Yes when ready | Only when explicitly enabled |
| Product for direct resale | Catalog item with a Product projection and native purchase lots | Yes | No | Yes when ready | Only when explicitly enabled |
| Bundle or combo | Catalog item bound to existing Product bundle fields | Depends on current Product | No new component semantics in this scope | Yes when ready | Only when explicitly enabled |
| Supply or packaging | Catalog item bound to `ingredients` and Ingredient lots | Yes | No | Normally no | Never as an ordinary product |

An internal `legacy_unclassified` compatibility state is required during upgrade. It is not presented as a seventh classification. It means the app lacks enough evidence to choose one of the six without owner review.

## Lifecycle and readiness

Lifecycle and readiness are separate:

| State or signal | Meaning |
| --- | --- |
| Draft | Incomplete, mutable work. Never eligible for Kiosk or production. |
| Ready | Definition is complete for its intended next action. A recipe may be ready for production without being ready for sale. |
| Active | Available in the relevant owner workflow. |
| Archived | Retained for history and excluded from normal selection. |
| Produced | Actual stock was created by a committed production batch; it is an event, not a definition state. |
| Ready for production | A published recipe version has valid components, yields, units, and no invalid dependency. |
| Ready for sale | Sellable is explicit, selling-price completeness is satisfied, and required sale configuration is valid. |
| Available in Kiosk | Ready for sale, Kiosk-enabled, branch-applicable, active, and not archived. |

Saving never implies publishing, producing, selling, or enabling in Kiosk.

## Prices and costs

- Purchase cost is optional when defining an ingredient, resale product, or supply.
- Selling price is optional when saving a product or recipe.
- Missing purchase cost makes costing incomplete; it does not fabricate a zero cost.
- Missing selling price prevents the `Ready for sale` state.
- A known zero and an unknown value must be distinguishable. New completeness flags provide that distinction because legacy `REAL NOT NULL DEFAULT 0` columns cannot.
- Production is allowed with incomplete optional cost information only after a visible warning. Historical records must retain whether their cost was complete.
- Grocery is a convenient editor for purchase facts, but it does not become the owner of recipe or selling-price data.

## Creation flow

Paluto uses a short, resumable flow:

1. Name the item.
2. Add components or identify it as purchased/direct resale.
3. Enter expected yield when it is prepared.
4. Enter optional costs and selling price.
5. Choose the classification last.
6. Review readiness, sellable status, and Kiosk status separately.
7. Save as draft or publish.

Autosave persists to SQLite after a debounce and on blur, Back, navigation to nested creation, and app backgrounding. A draft revision prevents stale asynchronous writes from overwriting a newer edit.

When a missing component is created, the parent draft and placeholder line are saved before navigation. The child editor receives a persisted return context. Saving the child resolves the placeholder and returns to the parent, including after process restart.

## Archive and permanent delete

Archive is the normal removal operation for anything with history. Archived records remain resolvable by sales, production batches, recipe versions, cost snapshots, reports, lots, and movements.

Permanent delete is a narrow owner-only operation. It is allowed only for a draft or unused record after a fail-closed reference check confirms:

- no purchase or lot;
- no production;
- no sale;
- no movement or adjustment;
- no recipe, recipe-version, bundle, or supply-rule reference; and
- no other historical dependency.

The check and delete execute in one exclusive transaction. A missing or failed reference check denies deletion. Existing cascade behavior is never used as an authorization mechanism.

## Beginner guidance

Each primary screen uses:

- one primary action;
- a short explanation card;
- plain-language status chips;
- examples under unfamiliar fields;
- a visible “What should I do next?” action;
- safe Back behavior and autosave feedback;
- large touch targets and existing lightweight components; and
- no blocking tutorial, large dependency, heavy animation, or network requirement.

## Compatibility rules

1. Existing identifiers remain unchanged.
2. Existing Product and Ingredient rows remain authoritative compatibility records and retain explicit catalog bindings.
3. Existing Kiosk visibility remains in legacy compatibility mode until the owner classifies a record; migration does not guess.
4. Newly created records default to not sellable and not Kiosk-enabled.
5. Existing bundle price arithmetic and stock interpretation remain unchanged.
6. Existing selected-lot recipe lines remain selected-lot lines.
7. Product scalar stock remains the compatibility availability authority during transition. Product lot evidence is enabled only for native or owner-reviewed records and must reconcile in every dual-write transaction.
8. Native prepared/finished Product projections cannot be created until the Kiosk compatibility predicate is deployed; otherwise the legacy query would expose non-sellable records.
9. Draft, lifecycle, price-completeness, and explicit availability rules apply natively to newly created or owner-reviewed catalog records.

See [domain-compatibility-map.md](domain-compatibility-map.md) for persistence ownership and [ux-flow-map.md](ux-flow-map.md) for route behavior.
