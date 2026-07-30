import {
  makeIngredientMovementId,
  makeMovementId,
  makeStockAdjustmentAllocationId,
  makeStockAdjustmentId,
} from "@/domain/ids";
import type {
  AdjustmentAccountingClass,
  StockAdjustmentReason,
} from "@/domain/stockAdjustments";
import { INVENTORY_QUANTITY_TOLERANCE } from "@/domain/stockAuthority";

import {
  getRepositoryDatabase,
  nowIso,
  type RepositoryDatabase,
} from "./shared";

export type StockAdjustmentOperation = "delta" | "set_count" | "mark_empty";
export type PersistStockAdjustmentAllocation = {
  id?: string;
  lotKind: "ingredient" | "product" | "scalar_product";
  ingredientLotId?: string | null;
  productStockLotId?: string | null;
  beforeQuantity: number;
  deltaQuantity: number;
  afterQuantity: number;
  unit: string;
  conversionId?: string | null;
  conversionFactorSnapshot?: number | null;
};

export type PersistStockAdjustmentInput = {
  id?: string;
  businessId: string;
  branchId?: string | null;
  catalogItemId: string;
  subjectKind: "product" | "ingredient";
  productId?: string | null;
  ingredientId?: string | null;
  requestToken: string;
  operation: StockAdjustmentOperation;
  reasonCode: StockAdjustmentReason;
  note?: string | null;
  accountingClass: AdjustmentAccountingClass;
  beforeQuantity: number;
  enteredAfterQuantity: number;
  deltaQuantity: number;
  unit: string;
  allocations: PersistStockAdjustmentAllocation[];
};

function approximatelyEqual(left: number, right: number) {
  return (
    Math.abs(left - right) <= INVENTORY_QUANTITY_TOLERANCE
  );
}

function validateAdjustment(input: PersistStockAdjustmentInput) {
  if (!input.requestToken.trim()) {
    throw new Error("Stock-adjustment request token is required.");
  }
  if (
    !Number.isFinite(input.beforeQuantity) ||
    !Number.isFinite(input.enteredAfterQuantity) ||
    !Number.isFinite(input.deltaQuantity) ||
    input.beforeQuantity < -INVENTORY_QUANTITY_TOLERANCE ||
    input.enteredAfterQuantity < -INVENTORY_QUANTITY_TOLERANCE ||
    !approximatelyEqual(
      input.enteredAfterQuantity - input.beforeQuantity,
      input.deltaQuantity,
    )
  ) {
    throw new Error("Stock-adjustment totals are inconsistent.");
  }
  if (
    (input.subjectKind === "product" &&
      (!input.productId || input.ingredientId)) ||
    (input.subjectKind === "ingredient" &&
      (!input.ingredientId || input.productId))
  ) {
    throw new Error("Stock-adjustment subject identity is inconsistent.");
  }
  if (input.allocations.length === 0) {
    throw new Error("Stock adjustment requires explicit allocation evidence.");
  }
  let allocationDelta = 0;
  for (const allocation of input.allocations) {
    if (
      !Number.isFinite(allocation.beforeQuantity) ||
      !Number.isFinite(allocation.afterQuantity) ||
      !Number.isFinite(allocation.deltaQuantity) ||
      allocation.beforeQuantity < -INVENTORY_QUANTITY_TOLERANCE ||
      allocation.afterQuantity < -INVENTORY_QUANTITY_TOLERANCE ||
      !approximatelyEqual(
        allocation.afterQuantity - allocation.beforeQuantity,
        allocation.deltaQuantity,
      )
    ) {
      throw new Error("Stock-adjustment allocation is inconsistent.");
    }
    allocationDelta += allocation.deltaQuantity;
  }
  if (!approximatelyEqual(allocationDelta, input.deltaQuantity)) {
    throw new Error("Stock-adjustment allocation delta does not match total.");
  }
  if (
    input.subjectKind === "ingredient" &&
    input.allocations.some(
      (allocation) => allocation.lotKind !== "ingredient",
    )
  ) {
    throw new Error("Ingredient adjustment requires Ingredient-lot evidence.");
  }
  if (
    input.subjectKind === "product" &&
    input.allocations.some(
      (allocation) => allocation.lotKind === "ingredient",
    )
  ) {
    throw new Error("Product adjustment cannot use Ingredient lots.");
  }

  const allocationIds = new Set<string>();
  for (const allocation of input.allocations) {
    const lotId =
      allocation.lotKind === "ingredient"
        ? allocation.ingredientLotId
        : allocation.lotKind === "product"
          ? allocation.productStockLotId
          : null;
    if (
      (allocation.lotKind === "ingredient" &&
        (!lotId || allocation.productStockLotId)) ||
      (allocation.lotKind === "product" &&
        (!lotId || allocation.ingredientLotId)) ||
      (allocation.lotKind === "scalar_product" &&
        (allocation.ingredientLotId || allocation.productStockLotId))
    ) {
      throw new Error("Stock-adjustment allocation identity is inconsistent.");
    }
    if (lotId) {
      if (allocationIds.has(lotId)) {
        throw new Error("Stock-adjustment lot allocations must be unique.");
      }
      allocationIds.add(lotId);
    }
  }
}

