# UX flow map

## Design objective

The redesigned experience teaches four durable questions:

```text
Paluto  — Ano ito, at paano ginagawa?
Grocery — Ano ang binili ko, at magkano?
Paninda — Ano ang ihahanda o ginawa ko ngayon?
Kiosk   — Ano ang ibinebenta ko ngayon?
```

The six classifications, lifecycle rules, and readiness language are defined in [target-user-model.md](target-user-model.md). This document maps those concepts onto the current flat Expo Router architecture without replacing the app shell, Home, or the core Kiosk selling surface.

## Navigation strategy

### Compatibility-first route policy

Route paths are implementation details and are not currently exposed as product language. The first safe implementation should therefore reuse existing route identities where possible:

| User-facing area | Compatibility route | Target role |
| --- | --- | --- |
| Paluto | `/owner/recipes` | Recipe Book and unified item-definition hub |
| Paluto detail | `/owner/recipe-detail` | Unified item, readiness, recipe, and history detail |
| Grocery | `/owner/grocery` | Purchase lots, shopping requirements, and missing prices |
| Paninda | `/owner/production` | Production landing and planner entry |
| Legacy product inventory | `/owner/inventory` | Compatibility/internal stock path during transition |
| Kiosk selling | `/kiosk/sell` | Existing product grid and cart |
| Kiosk payment | `/kiosk/checkout` | Existing payment and final checkout |

Existing route identities avoid unnecessary deep-link, Back, test, and breadcrumb breakage. New flat routes should be added only for new durable tasks.

### Owner bottom navigation

Keep the existing five-slot shape:

```text
Home | Paluto | BENTA | Kita | Ako
```

Changes are limited to:

- rename the current `Tindahan` label to `Paluto`;
- point it to `/owner/recipes`;
- treat Paluto, Grocery, Paninda, drafts, plans, stock adjustments, and related details as one active navigation group; and
- leave Home, BENTA, Kita, and Ako behavior intact.

### Owner workflow tabs

Replace the current `Paninda | Grocery | Recipes` order with:

```text
Paluto | Grocery | Paninda
```

The control appears on the three landing screens only:

- Paluto → `/owner/recipes`
- Grocery → `/owner/grocery`
- Paninda → `/owner/production`

This is the repeatable beginner model. The conceptual subsections under each area should be list filters, menu cards, or focused routes rather than nine cramped top tabs.

### Minimal Home change

Preserve the existing greeting, financial hero, stall cards, alerts, recent sales, and BENTA behavior. Change only the inventory-workflow quick actions:

```text
Paluto
Grocery
Paninda
```

Remove the current duplicate user-facing split between `Paninda`, `Recipe`, and `Niluto`.

## Target route map

```text
Owner
├── Home                                      /owner
├── Paluto                                    /owner/recipes
│   ├── Recipe Book and classification views
│   ├── Create or resume draft                /owner/paluto-editor?draftId=…
│   ├── Detail                                /owner/recipe-detail?itemId=…
│   ├── Drafts                                /owner/paluto-drafts
│   └── Archived                              /owner/paluto-archived
├── Grocery                                   /owner/grocery
│   ├── Add Purchased Stock                   existing sheet or focused action
│   ├── Shop by Recipe                        /owner/grocery-shop
│   └── Missing Prices                        /owner/grocery-missing-prices
├── Paninda                                   /owner/production
│   ├── Production Planner                    /owner/production-plan
│   ├── Saved Plan / Production Run           /owner/production-run?planId=…
│   ├── Production History                    /owner/production-history
│   └── Adjust Stock / Mark Empty              /owner/stock-adjustment
├── Kita                                      existing routes
└── Ako                                       existing routes

Kiosk
├── Select Stall                              /kiosk
├── Sell and Cart                             /kiosk/sell
├── Review Order and Supplies                 /kiosk/review-order
├── Payment and Confirm Checkout              /kiosk/checkout
└── Receipt                                   existing checkout success state
```

If a later release requires semantic Paluto URLs, aliases can be added after the compatibility routes are stable. That rename is not required for the first implementation.

## Paluto landing flow

### First-use state

Show one short dismissible explanation:

