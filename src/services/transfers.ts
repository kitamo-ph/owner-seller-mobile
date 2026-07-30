import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import { getAverageProducedCostByProduct, getProductById, type RepositoryDatabase } from "@/db/repositories";
import { makeMovementId, makeProductId, makeTransferId } from "@/domain/ids";
import type { Product } from "@/domain/types";

import { loadOwnerSetupStatus } from "./ownerSetup";

export type RecordTransferInput = {
  productId: string;
  toBranchId: string;
  quantity: number;
  notes?: string | null;
};

export type TransferResult = {
  transferId: string;
  productName: string;
  fromBranchName: string;
  toBranchName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  createdDestinationProduct: boolean;
};

export async function loadTransferCostPreview(
  productId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const status = await loadOwnerSetupStatus(db);
  const product = await getProductById(productId, db);
  if (!status.activeBusiness || !product || product.businessId !== status.activeBusiness.id) {
    throw new Error("Product not found. Refresh and try again.");
  }

  const averageCosts = await getAverageProducedCostByProduct(status.activeBusiness.id, db);
  return {
    unitCost: averageCosts.get(product.id) ?? product.cost,
    source: averageCosts.has(product.id) ? ("production_average" as const) : ("product_cost" as const),
  };
}

export async function recordTransfer(
  input: RecordTransferInput,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<TransferResult> {
  await runMigrations(db);

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Ilagay kung ilang piraso ang ililipat. Example: 5.");
  }

  const status = await loadOwnerSetupStatus(db);
  const business = status.activeBusiness;
  if (!business) {
    throw new Error("Create your business profile in Owner Settings first.");
  }

  const product = await getProductById(input.productId, db);
  if (!product || product.businessId !== business.id) {
    throw new Error("Product not found. Refresh and try again.");
  }

  if (!product.branchId) {
    throw new Error(`${product.name} is shared across stalls, kaya hindi na kailangang ilipat.`);
  }

  const fromBranch = status.branches.find((branch) => branch.id === product.branchId);
  const toBranch = status.branches.find((branch) => branch.id === input.toBranchId);
  if (!fromBranch || !toBranch) {
    throw new Error("Piliin kung saang stall ililipat.");
  }

  if (fromBranch.id === toBranch.id) {
    throw new Error("Iba dapat ang destination stall.");
  }

  if (product.stockQty < input.quantity) {
    throw new Error(
      `Hindi puwedeng mas mataas sa current stock. ${product.name} has ${product.stockQty} ${product.unitType} left sa ${fromBranch.branchName}.`,
    );
  }

  // Value moves with the goods: average produced cost when production history
  // exists, otherwise the owner-entered product cost.
  const averageCosts = await getAverageProducedCostByProduct(business.id, db);
  const unitCost = averageCosts.get(product.id) ?? product.cost;
  const totalCost = unitCost * input.quantity;

  // Destination row: same-named active product on the target stall, or a clone.
  const destinationRow = await db.getFirstAsync<{ id: string }>(
    `
      SELECT id FROM products
      WHERE business_id = ? AND branch_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
      LIMIT 1
    `,
    [business.id, toBranch.id, product.name],
  );

  const transferId = makeTransferId();
  const timestamp = new Date().toISOString();
  const notes = input.notes?.trim() || null;
  const newDestinationProductId = destinationRow ? null : makeProductId();

  await db.withExclusiveTransactionAsync(async (txn) => {
    const sourceResult = await txn.runAsync(
      `
        UPDATE products
        SET stock_qty = stock_qty - ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL AND stock_qty >= ?
      `,
      [input.quantity, timestamp, product.id, business.id, input.quantity],
    );

    if (sourceResult.changes !== 1) {
      throw new Error(`Not enough ${product.name} stock sa ${fromBranch.branchName}.`);
    }

    let destinationProductId: string;
    if (destinationRow) {
      destinationProductId = destinationRow.id;
      await txn.runAsync(
        `
          UPDATE products
          SET stock_qty = stock_qty + ?, updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL
        `,
        [input.quantity, timestamp, destinationProductId, business.id],
      );
    } else {
      destinationProductId = newDestinationProductId as string;
      await txn.runAsync(
        `
          INSERT INTO products (
            id, business_id, branch_id, name, category, price, cost, stock_qty,
            unit_type, low_stock_threshold, bundle_quantity, bundle_price,
            bundle_label, active, product_type, created_at, updated_at, sync_status, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          destinationProductId,
          business.id,
          toBranch.id,
          product.name,
          product.category,
          product.price,
          product.cost,
          input.quantity,
          product.unitType,
          product.lowStockThreshold,
          product.bundleQuantity,
          product.bundlePrice,
          product.bundleLabel,
          1,
          product.productType,
          timestamp,
          timestamp,
          "local",
          null,
        ],
      );
    }

    await txn.runAsync(
      `
        INSERT INTO product_transfers (
          id, business_id, from_branch_id, to_branch_id, from_product_id, to_product_id,
          product_name, quantity, unit_cost, total_cost, notes,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        transferId,
        business.id,
        fromBranch.id,
        toBranch.id,
        product.id,
        destinationProductId,
        product.name,
        input.quantity,
        unitCost,
        totalCost,
        notes,
        timestamp,
        timestamp,
        "local",
        null,
      ],
    );

    await txn.runAsync(
      `
        INSERT INTO inventory_movements (
          id, business_id, branch_id, product_id, movement_type, quantity, reason,
          linked_sale_id, unit_cost, total_cost, created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        makeMovementId(),
        business.id,
        fromBranch.id,
        product.id,
        "transfer_out",
        input.quantity,
        `Lipat papunta sa ${toBranch.branchName}`,
        null,
        unitCost,
        totalCost,
        timestamp,
        timestamp,
        "local",
        null,
      ],
    );

    await txn.runAsync(
      `
        INSERT INTO inventory_movements (
          id, business_id, branch_id, product_id, movement_type, quantity, reason,
          linked_sale_id, unit_cost, total_cost, created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        makeMovementId(),
        business.id,
        toBranch.id,
        destinationProductId,
        "transfer_in",
        input.quantity,
        `Lipat galing sa ${fromBranch.branchName}`,
        null,
        unitCost,
        totalCost,
        timestamp,
        timestamp,
        "local",
        null,
      ],
    );
  });

  return {
    transferId,
    productName: product.name,
    fromBranchName: fromBranch.branchName,
    toBranchName: toBranch.branchName,
    quantity: input.quantity,
    unitCost,
    totalCost,
    createdDestinationProduct: !destinationRow,
  };
}

export type TransferableProduct = Product & { branchName: string };

export async function listTransferableProducts(db: RepositoryDatabase = openKitamoDatabase()): Promise<TransferableProduct[]> {
  await runMigrations(db);
  const status = await loadOwnerSetupStatus(db);
  if (!status.activeBusiness || status.branches.length < 2) {
    return [];
  }

  const branchNames = new Map(status.branches.map((branch) => [branch.id, branch.branchName]));
  return status.products
    .filter((product) => product.branchId && product.stockQty > 0 && branchNames.has(product.branchId))
    .map((product) => ({
      ...product,
      branchName: branchNames.get(product.branchId as string) as string,
    }));
}
