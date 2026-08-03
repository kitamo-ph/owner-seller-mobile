# Phase C2–D1 approved design decisions

These decisions were independently inspected and are approved for the
accepted C2–D1 implementation. They are not defects.

## Decision 1 — Conversion snapshot persistence

Migration `016_recipe_usability` stores validated conversion-chain JSON
snapshots on Recipe lines and related evidence, rather than introducing
normalized `conversion_chain` / `conversion_steps` tables.

Rationale:

* Offline SQLite remains simple for owner devices with no network dependency.
* A single validated snapshot persists atomically with the Recipe line or lot.
* Historical costing keeps an immutable evidence blob that later edits cannot
  silently rewrite.
* Avoiding normalized step tables reduces schema expansion risk during a
  usability stabilization phase.
* Snapshots are parsed and validated through
  `validateRecipeConversionSnapshotEvidence` before acceptance.
* If queryable conversion steps become necessary later, an additive migration
  can project snapshots into normalized tables without discarding history.

## Decision 2 — Destructive confirmation

Permanent delete uses two sequential destructive confirmations instead of
exact-name typing.

Rationale:

* Small Android screens and large font settings make exact-name typing
  burdensome and error-prone.
* Owner-only access already bounds who can reach destructive actions.
* Lifecycle reference eligibility checks remain the authoritative safety gate.
* Archive remains the offered alternative whenever history exists.
* Accidental confirmation risk is reduced by requiring two explicit confirms
  and by disabling delete when references exist.
* Exact-name entry should be reconsidered only if owner testing shows that
  two confirms are still too easy to dismiss, or if non-owner roles later
  gain delete access.

## Decision 3 — Original lot evidence

`ingredient_lots.entered_quantity` and `ingredient_lots.entered_unit` preserve
the owner-entered purchase evidence.

Rationale:

* Owners enter purchases in practical units such as US gallons or packs.
* Normalized operational units remain separate for deduction and costing.
* Historical interpretation must not depend solely on converted values after
  unit-standard or conversion edits.
* Original entered evidence supports audit, Missing Prices completion, and
  owner-readable lot detail.
