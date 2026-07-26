# Inventory Redesign Manual Test Scenarios

## Document status

- Milestone: Phase A architecture and validation planning
- Status: Planned; not executed
- Applicable implementation phases: B through F
- Protected Android package: `ph.kitamo.app`

These scenarios describe future verification. No checkbox or expected result
below is evidence that a scenario has already run.

## Execution record template

Before executing any scenario, record:

```text
Application commit:
Schema version:
Build/install source:
Device model:
Android version:
Screen size / font scale:
Network state:
Tester:
Date and timezone:
Scenario IDs:
Result per scenario:
Evidence:
Notes / defect IDs:
```

Use only synthetic or tester-owned data. Never place credentials, PIN values,
customer personal data, receipt contents, or provider secrets in screenshots or
problem reports.

## Common preconditions

- The scenario's implementation phase has been explicitly approved and
  completed.
- All applicable automated checks in
  [acceptance-criteria.md](acceptance-criteria.md) are green.
- The test database is disposable and backed up when an upgrade scenario needs
  historical evidence.
- The tester has one active test business and stall unless the scenario says
  otherwise.
- Airplane mode can be enabled without preventing local application launch.
- The protected AAB is not used as a writable test artifact and is not rebuilt.

## Phase B — Domain and persistence

### INV-MAN-B-001 — Fresh schema initialization

**Acceptance links:** INV-AC-MIG-001, INV-AC-MIG-004, INV-AC-MIG-006,
INV-AC-MIG-007, INV-AC-MIG-009, INV-AC-MIG-010

**Preconditions**

- Use a disposable fresh install or an empty temporary application data area.
- Network access is disabled.

**Steps**

1. Launch the implemented app and complete a fresh local business setup.
2. Close the app completely and reopen it.
3. Open the existing Home, owner inventory/Grocery/Recipe/Production, and
   Kiosk compatibility routes without creating data.
4. Repeat application launch once more.

**Expected results**

- Initialization finishes without Internet access or a partial-migration error.
- Existing compatibility screens open in their correct empty state; no
  Phase C–E workflow is required for this Phase B check.
- Restart does not rerun visible setup or lose the business context.
- No demo, price, stock, supplier, or recipe data is fabricated.

### INV-MAN-B-002 — Populated legacy upgrade

**Acceptance links:** INV-AC-MIG-002, INV-AC-MIG-003, INV-AC-MIG-008,
INV-AC-MIG-009, INV-AC-MIG-012, INV-AC-REG-001 through INV-AC-REG-011

**Preconditions**

- Start with a disposable copy of schema-v10 data containing products, bundle
  pricing, grocery lots at different costs, recipes, production, a sale with
  COGS, spoilage, transfer, fixed cost, receipt, and problem report.
- Record IDs, quantities, costs, and report totals before upgrade.

**Steps**

1. Install/launch the redesigned application over the populated local data.
2. Open each historical product, lot, recipe, production batch, sale, receipt,
   movement, fixed cost, report, and problem report.
3. Compare stable IDs, quantities, costs, snapshots, and report totals with the
   pre-upgrade record.
4. Confirm through the approved read-only migration diagnostic that ambiguous
   bindings are `legacy_unclassified` and review-required.
5. Compare the Kiosk Product list with the pre-upgrade branch/shared list.
6. Close and reopen the app.

**Expected results**

- All recorded history remains readable with matching identifiers and values.
- Legacy selected lots and bundle pricing retain their meaning.
- Ambiguous records are stored as review-required rather than a guessed
  classification, even though Phase C review UI is not required yet.
- Unreviewed legacy Kiosk visibility is unchanged.
- Restart applies no duplicate migration and changes no historical value.

## Deferred Phase C/D persistence-backed UX scenarios

The following scenarios exercise the Phase B persistence through later UI.
They are not Phase B exit gates. Run each only after the owning Phase C or D
interface identified by its scenario ID is implemented.

### INV-MAN-C-005 — Nested graph and cycle messages

**Acceptance links:** INV-AC-GRAPH-001 through INV-AC-GRAPH-010

**Preconditions**

- Create purchased items Raw Rice, Water, Vinegar, Sugar, Salt, Spam, Nori, and
  Mayonnaise.

**Steps**