> Dito mo ilalagay kung ano ang item at paano ito ginagawa. Puwede munang Draft kahit kulang ang presyo o sangkap.

One primary action is visible:

```text
[Gumawa ng item]
```

Secondary links are Drafts and Archived. Do not display a blocking tutorial.

### Returning state

The landing screen provides:

- search;
- `Recipe Book` as the default view;
- classification filters for Purchased Ingredients, Prepared Bases, Finished Products, Resale Products, Bundles, and Supplies;
- prominent unfinished Drafts;
- status chips; and
- one `Gumawa ng item` action.

Each list row shows only the information needed to choose the next action:

- name;
- classification or `Kailangan pang piliin`;
- lifecycle status;
- readiness warning count; and
- concise stock/price summary when relevant.

Detailed costing, dependency tree, history, and actions belong on the detail route.

## Paluto creation flow

Classification occurs at the end as required. The editor can progressively reveal relevant fields without forcing a premature type decision.

```text
1. Ano ito?
   - Name
   - Basic unit
   - Optional category and example

2. Paano ginagawa?
   - Search existing stable items
   - Add purchased ingredient
   - Add prepared base / child recipe
   - Add supply rule where appropriate
   - Leave an unresolved requirement in Draft

3. Gaano karami ang inaasahang output?
   - Expected yield and unit for prepared items
   - Ingredient-specific conversion where explicitly configured

4. Presyo at paggamit
   - Optional purchase cost
   - Optional selling price
   - Sellable intent
   - Kiosk intent remains off by default

5. Anong uri ito?
   - Six classifications
   - “Hindi pa ako sigurado” keeps Draft

6. Suriin
   - Missing requirements
   - Cost completeness
   - Ready for production
   - Ready for sale
   - Available in Kiosk
   - Save Draft or Publish
```

The editor uses a route, not the current volatile full-screen modal. A persistent footer has one primary action for the current step plus a safe Back action. The header shows `Saved locally` with the last saved time or `Saving…`; it must never imply publication.

### Lifecycle and readiness copy

Keep definition lifecycle separate from operational events:

| Display | Meaning |
| --- | --- |
| Draft | Saved but incomplete; excluded from production and Kiosk |
| Ready | Definition meets its intended next action |
| Active | Available in normal owner selection |
| Archived | Hidden from normal selection; history retained |
| Ready for production | Published version has valid required components and yield |
| Produced | A committed batch exists; event/history signal |
| Ready for sale | Sellable, valid sale configuration, and known selling price |
| Available in Kiosk | Ready for sale, explicitly enabled, active, and branch-applicable |

Saving must not automatically mean Active, Produced, Ready for sale, or Available in Kiosk.

## Durable nested creation and return

Nested creation uses normal Stack pushes and persisted IDs. It never serializes draft form state into route parameters.

### Example route sequence

```text
/owner/paluto-editor?draftId=musubi-draft
  └── missing Sushi Rice:
      /owner/paluto-editor
        ?draftId=sushi-rice-draft
        &returnToDraftId=musubi-draft
        &returnLineId=musubi-sushi-line
          └── missing Cooked Rice:
              /owner/paluto-editor
                ?draftId=cooked-rice-draft
                &returnToDraftId=sushi-rice-draft
                &returnLineId=sushi-cooked-line
```

### Before pushing a child

1. Flush all pending parent edits.
2. Persist a stable unresolved parent line.
3. Create the child draft.
4. Persist the child’s parent draft ID and parent line ID.
5. Push the editor using only stable IDs.

The navigation action fails closed if the parent save fails. It must not open an unlinked child and imply the parent is safe.

### After saving a child

1. Validate and publish or save the child.
2. Resolve the parent placeholder to the child’s stable item or recipe-version ID.
3. Mark the return intent resolved.
4. Navigate Back.
5. Reload the parent from SQLite with `useFocusEffect`.
6. Announce that the child was added.

### Back, interruption, and restart

- Back flushes and saves; it does not show the current destructive discard dialog.
- An unfinished child remains in Drafts and retains its parent relationship.
- After restart, Drafts shows the nested chain and the next unfinished requirement.
- If the child was saved before navigation was interrupted, reopening the parent resolves from persisted IDs.
- A monotonic draft revision prevents an older debounced save from overwriting a newer navigation flush.

