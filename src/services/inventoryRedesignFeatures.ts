/**
 * Phase B persistence is deliberately inert. These compile-time gates document
 * the only supported runtime state for this milestone and prevent a new writer
 * from being mistaken for an enabled owner/Kiosk workflow.
 */
export const INVENTORY_REDESIGN_PHASE_B_FEATURES = Object.freeze({
  nativeCatalogProjectionCreation: false,
  catalogReviewUi: false,
  recipeDraftUi: false,
  recipeVersioningUi: false,
  productionPlannerUi: false,
  stockAdjustmentUi: false,
  supplyRuleUi: false,
  checkoutSupplyDeduction: false,
  catalogAwareKioskReaderActivated: false,
});

/**
 * Phase C1 activates only the recipe-first writer/editor surfaces and the
 * compatibility-aware Kiosk read guard required to keep native drafts hidden.
 * Production planning, stock adjustment UI, and checkout supply deduction
 * remain outside this focused phase.
 */
export const INVENTORY_REDESIGN_PHASE_C1_FEATURES = Object.freeze({
  nativeCatalogProjectionCreation: true,
  catalogReviewUi: false,
  recipeDraftUi: true,
  recipeVersioningUi: true,
  productionPlannerUi: false,
  stockAdjustmentUi: false,
  supplyRuleUi: false,
  checkoutSupplyDeduction: false,
  catalogAwareKioskReaderActivated: true,
});

export type InventoryRedesignPhaseBFeature =
  keyof typeof INVENTORY_REDESIGN_PHASE_B_FEATURES;

export function assertInventoryRedesignFeatureDisabled(
  feature: InventoryRedesignPhaseBFeature,
) {
  if (INVENTORY_REDESIGN_PHASE_B_FEATURES[feature] !== false) {
    throw new Error(`Unexpected enabled Phase B feature: ${feature}.`);
  }
}
