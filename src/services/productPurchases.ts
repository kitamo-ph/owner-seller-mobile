import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  addProductStockLotWithScalarProjection,
  createPurchaseReceipt,
  type ProductStockLotRecord,
  type RepositoryDatabase,
} from "@/db/repositories";

import { loadOwnerSetupStatus } from "./ownerSetup";

export type AddDirectResalePurchaseInput = {
  catalogItemId: string;
  productId: string;
  quantity: number;
  totalCost: number | null;
  purchasedAt?: string | null;
  notes?: string | null;
};

function localDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Records a native direct-resale purchase as one receipt, one Product lot,
 * one scalar compatibility update, and one movement in a single transaction.
 * Missing cost remains authoritative NULL evidence rather than a fake zero.
 */
export async function addDirectResalePurchase(
  input: AddDirectResalePurchaseInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Purchased quantity must be greater than zero.");
  }
  if (
    input.totalCost !== null &&
    (!Number.isFinite(input.totalCost) || input.totalCost < 0)
  ) {
    throw new Error("Purchase cost must be zero or higher when entered.");
  }

  const owner = await loadOwnerSetupStatus(db);
  if (!owner.activeBusiness) {
    throw new Error("Create the business profile before recording a purchase.");
  }
  const purchasedAt = input.purchasedAt?.trim() || localDate();
  let createdLot: ProductStockLotRecord | null = null;

  await db.withExclusiveTransactionAsync(async (txn) => {
    const product = await txn.getFirstAsync<{
      business_id: string;
      branch_id: string | null;
      unit_type: string;
      classification: string;
      stock_policy: string;
      lifecycle_status: string;
    }>(
      `
        SELECT product.business_id, product.branch_id, product.unit_type,
          item.classification, item.stock_policy, item.lifecycle_status
        FROM products product
        INNER JOIN legacy_item_bindings binding
          ON binding.entity_kind = 'product'
          AND binding.legacy_entity_id = product.id
          AND binding.catalog_item_id = ?
          AND binding.binding_status = 'active'
          AND binding.compatibility_mode IN ('reviewed_legacy', 'native')
          AND binding.review_required = 0
          AND binding.deleted_at IS NULL
        INNER JOIN catalog_items item
          ON item.id = binding.catalog_item_id
          AND item.business_id = binding.business_id
          AND item.deleted_at IS NULL
        WHERE product.id = ? AND product.deleted_at IS NULL
      `,
      [input.catalogItemId, input.productId],
    );
    if (
      !product ||
      product.business_id !== owner.activeBusiness?.id ||
      product.stock_policy !== "product_lots" ||
      product.lifecycle_status === "archived" ||
      !["direct_resale_product", "bundle_combo"].includes(
        product.classification,
      )
    ) {
      throw new Error("This selling item is not eligible for lot-backed purchasing.");
    }

    const costState = input.totalCost === null ? "unknown" : "known";
    const receiptId = await createPurchaseReceipt(
      {
        businessId: product.business_id,
        branchId: product.branch_id,
        purchasedAt,
        totalCost: input.totalCost,
        costState,
        notes: input.notes,
      },
      txn,
    );
    createdLot = await addProductStockLotWithScalarProjection(
      {
        businessId: product.business_id,
        branchId: product.branch_id,
        productId: input.productId,
        catalogItemId: input.catalogItemId,
        originKind: "purchase",
        purchaseReceiptId: receiptId,
        originDate: purchasedAt,
        quantity: input.quantity,
        unit: product.unit_type,
        recordedTotalCost: input.totalCost,
        recordedCostPerUnit:
          input.totalCost === null ? null : input.totalCost / input.quantity,
        costState,
        provenanceState: "exact",
        notes: input.notes,
        movementType: "purchase",
        movementReason: "Direct-resale purchase lot",
      },
      txn,
    );
    await txn.runAsync(
      `
        UPDATE catalog_items
        SET purchase_cost_state = CASE
          WHEN EXISTS (
            SELECT 1
            FROM product_stock_lots known_lot
            WHERE known_lot.catalog_item_id = catalog_items.id
              AND known_lot.deleted_at IS NULL
              AND known_lot.status <> 'archived'
              AND known_lot.cost_state = 'known'
              AND known_lot.recorded_cost_per_unit IS NOT NULL
          ) THEN 'known'
          ELSE 'unknown'
        END,
        updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL
      `,
      [
        new Date().toISOString(),
        input.catalogItemId,
        product.business_id,
      ],
    );
  });

  if (!createdLot) throw new Error("Direct-resale purchase was not recorded.");
  return createdLot;
}