1. Create Cooked Rice from Raw Rice and Water.
2. Create Sushi Rice from Cooked Rice, Vinegar, Sugar, and Salt.
3. Create Musubi from Sushi Rice, Spam, Nori, and Mayonnaise.
4. Open Musubi's dependency view and preparation order.
5. Attempt to add Musubi as an ingredient of Musubi.
6. Attempt to add Musubi to Cooked Rice, which would close an indirect cycle.
7. Archive Sushi Rice and inspect both the current Musubi editor and any saved
   historical recipe version.

**Expected results**

- The graph displays the configured multi-stage order without invented
  conversions.
- Direct and indirect cycles are rejected before save.
- Each error displays the dependency path that causes the cycle.
- Historical versions still identify archived Sushi Rice.
- Archived Sushi Rice is not silently accepted for a new active version.

### INV-MAN-C-006 — Draft persistence and nested return

**Acceptance links:** INV-AC-DRAFT-001 through INV-AC-DRAFT-008

**Preconditions**

- No Sushi Rice, Cooked Rice, or Musubi item exists.

**Steps**

1. Begin creating Musubi and enter a name, yield, notes, and one ingredient.
2. Search for Sushi Rice and choose to create a prepared base.
3. While creating Sushi Rice, create the missing Cooked Rice base.
4. Enter part of Cooked Rice, then force-close the app before completing it.
5. Reopen the app and resume the saved Cooked Rice draft.
6. Save Cooked Rice, return to Sushi Rice, save Sushi Rice, and return to
   Musubi.
7. Leave Musubi unfinished with no selling price and navigate to Kiosk.

**Expected results**

- Every parent draft retains all entered fields throughout nested navigation.
- Restart restores the same Cooked Rice draft rather than a duplicate.
- Each return selects the child just created.
- Musubi remains a visible draft in Paluto but is absent from Kiosk.
- No missing price is fabricated as zero.

### INV-MAN-C-007 — Recipe history and independent duplication

**Acceptance links:** INV-AC-VERSION-001 through INV-AC-VERSION-005

**Preconditions**

- A recipe has at least one completed production batch and sold output with
  recorded COGS.
- Record its version, batch cost, SaleItem COGS, and report total.

**Steps**

1. Edit the recipe quantity, yield, and name, then save.
2. Inspect the historical batch and sale.
3. Duplicate the active recipe.
4. Change the duplicate's name, topping, price, yield, and Kiosk state.
5. Reopen the original and duplicate.

**Expected results**

- The edit creates a new active version or immutable equivalent.
- Old production, COGS, and report values remain unchanged and linked to the
  historical version.
- Original and duplicate have independent IDs and future edits.
- The duplicate copied approved structure and supply rules only once.

### INV-MAN-D-007 — Lot recommendation, manual split, and cost history

**Acceptance links:** INV-AC-LOT-001 through INV-AC-LOT-012

**Preconditions**

- Add three lots of the same ingredient:
  - Lot A: older purchase, no expiry, 2 kg remaining at one cost.
  - Lot B: newer purchase, valid later expiry, 50 kg at a higher cost.
  - Lot C: valid earlier expiry, 3 kg at a third cost.
- Record all lot costs and quantities.

**Steps**

1. Ask the planner for 5 kg using automatic allocation.
2. Review FEFO/FIFO recommendations under the approved policy.
3. Switch to manual allocation and choose 2 kg from Lot A plus 3 kg from Lot B.
4. Review the exact expected batch-cost contribution.
5. Attempt to allocate more than one selected lot contains.
6. Complete a valid production, then add another higher-cost lot.
7. Reopen the completed batch and its related report.

**Expected results**

- The recommendation follows the documented FEFO/FIFO policy.
- Manual selection is owner-only and clearly recorded as manual.
- Split quantities and cost contributions match the selected lots exactly.
- Over-allocation is blocked before any stock change.
- The later purchase does not alter the completed batch or historical report.

### INV-MAN-D-008 — Adjustment reasons and mark empty

**Acceptance links:** INV-AC-ADJUST-001 through INV-AC-ADJUST-008,
INV-AC-TXN-005

**Preconditions**

- One ingredient lot contains 30 pieces.
- One finished product contains positive stock.

