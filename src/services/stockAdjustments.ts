import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  persistStockAdjustment,
  type PersistStockAdjustmentAllocation,
  type RepositoryDatabase,
} from "@/db/repositories";
import {
  planStockAdjustment,
  type StockAdjustmentOperation,
  type StockAdjustmentReason,
} from "@/domain/stockAdjustments";

/**
 * Owner-authorized orchestration for the persistence primitive. The pure
 * reason policy chooses accounting classification; callers cannot relabel an
 * adjustment as Product COGS or another category.
 */
export async function commitStockAdjustment(
  input: {
    businessId: string;
    branchId?: string | null;
    catalogItemId: string;
    subjectKind: "product" | "ingredient";
    productId?: string | null;
    ingredientId?: string | null;
    requestToken: string;
    ownerAuthorized: boolean;
    beforeQuantity: number;
    operation: StockAdjustmentOperation;
    reason: StockAdjustmentReason;
    note?: string | null;
    maximumQuantity?: number | null;
    unit: string;
    allocations: PersistStockAdjustmentAllocation[];
  },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const plan = planStockAdjustment({
    ownerAuthorized: input.ownerAuthorized,
    beforeQuantity: input.beforeQuantity,
    operation: input.operation,
    reason: input.reason,
    note: input.note,
    maximumQuantity: input.maximumQuantity,
  });
  if (!plan.ok) return { ok: false as const, plan };

  const operation =
    input.operation.kind === "mark_empty"
      ? "mark_empty"
      : input.operation.kind;
  const adjustmentId = await persistStockAdjustment(
    {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      catalogItemId: input.catalogItemId,
      subjectKind: input.subjectKind,
      productId: input.productId ?? null,
      ingredientId: input.ingredientId ?? null,
      requestToken: input.requestToken,
      operation,
      reasonCode: input.reason,
      note: input.note ?? null,
      accountingClass: plan.policy.accountingClass,
      beforeQuantity: plan.beforeQuantity,
      enteredAfterQuantity: plan.afterQuantity,
      deltaQuantity: plan.adjustmentQuantity,
      unit: input.unit,
      allocations: input.allocations,
    },
    db,
  );
  return { ok: true as const, plan, adjustmentId };
}
