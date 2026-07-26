# Recipe graph design

## Graph model

A published recipe version is a graph node. A version line that references another published recipe version is a directed edge from parent to child. Purchased/supply catalog items and custom-cost lines are leaves.

```text
Musubi v3
├── Sushi Rice v2
│   ├── Cooked Rice v4
│   │   ├── Raw Rice
│   │   └── Water
│   └── Sushi Seasoning v1
│       ├── Vinegar
│       ├── Sugar
│       └── Salt
├── Spam
├── Mayonnaise
├── Musubi Sauce v2
├── Nori
└── Wrapper
```

Edges always pin a child version. Publishing a new child version does not mutate a published parent. Updating the parent creates a new parent version that can explicitly adopt the new child version.

## Line contract

Each immutable version line stores:

- stable line ID and sort order;
- source kind: purchased/supply catalog item, child recipe version, or custom cost;
- source ID;
- quantity and original unit;
- normalized quantity/unit when an approved conversion exists;
- conversion ID and factor snapshot when conversion was used;
- role: main, supporting, seasoning, garnish, packaging, optional, or unset;
- optionality and costing-completeness flags;
- selected legacy lot or allocation mode when applicable; and
- human-readable name, unit, and cost snapshots required for history.

Roles are display metadata only. They never change quantity, costing, allocation, or required/optional behavior without a separate explicit field.

## Publication validation

Drafts may be incomplete. Publication must reject:

- no output catalog item, no required stock projection, or non-positive expected yield;
- unresolved draft placeholders;
- invalid or unsupported units;
- missing required component quantity;
- archived or missing required dependency;
- a direct or indirect cycle;
- graph limits exceeded;
- a child output that does not match its referenced version;
- a component from another business; and
- a sell-ready request with missing selling price or other sale requirement.

Missing purchase cost does not block recipe publication. It marks cost completeness false and creates a visible warning.

## Cycle detection

Validation uses the exact pinned-version graph for history and two collapsed semantic graphs for authoring safety:

1. Build the reachable exact-version adjacency map with one focused batch query, including the candidate version and proposed edges.
2. Run iterative three-color depth-first traversal over version IDs to reject a literal version-node cycle.
3. Collapse every version edge into a stable Recipe-family edge (`parent.recipe_id → child.recipe_id`).
4. Collapse it again into an output-item edge (`parent.output_catalog_item_id → child.output_catalog_item_id`).
5. Run iterative three-color traversal over both collapsed graphs.
6. Retain representative exact-version edge provenance so a semantic cycle reconstructs stable names and version labels.
7. Return a path such as `Musubi v3 → Sushi Rice v2 → Musubi v1`.

This deliberately rejects `Recipe A v2 → Recipe A v1` even though the two version IDs form no literal back edge. It also rejects an indirect path that returns to an older version of the same Recipe family or output catalog item. A diamond that merely reuses a child on separate non-cyclic branches remains valid.

Published history and expansion still traverse the exact pinned versions. The active version is consulted only when an owner explicitly selects a child for a new draft/publication; readers never silently replace a pinned child.

Publication and recipe-role activation run all three validators inside the enclosing transaction against the candidate graph.

## Safety bounds

“Arbitrary safe nesting” means the domain does not impose a small culinary depth, while the implementation still protects a budget Android device.

Initial configurable guardrails:

- maximum reachable version nodes: 500;
- maximum edges: 2,000;
- maximum active path depth: 64; and
- maximum emitted provenance paths: 5,000.

Exceeding a limit fails with a specific error and no mutation. These are safety limits, not recipe semantics, and Phase F performance evidence may lower them if required.

## Expansion and aggregation

Graph expansion is pure and read-only:

1. Load the root version, reachable versions, component lines, relevant stock summaries, and conversions in bounded batch queries.
2. Memoize each version's unit-output expansion.
3. Scale memoized results by the requested parent quantity.
4. Preserve a provenance path for each contribution.
5. Aggregate leaves only after expansion using `(item_id, canonical_unit, stock_scope)` as the key.
6. Sum repeated leaves once per actual edge contribution, including diamond-shaped graphs.

Memoizing a child expansion prevents repeated computation; it does not remove legitimate quantities when two parent branches both consume that child. Aggregated results retain per-path subtotals so Grocery can explain, for example, how much sugar belongs to seasoning versus sauce.

No planning function writes stock, movements, plans, or drafts.

## Units

Built-in compatible families retain existing rules and add controlled units:

- mass: grams and kilograms;
- volume: milliliters and liters;
- count: pieces where the same item and unit family allow it; and
- owner-defined conversions for packs, cans, cups, tablespoons, teaspoons, servings, or other supported units.

There is no universal mass-to-volume, pack-to-piece, or item-to-output conversion. An owner-defined conversion is catalog-item-specific, visible, editable by creating a new conversion version, and snapshotted by the recipe version that uses it.

Quantity comparisons use one documented tolerance. Storage remains compatible with current SQLite `REAL` and JavaScript `number`; this redesign does not introduce a broad precision migration.

## Stock-aware expansion

The graph calculation has two explicit modes:

- `use_prepared_stock_first`: account for compatible prepared catalog-item/Product stock before expanding the remaining prepared requirement;
- `prepare_fresh`: expand every prepared requirement regardless of stock.

Reservations in a plan are recommendations, not inventory mutations. Before a production stage commits, its allocations are revalidated under the production transaction. If actual upstream yield is smaller than planned, downstream availability is recalculated from actual stock and the plan becomes short; the recipe is not rewritten.

## Archived and missing dependencies

- Existing published versions remain readable even if their item or recipe is later archived.
- An archived dependency can support historical display and an already-recorded batch.
- A new version cannot publish with an archived required dependency unless the owner explicitly replaces or restores it.
- A saved plan whose dependency becomes archived is stale and must be reviewed before start.
- A deleted dependency is impossible once referenced because permanent delete fails closed.

## Errors

Domain errors are structured and localizable:

- code;
- root recipe/version;
- offending node or line;
- readable dependency path;
- configured limit if relevant; and
- suggested owner action.

The UI shows plain language; logs and checks retain stable codes.

## Complexity and query budget

- Traversal target: `O(V + E)`.
- No graph expansion while rendering a recipe list.
- A detail/planner request loads a bounded subgraph once.
- Repository-call instrumentation must reject N+1 queries.
- Required indexes cover version-by-recipe, active version, line-by-version, child-version reference, lifecycle, and business scope.
- Deep-graph and diamond-graph fixtures are mandatory before enabling nested publication.