The durable data design is specified in [recipe-versioning-design.md](recipe-versioning-design.md), and graph validation is specified in [recipe-graph-design.md](recipe-graph-design.md).

## Paluto detail and actions

The detail screen uses progressive disclosure:

1. identity, classification, and lifecycle;
2. readiness card;
3. current active recipe version and expected yield;
4. collapsed dependency tree;
5. price/cost completeness;
6. stock summary;
7. version and production history; and
8. actions.

Actions:

- Edit as new draft/version;
- Duplicate;
- Rename through a versioned edit;
- Archive;
- restricted permanent Delete; and
- Produce or open Kiosk only when eligible.

Permanent Delete is visually secondary and available only after the fail-closed domain check succeeds. Archive is the default removal path for a used record.

## Grocery flow

### Grocery landing

First-use explanation:

> Optional ang Grocery. Dito mo ilalagay ang binili, lot, presyo, supplier, at resibo kapag gusto mong mas kumpleto ang costing.

Primary action:

```text
[Add Purchased Stock]
```

Focused entry cards:

- Shop by Recipe;
- Missing Prices;
- Suppliers; and
- Optional Receipts.

Preserve the current grouped lot cards and their exact purchase cost/source explanation.

### Add Purchased Stock

1. Search and select an existing Paluto item that can be purchased.
2. If missing, open a minimal Paluto draft and return using the same persisted return pattern.
3. Enter quantity and unit.
4. Optionally enter total cost, supplier, receipt, purchase date, expiry, threshold, and notes.
5. Review whether cost and supplier facts remain incomplete.
6. Save one separate lot.

Quantity and unit are required. Missing purchase cost must display `Wala pang purchase cost`; it must not be fabricated as zero.

### Shop by Recipe

```text
Select recipe and target output
  → Direct requirements
  → Complete recipe tree
  → Selected preparation stage
  → Aggregate repeated purchased inputs
  → Compare against stock
  → Review shopping groups
```

Group results into:

- Already in stock;
- Need to buy;
- Not enough stock;
- No purchase price;
- No supplier; and
- Cost incomplete.

The calculation is read-only. It does not mutate lots, reserve stock, or start production.

### Missing Prices

Group by the owner of the fact:

- purchased ingredients/resale products/supplies missing purchase cost;
- finished or resale products missing selling price;
- recipes with incomplete costing; and
- production plans with incomplete estimated cost.

Each row routes to the correct editor. Grocery may help complete purchase facts, but it must not duplicate ownership of recipe or selling-price fields.

## Paninda flow

### Landing

First-use explanation:

> Dito mo pinaplano at itinatala ang aktwal na inihanda ngayon. Walang stock na mababago habang plano pa lang.

Primary action:

```text
[Planong produksyon]
```

Secondary sections:

- Saved Plans;
- Prepare Intermediate Items;
- Produce Finished Items; and
- Production History.

### Production planner

```text
Select active Paluto recipe version
  → Enter target output
  → Expand bounded dependency graph
  → Choose prepared-stock-first or prepare fresh
  → Show ordered stages
  → Show available stock, shortages, and missing prices
  → Show recommended lots and cost
  → Save Plan, Cancel, or Start
```

The planner:

- never mutates inventory;
- does not silently substitute a newer recipe version;
- keeps repeated raw requirements aggregated while preserving branch provenance;
- collapses nested stages by default;
- shows a readable dependency path;
- reports incomplete prices without blocking plan save; and
- blocks only invalid graph, unit, or required-definition conditions.

The detailed calculation and stage contract belongs in [production-planner-design.md](production-planner-design.md).

### Production run

The saved plan becomes a sequence of focused stage cards:

1. preparation order;
2. expected stage output;
3. exact or manually selected lot allocation;
4. actual consumed quantities;
5. actual output;
6. variance and available remainder;
7. downstream shortfall;
8. reduce final target or continue; and
9. final transaction review.

Only the active stage editor is expanded. Completed and future stages remain compact to protect low-end rendering.

The current production strengths remain:

- explicit stall selection;
- clear before/after lot quantities;
- exact cost preview;
- review before commit;
- atomicity explanation; and
- clear success state.