**Steps**

1. Count 24 pieces and record a `-6` personal/household-use adjustment.
2. Record one spoilage/damage adjustment on finished stock.
3. Record a counting correction on another lot.
4. Open movement history and profit/COGS reporting.
5. Mark one lot empty, cancelling once before confirming with a reason.
6. Mark total stock empty for a separate disposable test item.
7. Attempt each owner action from normal seller-mode navigation.

**Expected results**

- Each movement records expected, actual/delta, reason, quantity, cost, and
  classification.
- Personal use is not product COGS; spoilage remains a distinct loss.
- Cancellation changes nothing.
- Mark-empty sets stock to zero through movements and never deletes the item or
  lot.
- Seller mode cannot reach the administrative actions.

### INV-MAN-C-008 — Archive and delete eligibility

**Acceptance links:** INV-AC-LIFE-001 through INV-AC-LIFE-006

**Preconditions**

- Create one unused draft and one used item with purchase/recipe/production or
  sale history.

**Steps**

1. Permanently delete the unused draft.
2. Attempt to permanently delete the used item.
3. Archive the used item.
4. Search normal Paluto selectors and Kiosk.
5. Open historical sales, production, COGS, stock movements, and reports that
   reference the archived item.

**Expected results**

- Only the provably unused draft is permanently deleted.
- The used item deletion fails closed with understandable reasons.
- The archived item is absent from normal creation and Kiosk lists.
- All historical views still show stable labels, costs, and references.

## Phase C — Paluto UX (additional scenarios)

### INV-MAN-C-001 — Beginner purchased-item setup

**Acceptance links:** INV-AC-DRAFT-001, INV-AC-DRAFT-004,
INV-AC-GROCERY-006 through INV-AC-GROCERY-009, INV-AC-REG-012

**Preconditions**

- Use a fresh business with no items.
- Enable a large system font setting.

**Steps**

1. Open Paluto and choose the primary create action.
2. Define Raw Rice without purchase cost, supplier, receipt, or selling price.
3. Read examples/help beneath classification and price fields.
4. Select Purchased ingredient at the classification step.
5. Save and reopen the item.
6. Open Kiosk.

**Expected results**

- One clear primary action and short contextual guidance are visible.
- Optional purchasing and price fields do not block save.
- Status clearly distinguishes Saved from Ready for sale.
- Raw Rice does not appear in Kiosk.
- Controls remain readable and reachable with large text.

### INV-MAN-C-002 — All six classifications and readiness

**Acceptance links:** INV-AC-DRAFT-006, INV-AC-GROCERY-007,
INV-AC-SUPPLY-010, INV-AC-REG-012

**Preconditions**

- Have sample records suitable for Purchased ingredient, Prepared base,
  Finished product, Direct resale, Bundle/combo, and Supply/packaging.

**Steps**

1. Create one record of each classification.
2. Leave the prepared base and supply non-sellable.
3. Leave the finished product without a selling price.
4. Give the resale product a selling price but do not enable Kiosk.
5. Explicitly mark eligible records ready for sale and enable selected ones for
   Kiosk.
6. Open Kiosk and compare the list.

**Expected results**

- Classifications and statuses are clear and editable.
- Creation alone never enables Kiosk.
- Missing selling price prevents ready-for-sale status.
- Non-sellable prepared bases and supplies remain absent.
- Among the native/reviewed sample records, only explicitly ready, sellable,
  Kiosk-enabled records appear. Unreviewed legacy visibility remains covered
  by INV-MAN-B-002 and is not tightened by this scenario.

### INV-MAN-C-003 — Safe Back and automatic preservation

**Acceptance links:** INV-AC-DRAFT-002, INV-AC-DRAFT-007,
INV-AC-DRAFT-008, INV-AC-PERF-007

**Preconditions**

- Begin a multi-field recipe on a low-end test device.

**Steps**

1. Enter fields quickly for several seconds.
2. Tap Back during and after the autosave indication.
3. Choose to continue editing, then navigate away normally.
4. Force-close and reopen the app.
5. Resume the draft and inspect duplicates.

**Expected results**

- Typing remains responsive and does not visibly save once per keystroke.
- Back never silently loses entered data.
- Reopen restores one draft with all saved fields.
- The UI distinguishes Saving, Saved, and incomplete requirements.