/**
 * Persists an owner-authorized adjustment, exact lot/scalar mutations,
 * movement evidence, and allocation evidence in one transaction. The request
 * token makes a committed retry idempotent; every mutable balance is guarded.
 */
export async function persistStockAdjustment(
  input: PersistStockAdjustmentInput,
  db?: RepositoryDatabase,
) {
  validateAdjustment(input);
  const database = getRepositoryDatabase(db);
  let adjustmentId: string | null = null;

  await database.withExclusiveTransactionAsync(async (txn) => {
    const prior = await txn.getFirstAsync<{
      id: string;
      business_id: string;
      catalog_item_id: string;
    }>(
      `
        SELECT id, business_id, catalog_item_id
        FROM stock_adjustments
        WHERE request_token = ? AND deleted_at IS NULL
      `,
      [input.requestToken],
    );
    if (prior) {
      if (
        prior.business_id !== input.businessId ||
        prior.catalog_item_id !== input.catalogItemId
      ) {
        throw new Error("Stock-adjustment token belongs to another item.");
      }
      adjustmentId = prior.id;
      return;
    }

    const timestamp = nowIso();
    const id = input.id ?? makeStockAdjustmentId();
    await txn.runAsync(
      `
        INSERT INTO stock_adjustments (
          id, business_id, branch_id, catalog_item_id, subject_kind,
          product_id, ingredient_id, request_token, operation, reason_code,
          note, accounting_class, before_quantity, entered_after_quantity,
          delta_quantity, unit, authorized_mode, created_at, updated_at,
          sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owner', ?, ?, 'local', NULL)
      `,
      [
        id,
        input.businessId,
        input.branchId ?? null,
        input.catalogItemId,
        input.subjectKind,
        input.productId ?? null,
        input.ingredientId ?? null,
        input.requestToken,
        input.operation,
        input.reasonCode,
        input.note?.trim() || null,
        input.accountingClass,
        input.beforeQuantity,
        input.enteredAfterQuantity,
        input.deltaQuantity,
        input.unit,
        timestamp,
        timestamp,
      ],
    );

    if (input.subjectKind === "product") {
      const product = await txn.getFirstAsync<{
        stock_qty: number;
        business_id: string;
        branch_id: string | null;
      }>(
        `
          SELECT stock_qty, business_id, branch_id
          FROM products
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL
        `,
        [input.productId as string, input.businessId],
      );
      if (
        !product ||
        !approximatelyEqual(product.stock_qty, input.beforeQuantity) ||
        (input.branchId !== undefined &&
          input.branchId !== product.branch_id)
      ) {
        throw new Error("Product balance/context changed before adjustment.");
      }

      const authority = await txn.getFirstAsync<{
        stock_policy: "product_scalar" | "product_lots";
        compatibility_mode: string;
        review_required: number;
        binding_status: string;
      }>(
        `
          SELECT
            item.stock_policy,
            binding.compatibility_mode,
            binding.review_required,
            binding.binding_status
          FROM catalog_items item
          INNER JOIN legacy_item_bindings binding
            ON binding.catalog_item_id = item.id
            AND binding.entity_kind = 'product'
            AND binding.legacy_entity_id = ?
            AND binding.deleted_at IS NULL
          WHERE item.id = ? AND item.business_id = ?
            AND item.deleted_at IS NULL
        `,
        [
          input.productId as string,
          input.catalogItemId,
          input.businessId,
        ],
      );
      if (!authority || authority.binding_status !== "active") {
        throw new Error("Product adjustment requires an exact active catalog binding.");
      }

      const usesScalarOnly = input.allocations.every(
        (allocation) => allocation.lotKind === "scalar_product",
      );
      const usesProductLots = input.allocations.every(
        (allocation) => allocation.lotKind === "product",
      );
      if (!usesScalarOnly && !usesProductLots) {
        throw new Error("Product adjustment cannot mix stock authorities.");
      }
      if (usesScalarOnly && input.allocations.length !== 1) {
        throw new Error("Legacy Product scalar adjustment requires one allocation.");
      }
      const scalarAuthority =
        authority.stock_policy === "product_scalar" &&
        authority.compatibility_mode === "legacy_unclassified" &&
        authority.review_required === 1;
      const lotAuthority =
        authority.stock_policy === "product_lots" &&
        ["reviewed_legacy", "native"].includes(
          authority.compatibility_mode,
        ) &&
        authority.review_required === 0;
      if (
        (!scalarAuthority && !lotAuthority) ||
        (scalarAuthority && !usesScalarOnly) ||
        (lotAuthority && !usesProductLots)
      ) {
        throw new Error(
          "Product adjustment allocations do not match authoritative stock policy.",
        );
      }
      if (
        usesScalarOnly &&
        (!approximatelyEqual(
          input.allocations[0].beforeQuantity,
          input.beforeQuantity,
        ) ||
          !approximatelyEqual(
            input.allocations[0].afterQuantity,
            input.enteredAfterQuantity,
          ))
      ) {
        throw new Error("Legacy Product scalar evidence does not match the adjustment.");
      }

      if (usesProductLots) {
        const lotRows = await txn.getAllAsync<{
          id: string;
          remaining_quantity: number;
          status: string;
        }>(
          `
            SELECT id, remaining_quantity, status
            FROM product_stock_lots
            WHERE product_id = ? AND catalog_item_id = ?
              AND business_id = ? AND deleted_at IS NULL
          `,
          [
            input.productId as string,
            input.catalogItemId,
            input.businessId,
          ],
        );
        const activeTotal = lotRows
          .filter((lot) => lot.status === "active")
          .reduce((sum, lot) => sum + lot.remaining_quantity, 0);
        const invalidInactive = lotRows.some(
          (lot) =>
            lot.status !== "active" &&
            lot.remaining_quantity > INVENTORY_QUANTITY_TOLERANCE,
        );
        if (
          invalidInactive ||
          !approximatelyEqual(activeTotal, product.stock_qty)
        ) {
          throw new Error("Product scalar/Product-lot drift blocks adjustment.");
        }
      }

      for (const allocation of input.allocations) {
        if (allocation.lotKind !== "product") continue;
        const result = await txn.runAsync(
          `
            UPDATE product_stock_lots
            SET remaining_quantity = ?,
              status = CASE WHEN ? <= ? THEN 'depleted' ELSE 'active' END,
              updated_at = ?, sync_status = 'local'
            WHERE id = ? AND product_id = ? AND business_id = ?
              AND catalog_item_id = ?
              AND ABS(remaining_quantity - ?) <= ?
              AND deleted_at IS NULL
          `,
          [
            allocation.afterQuantity,
            allocation.afterQuantity,
            INVENTORY_QUANTITY_TOLERANCE,
            timestamp,
            allocation.productStockLotId ?? null,
            input.productId as string,
            input.businessId,
            input.catalogItemId,
            allocation.beforeQuantity,
            INVENTORY_QUANTITY_TOLERANCE,
          ],
        );
        if (result.changes !== 1) {
          throw new Error("Product lot changed before adjustment.");
        }
      }

      if (usesProductLots) {
        const projectedLots = await txn.getAllAsync<{
          remaining_quantity: number;
          status: string;
        }>(
          `
            SELECT remaining_quantity, status
            FROM product_stock_lots
            WHERE product_id = ? AND catalog_item_id = ?
              AND business_id = ? AND deleted_at IS NULL
          `,
          [
            input.productId as string,
            input.catalogItemId,
            input.businessId,
          ],
        );
        const projectedTotal = projectedLots
          .filter((lot) => lot.status === "active")
          .reduce((sum, lot) => sum + lot.remaining_quantity, 0);
        if (!approximatelyEqual(projectedTotal, input.enteredAfterQuantity)) {
          throw new Error("Product lot projection does not match adjusted total.");
        }
      }

      const productResult = await txn.runAsync(
        `
          UPDATE products
          SET stock_qty = ?, updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ?
            AND ABS(stock_qty - ?) <= ?
            AND deleted_at IS NULL
        `,
        [
          input.enteredAfterQuantity,
          timestamp,
          input.productId as string,
          input.businessId,
          input.beforeQuantity,
          INVENTORY_QUANTITY_TOLERANCE,
        ],
      );
      if (productResult.changes !== 1) {
        throw new Error("Product scalar changed before adjustment.");
      }

      const movementId = makeMovementId();
      await txn.runAsync(
        `
          INSERT INTO inventory_movements (
            id, business_id, branch_id, product_id, movement_type, quantity,
            reason, linked_sale_id, unit_cost, total_cost, created_at,
            updated_at, sync_status, deleted_at
          ) VALUES (?, ?, ?, ?, 'adjustment', ?, ?, NULL, NULL, NULL, ?, ?, 'local', NULL)
        `,
        [
          movementId,
          input.businessId,
          product.branch_id,
          input.productId as string,
          input.deltaQuantity,
          `${input.reasonCode}: ${input.note?.trim() || "owner adjustment"}`,
          timestamp,
          timestamp,
        ],
      );

      for (const allocation of input.allocations) {
        await txn.runAsync(
          `
            INSERT INTO stock_adjustment_allocations (
              id, business_id, stock_adjustment_id, lot_kind,
              ingredient_lot_id, product_stock_lot_id, before_quantity,
              delta_quantity, after_quantity, unit, conversion_id,
              conversion_factor_snapshot, movement_kind,
              ingredient_movement_id, inventory_movement_id, created_at,
              updated_at, sync_status, deleted_at
            ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'product', NULL, ?, ?, ?, 'local', NULL)
          `,
          [
            allocation.id ?? makeStockAdjustmentAllocationId(),
            input.businessId,
            id,
            allocation.lotKind,
            allocation.productStockLotId ?? null,
            allocation.beforeQuantity,
            allocation.deltaQuantity,
            allocation.afterQuantity,
            allocation.unit,
            allocation.conversionId ?? null,
            allocation.conversionFactorSnapshot ?? null,
            movementId,
            timestamp,
            timestamp,
          ],
        );
      }
    } else {
      const binding = await txn.getFirstAsync<{
        stock_policy: string;
        binding_status: string;
      }>(
        `
          SELECT item.stock_policy, binding.binding_status
          FROM catalog_items item
          INNER JOIN legacy_item_bindings binding
            ON binding.catalog_item_id = item.id
            AND binding.entity_kind = 'ingredient'
            AND binding.legacy_entity_id = ?
            AND binding.deleted_at IS NULL
          WHERE item.id = ? AND item.business_id = ?
            AND item.deleted_at IS NULL
        `,
        [
          input.ingredientId as string,
          input.catalogItemId,
          input.businessId,
        ],
      );
      if (
        !binding ||
        binding.binding_status !== "active" ||
        binding.stock_policy !== "ingredient_lots"
      ) {
        throw new Error(
          "Ingredient adjustment requires an exact lot-backed catalog binding.",
        );
      }

      const lots = await txn.getAllAsync<{
        id: string;
        remaining_quantity: number;
        status: string;
      }>(
        `
          SELECT id, remaining_quantity, status
          FROM ingredient_lots
          WHERE ingredient_id = ? AND business_id = ? AND deleted_at IS NULL
        `,
        [input.ingredientId as string, input.businessId],
      );
      const invalidInactive = lots.some(
        (lot) =>
          lot.status !== "active" &&
          lot.remaining_quantity > INVENTORY_QUANTITY_TOLERANCE,
      );
      const total = lots
        .filter((lot) => lot.status === "active")
        .reduce((sum, lot) => sum + lot.remaining_quantity, 0);
      if (
        invalidInactive ||
        !approximatelyEqual(total, input.beforeQuantity)
      ) {
        throw new Error("Ingredient-lot balance changed before adjustment.");
      }

      for (const allocation of input.allocations) {
        const result = await txn.runAsync(
          `
            UPDATE ingredient_lots
            SET remaining_quantity = ?,
              status = CASE WHEN ? <= ? THEN 'depleted' ELSE 'active' END,
              updated_at = ?, sync_status = 'local'
            WHERE id = ? AND ingredient_id = ? AND business_id = ?
              AND ABS(remaining_quantity - ?) <= ?
              AND deleted_at IS NULL
          `,
          [
            allocation.afterQuantity,
            allocation.afterQuantity,
            INVENTORY_QUANTITY_TOLERANCE,
            timestamp,
            allocation.ingredientLotId ?? null,
            input.ingredientId as string,
            input.businessId,
            allocation.beforeQuantity,
            INVENTORY_QUANTITY_TOLERANCE,
          ],
        );
        if (result.changes !== 1) {
          throw new Error("Ingredient lot changed before adjustment.");
        }

        const movementId = makeIngredientMovementId();
        await txn.runAsync(
          `
            INSERT INTO ingredient_movements (
              id, business_id, ingredient_id, lot_id, movement_type, quantity,
              unit, unit_cost, total_cost, reason, created_at, updated_at,
              sync_status, deleted_at
            ) VALUES (?, ?, ?, ?, 'adjustment', ?, ?, NULL, NULL, ?, ?, ?, 'local', NULL)
          `,
          [
            movementId,
            input.businessId,
            input.ingredientId as string,
            allocation.ingredientLotId ?? null,
            allocation.deltaQuantity,
            allocation.unit,
            `${input.reasonCode}: ${input.note?.trim() || "owner adjustment"}`,
            timestamp,
            timestamp,
          ],
        );
        await txn.runAsync(
          `
            INSERT INTO stock_adjustment_allocations (
              id, business_id, stock_adjustment_id, lot_kind,
              ingredient_lot_id, product_stock_lot_id, before_quantity,
              delta_quantity, after_quantity, unit, conversion_id,
              conversion_factor_snapshot, movement_kind,
              ingredient_movement_id, inventory_movement_id, created_at,
              updated_at, sync_status, deleted_at
            ) VALUES (?, ?, ?, 'ingredient', ?, NULL, ?, ?, ?, ?, ?, ?, 'ingredient', ?, NULL, ?, ?, 'local', NULL)
          `,
          [
            allocation.id ?? makeStockAdjustmentAllocationId(),
            input.businessId,
            id,
            allocation.ingredientLotId ?? null,
            allocation.beforeQuantity,
            allocation.deltaQuantity,
            allocation.afterQuantity,
            allocation.unit,
            allocation.conversionId ?? null,
            allocation.conversionFactorSnapshot ?? null,
            movementId,
            timestamp,
            timestamp,
          ],
        );
      }
    }

    adjustmentId = id;
  });

  if (!adjustmentId) throw new Error("Stock adjustment failed.");
  return adjustmentId;
}

export async function listStockAdjustmentsForCatalogItem(
  catalogItemId: string,
  limit = 50,
  db?: RepositoryDatabase,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Stock-adjustment limit must be between 1 and 500.");
  }
  return getRepositoryDatabase(db).getAllAsync<Record<string, unknown>>(
    `
      SELECT *
      FROM stock_adjustments
      WHERE catalog_item_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [catalogItemId, limit],
  );
}
