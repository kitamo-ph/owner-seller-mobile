import {
  makeCatalogCostProfileId,
  makeRecipeVersionCostSummaryId,
} from "@/domain/ids";

import {
  getRepositoryDatabase,
  nowIso,
  type RepositoryDatabase,
} from "./shared";

export type CatalogCostProfileSource =
  | "owner_estimate"
  | "recipe_version";
export type CatalogCostProfileStatus =
  | "active"
  | "superseded"
  | "archived";
export type RecipeLineCostSource =
  | "purchase_lot"
  | "owner_estimate"
  | "recipe_version"
  | "custom"
  | "unknown"
  | "legacy_snapshot"
  | "not_applicable";
export type RecipeVersionCostSummaryStatus =
  | "actual"
  | "estimated"
  | "incomplete"
  | "no_price";

export type CatalogCostProfileRecord = {
  id: string;
  businessId: string;
  catalogItemId: string;
  sourceKind: CatalogCostProfileSource;
  totalCost: number;
  referenceQuantity: number;
  referenceUnit: string;
  requestToken: string | null;
  sourceRecipeVersionId: string | null;
  supersedesProfileId: string | null;
  status: CatalogCostProfileStatus;
  effectiveAt: string;
  supersededAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type RecipeVersionCostSummaryRecord = {
  id: string;
  businessId: string;
  recipeVersionId: string;
  status: RecipeVersionCostSummaryStatus;
  totalCost: number | null;
  costPerOutputUnit: number | null;
  knownCostSubtotal: number;
  missingRequiredCount: number;
  estimatedInputCount: number;
  createdAt: string;
  deletedAt: string | null;
};

type CatalogCostProfileRow = {
  id: string;
  business_id: string;
  catalog_item_id: string;
  source_kind: CatalogCostProfileSource;
  total_cost: number;
  reference_quantity: number;
  reference_unit: string;
  request_token: string | null;
  source_recipe_version_id: string | null;
  supersedes_profile_id: string | null;
  status: CatalogCostProfileStatus;
  effective_at: string;
  superseded_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RecipeVersionCostSummaryRow = {
  id: string;
  business_id: string;
  recipe_version_id: string;
  status: RecipeVersionCostSummaryStatus;
  total_cost: number | null;
  cost_per_output_unit: number | null;
  known_cost_subtotal: number;
  missing_required_count: number;
  estimated_input_count: number;
  created_at: string;
  deleted_at: string | null;
};

export type ActivateCatalogCostProfileInput = {
  id?: string;
  businessId: string;
  catalogItemId: string;
  sourceKind: CatalogCostProfileSource;
  totalCost: number;
  referenceQuantity: number;
  referenceUnit: string;
  requestToken?: string | null;
  sourceRecipeVersionId?: string | null;
  notes?: string | null;
  effectiveAt?: string;
  expectedActiveProfileId?: string | null;
};

export type CreateRecipeVersionCostSummaryInput = {
  id?: string;
  businessId: string;
  recipeVersionId: string;
  status: RecipeVersionCostSummaryStatus;
  totalCost: number | null;
  costPerOutputUnit: number | null;
  knownCostSubtotal: number;
  missingRequiredCount: number;
  estimatedInputCount: number;
};

function mapProfile(row: CatalogCostProfileRow): CatalogCostProfileRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    catalogItemId: row.catalog_item_id,
    sourceKind: row.source_kind,
    totalCost: row.total_cost,
    referenceQuantity: row.reference_quantity,
    referenceUnit: row.reference_unit,
    requestToken: row.request_token,
    sourceRecipeVersionId: row.source_recipe_version_id,
    supersedesProfileId: row.supersedes_profile_id,
    status: row.status,
    effectiveAt: row.effective_at,
    supersededAt: row.superseded_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapSummary(
  row: RecipeVersionCostSummaryRow,
): RecipeVersionCostSummaryRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    recipeVersionId: row.recipe_version_id,
    status: row.status,
    totalCost: row.total_cost,
    costPerOutputUnit: row.cost_per_output_unit,
    knownCostSubtotal: row.known_cost_subtotal,
    missingRequiredCount: row.missing_required_count,
    estimatedInputCount: row.estimated_input_count,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function validateProfileInput(input: ActivateCatalogCostProfileInput) {
  if (!input.businessId.trim() || !input.catalogItemId.trim()) {
    throw new Error("Cost profile requires business and catalog item identity.");
  }
  if (!Number.isFinite(input.totalCost) || input.totalCost < 0) {
    throw new Error("Cost profile total cost must be zero or higher.");
  }
  if (
    !Number.isFinite(input.referenceQuantity) ||
    input.referenceQuantity <= 0
  ) {
    throw new Error("Cost profile reference quantity must be greater than zero.");
  }
  if (!input.referenceUnit.trim()) {
    throw new Error("Cost profile reference unit is required.");
  }
  if (
    input.sourceKind === "recipe_version" &&
    !input.sourceRecipeVersionId?.trim()
  ) {
    throw new Error("Recipe-derived cost requires an exact Recipe version.");
  }
  if (
    input.sourceKind === "owner_estimate" &&
    input.sourceRecipeVersionId
  ) {
    throw new Error("Owner estimates cannot claim Recipe-derived evidence.");
  }
  if (
    input.sourceKind === "owner_estimate" &&
    !input.requestToken?.trim()
  ) {
    throw new Error("Owner estimates require an idempotency request token.");
  }
  if (input.sourceKind === "recipe_version" && input.requestToken) {
    throw new Error("Recipe-derived costs cannot carry an estimate request token.");
  }
}

function validateSummaryInput(input: CreateRecipeVersionCostSummaryInput) {
  if (!input.businessId.trim() || !input.recipeVersionId.trim()) {
    throw new Error("Recipe cost summary requires business and version identity.");
  }
  if (
    !Number.isFinite(input.knownCostSubtotal) ||
    input.knownCostSubtotal < 0 ||
    !Number.isSafeInteger(input.missingRequiredCount) ||
    input.missingRequiredCount < 0 ||
    !Number.isSafeInteger(input.estimatedInputCount) ||
    input.estimatedInputCount < 0
  ) {
    throw new Error("Recipe cost summary counts and subtotal are invalid.");
  }
  const hasCompleteTotals =
    input.totalCost !== null &&
    Number.isFinite(input.totalCost) &&
    input.totalCost >= 0 &&
    input.costPerOutputUnit !== null &&
    Number.isFinite(input.costPerOutputUnit) &&
    input.costPerOutputUnit >= 0;
  if (
    (input.status === "actual" || input.status === "estimated") &&
    !hasCompleteTotals
  ) {
    throw new Error("Complete Recipe cost summaries require numeric totals.");
  }
  if (
    (input.status === "incomplete" || input.status === "no_price") &&
    (input.totalCost !== null || input.costPerOutputUnit !== null)
  ) {
    throw new Error("Incomplete Recipe cost summaries cannot claim a total.");
  }
  if (
    (input.status === "actual" &&
      (input.missingRequiredCount !== 0 ||
        input.estimatedInputCount !== 0)) ||
    (input.status === "estimated" &&
      (input.missingRequiredCount !== 0 ||
        input.estimatedInputCount === 0)) ||
    (input.status === "incomplete" && input.missingRequiredCount === 0)
  ) {
    throw new Error("Recipe cost summary status does not match its evidence.");
  }
}

export async function getCatalogCostProfileById(
  id: string,
  db?: RepositoryDatabase,
) {
  const row =
    await getRepositoryDatabase(db).getFirstAsync<CatalogCostProfileRow>(
      `
        SELECT *
        FROM catalog_cost_profiles
        WHERE id = ? AND deleted_at IS NULL
      `,
      [id],
    );
  return row ? mapProfile(row) : null;
}

export async function getActiveCatalogCostProfile(
  catalogItemId: string,
  db?: RepositoryDatabase,
) {
  const row =
    await getRepositoryDatabase(db).getFirstAsync<CatalogCostProfileRow>(
      `
        SELECT *
        FROM catalog_cost_profiles
        WHERE catalog_item_id = ? AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [catalogItemId],
    );
  return row ? mapProfile(row) : null;
}

export async function getCatalogCostProfileByRequestToken(
  businessId: string,
  requestToken: string,
  db?: RepositoryDatabase,
) {
  const row =
    await getRepositoryDatabase(db).getFirstAsync<CatalogCostProfileRow>(
      `
        SELECT *
        FROM catalog_cost_profiles
        WHERE business_id = ? AND request_token = ?
          AND source_kind = 'owner_estimate'
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [businessId, requestToken.trim()],
    );
  return row ? mapProfile(row) : null;
}

export async function listCatalogCostProfileHistory(
  catalogItemId: string,
  db?: RepositoryDatabase,
) {
  const rows =
    await getRepositoryDatabase(db).getAllAsync<CatalogCostProfileRow>(
      `
        SELECT *
        FROM catalog_cost_profiles
        WHERE catalog_item_id = ? AND deleted_at IS NULL
        ORDER BY effective_at DESC, id DESC
      `,
      [catalogItemId],
    );
  return rows.map(mapProfile);
}

export async function activateCatalogCostProfileInTransaction(
  input: ActivateCatalogCostProfileInput,
  db: RepositoryDatabase,
) {
  validateProfileInput(input);
  if (input.sourceKind === "owner_estimate") {
    const repeated = await getCatalogCostProfileByRequestToken(
      input.businessId,
      input.requestToken as string,
      db,
    );
    if (repeated) {
      const sameRequest =
        repeated.catalogItemId === input.catalogItemId &&
        Math.abs(repeated.totalCost - input.totalCost) <= 1e-9 &&
        Math.abs(repeated.referenceQuantity - input.referenceQuantity) <=
          1e-9 &&
        repeated.referenceUnit === input.referenceUnit.trim();
      if (!sameRequest) {
        throw new Error(
          "Owner-estimate request token was already used for different evidence.",
        );
      }
      return repeated;
    }
  }
  const item = await db.getFirstAsync<{ business_id: string }>(
    `
      SELECT business_id
      FROM catalog_items
      WHERE id = ? AND deleted_at IS NULL
        AND lifecycle_status <> 'archived'
    `,
    [input.catalogItemId],
  );
  if (item?.business_id !== input.businessId) {
    throw new Error("Cost profile catalog item is unavailable.");
  }

  if (input.sourceKind === "recipe_version") {
    const source = await db.getFirstAsync<{
      business_id: string;
      output_catalog_item_id: string;
      status: string;
    }>(
      `
        SELECT business_id, output_catalog_item_id, status
        FROM recipe_versions
        WHERE id = ? AND deleted_at IS NULL
      `,
      [input.sourceRecipeVersionId as string],
    );
    if (
      source?.business_id !== input.businessId ||
      source.output_catalog_item_id !== input.catalogItemId ||
      source.status === "archived"
    ) {
      throw new Error("Recipe-derived cost source is unavailable.");
    }
  }

  const current = await db.getFirstAsync<CatalogCostProfileRow>(
    `
      SELECT *
      FROM catalog_cost_profiles
      WHERE catalog_item_id = ? AND status = 'active'
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [input.catalogItemId],
  );
  if (
    input.expectedActiveProfileId !== undefined &&
    (current?.id ?? null) !== input.expectedActiveProfileId
  ) {
    throw new Error("Catalog cost profile changed before replacement.");
  }

  const timestamp = input.effectiveAt ?? nowIso();
  if (current) {
    const superseded = await db.runAsync(
      `
        UPDATE catalog_cost_profiles
        SET status = 'superseded', superseded_at = ?, updated_at = ?,
          sync_status = 'local'
        WHERE id = ? AND status = 'active' AND deleted_at IS NULL
      `,
      [timestamp, timestamp, current.id],
    );
    if (superseded.changes !== 1) {
      throw new Error("Catalog cost profile changed before supersession.");
    }
  }

  const id = input.id ?? makeCatalogCostProfileId();
  await db.runAsync(
    `
      INSERT INTO catalog_cost_profiles (
        id, business_id, catalog_item_id, source_kind, total_cost,
        reference_quantity, reference_unit, request_token,
        source_recipe_version_id,
        supersedes_profile_id, status, effective_at, superseded_at, notes,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?, ?, 'local', NULL)
    `,
    [
      id,
      input.businessId,
      input.catalogItemId,
      input.sourceKind,
      input.totalCost,
      input.referenceQuantity,
      input.referenceUnit.trim(),
      input.requestToken?.trim() || null,
      input.sourceRecipeVersionId ?? null,
      current?.id ?? null,
      timestamp,
      input.notes?.trim() || null,
      timestamp,
      timestamp,
    ],
  );
  const profile = await getCatalogCostProfileById(id, db);
  if (!profile) throw new Error("Activated catalog cost profile is unavailable.");
  return profile;
}

export async function activateCatalogCostProfile(
  input: ActivateCatalogCostProfileInput,
  db?: RepositoryDatabase,
) {
  const database = getRepositoryDatabase(db);
  let profile: CatalogCostProfileRecord | null = null;
  await database.withExclusiveTransactionAsync(async (txn) => {
    profile = await activateCatalogCostProfileInTransaction(input, txn);
  });
  if (!profile) throw new Error("Catalog cost profile activation failed.");
  return profile;
}

export async function createRecipeVersionCostSummary(
  input: CreateRecipeVersionCostSummaryInput,
  db?: RepositoryDatabase,
) {
  validateSummaryInput(input);
  const database = getRepositoryDatabase(db);
  const version = await database.getFirstAsync<{
    business_id: string;
  }>(
    `
      SELECT business_id
      FROM recipe_versions
      WHERE id = ? AND deleted_at IS NULL
    `,
    [input.recipeVersionId],
  );
  if (version?.business_id !== input.businessId) {
    throw new Error("Recipe version cost summary source is unavailable.");
  }
  const timestamp = nowIso();
  const id = input.id ?? makeRecipeVersionCostSummaryId();
  await database.runAsync(
    `
      INSERT INTO recipe_version_cost_summaries (
        id, business_id, recipe_version_id, status, total_cost,
        cost_per_output_unit, known_cost_subtotal, missing_required_count,
        estimated_input_count, created_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL)
    `,
    [
      id,
      input.businessId,
      input.recipeVersionId,
      input.status,
      input.totalCost,
      input.costPerOutputUnit,
      input.knownCostSubtotal,
      input.missingRequiredCount,
      input.estimatedInputCount,
      timestamp,
    ],
  );
  const summary = await getRecipeVersionCostSummary(
    input.recipeVersionId,
    database,
  );
  if (!summary) throw new Error("Recipe version cost summary is unavailable.");
  return summary;
}

export async function getRecipeVersionCostSummary(
  recipeVersionId: string,
  db?: RepositoryDatabase,
) {
  const row =
    await getRepositoryDatabase(db).getFirstAsync<RecipeVersionCostSummaryRow>(
      `
        SELECT *
        FROM recipe_version_cost_summaries
        WHERE recipe_version_id = ? AND deleted_at IS NULL
      `,
      [recipeVersionId],
    );
  return row ? mapSummary(row) : null;
}

export async function listRecipeVersionCostSummariesForBusiness(
  businessId: string,
  db?: RepositoryDatabase,
) {
  const rows =
    await getRepositoryDatabase(db).getAllAsync<RecipeVersionCostSummaryRow>(
      `
        SELECT *
        FROM recipe_version_cost_summaries
        WHERE business_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
      `,
      [businessId],
    );
  return rows.map(mapSummary);
}
