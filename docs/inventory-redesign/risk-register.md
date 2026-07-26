# Inventory redesign risk register

## Rating

- Critical: can corrupt stock/history, violate checkout idempotency, expose owner-only behavior, or make an upgrade unusable.
- High: can change protected business meaning or block safe rollout.
- Medium: can materially damage usability/performance/evidence but has a bounded recovery path.

Status `Open` means a later phase must produce the stated exit evidence. Phase A does not resolve implementation risks.

## Risks

| ID | Rating | Risk and evidence | Mitigation / exit evidence | Status |
| --- | --- | --- | --- | --- |
| INV-REDESIGN-001 | Critical | Legacy Product/Ingredient classification is ambiguous. `ProductType`, name, active state, bundle fields, and zero/positive price do not prove one of six classifications. | Create catalog profiles and exact bindings; migrate to `legacy_unclassified`; require owner review; populated-v10 assertions prove no guess. | Open |
| INV-REDESIGN-002 | Critical | Product/Ingredient identities and stock models differ. A name-based merge or generic rewrite can orphan FKs/history. | Preserve every ID and table; use `legacy_item_bindings`; never merge by name; assert all legacy row IDs/counts/references after upgrade. | Open |
| INV-REDESIGN-003 | Critical | Current Kiosk lists branch/shared Products without checking `active`, price, sellable, readiness, or Kiosk enablement. A native prepared Product could be exposed. | Deploy catalog-aware compatibility predicate before native Product creation; retain legacy visibility; add Kiosk query and route-boundary checks. | Open |
| INV-REDESIGN-004 | Critical | Product scalar stock and proposed Product-lot evidence can diverge across checkout, production, transfer, spoilage, direct edit, seed, or reset. | Keep scalar authority during transition; limit lots to native/reviewed items; dual-write all writers atomically; reconciliation blocks on mismatch; remove native direct stock edit. | Open |
| INV-REDESIGN-005 | High | Existing consumption is explicit selected-lot, not FIFO/FEFO. Silent policy change alters availability and costs. | Imported lines remain `legacy_selected`; FEFO/FIFO only recommends new allocations; commit exact allocations and preserve manual/auto provenance. | Open |
| INV-REDESIGN-006 | High | Current history cannot reconstruct every recipe definition effective before migration because headers could be edited in place. | Import one current-definition version; leave historical version link null/unknown when unproved; retain old snapshots as authority. | Open |
| INV-REDESIGN-007 | Critical | Cook-upon-order checkout does not check the guarded Ingredient-lot update result before writing usage/movement. | Correct only with failure/race regression; all guarded writes must check affected rows before related history; same-token retry evidence required. | Open |
| INV-REDESIGN-008 | High | Recipe, Ingredient, and Product unit vocabularies differ, and production increments Product stock without validating output-unit compatibility. | Version item-specific conversions; no implicit `pcs`/`piece`, pack, mass/volume mapping; block incompatible publish/production; preserve legacy snapshots. | Open |
| INV-REDESIGN-009 | High | SQLite `REAL`/JavaScript `number` is unrounded and has no repository-wide accounting rounding contract. Small supply costs increase sensitivity. | Preserve legacy representation; use shared tolerance; persist unrounded allocation contributions; approve one display/final-accounting rule before reports ship. | Open |
| INV-REDESIGN-010 | Critical | Existing Product→Recipe and Ingredient→lot/movement cascades can erase provenance if permanent delete relies on FKs. | Central owner-only fail-closed reference check and delete in one transaction; historical new FKs restrict or retain snapshots; failure-injection tests. | Open |
| INV-REDESIGN-011 | High | Migrations have no down path/checksum and a release's multiple migrations commit separately. Partial success must resume safely. | Append 011–014 only; make each intermediate schema usable/resumable; feature-gate new readers/writers; populated-v10 interrupted/resume and rerun tests; forward-fix rollback. | Open |
| INV-REDESIGN-012 | High | No populated v10 upgrade fixture or SQLite service transaction suite exists; current checks are mainly pure math/static. | Build representative v10 fixture, foreign-key/integrity checks, service integration harness, and per-write failure injection before native writes. | Open |
| INV-REDESIGN-013 | High | Existing Product branch and selected production Branch can disagree; branch-null stock is shared across stalls. | Make location policy explicit; validate native branch-specific Product against production/sale branch; preserve shared scope; flag old mismatches without rewrite. | Open |
| INV-REDESIGN-014 | High | Supply cost accounting is not in the protected profit formula. Merging it into `sale_items.cogs_total` would change historical meaning. | Persist Product, packaging, utensil/condiment, other supply, and total separately; approve report recognition; never recalculate old sales. | Open |
| INV-REDESIGN-015 | High | Existing bundle fields are advantageous quantity pricing for one Product, not composite bundle components. | Retain `legacy_quantity_pricing` and current pricing checks; do not infer a combo graph or stock deduction. Composite bundles require separate approval. | Open |
| INV-REDESIGN-016 | High | Direct SQL exists across multiple services; changing repositories alone misses checkout, reports, production, transfers, and stock operations. | Use the writer/reader inventory in [transaction-impact-analysis.md](transaction-impact-analysis.md); file-scope review and integration tests cover every call site. | Open |
| INV-REDESIGN-017 | High | Current Ingredient adjustment reads before its transaction; transfer and fixed-cost paths also have read-before-write windows. | New adjustment reads/guards/writes inside one exclusive transaction; audit adjacent writers; inject stale-state failures. | Open |
| INV-REDESIGN-018 | High | Multi-stage preparation cannot be one transaction across human time, so downstream stock can change between stages. | Commit each stage atomically, revalidate before it, mark stale/short, and recalculate from actual output. Never reserve stock by mutation during planning. | Open |
| INV-REDESIGN-019 | Medium | Recursive graphs can overflow, double count shared leaves, issue N+1 queries, or make budget devices unresponsive. | Iterative bounded `O(V+E)` traversal; batch queries, memoization, operation budgets, diamond/deep fixtures, collapsed UI, query instrumentation. | Open |
| INV-REDESIGN-020 | High | Debounced drafts can race Back or nested navigation and lose/overwrite parent data. | SQLite authority, monotonic revisions, forced flush plus placeholder transaction before push, persisted return chain, restart/manual tests. | Open |
| INV-REDESIGN-021 | Medium | New Kiosk review can slow the established fast sale path or leave stale supplies after cart edits. | One concise route, batch rule load, review revision tied to checkout token, invalidate on cart change, clear with cart, budget-device review. | Open |
| INV-REDESIGN-022 | High | Missing purchase/selling price and intentional zero are indistinguishable in legacy required-zero columns; Ingredient-lot cost columns are also non-null. | Preserve values; add catalog completeness plus nullable Ingredient-lot cost shadows and explicit state; treat required-column zero only as a compatibility sentinel for native unknown cost; gate writes until all native readers ignore that sentinel. | Open |
| INV-REDESIGN-023 | High | Grocery becomes falsely mandatory if recipe definitions continue to pin a priced purchase lot. | Native version lines reference catalog items, not lots; Grocery facts optional; execution selects lots; missing cost is an explicit warning. | Open |
| INV-REDESIGN-024 | Medium | Profit reports use multiple independent reads and may show a mixed snapshot during concurrent writes. | Evaluate a bounded read transaction/snapshot in Phase B/F; add consistency fixtures; do not quietly change existing query meaning. | Open |
| INV-REDESIGN-025 | High | A lower-version old app may ignore catalog semantics after native records exist. | Do not support data-bearing downgrade; document policy before release, rely on future versionCode progression only after authorized release work, and never create native records before current readers are compatible. | Open |
| INV-REDESIGN-026 | Medium | Current segmented controls/chips include targets below the preferred 44–48 px and new graph screens can harm accessibility. | Reuse accessible controls, raise targets, announce save/step changes, focus nested return, respect reduced motion, and perform device/screen-reader review. | Open |
| INV-REDESIGN-027 | High | Full reset/count lists can drift when tables are added; adding all tables to startup counts can create latency. | Update reset child-first, derive migration inventory where possible, assert ledger/schema/reset agreement, and add only focused counts. | Open |
| INV-REDESIGN-028 | High | New phases can expose half-built flows (schema without writers, native Products before Kiosk filter, lot evidence before all writers). | Feature-gate route entry/native creation, obey ordered phase dependencies, and stop at each verification pause with scope and validation evidence. | Open |
| INV-REDESIGN-029 | High | Multiple active legacy Recipes can target one Product, and current Kiosk lets the chronologically latest row decide cook mode. Import cannot infer the owner's intended primary recipe. | Import every family/current version, retain legacy resolution for unreviewed records, and require an explicit primary/Kiosk recipe role before native readiness. | Open |

