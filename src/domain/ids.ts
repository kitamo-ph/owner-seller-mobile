export type LocalIdKind =
  | "business"
  | "branch"
  | "product"
  | "sale"
  | "sale_item"
  | "receipt"
  | "movement"
  | "alert"
  | "queue_item"
  | "batch"
  | "setting"
  | "ingredient"
  | "ingredient_lot"
  | "ingredient_movement"
  | "recipe"
  | "recipe_line"
  | "production_batch"
  | "production_usage"
  | "sale_usage"
  | "transfer"
  | "fixed_cost"
  | "fixed_cost_payment"
  | "checkout"
  | "catalog_item"
  | "legacy_binding"
  | "unit_conversion"
  | "recipe_version"
  | "recipe_version_line"
  | "recipe_role"
  | "recipe_draft"
  | "recipe_draft_line"
  | "supplier"
  | "purchase_receipt"
  | "product_stock_lot"
  | "production_plan"
  | "production_plan_stage"
  | "production_plan_requirement"
  | "production_plan_allocation"
  | "sale_product_lot_usage"
  | "production_input_allocation"
  | "stock_adjustment"
  | "stock_adjustment_allocation"
  | "supply_rule"
  | "sale_supply_usage"
  | "sale_supply_lot_usage"
  | "catalog_cost_profile"
  | "recipe_version_cost_summary";

function shortRandom() {
  return Math.random().toString(36).slice(2, 8);
}

export function makeLocalId(kind: LocalIdKind) {
  return `local_${kind}_${Date.now().toString(36)}_${shortRandom()}`;
}

export const makeBusinessId = () => makeLocalId("business");
export const makeBranchId = () => makeLocalId("branch");
export const makeProductId = () => makeLocalId("product");
export const makeSaleId = () => makeLocalId("sale");
export const makeSaleItemId = () => makeLocalId("sale_item");
export const makeReceiptId = () => makeLocalId("receipt");
export const makeMovementId = () => makeLocalId("movement");
export const makeAlertId = () => makeLocalId("alert");
export const makeQueueItemId = () => makeLocalId("queue_item");
export const makeBatchId = () => makeLocalId("batch");
export const makeSettingId = () => makeLocalId("setting");
export const makeIngredientId = () => makeLocalId("ingredient");
export const makeIngredientLotId = () => makeLocalId("ingredient_lot");
export const makeIngredientMovementId = () => makeLocalId("ingredient_movement");
export const makeRecipeId = () => makeLocalId("recipe");
export const makeRecipeLineId = () => makeLocalId("recipe_line");
export const makeProductionBatchId = () => makeLocalId("production_batch");
export const makeProductionUsageId = () => makeLocalId("production_usage");
export const makeSaleUsageId = () => makeLocalId("sale_usage");
export const makeTransferId = () => makeLocalId("transfer");
export const makeFixedCostId = () => makeLocalId("fixed_cost");
export const makeFixedCostPaymentId = () => makeLocalId("fixed_cost_payment");
export const makeCheckoutId = () => makeLocalId("checkout");
export const makeCatalogItemId = () => makeLocalId("catalog_item");
export const makeLegacyBindingId = () => makeLocalId("legacy_binding");
export const makeUnitConversionId = () => makeLocalId("unit_conversion");
export const makeRecipeVersionId = () => makeLocalId("recipe_version");
export const makeRecipeVersionLineId = () => makeLocalId("recipe_version_line");
export const makeRecipeRoleId = () => makeLocalId("recipe_role");
export const makeRecipeDraftId = () => makeLocalId("recipe_draft");
export const makeRecipeDraftLineId = () => makeLocalId("recipe_draft_line");
export const makeSupplierId = () => makeLocalId("supplier");
export const makePurchaseReceiptId = () => makeLocalId("purchase_receipt");
export const makeProductStockLotId = () => makeLocalId("product_stock_lot");
export const makeProductionPlanId = () => makeLocalId("production_plan");
export const makeProductionPlanStageId = () => makeLocalId("production_plan_stage");
export const makeProductionPlanRequirementId = () => makeLocalId("production_plan_requirement");
export const makeProductionPlanAllocationId = () => makeLocalId("production_plan_allocation");
export const makeSaleProductLotUsageId = () => makeLocalId("sale_product_lot_usage");
export const makeProductionInputAllocationId = () => makeLocalId("production_input_allocation");
export const makeStockAdjustmentId = () => makeLocalId("stock_adjustment");
export const makeStockAdjustmentAllocationId = () => makeLocalId("stock_adjustment_allocation");
export const makeSupplyRuleId = () => makeLocalId("supply_rule");
export const makeSaleSupplyUsageId = () => makeLocalId("sale_supply_usage");
export const makeSaleSupplyLotUsageId = () => makeLocalId("sale_supply_lot_usage");
export const makeCatalogCostProfileId = () => makeLocalId("catalog_cost_profile");
export const makeRecipeVersionCostSummaryId = () =>
  makeLocalId("recipe_version_cost_summary");
