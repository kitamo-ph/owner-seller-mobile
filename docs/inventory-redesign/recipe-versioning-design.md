# Recipe versioning and drafts

## Stable identity and immutable versions

`recipes` remains the stable legacy recipe identity and keeps its existing ID and output Product relationship. `recipe_versions` contains immutable effective definitions and points to the output `catalog_items` identity. Imported recipes retain their exact Product binding.

Each version records:

- recipe ID and monotonic version number;
- status (`published`, `superseded`, or `archived` for selection; never mutable content);
- name/category snapshots;
- output catalog item ID and any required Product projection snapshot;
- expected output quantity and unit;
- production mode;
- suggested/selling-price snapshot and completeness;
- notes;
- created/effective timestamps;
- source draft or duplicated version ID; and
- graph/cost completeness metadata.

`recipes.active_version_id` identifies the version used for new plans and production. Historical batches and sale usages keep their exact version or their existing immutable snapshots.

Multiple stable Recipe families may output the same catalog item because that is valid legacy data. `catalog_item_recipe_roles` makes `primary`, `alternate`, and cook-upon-order/Kiosk selection explicit for native or reviewed items. Upgrade imports every family but does not guess a primary from creation time. Unreviewed legacy Kiosk behavior retains its current chronological resolution until the owner chooses a role.

## Why versions are required

Current recipe lines are flat and mutable at the database level, while production history stores only partial snapshots. Editing in place would make it impossible to explain a historical yield, graph, or cost. Therefore:

- a published version never changes;
- editing starts a draft based on a chosen version;
- publishing inserts a complete new version and lines atomically;
- the stable recipe's active pointer changes only after validation; and
- historical production and COGS are never recomputed.

Renaming or changing category after history also creates a version because those labels appear in historical explanations. The stable recipe may carry the latest name as a compatibility projection, but historical readers use the version or existing snapshot.

## Draft persistence

`recipe_drafts` and `recipe_draft_lines` are mutable SQLite records. A draft stores:

- stable draft ID;
- business/branch scope;
- optional source recipe/version;
- editor step and lifecycle;
- partial name, classification, yield, price, sellable, and Kiosk fields;
- autosave revision and last-saved timestamp;
- unresolved requirement count;
- optional parent draft, parent placeholder line, and return route; and
- creation/update metadata.

Draft lines may reference a saved catalog item, a published child recipe version, a child draft, or an unresolved placeholder. Drafts never appear in Kiosk, production selection, Grocery active-recipe lists, or active supply rules.

Autosave uses a monotonic revision:

1. UI edits increment the local revision.
2. Debounced save writes only if the stored revision is not newer.
3. Blur, Back, app background, and nested navigation flush immediately.
4. Screens reload by `draftId` on focus.
5. A process restart resumes the latest stored revision.

## Nested creation

Before opening a child editor:

1. Flush the parent draft.
2. Insert or update a placeholder line with a stable ID.
3. Create the child draft with `parent_draft_id` and `parent_line_id`.
4. Push the editor route using IDs, not serialized form state.

When the child is published:

1. Validate and publish the child version atomically.
2. Replace the parent's placeholder reference with the new child version in a draft transaction.
3. Mark the child return link resolved.
4. Return to the parent route.

If interrupted after child publication but before navigation, reopening either draft resolves from persisted IDs. Back from an unfinished child saves it and returns without losing the parent.

## Publish transaction

Publishing executes in one exclusive transaction:

1. Re-read the draft revision.
2. Validate required fields, units, business scope, lifecycle, and dependency availability.
3. Build the proposed adjacency graph and reject cycles/limits.
4. Allocate the next version number under a uniqueness constraint.
5. Insert immutable version and line snapshots.
6. Update the recipe active-version pointer and compatibility header fields.
7. Update catalog readiness and an explicitly required Product/Ingredient projection.
8. Mark the draft published.

Any failure leaves the previous active version and draft intact.

## Editing with and without history

Use one behavior for clarity: publishing an edit always creates a version. Whether history exists determines retention policy, not the write shape.

- If the old version has history or is referenced, it is retained indefinitely.
- If it has no references, it may still be retained for audit; a later owner-only cleanup may remove only proven-unused versions.
- Changing selling price alone creates a version or a separately versioned price fact before it can affect new production/sale readiness. It never changes old sale-item price/COGS snapshots.
- Sellable and Kiosk flags are catalog configuration, audited separately and projected only where compatibility requires it; version snapshots preserve what the recipe editor showed.

## Duplicate

Duplicate creates a new recipe identity and a draft copied from the selected source version. It copies:

- component structure and pinned child versions;
- quantities, units, roles, and conversion snapshots;
- expected output;
- classification proposal;
- optional supply rules as inactive draft copies; and
- completeness warnings.

It does not copy:

- production or sales history;
- stock;
- active/Kiosk state;
- historical batch cost;
- lot allocations; or
- stable identity.

The owner may change name, toppings/components, price, yield, classification, and Kiosk intent before publishing.

## Legacy migration

For each existing recipe, including inactive or history-bearing recipes:

- preserve the existing recipe ID;
- create a version representing the definition present at migration time;
- copy header and line values without semantic reinterpretation;
- preserve selected lot IDs and snapshots;
- set it as the current-definition compatibility pointer without making an inactive Recipe selectable; and
- mark completeness/review flags where current zeros or custom values are ambiguous.

An old production batch cannot always be proven to have used that current definition because prior header edits were possible and no full version snapshot exists. Therefore its new `recipe_version_id` remains `NULL` unless evidence proves the link. Existing name, output, usage, and cost snapshots remain the historical authority.

## Archive and delete

- Archiving a recipe identity prevents new drafts/plans from selecting it but preserves every version and history reader.
- A version referenced by a parent version, plan, batch, or sale cannot be deleted.
- A draft can be permanently deleted only when it has no child/parent dependency requiring recovery and no published result.
- Permanent deletion uses the centralized fail-closed lifecycle service.

## Concurrency and offline behavior

All operations use the existing single local SQLite database and exclusive transaction queue. No server, clock synchronization, or network is required. Unique `(recipe_id, version_number)` and draft revision checks prevent local re-entrancy from producing duplicate versions or overwriting newer drafts.

See [recipe-graph-design.md](recipe-graph-design.md) for dependency validation and [migration-plan.md](migration-plan.md) for the staged backfill.