### INV-MAN-C-004 — Edit, duplicate, archive, and delete language

**Acceptance links:** INV-AC-VERSION-001 through INV-AC-VERSION-005,
INV-AC-LIFE-001 through INV-AC-LIFE-006

**Preconditions**

- One unused draft and one historically used recipe exist.

**Steps**

1. Rename and edit the used recipe.
2. Duplicate it and customize the copy.
3. Archive the used original.
4. Attempt permanent delete on both the unused draft and used original.
5. Read every confirmation and outcome.

**Expected results**

- Labels clearly distinguish edit/version, duplicate, archive, and permanent
  delete.
- Historical effects are described before a destructive action.
- Only the unused draft can be permanently deleted.
- The copy is independently editable.

## Phase D — Grocery and Paninda UX (additional scenarios)

### INV-MAN-D-001 — Shop by direct recipe

**Acceptance links:** INV-AC-GROCERY-001, INV-AC-GROCERY-005,
INV-AC-GROCERY-009

**Preconditions**

- Musubi directly references Sushi Rice, Spam, Nori, Mayonnaise, and Packaging.
- Sushi Rice has its own nested recipe.

**Steps**

1. Open Grocery → Shop by Recipe.
2. Select Musubi and Direct recipe requirements.
3. Review stock and price status groups.

**Expected results**

- Only direct Musubi requirements are listed.
- Sushi Rice remains one prepared requirement rather than being expanded.
- Each result appears in the correct stock/price/supplier group.
- No missing value is invented.

### INV-MAN-D-002 — Complete tree and repeated aggregation

**Acceptance links:** INV-AC-GROCERY-002 through INV-AC-GROCERY-005

**Preconditions**

- Sugar appears in both Sushi Seasoning and Musubi Sauce.

**Steps**

1. Select Complete recipe tree for Musubi.
2. Expand Sugar's contribution explanation.
3. Choose only the Sushi Rice preparation stage and compare the list.
4. Change the target quantity.

**Expected results**

- Prepared bases expand to purchased/raw leaves.
- Sugar shows both branch contributions and one correct total.
- Selected-stage shopping excludes unrelated Musubi requirements.
- Target changes recalculate without inventory mutation.

### INV-MAN-D-003 — Missing-price center and optional receipt

**Acceptance links:** INV-AC-GROCERY-006 through INV-AC-GROCERY-009

**Preconditions**

- Prepare an ingredient without purchase cost, a resale product without purchase
  cost, a supply without unit cost, a finished product without selling price,
  and a recipe/plan with incomplete cost.

**Steps**

1. Open Grocery → Missing Prices.
2. Review each group and follow one item to its owning edit screen.
3. Add purchased stock without supplier or receipt.
4. Complete one missing price and return to the center.

**Expected results**

- All missing-price categories appear under the correct owner.
- Optional supplier/receipt omission does not block purchase.
- Completing one price updates only dependent calculations.
- Unresolved costs remain explicitly incomplete.

### INV-MAN-D-004 — Plan 30 Musubi with prepared-stock choices

**Acceptance links:** INV-AC-PLAN-001 through INV-AC-PLAN-005,
INV-AC-PERF-002, INV-AC-PERF-003

**Preconditions**

- A complete Musubi graph exists.
- Some Cooked Rice and Sushi Rice stock is available.
- Record all stock and movement counts.

**Steps**

1. Plan 30 Musubi.
2. Review raw/prepared requirements, stock, missing purchases, cost, lot
   recommendations, and preparation sequence.
3. Choose prepared stock first.
4. Switch to prepare everything fresh.
5. Change target to 24, then back to 30.
6. Cancel the plan and compare stock and movements.

**Expected results**

- All amounts come from configured recipes/yields.
- Prepared-stock and fresh choices are visibly different and mathematically
  consistent.
- Target changes are responsive and reuse the loaded snapshot.
- Cancellation changes no inventory or history.

### INV-MAN-D-005 — Expected versus actual intermediate yield

**Acceptance links:** INV-AC-PLAN-006 through INV-AC-PLAN-011

**Preconditions**

- A saved 30-Musubi plan requires Cooked Rice and Sushi Rice stages.

