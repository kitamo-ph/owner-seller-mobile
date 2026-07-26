# Production planner design

## Separation of planning and execution

Planning is a pure, read-only calculation. It may save a plan snapshot, but it does not create inventory movements, reserve stock, deduct a lot, add output, or rewrite a recipe.

Execution records one actual preparation stage at a time. Human work can span minutes or hours, so the whole plan cannot be one long SQLite transaction. Each completed stage has its own atomic production transaction.

## Plan inputs

A plan starts with:

- business and branch;
- root recipe and exact active version;
- target output quantity and unit;
- mode: `use_prepared_stock_first` or `prepare_fresh`;
- optional owner-edited expected output per stage; and
- stock/cost observation timestamp.

The planner expands the bounded recipe graph described in [recipe-graph-design.md](recipe-graph-design.md). It uses configured recipe yields and owner-configured conversions only.

## Persisted plan

`production_plans` stores the root intent and state:

- `draft`, `ready`, `in_progress`, `completed`, `cancelled`, or `stale`;
- target quantity/unit and root version;
- preparation mode;
- calculation version;
- stock observation time;
- expected total cost, cost completeness, and missing-price count; and
- created/updated/started/completed timestamps.

`production_plan_stages` stores a topological preparation sequence. Each stage records:

- exact recipe version;
- parent/source relationships;
- expected input multiplier and expected output;
- prepared stock expected to be used;
- amount needing fresh preparation;
- status;
- actual output when completed;
- linked production batch; and
- shortage/variance state.

`production_plan_requirements` keeps raw and prepared requirements plus provenance paths. `production_plan_allocations` stores recommended or owner-selected lots and whether the choice was legacy-selected, manual, FEFO recommendation, or FIFO recommendation.

Saved plans are snapshots, not promises. Stock and lifecycle can change, so a plan must be revalidated before start and before every stage.

## Calculation

For “Produce 30 Musubi”:

1. Resolve the exact root version.
2. Expand the graph and scale every stage by expected yield.
3. Topologically order child preparation before parent production.
4. In prepared-stock-first mode, subtract compatible prepared Product stock before scheduling child production.
5. Aggregate purchased Ingredient and supply leaves after unit conversion.
6. Read compatible available lots and produce allocation recommendations without writing them.
7. Report stock available, amount to prepare, amount to buy, missing costs, expected cost, estimated remainder, and warnings.

Repeated raw items are aggregated by stable ID and compatible canonical unit while retaining path-level explanations.

## Expected and actual yield

Recipe versions preserve expected yield. A production batch separately records:

- expected output for the stage;
- actual output entered by the owner;
- expected inputs;
- actual allocated inputs;
- expected and actual cost;
- output cost per actual unit;
- absolute and percentage yield variance; and
- exact version and plan-stage IDs.

Actual output never edits the recipe. After a child stage commits, downstream calculations use the actual prepared stock available. If it is insufficient:

- the plan becomes short;
- the app explains the affected downstream stages;
- the owner may prepare more, choose other compatible prepared stock, or lower the final target; and
- no downstream transaction is attempted until its requirements are valid.

## Stage execution transaction

Planning and UI review occur outside the write transaction. On commit, an exclusive transaction:

1. Reloads business/branch, recipe version, plan stage, status, and affected lots.
2. Rejects stale, archived, cross-context, already-completed, or insufficient allocations.
3. Inserts the production batch with expected/actual/version/plan snapshots.
4. Applies guarded exact Ingredient, supply, and prepared Product lot deductions.
5. Inserts all allocation usages and movement rows.
6. Creates a Product output lot tied to the production batch using actual output and unrounded batch cost.
7. Updates `products.stock_qty` as the compatibility aggregate.
8. Inserts the existing cooked/output movement.
9. Updates the plan stage and downstream shortage state.
10. Resolves existing low-stock alerts where current behavior requires it.

Every guarded update's affected-row count is checked. A failure at any step rolls back all writes for that stage.

Manual “Dagdag luto (walang recipe)” remains a compatibility operation until a separately reviewed replacement exists. It must not be silently relabeled as recipe-backed production.

## Prepared Product stock

New produced output creates a `product_stock_lots` row with:

- Product ID;
- actual quantity and unit;
- exact production batch origin;
- unrounded total and unit cost;
- created/remaining quantity;
- lifecycle status; and
- provenance/completeness flags.

The existing scalar `products.stock_qty` remains transactionally synchronized during the compatibility period. The Product lot is the future allocation/cost evidence; the scalar remains required by existing screens, reports, Kiosk, transfers, and protected behavior until all call sites are migrated and reconciled.

Legacy scalar balances are not mass-backfilled. When an owner reviews a legacy catalog item and enables native Product-lot behavior, one explicitly labeled legacy-balance lot may copy the then-recorded quantity/cost inside a reconciliation transaction. Its provenance remains `legacy_unknown`; it is never described as a purchase or production batch.

## Staleness and cancellation

A plan is stale when:

- an allocation no longer has enough remaining quantity;
- a selected item, lot, or version is archived;
- a conversion used by a draft calculation is no longer current;
- business/branch context differs; or
- another committed operation changes required stock.

Recalculation updates the plan snapshot but never historical completed stages. Cancelling a plan changes its status only and makes no inventory movement. Completed stage batches remain history even if later stages are cancelled.

## Costing

- Exact lot contributions are summed without intermediate display rounding.
- Custom/incomplete costs preserve completeness metadata.
- Actual unit cost is actual batch cost divided by actual positive output.
- A zero or invalid actual output cannot complete a stage.
- Historical stage and batch costs are immutable after later purchase, conversion, or recipe edits.
- Current SQLite `REAL`/JavaScript `number` representation remains; comparisons use a documented quantity tolerance.

## Performance

- Load one bounded graph and batch-fetch stock summaries and candidate lots.
- Do not expand graphs on list cards.
- Cache pure expansion by `(recipe_version_id, target_unit)` within one calculation.
- Persist compact stage/requirement snapshots, not duplicate UI trees.
- Paginate saved plans/history and collapse stage details.
- Recalculate only affected downstream stages after actual yield.
- Use query-plan checks for active versions, stage status, requirement lookup, and lot candidates.

## Required implementation evidence

Before enabling the planner:

- pure graph and plan checks;
- saved-plan restore check;
- no-mutation planning check;
- prepared-stock-first and fresh-mode checks;
- expected/actual downstream shortfall checks;
- exact split-lot cost checks;
- stage failure injection after every material write;
- scalar/Product-lot reconciliation;
- stale-plan rejection; and
- device review on a budget Android target.