## Approval conditions before Phase B

Recommendation is **Proceed with conditions**. Phase B should begin only after approval of:

1. additive `catalog_items` plus `legacy_item_bindings`;
2. Product scalar stock as transition authority and Product lots only for native/reviewed records;
3. `legacy_unclassified` migration with compatibility-visible Kiosk behavior;
4. imported current recipe versions with unknown historical links where proof is absent;
5. FEFO/FIFO as recommendation for new allocation only;
6. nullable Ingredient-lot cost shadows/state with the legacy zero sentinel gated from all native readers;
7. no broad money representation migration;
8. separately persisted supply/order cost categories pending report-recognition approval; and
9. behavioral/forward-fix rollback rather than unsupported down migration.

## Mandatory exit gates before native data writes

- Exact populated-v10 upgrade and rerun fixture passes.
- `PRAGMA integrity_check` and `foreign_key_check` pass.
- Kiosk compatibility predicate passes legacy/native visibility fixtures.
- Catalog bindings preserve every legacy ID without name merging.
- All Product stock writers have an explicit legacy/native strategy.
- Production, checkout, adjustment, and mark-empty failure-injection suites pass.
- Checkout same-token retry proves no duplicate effect.
- Protected package, Expo identity, signing, version/versionCode, and AAB remain unchanged.
