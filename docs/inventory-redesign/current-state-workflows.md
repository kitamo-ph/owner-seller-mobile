# Current-state workflows

## Scope and evidence

This document records the implemented Owner Inventory, Grocery, Recipes, Production, and Kiosk experience before the redesign. It is a Phase A code audit, not a schema prescription or implementation authorization.

The findings come from the current Expo Router routes, screen components, services, repositories, Zustand stores, and the accepted MOB-0/MOB-1 evidence. No runtime data or production database was opened. The app was not started for this audit, so visual polish, physical-device performance, focus movement, screen-reader output, and contrast remain manual-verification items.

The target terminology and lifecycle are defined in [target-user-model.md](target-user-model.md). Persistence compatibility is covered separately in [domain-compatibility-map.md](domain-compatibility-map.md).

## Current navigation and labels

Owner and Kiosk both use flat Expo Router stacks:

- Owner registers `inventory`, `grocery`, `recipes`, `recipe-detail`, `production`, and `transfers` as separate screens in [`app/owner/_layout.tsx`](../../app/owner/_layout.tsx#L39).
- Kiosk registers `sell`, `checkout`, `orders`, `stock`, and `shift` in [`app/kiosk/_layout.tsx`](../../app/kiosk/_layout.tsx#L39).
- Owner screens use `ScreenScroll` for the context bar, safe-area handling, and bottom navigation.
- Kiosk screens use the same shell with the Kiosk context bar and Kiosk bottom navigation.

The current Owner navigation uses overlapping labels:

| Surface | Current labels | Evidence |
| --- | --- | --- |
| Owner bottom navigation | Home, Tindahan, BENTA, Kita, Ako | [`KitaMoUI.tsx`](../../src/components/ui/KitaMoUI.tsx#L421) |
| Tindahan segmented control | Paninda, Grocery, Recipes | [`TindahanTabs.tsx`](../../src/components/owner/TindahanTabs.tsx#L5) |
| Home quick actions | Benta, Grocery, Paninda, Recipe, Niluto, Bayarin, Reports | [`app/owner/index.tsx`](../../app/owner/index.tsx#L46) |
| Inventory heading | Paninda | [`app/owner/inventory.tsx`](../../app/owner/inventory.tsx#L378) |
| Recipe heading | Tindahan, with a `Bili → Timpla → Presyo → Luto → Paninda → Benta` subtitle | [`app/owner/recipes.tsx`](../../app/owner/recipes.tsx#L507) |
| Production heading | Niluto / Production | [`app/owner/production.tsx`](../../app/owner/production.tsx#L238) |

The same words therefore refer to a navigation group, an item catalog, sellable stock, and a production action. A beginner cannot infer clear ownership from the labels alone.

## Current workflow map

```text
Owner Home
├── Grocery
│   └── Add purchase lot
├── Paninda
│   ├── Add or edit product, stock, cost, price, and bundle
│   ├── Manual cooked stock
│   ├── Spoilage
│   └── Transfer
├── Recipe
│   ├── Select an existing Paninda output
│   ├── Add exact Grocery lots or custom costs
│   ├── Review cost
│   └── Save recipe
├── Niluto / Production
│   ├── Select stall
│   ├── Select prepared recipe
│   ├── Enter produced quantity
│   ├── Preview exact saved-lot deductions
│   └── Commit production
└── BENTA
    ├── Select and confirm stall
    ├── Add products to cart
    ├── Bayad: review cart, discount, and payment
    └── Complete sale and show receipt
```

## Paninda: product definition, pricing, and stock

The current Paninda screen is both catalog editor and stock-control surface.

### Creation and editing

- Product classifications are limited to `retail item`, `cooked food`, `ingredient-based item`, and `service/other` in [`app/owner/inventory.tsx`](../../app/owner/inventory.tsx#L23).
- One form owns name, category, product type, unit, scalar stock, low-stock threshold, selling price, unit cost, and bundle quantity/price/label in [`app/owner/inventory.tsx`](../../app/owner/inventory.tsx#L605).
- Blank numeric inputs become zero through the required-number parser. A new Product is immediately written with `active: true` in [`app/owner/inventory.tsx`](../../app/owner/inventory.tsx#L133).
- Editing scalar stock calls the Product repository directly when the displayed quantity changes in [`app/owner/inventory.tsx`](../../app/owner/inventory.tsx#L195). The form does not ask for an adjustment reason.

### Operational actions

Each product action sheet combines:

- `Dagdag luto (walang recipe)`;
- finished-product spoilage;
- transfer to another stall; and
- product editing.

The actions are defined in [`app/owner/inventory.tsx`](../../app/owner/inventory.tsx#L950). The recipe-free cooked action warns that it directly adds finished stock and does not deduct ingredients. Product spoilage records only the finished-product stock-out path. There is no general personal-use, counting-correction, promotion, damaged, expired, or mark-empty flow.

### Current user impact

- Item identity, sellability, purchasing, pricing, and stock are presented as one operation.
- Missing selling price and a known zero price are visually indistinguishable after save.
- An unfinished conceptual item cannot be saved as a draft.
- Direct stock editing competes with the movement-led adjustment model.
- Bundle pricing is embedded in every product form even when the item is not a bundle.

## Grocery: purchase lots and exact cost

The Grocery screen is the strongest current explanation of purchase-lot provenance.

### Purchase flow

1. Open `Dagdag bili`.
2. Enter a grocery-item name, quantity, unit, and total cost.
3. Optionally enter brand, source, date, threshold, and notes.
4. Save one traceable lot.

The purchase sheet and its lot-exact explanation are in [`app/owner/grocery.tsx`](../../app/owner/grocery.tsx#L515). Existing lots are grouped by Ingredient but remain separate, with remaining quantity, remaining value, exact cost, purchase date, source, and recipe-usage count in [`app/owner/grocery.tsx`](../../app/owner/grocery.tsx#L449).

### Current restrictions

- Quantity must be positive.
- Total purchase cost must also be positive; a missing cost blocks saving in [`app/owner/grocery.tsx`](../../app/owner/grocery.tsx#L180).
- Source is a free-form purchase location, not a Supplier entity.
- There is no receipt identifier, expiry field, missing-price center, direct-recipe shopping list, complete-tree shopping list, or selected-stage shopping list.
- The screen starts from a purchase. It cannot define an ingredient that has not yet been bought.

### Current user impact

The lot model is visible and trustworthy, but Grocery is not optional in the experience. A beginner must record a priced lot before that item can participate in the stock-backed recipe flow.

## Recipes: output Product plus exact-lot cost lines

Recipes are created through a full-screen, three-step modal.

### Current three steps

1. `Ano ang gagawin?`
   - Select an existing Product as output.
   - Enter recipe name, output quantity/unit, production mode, and notes.
2. `Mga sangkap`
   - Add an exact Grocery lot and quantity, or add a custom cost.
3. `Suriin ang recipe`
   - Review line snapshots, batch cost, unit cost, estimated profit, and makeable quantity.

The modal and its steps are in [`app/owner/recipes.tsx`](../../app/owner/recipes.tsx#L715).

### Draft behavior

All editor fields and draft lines are component-local React state in [`app/owner/recipes.tsx`](../../app/owner/recipes.tsx#L52). Closing a non-empty editor offers only `Continue editing` or destructive `Discard` in [`app/owner/recipes.tsx`](../../app/owner/recipes.tsx#L344).

When the output Product is missing, the flow closes and resets the builder before opening Paninda. When a Grocery lot is missing, it similarly closes and resets before opening Grocery. These exits are in [`app/owner/recipes.tsx`](../../app/owner/recipes.tsx#L756) and [`app/owner/recipes.tsx`](../../app/owner/recipes.tsx#L875).

There is no:

- SQLite-backed draft;
- resume after interruption;
- nested item or prepared-base creation;
- unresolved-requirement placeholder;
- parent-child return context; or
- safe recovery after process restart.

### Ingredient representation in the current UI

- A stock-backed line selects one exact IngredientLot and saves quantity, unit, cost, and source snapshots.
- A custom line saves a positive batch cost but does not deduct stock or constrain makeable quantity.
- Recipe definitions cannot reference another Recipe output.
- Selecting the displayed cheapest lot is encouraged, but the chosen purchase lot then remains part of the recipe definition.

This couples “how the item is made” to “which purchase lot happened to exist when the recipe was entered.”

### Lifecycle actions

The list provides:

- read-only detail;
- `Magluto` for prepared-before-selling recipes; and
- Archive.

The actions are in [`app/owner/recipes.tsx`](../../app/owner/recipes.tsx#L665). The detail screen explains saved cost snapshots but has no edit, rename, duplicate, version, or restore action in [`app/owner/recipe-detail.tsx`](../../app/owner/recipe-detail.tsx#L100).

## Niluto / Production: single-level immediate production

The current production flow is an immediate operational transaction rather than a saved plan.

### Current flow

1. Explicitly select the destination stall.
2. Select an active `prepared_before_selling` recipe.
3. Enter the quantity actually produced.
4. Preview scaled deductions from the exact lots stored on the recipe.
5. Review the output stock increase and total cost.
6. Confirm the transaction.
7. Optionally open Kiosk for the same stall.

The selection sequence is in [`app/owner/production.tsx`](../../app/owner/production.tsx#L302). Planning calls the single-level `planProduction` calculation over the recipe’s current lines in [`app/owner/production.tsx`](../../app/owner/production.tsx#L122). The final confirmation is in [`app/owner/production.tsx`](../../app/owner/production.tsx#L550).

### Strengths

- Explicit stall selection protects operational scope.
- A preview shows before/after lot quantities.
- Unit incompatibility and insufficient selected-lot stock block production.
- The review sheet repeats the exact deductions and output.
- The UI explains that deduction, output, movements, and cost snapshot are one SQLite transaction.
- Recent batches are visible after completion.

### Current limitations

- Target quantity and actual output are the same field.
- No plan is saved.
- No nested recipe graph is expanded.
- No preparation order or intermediate stage is shown.
- Existing prepared-base stock cannot satisfy a child stage because prepared bases do not exist in this model.
- The owner cannot choose a different lot or split across lots at production time.
- There is no expected-versus-actual yield capture or downstream recalculation.
- Production history is a short recent list, not a navigable operational record.

## Kiosk: established sale flow

### Stall boundary

Kiosk entry clears the previous session, requires an explicit active-stall selection, switches the saved context, and confirms the transient Kiosk session before opening sales. This flow is in [`app/kiosk/index.tsx`](../../app/kiosk/index.tsx#L49).

### Product selection and cart

The established Kiosk selling surface provides:

- branch-context heading;
- search;
- category, favorite, and recent filters;
- two-column product tiles;
- bundle labels;
- made-to-order labels;
- stock warnings;
- cart quantity steppers; and
- a persistent total/`Bayad` action.

The product grid is in [`app/kiosk/sell.tsx`](../../app/kiosk/sell.tsx#L210), and cart editing is in [`app/kiosk/sell.tsx`](../../app/kiosk/sell.tsx#L285). These are considered successful existing patterns and are not broad-redesign targets.

### Current Kiosk eligibility

`loadKioskContext` currently filters Products only by branch or business-wide scope in [`src/services/kioskSales.ts`](../../src/services/kioskSales.ts#L151). `listProductsForBusiness` returns every non-deleted Product without an `active` predicate in [`src/db/repositories/products.ts`](../../src/db/repositories/products.ts#L217).

The current model has no explicit:

- sellable flag;
- Kiosk-enabled flag;
- draft/readiness state;
- known-selling-price state; or
- prepared-base/supply exclusion.

### Checkout

`Bayad` currently displays a read-only cart summary, discount, payment method, reference number, optional cash tender, change, and the final `Kumpirmahin ang Benta` action in [`app/kiosk/checkout.tsx`](../../app/kiosk/checkout.tsx#L216).

The seller cannot edit product quantities on this screen and cannot review or edit supplies. Checkout nevertheless has valuable patterns to preserve:

- one existing checkout token;
- duplicate-tap guard;
- payment validation;
- concise disabled reason;
- offline confirmation;
- receipt/share state; and
- clear new-sale navigation.

## Current state ownership

| State | Current owner | Persistence |
| --- | --- | --- |
| Business/stall context and application mode | Zustand `appStore` plus Owner setup service | IDs are reloaded from SQLite settings; the store is transient |
| Owner access state | Zustand `ownerAccessStore` | Protection preference is hydrated; unlock state is transient |
| Kiosk cart, checkout token, shift display state, and last receipt | Zustand `kioskStore` | Volatile until successful checkout |
| Recipe builder | Local component state | Not persisted |
| Grocery purchase form | Local component state | Not persisted before save |
| Production selection and review | Local component state | Not persisted before commit |
| Favorite and recent Product IDs | Kiosk preferences service | SQLite app settings |

No Inventory, Grocery, Recipe, or Production screen imports the SQLite client directly. Screens use services and repositories and generally reload data with `useFocusEffect`. The target should preserve that boundary: durable drafts and plans belong in SQLite, not in a new long-lived Zustand editor store.

## Shared UI patterns

Reusable strengths include:

- `ScreenScroll` for context, safe areas, and bottom navigation;
- `AppTopBar`;
- `GabiCard` and `GabiSectionHeader`;
- `GabiField`;
- `GabiRadioRow` and segmented controls;
- primary and soft buttons;
- status chips;
- notices, empty states, skeletons, and snackbars;
- existing theme tokens and Ionicons.

Shared fields use programmatic labels and 48-pixel minimum height. Shared primary and soft buttons expose accessibility role and disabled/busy state and have at least 44-pixel targets. Skeleton animation checks the platform reduced-motion preference.

Current interaction-size risks include:

- the shared segmented-control segment at 38 pixels in [`GabiControls.tsx`](../../src/components/gabi/GabiControls.tsx#L173);
- Kiosk filter chips at 38 pixels in [`app/kiosk/sell.tsx`](../../app/kiosk/sell.tsx#L497); and
- checkout choice chips at 42 pixels in [`app/kiosk/checkout.tsx`](../../app/kiosk/checkout.tsx#L452).

Dynamic notices generally do not declare a live region. Route and step changes do not explicitly move accessibility focus.

## Pain-point summary

| ID | Current pain point | Beginner impact | Target direction |
| --- | --- | --- | --- |
| UX-CURRENT-001 | Tindahan, Paninda, Recipe, and Niluto overlap | The owner cannot remember which section owns which task | Paluto, Grocery, Paninda, Kiosk mental model |
| UX-CURRENT-002 | Product must exist before its recipe | Definition begins with sale-stock administration | Unified Paluto draft starts from the item idea |
| UX-CURRENT-003 | Priced lot is effectively required before stock-backed recipe creation | Grocery is not optional | Recipe references stable items; purchase facts remain optional |
| UX-CURRENT-004 | Draft is volatile and discard-only | Back, navigation, restart, or nested creation loses work | SQLite autosave and Drafts |
| UX-CURRENT-005 | Recipe line selects a purchase lot | Definition and fulfillment are conflated | Paluto selects stable component; Paninda allocates lots |
| UX-CURRENT-006 | Price blank becomes zero and Product is active on creation | Incomplete item may appear sale-like | Explicit missing-price and readiness signals |
| UX-CURRENT-007 | No recipe edit/duplicate/version flow | Owner must recreate or archive | Immutable versions and copy/edit actions |
| UX-CURRENT-008 | Production has no saved target/actual stages | Multi-stage preparation cannot be managed | Saved planner and staged run |
| UX-CURRENT-009 | Stock definition and correction are mixed | Quantity changes lack clear reason and accounting intent | Reason-led Adjust Stock and Mark Empty |
| UX-CURRENT-010 | Kiosk jumps from cart to payment | Actual packaging and utensils are not reviewed | One minimal order-review step |

## Patterns that must remain recognizable

- Owner Home financial and stall experience.
- Explicit Kiosk stall confirmation and session boundary.
- Core Kiosk product grid, favorites, recents, cart, and payment interaction.
- Separate Grocery lots and cost/source history.
- Recipe and production cost snapshots.
- Explicit production stall selection.
- Before/after deduction preview and confirmation.
- Offline-first local persistence and `useFocusEffect` refresh behavior.
- Existing Gabi theme, typography, spacing, cards, fields, notices, and controls.
- Owner-only access to administrative stock, recipe, costing, lot, and production actions.

The target route and interaction design is recorded in [ux-flow-map.md](ux-flow-map.md).