**Steps**

1. Start preparation and record Cooked Rice below its expected output.
2. Continue to Sushi Rice and review recalculated availability.
3. Record another actual output below expectation.
4. Review the final Musubi shortfall warning.
5. Reduce the final target and complete production.
6. Reopen the recipe, plan, batches, lots, and cost history.

**Expected results**

- Expected recipe yields remain unchanged.
- Each actual output is recorded on its batch.
- Downstream availability uses actual output.
- The owner can reduce the target without falsifying yield.
- Exact lot deductions, movements, outputs, variance, and costs are preserved.

### INV-MAN-D-006 — Saved-plan restart and no premature writes

**Acceptance links:** INV-AC-PLAN-005, INV-AC-PLAN-009,
INV-AC-TXN-007, INV-AC-REG-013

**Preconditions**

- Record stock, lots, movements, and batch counts.

**Steps**

1. Create and save a production plan without starting preparation.
2. Force-close the app.
3. Reopen offline and restore the saved plan.
4. Edit target and lot recommendation, then save again.
5. Delete/cancel the disposable plan.
6. Compare inventory/history counts with the precondition.

**Expected results**

- The plan restores all planned fields and version references offline.
- No production, deduction, movement, or COGS row exists.
- Save/edit remains one logical plan rather than duplicates.
- Cancellation removes only the allowed plan state.

## Phase E — Kiosk order editor

### INV-MAN-E-001 — Product, quantity, and order supply rules

**Acceptance links:** INV-AC-SUPPLY-001 through INV-AC-SUPPLY-005

**Preconditions**

- Each Musubi requires one wrapper.
- Every two Musubi suggests one pair of chopsticks.
- Each order includes one editable plastic bag and one optional tissue.

**Steps**

1. Add three Musubi and two drinks to the cart.
2. Open Review Order.
3. Inspect wrapper, chopstick, bag, and tissue quantities.
4. Change Musubi quantity to four, then one.
5. Remove tissue and the editable bag.
6. Attempt to remove required wrappers.

**Expected results**

- Per-product, per-quantity, and per-order rules calculate correctly.
- Order-level rules appear only once.
- Quantity edits immediately recalculate suggestions.
- Optional/editable supplies can be removed.
- Required wrapper quantity cannot fall below the rule.

### INV-MAN-E-002 — Supply shortage

**Acceptance links:** INV-AC-SUPPLY-006, INV-AC-SUPPLY-010

**Preconditions**

- Required wrappers are below the calculated need.
- Optional chopsticks are also below the suggestion.

**Steps**

1. Build an order that exceeds both supplies.
2. Open Review Order.
3. Try to confirm without editing.
4. Reduce product quantity or edit optional supplies according to the UI.

**Expected results**

- Exact available versus required/suggested quantities are visible.
- Required shortage follows the approved blocking policy.
- Optional shortage follows the approved warning/edit policy.
- No negative or fabricated supply stock is shown.

### INV-MAN-E-003 — Atomic supply checkout

**Acceptance links:** INV-AC-SUPPLY-007 through INV-AC-SUPPLY-009,
INV-AC-TXN-002, INV-AC-REG-002

**Preconditions**

- Record product, ingredient-lot, and supply stock.
- Build an order containing prepared stock, a cook-upon-order product, and
  tracked supplies.

**Steps**

1. Review and confirm exact product and supply quantities.
2. Open the resulting order, receipt, movements, and reports.
3. Compare all post-checkout stock with the recorded precondition.

**Expected results**

- Exactly one Sale, receipt, and pending queue entry exist.
- Products, ingredient lots, and supplies decrease by exact confirmed amounts.
- Movements/usages trace every deduction.
- Product COGS, packaging, utensil/condiment, and total order cost remain
  distinguishable.

### INV-MAN-E-004 — Double confirmation and restart retry

**Acceptance links:** INV-AC-SUPPLY-008, INV-AC-TXN-003,
INV-AC-TXN-004

**Preconditions**

- Build one order with tracked product and supply stock.
- Record stock and movement counts.

**Steps**

1. Rapidly double-tap Confirm Order.
2. If a supported interruption test hook exists, interrupt after confirmation
   begins and reopen the app.
