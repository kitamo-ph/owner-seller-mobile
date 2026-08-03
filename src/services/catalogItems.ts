import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  getCatalogItemById,
  listLegacyBindingsForCatalogItem,
  listPanindaCatalogProductsForBusiness,
  type CatalogItemRecord,
  type CatalogStockPolicy,
  type LegacyProjectionRole,
  type RepositoryDatabase,
} from "@/db/repositories";
import {
  evaluateCatalogReadiness,
  requiredProjectionForClassification,
  resolvePanindaActionPolicy,
  resolvePanindaSection,
  type CatalogClassification,
  type CatalogCompatibilityMode,
  type CatalogLifecycle,
  type CatalogReadiness,
  type CatalogReadinessState,
  type CatalogSourceType,
  type PanindaActionPolicy,
  type PanindaSection,
} from "@/domain/catalogItems";
import type { CostEvidence, CostState } from "@/domain/costState";
import { makeCatalogItemId } from "@/domain/ids";
import type { Product } from "@/domain/types";

export type CatalogReadinessSnapshot = {
  item: CatalogItemRecord;
  readiness: CatalogReadiness;
  productId: string | null;
  ingredientId: string | null;
};

export type PanindaCatalogEntry = {
  catalogItemId: string;
  product: Product;
  classification: CatalogClassification;
  lifecycle: CatalogLifecycle;
  readinessState: CatalogReadinessState;
  sourceType: CatalogSourceType;
  compatibilityMode: CatalogCompatibilityMode;
  bindingStatus: "active" | "archived";
  projectionRole: LegacyProjectionRole;
  stockPolicy: CatalogStockPolicy;
  reviewRequired: boolean;
  draftId: string | null;
  activeRecipeId: string | null;
  activeVersionId: string | null;
  section: Exclude<PanindaSection, "excluded">;
  actions: PanindaActionPolicy;
};

