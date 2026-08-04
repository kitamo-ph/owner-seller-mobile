# Tindahan lifecycle unblock — change report

**Commit:** `c49e132` · **Branch:** `feat/mob-inventory-recipe-redesign` (1 ahead of origin, not pushed)
**Baseline:** `6a2c93b` · **Scope:** 15 files, +2,049 / −11 (510 of those insertions are `package-lock.json`)

## 1. The blocker, precisely

Marking a Recipe ready produced an item that could never be produced and never be sold.
It was not one bug — publication wrote a state that **four independent gates** all reject,
and no code anywhere could move any of them.

| Gate | Required value | What publication actually wrote |
| --- | --- | --- |
| `catalog_items.lifecycle_status` | `'active'` | `'ready'` |
| `catalog_items.readiness_state` | `'ready'` | `'incomplete'` (hard-coded) |
| `catalog_items.sellable` / `kiosk_enabled` | `1` / `1` | `0` / `0` |
| `products.active` | `1` | `0` |

Three separate consumers depend on those columns, and each one refused the item:

- **Paninda `Active`** — `resolvePanindaSection` needs `lifecycle === 'active' && readinessState === 'ready' && productActive`.
  The item sat in `Needs Setup` permanently.
- **Native production readiness** — `loadNativeProductionReadiness` additionally joined on
  `product_projection.active = 1`, producing the message you saw:
  *"Recipe has no active Paninda Product projection."*
- **Kiosk** — `listKioskEligibleCatalogProducts` requires all six of
  `review_required = 0`, `lifecycle_status = 'active'`, `sellable = 1`, `kiosk_enabled = 1`,
  `selling_price_state = 'known'`, `products.active = 1`.

And there was no escape hatch in the UI: `resolvePanindaActionPolicy` withheld both
`editSellingItem` and `addPurchasedStock` from Recipe-backed items, so no screen could
set a price or activate anything. The only writer that ever set `products.active = 1`
was `createProduct`, reachable exclusively from the direct-resale *Bagong Paninda* flow.

The lifecycle simply terminated at publication. That is the "endless cycle".

## 2. What changed

### 2.1 The missing transition (new)

`src/domain/panindaListing.ts` — pure eligibility logic, fail-closed, with owner-facing
Taglish copy for every blocker.
`src/db/repositories/panindaListing.ts` — the only writer permitted to set the
Kiosk-eligible column combination, plus its inverse and archive restore.

Three transitions, all atomic and owner-authorized:

- **List for sale** — sets `lifecycle_status='active'`, `readiness_state='ready'`,
  `sellable=1`, `kiosk_enabled=1`, `selling_price_state='known'`, `products.active=1`,
  and the price, in one transaction.
- **Unlist** — returns the item to `ready` and deactivates the projection. Stock, Recipe,
  history, and the price are untouched, so listing is never a one-way decision.
- **Restore from archive** — returns an archived item to `ready`. Archiving previously had
  no inverse, which made it its own trap.

Eligibility is re-evaluated **inside** the transaction against the persisted row, never
against caller-supplied state, and every write is row-count guarded against concurrent
modification.

### 2.2 Publication now derives readiness

`resolvePublishedReadinessState()` computes `readiness_state` from the published
definition (graph state + presence of input lines) instead of the hard-coded
`'incomplete'` that nothing could clear. Republishing refreshes readiness but never
changes listing state — an item already on sale stays on sale, and an unlisted one is
never silently listed.

### 2.3 Production decoupled from "on sale"

`loadNativeProductionReadiness` no longer joins on `product_projection.active = 1`.
Producing stock is upstream of selling it; you must be able to cook something before you
decide to list it. Tenant scoping (`business_id`), branch scoping, and dangling-binding
rejection are all unchanged — only the sale-state requirement was removed. The remaining
blocker message is now owner-readable Taglish rather than internal vocabulary.

### 2.4 UI

- Action sheet gains **Ilagay sa Tindahan**, **Palitan ang presyo**, **Alisin sa
  Tindahan**, **Ibalik mula sa Archive**. Listing is ordered first — for a freshly
  published Recipe it is the action that completes the lifecycle, so it must not sit
  below the fold.
- New `ListingPriceSheet` asks for a price when one is missing, and doubles as the
  repricing surface. It follows the same reachability contract the action sheet is held
  to: bounded max height from window height and safe-area inset, fixed header outside the
  scroll area, Android Back and scrim both close, confirm action always reachable.