3. Retry using the same checkout state/token.
4. Inspect sales, receipts, queue, usages, movements, and stock.

**Expected results**

- One checkout result is shown.
- Exactly one set of persisted effects exists.
- Restart/retry returns the completed sale or a safe retry state.
- Products, lots, and supplies are never double-deducted.

### INV-MAN-E-005 — Seller/owner boundaries

**Acceptance links:** INV-AC-SUPPLY-011, INV-AC-LIFE-006,
INV-AC-REG-011

**Preconditions**

- Owner PIN is enabled.
- Kiosk mode is confirmed for one active stall.

**Steps**

1. From Kiosk, review and edit only order-level editable supplies.
2. Try normal navigation and deep-link attempts to supply administration,
   recipe editing, permanent delete, adjustment, mark-empty, and manual lot
   selection.
3. Enter Owner mode with a wrong PIN until throttled.
4. After the allowed recovery, authenticate correctly and open the owner
   actions.

**Expected results**

- Kiosk permits operational order review but not administrative inventory
  mutation.
- Owner routes remain gated.
- PIN attempt limits survive navigation/restart as designed.
- Correct owner authorization restores only the approved owner capabilities.

## Phase F — Full validation and handoff

### INV-MAN-F-001 — Legacy workflow regression

**Acceptance links:** INV-AC-REG-001 through INV-AC-REG-013

**Preconditions**

- Use the current seller pilot checklist as the legacy regression source.
- Prepare two stalls and data for Grocery, recipe, production, checkout,
  cook-upon-order, transfer, spoilage, fixed costs, and reports.

**Steps**

1. Repeat business/stall context switching and Kiosk confirmation.
2. Verify legacy bundle quantities 7, 8, 9, 16, and 17.
3. Verify selected-lot recipe cost and incompatible-unit rejection.
4. Produce a flat legacy recipe and verify exact stock/movements.
5. Complete prepared-stock and cook-upon-order sales.
6. Transfer stock and record finished-product spoilage.
7. Add/pay a fixed cost and open Today/Week/Month/All reports.
8. Save and share a sanitized problem report.
9. Close and reopen the app offline.

**Expected results**

- All protected legacy arithmetic and transaction outcomes remain unchanged.
- Transfers remain value-neutral and spoilage remains separately reported.
- Fixed-cost and profit formulas remain consistent.
- Problem reporting does not expose sensitive values.
- All local data remains available offline after restart.

### INV-MAN-F-002 — Fresh and upgraded behavior parity

**Acceptance links:** INV-AC-MIG-001 through INV-AC-MIG-011

**Preconditions**

- One fresh-install test database and one upgraded schema-v10 database exist.

**Steps**

1. Create the same six classifications and nested recipe in each database.
2. Add equivalent lots, plan/produce the same output, and sell the same order.
3. Compare current statuses, calculations, movements, COGS categories, and
   reports.
4. Reopen both applications offline.

**Expected results**

- Newly created equivalent records behave consistently.
- Legacy history exists only in the upgraded database and remains unchanged.
- No migration-only error, duplicate, or hidden classification appears.

### INV-MAN-F-003 — Low-end-device performance and accessibility

**Acceptance links:** INV-AC-PERF-001 through INV-AC-PERF-011

**Preconditions**

- Use the designated low-end Android device.
- Enable large font.
- Prepare a documented maximum-depth graph, a wide repeated-ingredient graph,
  at least 50 Recipe Book entries, many lots, and a multi-line cart.

**Steps**

1. Scroll and filter Recipe Book without opening details.
2. Open and recalculate a complete-tree production plan.
3. Change target quantity repeatedly.
4. Search and page through lot choices.
5. Open order review and edit supplies.
6. Trigger autosave while typing quickly.
7. Use Android Back/cancel throughout.

**Expected results**

- No list item causes full graph expansion.
- Representative screens show no visible freeze longer than one second.
- Inputs, Back, and cancel remain responsive.
- No recursion failure, duplicate requirement, or runaway autosave appears.
- Layout remains readable with large text and touch targets remain usable.

### INV-MAN-F-004 — Offline interruption and recovery

**Acceptance links:** INV-AC-DRAFT-002, INV-AC-PLAN-005,
INV-AC-PLAN-009, INV-AC-TXN-001 through INV-AC-TXN-009,
INV-AC-REG-013