### Stock adjustment

The product definition form no longer edits scalar stock without explanation. `Adjust Stock` and `Mark Stock as Empty` use a focused owner-only route:

```text
Select item and optional lot
  → Show recorded quantity
  → Enter counted quantity or choose Mark Empty
  → Select reason
  → Show difference and accounting category
  → Confirm movement-led adjustment
```

Reason choices use the approved taxonomy. Personal use must be visibly distinguished from product COGS and spoilage.

## Minimal Kiosk order review

The core Kiosk grid and cart remain unchanged. Only the cart CTA and route sequence change.

### Sell screen

Change the floating CTA from:

```text
Bayad
```

to:

```text
Suriin ang order
```

It pushes `/kiosk/review-order`. Product tiles, filters, favorites, recents, bundle labels, made-to-order labels, cart steppers, and total remain as implemented.

### Review Order screen

```text
Order
Musubi × 3                     [−] 3 [+]
Soft Drink × 2                [−] 2 [+]

Supplies
Plastic Bag × 1               [−] 1 [+]
Chopsticks × 2                [−] 2 [+]
Ketchup Packet × 3            [−] 3 [+]

[Magdagdag ng supply]
[Kumpirmahin at magbayad]
```

Behavior:

- Recalculate suggestions when product quantities change.
- Preserve seller overrides for the same checkout token.
- Label required packaging and explain why it cannot be removed.
- Allow removal or quantity change only when the rule permits it.
- Show tracked supply shortage before continuing.
- Separate `Product COGS`, `Packaging`, and `Utensil/Condiment` costs in Owner-facing review where authorized.
- Continue to the existing `/kiosk/checkout` payment screen.

Supply-rule and cost behavior is defined in [supplies-and-order-cost-design.md](supplies-and-order-cost-design.md).

### Payment and checkout

Keep the current payment controls. Show a compact final product/supply summary with Back returning to Review Order. Checkout receives:

- product cart snapshot;
- reviewed supply snapshot;
- checkout token;
- payment and discount data; and
- exact supply quantities.

Successful checkout clears both cart and supply-review state. Retrying the same token must not regenerate or double-deduct supplies.

### Kiosk state ownership

Extend the current `kioskStore` rather than creating a second cart authority:

- `supplyItems`;
- suggestion source/rule IDs;
- editable/required behavior;
- review status tied to `checkoutToken`; and
- actions to apply suggestions and record seller overrides.

This state is transient like the existing cart. Exact use becomes durable in the checkout transaction.

## Beginner guidance and copy rules

- Use one short explanation card on first use; never a long blocking tutorial.
- Show one primary action per landing screen.
- Put examples under or inside fields.
- Use `Hindi pa ako sigurado` only where a Draft can safely remain incomplete.
- Distinguish `Saved`, `Ready`, `Produced`, `Ready for sale`, and `Available in Kiosk`.
- Use Filipino-first operational copy consistently; retain English technical terms only when they are already familiar and explained.
- Never use `0` to mean unknown.
- Explain why an action is blocked and provide the next safe route.
- Preserve safe Back behavior and visible local-save status.
- Do not automatically enable Kiosk when an item is created or published.

## Accessibility requirements

- All primary actions, steppers, workflow tabs, filter chips, and selectable rows have at least a 44-by-44-pixel target.
- Workflow tabs expose tab role and selected state.
- Item classifications and production choices use radio semantics with checked state.
- Dynamic autosave, validation, child-return, shortage, and completion messages use appropriate live regions.
- Route and wizard-step transitions move focus to the new heading.
- Required packaging exposes an accessible explanation, not only a lock icon or color.
- Disabled actions include a visible and announced reason.
- Dependency trees provide a linear reading order and level/path text; visual indentation is not the only relationship cue.
- Cost, stock, and readiness do not rely on color alone.
- Text supports font scaling without truncating the next action.
- Reduced-motion preference continues to be respected.

Visual and assistive-technology verification must be completed on a budget Android device in the later manual-test phase described by [manual-test-scenarios.md](manual-test-scenarios.md).

## Low-end-device constraints