- `Needs Setup` rows now explain themselves: either "Handa na ito. Piliin ang Ilagay sa
  Tindahan…" or "May kulang pang detalye…", instead of showing a bare warning chip.

### 2.5 One trap I created and removed

My first pass enabled the legacy edit form for Recipe-backed items so a price could be
set. Two problems, both caught by the existing checks rather than by me:

1. That form also renames the Product, which would desync from the Recipe `name_snapshot`
   on the next republish.
2. Once listed, `listForSale` goes false — so there would have been **no way to change the
   price of a listed item**. A new dead end, in the fix for a dead end.

Resolved by reverting the edit-form change and adding an explicit `changeSellingPrice`
action that reuses the same tested transaction.

## 3. Deliberately changed contracts

Two existing protected expectations were wrong and are now changed, with the reasoning
recorded in the check files themselves:

| Check | Was | Now | Why |
| --- | --- | --- | --- |
| `check-paninda-stabilization` | archived records offer **zero** actions | archived records offer **exactly** `restoreFromArchive` | Archive with no inverse is the same class of one-way trap. Restore mutates no history; it returns the item to `ready`, where listing stays a separate explicit act. |
| `check-grocery-production-stabilization` | readiness SQL **must** contain `product_projection.active = 1` | readiness SQL **must not** contain it; an unlisted projection resolves | Requiring an item to be on sale before it can be cooked is backwards and was a direct cause of the blocker. |

Both are behavior changes, not test loosening — each replaced assertion is now an
assertion of the opposite, not a deletion.

## 4. Verification

`check:paninda-listing-transactions` (new, 536 lines) drives the real repository
transactions against real SQLite and proves the full round trip:

```
baseline unlisted published Recipe: passed
listing without a price is refused atomically: passed
unauthorized listing is fail-closed: passed
listing reaches Active + Kiosk eligibility: passed
unlisting is reversible and preserves evidence: passed
relisting reuses retained price: passed
archive -> restore -> relist round trip: passed
integrity_check and foreign_key_check: passed
```

It asserts Kiosk eligibility using the exact native branch of the real
`listKioskEligibleCatalogProducts` predicate — 0 eligible before listing, 1 after — so
the proof is against the shipping query, not a paraphrase of it.

Full suite, true exit code captured (not masked by a pipeline):

```
UMBRELLA_EXIT=0
38 checks PASS · 1 SKIPPED (phase-preflight — worktree was dirty mid-run, expected)
```

`npm run typecheck` clean · `npm run lint` exit 0 · protected identity and AAB SHA-256
still PASS · `check:phase-preflight` exit 0 on the committed clean tree.

## 5. What you can now do on the phone

1. Recipe Book → build and **Mark Ready** as before.
2. Paninda → **Needs Setup** → the item is there with a line telling you it is ready.
3. Three-dot → **Ilagay sa Tindahan** → enter a price → confirm.
4. It moves to **Active** and becomes sellable in Kiosk.
5. **Produce from Recipe** now works *without* listing first — cook stock, then list.
6. **Palitan ang presyo** reprices; **Alisin sa Tindahan** takes it off sale without
   losing stock, Recipe, or history; archived items can be restored.

## 6. Limits and things I did not do

- **Not pushed.** The commit is local, branch is 1 ahead of origin. Cursor also works this
  branch, so the push is yours to make.
- **No physical-device test.** Everything here is verified at the domain, transaction, and
  structure level. The phone run is still needed and is the real acceptance.
- **The design zip was not applied.** `# KitaMo Product Redesign (5).zip` is a visual
  redesign aligned to `main@9aecc0f` (Phase B), an older baseline, and its §12 explicitly
  says inventory gets visual treatment with "all engine flows untouched". Your blocker was
  logic, so applying a re-skin on top would have mixed a large cosmetic diff into a
  correctness fix. It remains available as a separate piece of work.
- **`prepared_base` is not listable.** Prepared bases are managed in Recipe Book by design.
  The Kiosk query does permit selling them, so if you want to sell a prepared base directly
  that is a small, separate decision — not a dead end today.
- **Broader audit incomplete.** I launched a six-agent parallel audit for *other* dead ends
  of this class across Grocery, Kiosk, and the recipe-publish flow. All six agents failed on
  the monthly spend limit and returned nothing. The fix above rests on my own direct tracing,
  which is complete for this defect, but the wider sweep for sibling defects has not run.