**Preconditions**

- Airplane mode is enabled.
- Draft, saved plan, in-progress preparation, and cart fixtures are available.

**Steps**

1. Force-close during draft editing and verify recovery.
2. Force-close after saving but before starting a production plan.
3. Use approved failure-injection builds/hooks to interrupt each material
   production and checkout transaction boundary.
4. Reopen and inspect stock, history, plans, sales, receipts, and queue entries.
5. Retry permitted operations with their original stable token/ID.

**Expected results**

- Draft and saved-plan state recovers locally.
- No partial transaction survives a forced failure.
- Retry creates at most one committed result.
- No network prompt or background sync is required.

### INV-MAN-F-005 — Report and cost-category reconciliation

**Acceptance links:** INV-AC-SUPPLY-009, INV-AC-ADJUST-001 through
INV-AC-ADJUST-007, INV-AC-REG-005 through INV-AC-REG-009

**Preconditions**

- Complete sales with product, packaging, and utensil/condiment costs.
- Record personal use, spoilage, counting correction, production, transfer, and
  fixed cost in the same known report period.

**Steps**

1. Calculate expected revenue, sold product COGS, supply categories, spoilage,
   fixed costs, and net profit independently from recorded fixture amounts.
2. Open Today/Week/Month/All and relevant stall/consolidated reports.
3. Open underlying movements/usages for each category.

**Expected results**

- Report totals match the independently calculated values within documented
  tolerance.
- Personal use does not contaminate product COGS.
- Transfers and unsold inventory are not expenses.
- Packaging and utensil/condiment costs remain distinguishable.
- Every aggregate is traceable to persisted history.

### INV-MAN-F-006 — Identity and protected artifact closeout

**Acceptance links:** INV-AC-PROTECT-001 through INV-AC-PROTECT-008

**Preconditions**

- Use read-only identity/configuration and protected-artifact baseline evidence.
- Do not run a build.

**Steps**

1. Verify Android package, Expo owner/slug, EAS project ID, version, and
   versionCode.
2. Verify signing references are unchanged.
3. Verify the protected AAB path, size, timestamp, and SHA-256 against the
   recorded baseline.
4. Inspect Git scope for unapproved application identity, cloud, permission,
   signing, artifact, and build-output files.

**Expected results**

- Identity values exactly match the protected baseline.
- Signing and cloud configuration are unchanged.
- The protected AAB metadata/hash is unchanged.
- No new APK/AAB/build output exists from this redesign validation.

### INV-MAN-F-007 — Final problem-report and handoff evidence

**Acceptance links:** INV-AC-REG-010, INV-AC-BASE-005,
INV-AC-BASE-006

**Preconditions**

- All required Phase F scenarios have execution records.

**Steps**

1. Create one owner-mode and one Kiosk-mode synthetic problem report.
2. Include route/action breadcrumbs but no sensitive or customer data.
3. Copy/share the report and inspect redaction.
4. Assemble scenario results, device details, defects, query/performance
   evidence, migration evidence, and unresolved risks.
5. Run documentation link, metadata, required-field, whitespace, final-newline,
   and Git-scope validation.

**Expected results**

- Reports are stored locally once and redact sensitive fields.
- Handoff evidence distinguishes passed, failed, blocked, and not-run scenarios.
- No planned scenario is represented as executed without evidence.
- Documentation and Git-scope validation pass.

## Stop conditions during manual execution

Stop the affected scenario immediately and preserve non-sensitive evidence if:

- any migration loses or reinterprets historical data;
- a plan changes inventory before production starts;
- a failed transaction leaves partial stock, history, Sale, receipt, or queue
  state;
- retry double-deducts a product, lot, or supply;
- a draft or archived item appears unexpectedly in Kiosk;
- seller mode reaches an owner-only mutation;
- a graph loops, overflows, double-counts, or exceeds its documented bound
  without a friendly error;
- a missing value is fabricated;
- an identity, signing, permission, version, Expo/EAS, or protected-AAB value
  changes;
- a scenario would require Internet access contrary to the offline-first
  policy.

Record the failed scenario ID and defect. Do not repair test data by deleting
history or directly overwriting quantities.