- Use the existing theme, icons, and UI primitives; add no large visual dependency.
- Use focused service queries rather than full-table reads.
- Do not load the complete recipe graph for every Paluto row.
- Load a graph only for the selected detail, shopping calculation, or production plan.
- Bound graph traversal by node/edge limits and fail with a readable error.
- Collapse dependency and production stages by default.
- Use virtualized lists for potentially large Paluto, Grocery, plan, and history collections.
- Memoize derived maps and aggregation within one selected flow.
- Avoid heavy animation, background polling, unnecessary images, and network work.
- Persist drafts on a bounded debounce plus blur/background/navigation flush; do not write SQLite on every keystroke.

## Preserved experience patterns

| Pattern | Target use |
| --- | --- |
| `ScreenScroll`, context bar, and bottom navigation | Retain on landing and detail screens |
| `AppTopBar` | Retain; add clear workflow title and safe Back |
| Gabi cards, fields, buttons, notices, chips, and empty states | Compose all new screens |
| Current Grocery lot card | Retain provenance and cost presentation |
| Current recipe three-step progression | Reuse the progressive idea, but as durable route-backed steps |
| Current production selection and review rows | Reuse in planner/run stages |
| Current production deduction preview and atomicity notice | Preserve in final run review |
| Current Kiosk product grid and cart | Preserve |
| Current checkout payment and receipt | Preserve after Review Order |
| `useFocusEffect` refresh | Reload parent drafts and operational data after nested routes |

## Planned route files

### Existing route files to modify

- `app/owner/_layout.tsx`
- `app/owner/index.tsx`
- `app/owner/inventory.tsx`
- `app/owner/grocery.tsx`
- `app/owner/recipes.tsx`
- `app/owner/recipe-detail.tsx`
- `app/owner/production.tsx`
- `app/kiosk/_layout.tsx`
- `app/kiosk/sell.tsx`
- `app/kiosk/checkout.tsx`
- `app/kiosk/stock.tsx`

### New route files

- `app/owner/paluto-editor.tsx`
- `app/owner/paluto-drafts.tsx`
- `app/owner/paluto-archived.tsx`
- `app/owner/grocery-shop.tsx`
- `app/owner/grocery-missing-prices.tsx`
- `app/owner/production-plan.tsx`
- `app/owner/production-run.tsx`
- `app/owner/production-history.tsx`
- `app/owner/stock-adjustment.tsx`
- `app/kiosk/review-order.tsx`

## Planned component and state files

### Existing files to modify

- `src/components/owner/TindahanTabs.tsx` or replace it with the workflow component below after all imports move.
- `src/components/ui/KitaMoUI.tsx`
- `src/state/kioskStore.ts`

### New lightweight components

- `src/components/owner/InventoryWorkflowTabs.tsx`
- `src/components/owner/PalutoItemCard.tsx`
- `src/components/owner/ItemReadinessCard.tsx`
- `src/components/owner/RecipeDependencyTree.tsx`
- `src/components/owner/ProductionStageCard.tsx`
- `src/components/owner/RequirementGroup.tsx`
- `src/components/owner/MissingPriceCard.tsx`
- `src/components/kiosk/KioskSupplyEditor.tsx`

Names are planned implementation boundaries, not Phase A-created source files. Domain, repository, service, migration, and test files are listed in [implementation-plan.md](implementation-plan.md).

## UX acceptance checkpoints

- A beginner can define a Recipe or Prepared Base before recording a purchase or price.
- Creating an item never silently places it in Kiosk.
- Parent and nested child drafts survive Back, interruption, and process restart.
- Saving a child returns to the correct parent placeholder without duplicate lines.
- Paluto, Grocery, Paninda, and Kiosk each answer one beginner question.
- Grocery remains optional and shows unknown purchase facts explicitly.
- Production planning causes no inventory mutation.
- Production execution distinguishes expected and actual output.
- Stock changes use reason-led movement history.
- Kiosk adds only one concise review step before the existing payment screen.
- Required packaging cannot be silently removed.
- Seller-adjusted supplies are recorded exactly once with the checkout token.
- Home and the core Kiosk product-selection experience remain recognizably unchanged.

Detailed domain and transaction acceptance criteria are recorded in [acceptance-criteria.md](acceptance-criteria.md).
