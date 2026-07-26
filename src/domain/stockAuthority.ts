import {
  type CatalogClassification,
  type CatalogCompatibilityMode,
  type CatalogProjectionKind,
  requiredProjectionForClassification,
} from "./catalogItems";

export const INVENTORY_QUANTITY_TOLERANCE = 1e-9;

export type StockAuthority =
  | "none"
  | "legacy_product_scalar"
  | "ingredient_lots"
  | "product_lots_with_scalar_projection";

export type StockAuthorityInput = {
  classification: CatalogClassification;
  compatibilityMode: CatalogCompatibilityMode;
  bindingKind: CatalogProjectionKind | null;
  stockTrackingEnabled: boolean;
};

export type StockAuthorityResolution =
  | { ok: true; authority: StockAuthority }
  | {
      ok: false;
      reason:
        | "tracked_item_requires_binding"
        | "classification_projection_mismatch"
        | "reviewed_item_cannot_remain_unclassified";
    };

export type ProductLotBalance = {
  lotId: string;
  remainingQuantity: number;
  status: "active" | "depleted" | "archived";
};

export type ProductStockReconciliation = {
  status: "balanced" | "drift" | "invalid";
  scalarQuantity: number;
  activeLotQuantity: number;
  difference: number;
  canAllocate: boolean;
  issues: (
    | "invalid_scalar_quantity"
    | "invalid_lot_quantity"
    | "duplicate_lot"
    | "inactive_lot_has_balance"
  )[];
};

export type LotBackedMutationValidation =
  | {
      ok: true;
      quantityDelta: number;
      before: ProductStockReconciliation;
      after: ProductStockReconciliation;
    }
  | {
      ok: false;
      reason:
        | "invalid_before_state"
        | "invalid_after_state"
        | "scalar_lot_delta_mismatch"
        | "movement_delta_mismatch";
      before: ProductStockReconciliation;
      after: ProductStockReconciliation;
    };

export function resolveStockAuthority(
  input: StockAuthorityInput,
): StockAuthorityResolution {
  if (!input.stockTrackingEnabled) {
    return { ok: true, authority: "none" };
  }

  if (!input.bindingKind) {
    return { ok: false, reason: "tracked_item_requires_binding" };
  }

  if (input.classification === "legacy_unclassified") {
    if (input.compatibilityMode !== "legacy_unclassified") {
      return {
        ok: false,
        reason: "reviewed_item_cannot_remain_unclassified",
      };
    }

    return {
      ok: true,
      authority:
        input.bindingKind === "product"
          ? "legacy_product_scalar"
          : "ingredient_lots",
    };
  }

  const requiredProjection = requiredProjectionForClassification(
    input.classification,
  );
  if (requiredProjection !== input.bindingKind) {
    return {
      ok: false,
      reason: "classification_projection_mismatch",
    };
  }

  return {
    ok: true,
    authority:
      input.bindingKind === "ingredient"
        ? "ingredient_lots"
        : "product_lots_with_scalar_projection",
  };
}

function approximatelyEqual(
  left: number,
  right: number,
  tolerance: number,
) {
  return Math.abs(left - right) <= tolerance;
}

/**
 * Reports Product scalar/Product-lot drift and never proposes a repair.
 *
 * Only active lots participate in the authoritative native balance. A depleted
 * or archived lot retaining a material balance is invalid evidence and blocks
 * allocation rather than being silently folded into the total.
 */
export function reconcileProductStock(
  scalarQuantity: number,
  lots: readonly ProductLotBalance[],
  tolerance = INVENTORY_QUANTITY_TOLERANCE,
): ProductStockReconciliation {
  const issues: ProductStockReconciliation["issues"] = [];
  const seenLotIds = new Set<string>();
  let activeLotQuantity = 0;

  if (
    !Number.isFinite(scalarQuantity) ||
    scalarQuantity < -tolerance ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    issues.push("invalid_scalar_quantity");
  }

  for (const lot of lots) {
    if (seenLotIds.has(lot.lotId)) {
      issues.push("duplicate_lot");
    }
    seenLotIds.add(lot.lotId);

    if (
      !lot.lotId.trim() ||
      !Number.isFinite(lot.remainingQuantity) ||
      lot.remainingQuantity < -tolerance
    ) {
      issues.push("invalid_lot_quantity");
      continue;
    }

    const normalizedRemaining =
      Math.abs(lot.remainingQuantity) <= tolerance ? 0 : lot.remainingQuantity;
    if (lot.status === "active") {
      activeLotQuantity += normalizedRemaining;
    } else if (normalizedRemaining > tolerance) {
      issues.push("inactive_lot_has_balance");
    }
  }

  const difference = scalarQuantity - activeLotQuantity;
  if (issues.length > 0) {
    return {
      status: "invalid",
      scalarQuantity,
      activeLotQuantity,
      difference,
      canAllocate: false,
      issues: [...new Set(issues)],
    };
  }

  const balanced = approximatelyEqual(
    scalarQuantity,
    activeLotQuantity,
    tolerance,
  );
  return {
    status: balanced ? "balanced" : "drift",
    scalarQuantity,
    activeLotQuantity,
    difference,
    canAllocate: balanced,
    issues: [],
  };
}

/**
 * Guards the one-transaction Product projection rule.
 *
 * A valid lot-backed mutation must begin and end reconciled, change Product
 * scalar and active-lot totals by the same amount, and append a movement with
 * that exact signed quantity.
 */
export function validateLotBackedMutation(input: {
  beforeScalarQuantity: number;
  afterScalarQuantity: number;
  beforeLots: readonly ProductLotBalance[];
  afterLots: readonly ProductLotBalance[];
  movementQuantity: number;
  tolerance?: number;
}): LotBackedMutationValidation {
  const tolerance = input.tolerance ?? INVENTORY_QUANTITY_TOLERANCE;
  const before = reconcileProductStock(
    input.beforeScalarQuantity,
    input.beforeLots,
    tolerance,
  );
  const after = reconcileProductStock(
    input.afterScalarQuantity,
    input.afterLots,
    tolerance,
  );

  if (before.status !== "balanced") {
    return { ok: false, reason: "invalid_before_state", before, after };
  }
  if (after.status !== "balanced") {
    return { ok: false, reason: "invalid_after_state", before, after };
  }

  const scalarDelta =
    input.afterScalarQuantity - input.beforeScalarQuantity;
  const lotDelta = after.activeLotQuantity - before.activeLotQuantity;
  if (!approximatelyEqual(scalarDelta, lotDelta, tolerance)) {
    return {
      ok: false,
      reason: "scalar_lot_delta_mismatch",
      before,
      after,
    };
  }

  if (
    !Number.isFinite(input.movementQuantity) ||
    !approximatelyEqual(scalarDelta, input.movementQuantity, tolerance)
  ) {
    return {
      ok: false,
      reason: "movement_delta_mismatch",
      before,
      after,
    };
  }

  return { ok: true, quantityDelta: scalarDelta, before, after };
}
