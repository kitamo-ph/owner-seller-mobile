/**
 * Focused pure-domain check for immutable recipe publication and selection.
 *
 * Compile first:
 * tsc src/domain/recipeVersioning.ts --outDir node_modules/.cache/kitamo-recipe-versioning-check
 */

"use strict";

const {
  assessRecipeVersionMutation,
  createNextVersionDraft,
  duplicateVersionIntoNewFamily,
  getExactRecipeVersion,
  publishRecipeVersion,
  resolveProductionRecipeVersion,
  transitionRecipeVersionStatus,
  validateDefaultRecipeInvariant,
  validateRecipeVersionDraft,
} = require("../node_modules/.cache/kitamo-recipe-versioning-check/recipeVersioning.js");

let failures = 0;

function check(name, condition, details = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${name}: ${ok ? "OK" : "FAIL"}${details ? ` (${details})` : ""}`);
}

const draft = {
  id: "draft-musubi",
  familyId: "family-musubi",
  businessId: "business-1",
  basedOnVersionId: null,
  duplicatedFromVersionId: null,
  name: "Musubi",
  category: "Meals",
  outputCatalogItemId: "item-musubi",
  expectedOutputQuantity: 10,
  outputUnit: "pcs",
  productionMode: "prepared_before_selling",
  suggestedSellingPrice: null,
  sellingPriceState: "unknown",
  requestedReadyForSale: false,
  notes: "Initial recipe",
  inputs: [
    {
      id: "draft-line-rice",
      sourceKind: "catalog_item",
      catalogItemId: "item-rice",
      label: "Rice",
      quantity: 500,
      unit: "g",
      role: "main",
      optional: false,
      costState: "unknown",
      authoritativeUnitCost: null,
    },
  ],
  revision: 2,
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:02:00.000Z",
};

const validation = validateRecipeVersionDraft(draft);
check("missing purchase cost does not block publication", validation.valid);
check("missing purchase cost marks incomplete", !validation.costComplete);
check(
  "selling price remains optional before sale readiness",
  !validation.errors.some((error) => error.code === "selling_price_required"),
);

const publication = publishRecipeVersion(
  draft,
  {},
  {
    versionId: "musubi-v1",
    versionNumber: 1,
    effectiveAt: "2026-07-26T01:00:00.000Z",
  },
);
check("valid draft publishes", publication.ok);

if (publication.ok) {
  const version = publication.version;
  check("published version is frozen", Object.isFrozen(version));
  check("published inputs are frozen", Object.isFrozen(version.inputs[0]));
  try {
    version.name = "Mutated";
  } catch {
    // Expected in strict mode.
  }
  check("published definition cannot mutate in place", version.name === "Musubi");
  check("unknown cost preserved, not fabricated", version.inputs[0].authoritativeUnitCost === null);

  const mutation = assessRecipeVersionMutation(version, 3);
  check(
    "used version requires a new version",
    !mutation.mutableInPlace &&
      mutation.action === "create_new_version" &&
      mutation.reason === "historical_version_is_referenced",
  );

  const nextDraft = createNextVersionDraft(version, {
    draftId: "draft-musubi-v2",
    now: "2026-07-26T02:00:00.000Z",
  });
  check("edit keeps stable family", nextDraft.familyId === version.familyId);
  check("edit pins source version", nextDraft.basedOnVersionId === version.id);
  check("edit receives independent line IDs", nextDraft.inputs[0].id !== version.inputs[0].id);

  const duplicate = duplicateVersionIntoNewFamily(version, {
    newFamilyId: "family-musubi-spicy",
    newDraftId: "draft-musubi-spicy",
    now: "2026-07-26T03:00:00.000Z",
    name: "Spicy Musubi",
  });
  check("duplicate has independent family", duplicate.familyId !== version.familyId);
  check("duplicate records provenance", duplicate.duplicatedFromVersionId === version.id);
  check("duplicate does not copy sale readiness", duplicate.requestedReadyForSale === false);

  const superseded = transitionRecipeVersionStatus(version, "superseded");
  check("status transition returns a new snapshot", superseded !== version);
  check("status transition keeps immutable content", superseded.name === version.name);
  check("original status remains published", version.status === "published");

  const exact = getExactRecipeVersion([version, superseded], "musubi-v1");
  check("exact retrieval does not choose a newer fallback", exact === version);

  const alternativeDraft = {
    ...draft,
    id: "draft-alt",
    familyId: "family-musubi-alt",
    name: "Alternative Musubi",
  };
  const alternativePublication = publishRecipeVersion(
    alternativeDraft,
    {},
    {
      versionId: "musubi-alt-v1",
      versionNumber: 1,
      effectiveAt: "2026-07-26T04:00:00.000Z",
    },
  );

  if (alternativePublication.ok) {
    const roles = [
      {
        outputCatalogItemId: "item-musubi",
        familyId: version.familyId,
        versionId: version.id,
        role: "default",
        active: true,
      },
      {
        outputCatalogItemId: "item-musubi",
        familyId: alternativePublication.version.familyId,
        versionId: alternativePublication.version.id,
        role: "alternative",
        active: true,
      },
    ];
    check("one default recipe invariant passes", validateDefaultRecipeInvariant(roles).ok);

    const defaultSelection = resolveProductionRecipeVersion({
      outputCatalogItemId: "item-musubi",
      versions: [version, alternativePublication.version],
      roles,
    });
    check(
      "implicit selection resolves only the default",
      defaultSelection.ok &&
        defaultSelection.selection === "default" &&
        defaultSelection.version.id === version.id,
    );

    const explicitAlternative = resolveProductionRecipeVersion({
      outputCatalogItemId: "item-musubi",
      versions: [version, alternativePublication.version],
      roles,
      explicitVersionId: alternativePublication.version.id,
    });
    check(
      "alternative requires and honors exact selection",
      explicitAlternative.ok &&
        explicitAlternative.selection === "explicit" &&
        explicitAlternative.version.id === alternativePublication.version.id,
    );

    const conflictingRoles = [
      roles[0],
      {
        ...roles[1],
        role: "default",
      },
    ];
    const conflict = validateDefaultRecipeInvariant(conflictingRoles);
    check(
      "two implicit defaults are rejected",
      !conflict.ok && conflict.code === "multiple_default_recipes",
    );
  } else {
    check("alternative fixture publishes", false);
  }
}

const readyWithoutPrice = validateRecipeVersionDraft({
  ...draft,
  id: "ready-no-price",
  requestedReadyForSale: true,
});
check(
  "missing selling price blocks sale readiness",
  !readyWithoutPrice.valid &&
    readyWithoutPrice.errors.some((error) => error.code === "selling_price_required"),
);

const unresolved = validateRecipeVersionDraft({
  ...draft,
  id: "unresolved",
  inputs: [
    {
      id: "placeholder",
      sourceKind: "unresolved",
      label: "New prepared base",
      quantity: null,
      unit: null,
      role: "main",
      optional: false,
      costState: "unknown",
      authoritativeUnitCost: null,
    },
  ],
});
check(
  "unresolved placeholder cannot publish",
  !unresolved.valid &&
    unresolved.errors.some((error) => error.code === "unresolved_input"),
);

if (failures === 0) {
  console.log("ALL RECIPE VERSIONING CHECKS PASSED");
  process.exit(0);
}

console.error(`${failures} RECIPE VERSIONING CHECKS FAILED`);
process.exit(1);