export async function loadPanindaCatalog(
  businessId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<PanindaCatalogEntry[]> {
  await runMigrations(db);
  const records = await listPanindaCatalogProductsForBusiness(businessId, db);

  return records.flatMap((record) => {
    const policyInput = {
      classification: record.item.classification,
      lifecycle: record.item.lifecycle,
      readinessState: record.item.readinessState,
      compatibilityMode: record.compatibilityMode,
      sourceType: record.item.sourceType,
      bindingStatus: record.bindingStatus,
      stockPolicy: record.item.stockPolicy,
      productActive: record.product.active,
      hasDraft: record.draftId !== null,
      hasRecipe: record.activeRecipeId !== null,
      hasPublishedRecipe: record.activeVersionId !== null,
    } as const;
    const section = resolvePanindaSection(policyInput);
    if (section === "excluded") return [];

    return [{
      catalogItemId: record.item.id,
      product: record.product,
      classification: record.item.classification,
      lifecycle: record.item.lifecycle,
      readinessState: record.item.readinessState,
      sourceType: record.item.sourceType,
      compatibilityMode: record.compatibilityMode,
      bindingStatus: record.bindingStatus,
      projectionRole: record.projectionRole,
      stockPolicy: record.item.stockPolicy,
      reviewRequired:
        record.item.classificationReviewRequired ||
        record.bindingReviewRequired,
      draftId: record.draftId,
      activeRecipeId: record.activeRecipeId,
      activeVersionId: record.activeVersionId,
      section,
      actions: resolvePanindaActionPolicy(policyInput),
    }];
  });
}

function costEvidence(
  state: CostState,
  legacyValue: number | null,
): CostEvidence {
  return {
    state,
    amount: state === "known" ? legacyValue : null,
    legacyValue,
  };
}

export async function loadCatalogReadiness(
  catalogItemId: string,
  branchId: string | null,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<CatalogReadinessSnapshot | null> {
  await runMigrations(db);
  const item = await getCatalogItemById(catalogItemId, db);
  if (!item) return null;
  const bindings = await listLegacyBindingsForCatalogItem(catalogItemId, db);
  const productBinding = bindings.find(
    (binding) => binding.entityKind === "product",
  );
  const ingredientBinding = bindings.find(
    (binding) => binding.entityKind === "ingredient",
  );
  const product = productBinding
    ? await db.getFirstAsync<{
        id: string;
        branch_id: string | null;
        price: number;
        active: number;
      }>(
        `
          SELECT id, branch_id, price, active
          FROM products
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL
        `,
        [productBinding.legacyEntityId, item.businessId],
      )
    : null;

  const hasPublishedRecipe = Boolean(
    await db.getFirstAsync<{ id: string }>(
      `
        SELECT version.id
        FROM recipe_versions version
        WHERE version.output_catalog_item_id = ?
          AND version.status = 'published'
          AND version.deleted_at IS NULL
        LIMIT 1
      `,
      [catalogItemId],
    ),
  );
  const compatibilityMode =
    productBinding?.compatibilityMode ??
    ingredientBinding?.compatibilityMode ??
    "native";
  const requiredProjection = requiredProjectionForClassification(
    item.classification,
  );
  const actualProjection = productBinding
    ? "product"
    : ingredientBinding
      ? "ingredient"
      : null;
  const branchApplicable =
    product === null ||
    branchId === null ||
    product.branch_id === null ||
    product.branch_id === branchId;
  const legacyVisibleUnderExistingPredicate =
    Boolean(product) && branchApplicable;
  const sellingPrice = costEvidence(
    item.sellingPriceState,
    product?.price ?? null,
  );

  return {
    item,
    productId: productBinding?.legacyEntityId ?? null,
    ingredientId: ingredientBinding?.legacyEntityId ?? null,
    readiness: evaluateCatalogReadiness({
      classification: item.classification,
      lifecycle: item.lifecycle,
      readinessState: item.readinessState,
      compatibilityMode,
      sourceType: item.sourceType,
      reviewRequired:
        item.classificationReviewRequired ||
        bindings.some((binding) => binding.reviewRequired),
      sellable: item.sellable,
      kioskEnabled: item.kioskEnabled,
      branchApplicable,
      sellingPrice,
      hasPublishedRecipe,
      productionConfigurationComplete:
        requiredProjection !== null &&
        actualProjection === requiredProjection &&
        (requiredProjection !== "product" ||
          item.stockPolicy === "product_lots"),
      saleConfigurationComplete:
        actualProjection === "product" && product?.active === 1,
      legacyVisibleUnderExistingPredicate,
      explicitlyBlocked: false,
    }),
  };
}

/**
 * Creates semantic draft identity only. Phase B deliberately does not create a
 * Product/Ingredient projection, so the current Kiosk reader cannot expose a
 * native draft before its compatibility reader is activated.
 */
export async function createNativeCatalogDraft(
  input: {
    id?: string;
    businessId: string;
    branchId?: string | null;
    name: string;
    classification: Exclude<CatalogClassification, "legacy_unclassified">;
  },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const name = input.name.trim();
  if (!name) throw new Error("Catalog item name is required.");
  const id = input.id ?? makeCatalogItemId();
  const timestamp = new Date().toISOString();
  const projection = requiredProjectionForClassification(input.classification);
  const purchased =
    input.classification === "purchased_ingredient" ||
    input.classification === "direct_resale_product" ||
    input.classification === "supply_packaging";
  const mayBeSold = projection === "product";
  await db.runAsync(
    `
      INSERT INTO catalog_items (
        id, business_id, branch_id, name, normalized_name, source_type,
        classification, lifecycle_status, readiness_state,
        classification_review_required, sellable, kiosk_enabled,
        purchase_cost_state, selling_price_state, stock_policy, archived_at,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 'native', ?, 'draft', 'incomplete', 0, 0, 0, ?, ?, ?, NULL, ?, ?, 'local', NULL)
    `,
    [
      id,
      input.businessId,
      input.branchId ?? null,
      name,
      name.toLocaleLowerCase().trim(),
      input.classification,
      purchased ? "unknown" : "not_applicable",
      mayBeSold ? "unknown" : "not_applicable",
      projection === "ingredient" ? "ingredient_lots" : "product_lots",
      timestamp,
      timestamp,
    ],
  );
  return getCatalogItemById(id, db);
}
