import type { CostState } from "@/domain/costState";
import {
  makeMovementId,
  makeProductStockLotId,
} from "@/domain/ids";
import {
  INVENTORY_QUANTITY_TOLERANCE,
  reconcileProductStock,
  type ProductStockReconciliation,
} from "@/domain/stockAuthority";

import {
  getRepositoryDatabase,
  nowIso,
  type RepositoryDatabase,
} from "./shared";

export type ProductStockLotOrigin =
  | "purchase"
  | "production"
  | "adjustment"
  | "legacy_balance"
  | "transfer"
  | "return";
export type ProductStockLotStatus = "active" | "depleted" | "archived";
export type ProductStockLotProvenance =
  | "exact"
  | "legacy_unknown"
  | "review_required";

export type ProductStockLotRecord = {
  id: string;
  businessId: string;
  branchId: string | null;
  productId: string;
  catalogItemId: string;
  originKind: ProductStockLotOrigin;
  productionBatchId: string | null;
  purchaseReceiptId: string | null;
  supplierId: string | null;
  initializationToken: string | null;
  originDate: string;
  expiryDate: string | null;
  initialQuantity: number;
  remainingQuantity: number;
  unit: string;
  recordedTotalCost: number | null;
  recordedCostPerUnit: number | null;
  costState: CostState;
  status: ProductStockLotStatus;
  provenanceState: ProductStockLotProvenance;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type ProductStockLotRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  product_id: string;
  catalog_item_id: string;
  origin_kind: ProductStockLotOrigin;
  production_batch_id: string | null;
  purchase_receipt_id: string | null;
  supplier_id: string | null;
  initialization_token: string | null;
  origin_date: string;
  expiry_date: string | null;
  initial_quantity: number;
  remaining_quantity: number;
  unit: string;
  recorded_total_cost: number | null;
  recorded_cost_per_unit: number | null;
  cost_state: CostState;
  status: ProductStockLotStatus;
  provenance_state: ProductStockLotProvenance;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function mapLot(row: ProductStockLotRow): ProductStockLotRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    productId: row.product_id,
    catalogItemId: row.catalog_item_id,
    originKind: row.origin_kind,
    productionBatchId: row.production_batch_id,
    purchaseReceiptId: row.purchase_receipt_id,
    supplierId: row.supplier_id,
    initializationToken: row.initialization_token,
    originDate: row.origin_date,
    expiryDate: row.expiry_date,
    initialQuantity: row.initial_quantity,
    remainingQuantity: row.remaining_quantity,
    unit: row.unit,
    recordedTotalCost: row.recorded_total_cost,
    recordedCostPerUnit: row.recorded_cost_per_unit,
    costState: row.cost_state,
    status: row.status,
    provenanceState: row.provenance_state,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function validateCostState(
  state: CostState,
  totalCost: number | null,
  unitCost: number | null,
  quantity: number,
) {
  if (
    state === "known" &&
    (totalCost === null ||
      unitCost === null ||
      !Number.isFinite(totalCost) ||
      !Number.isFinite(unitCost) ||
      totalCost < 0 ||
      unitCost < 0 ||
      Math.abs(totalCost - unitCost * quantity) >
        INVENTORY_QUANTITY_TOLERANCE)
  ) {
    throw new Error(
      "Known Product-lot cost requires consistent non-negative values.",
    );
  }
  if (
    state !== "known" &&
    (totalCost !== null || unitCost !== null)
  ) {
    throw new Error("Unresolved Product-lot cost must remain NULL.");
  }
}

async function validateProductLotOrigin(
  input: AddProductStockLotInput,
  product: {
    branch_id: string | null;
  },
  db: RepositoryDatabase,
) {
  const productionBatchId = input.productionBatchId?.trim() || null;
  const purchaseReceiptId = input.purchaseReceiptId?.trim() || null;
  const supplierId = input.supplierId?.trim() || null;

  if (supplierId) {
    const supplier = await db.getFirstAsync<{
      business_id: string;
      status: string;
    }>(
      `
        SELECT business_id, status
        FROM suppliers
        WHERE id = ? AND deleted_at IS NULL
      `,
      [supplierId],
    );
    if (
      !supplier ||
      supplier.business_id !== input.businessId ||
      supplier.status !== "active"
    ) {
      throw new Error("Product-lot supplier is unavailable.");
    }
  }

  if (input.originKind === "production") {
    if (!productionBatchId || purchaseReceiptId || supplierId) {
      throw new Error(
        "Production-origin Product lots require only an exact production batch.",
      );
    }
    const batch = await db.getFirstAsync<{
      business_id: string;
      branch_id: string | null;
      output_product_id: string | null;
    }>(
      `
        SELECT business_id, branch_id, output_product_id
        FROM production_batches
        WHERE id = ? AND deleted_at IS NULL
      `,
      [productionBatchId],
    );
    if (
      !batch ||
      batch.business_id !== input.businessId ||
      batch.branch_id !== product.branch_id ||
      batch.output_product_id !== input.productId
    ) {
      throw new Error("Product lot does not match its production batch.");
    }
    return;
  }

  if (input.originKind === "purchase") {
    if (!purchaseReceiptId || productionBatchId) {
      throw new Error(
        "Purchase-origin Product lots require only an exact purchase receipt.",
      );
    }
    const receipt = await db.getFirstAsync<{
      business_id: string;
      branch_id: string | null;
      supplier_id: string | null;
    }>(
      `
        SELECT business_id, branch_id, supplier_id
        FROM purchase_receipts
        WHERE id = ? AND deleted_at IS NULL
      `,
      [purchaseReceiptId],
    );
    if (
      !receipt ||
      receipt.business_id !== input.businessId ||
      receipt.branch_id !== product.branch_id ||
      receipt.supplier_id !== supplierId
    ) {
      throw new Error("Product lot does not match its purchase receipt.");
    }
    return;
  }

  if (productionBatchId || purchaseReceiptId || supplierId) {
    throw new Error(
      "This Product-lot origin cannot claim purchase or production provenance.",
    );
  }
}

function reconciliationFromRows(
  scalarQuantity: number,
  rows: ProductStockLotRow[],
): ProductStockReconciliation {
  return reconcileProductStock(
    scalarQuantity,
    rows.map((row) => ({
      lotId: row.id,
      remainingQuantity: row.remaining_quantity,
      status: row.status,
    })),
  );
}

async function readProductAndLots(
  productId: string,
  businessId: string,
  db: RepositoryDatabase,
) {
  const product = await db.getFirstAsync<{
    id: string;
    business_id: string;
    branch_id: string | null;
    stock_qty: number;
    unit_type: string;
    cost: number;
  }>(
    `
      SELECT id, business_id, branch_id, stock_qty, unit_type, cost
      FROM products
      WHERE id = ? AND business_id = ? AND deleted_at IS NULL
    `,
    [productId, businessId],
  );
  if (!product) throw new Error("Product is unavailable.");
  const lots = await db.getAllAsync<ProductStockLotRow>(
    `
      SELECT *
      FROM product_stock_lots
      WHERE product_id = ? AND business_id = ? AND deleted_at IS NULL
      ORDER BY origin_date ASC, created_at ASC, id ASC
    `,
    [productId, businessId],
  );
  return { product, lots };
}

async function requireLotTrackedProductBinding(
  productId: string,
  businessId: string,
  db: RepositoryDatabase,
) {
  const binding = await db.getFirstAsync<{ catalog_item_id: string }>(
    `
      SELECT binding.catalog_item_id
      FROM legacy_item_bindings binding
      INNER JOIN catalog_items item
        ON item.id = binding.catalog_item_id
        AND item.business_id = binding.business_id
        AND item.deleted_at IS NULL
      WHERE binding.entity_kind = 'product'
        AND binding.legacy_entity_id = ?
        AND binding.business_id = ?
        AND binding.compatibility_mode IN ('reviewed_legacy', 'native')
        AND binding.review_required = 0
        AND binding.binding_status = 'active'
        AND binding.deleted_at IS NULL
        AND item.stock_policy = 'product_lots'
        AND item.lifecycle_status <> 'archived'
    `,
    [productId, businessId],
  );
  if (!binding) {
    throw new Error("Product is not activated for lot-backed stock.");
  }
  return binding.catalog_item_id;
}

export async function listProductStockLots(
  productId: string,
  db?: RepositoryDatabase,
) {
  const rows = await getRepositoryDatabase(db).getAllAsync<ProductStockLotRow>(
    `
      SELECT *
      FROM product_stock_lots
      WHERE product_id = ? AND deleted_at IS NULL
      ORDER BY origin_date ASC, created_at ASC, id ASC
    `,
    [productId],
  );
  return rows.map(mapLot);
}

export async function reconcileStoredProductStock(
  productId: string,
  businessId: string,
  db?: RepositoryDatabase,
) {
  const { product, lots } = await readProductAndLots(
    productId,
    businessId,
    getRepositoryDatabase(db),
  );
  return reconciliationFromRows(product.stock_qty, lots);
}

export type InitializeLegacyBalanceInput = {
  businessId: string;
  productId: string;
  catalogItemId: string;
  initializationToken: string;
  notes?: string | null;
};

/**
 * Owner-review-only transition. It copies the observed scalar balance as
 * explicitly uncertain evidence without changing the scalar or claiming a
 * purchase/production origin. Retrying the same token is idempotent.
 */
export async function initializeReviewedLegacyProductBalance(
  input: InitializeLegacyBalanceInput,
  db?: RepositoryDatabase,
) {
  if (!input.initializationToken.trim()) {
    throw new Error("Initialization token is required.");
  }
  const database = getRepositoryDatabase(db);
  let initialized: ProductStockLotRecord | null = null;

  const apply = async (txn: RepositoryDatabase) => {
    const prior = await txn.getFirstAsync<ProductStockLotRow>(
      `
        SELECT *
        FROM product_stock_lots
        WHERE initialization_token = ? AND deleted_at IS NULL
      `,
      [input.initializationToken],
    );
    if (prior) {
      if (
        prior.product_id !== input.productId ||
        prior.catalog_item_id !== input.catalogItemId
      ) {
        throw new Error("Initialization token belongs to another Product.");
      }
      initialized = mapLot(prior);
      return;
    }

    const transition = await txn.getFirstAsync<{
      business_id: string;
      branch_id: string | null;
      stock_qty: number;
      unit_type: string;
      cost: number;
      compatibility_mode: string;
      review_required: number;
      stock_policy: string;
    }>(
      `
        SELECT
          p.business_id,
          p.branch_id,
          p.stock_qty,
          p.unit_type,
          p.cost,
          binding.compatibility_mode,
          binding.review_required,
          item.stock_policy
        FROM products p
        INNER JOIN legacy_item_bindings binding
          ON binding.entity_kind = 'product'
          AND binding.legacy_entity_id = p.id
          AND binding.catalog_item_id = ?
          AND binding.deleted_at IS NULL
        INNER JOIN catalog_items item
          ON item.id = binding.catalog_item_id
          AND item.deleted_at IS NULL
        WHERE p.id = ? AND p.business_id = ? AND p.deleted_at IS NULL
      `,
      [input.catalogItemId, input.productId, input.businessId],
    );
    if (
      !transition ||
      transition.compatibility_mode !== "reviewed_legacy" ||
      transition.review_required !== 0 ||
      transition.stock_policy !== "product_lots"
    ) {
      throw new Error("Product is not approved for lot initialization.");
    }
    if (
      !Number.isFinite(transition.stock_qty) ||
      transition.stock_qty < -INVENTORY_QUANTITY_TOLERANCE
    ) {
      throw new Error("Legacy Product balance requires owner review.");
    }

    const existing = await txn.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM product_stock_lots
        WHERE product_id = ?
      `,
      [input.productId],
    );
    if ((existing?.count ?? 0) !== 0) {
      throw new Error("Product-lot evidence is already initialized.");
    }

    const quantity =
      Math.abs(transition.stock_qty) <= INVENTORY_QUANTITY_TOLERANCE
        ? 0
        : transition.stock_qty;
    const timestamp = nowIso();
    const id = makeProductStockLotId();
    const knownCost = transition.cost > 0;
    await txn.runAsync(
      `
        INSERT INTO product_stock_lots (
          id, business_id, branch_id, product_id, catalog_item_id, origin_kind,
          production_batch_id, purchase_receipt_id, supplier_id,
          initialization_token, origin_date, expiry_date, initial_quantity,
          remaining_quantity, unit, recorded_total_cost,
          recorded_cost_per_unit, cost_state, status, provenance_state, notes,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, 'legacy_balance', NULL, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'legacy_unknown', ?, ?, ?, 'local', NULL)
      `,
      [
        id,
        input.businessId,
        transition.branch_id,
        input.productId,
        input.catalogItemId,
        input.initializationToken,
        timestamp,
        quantity,
        quantity,
        transition.unit_type,
        knownCost ? transition.cost * quantity : null,
        knownCost ? transition.cost : null,
        knownCost ? "known" : "legacy_zero_unresolved",
        quantity > INVENTORY_QUANTITY_TOLERANCE ? "active" : "depleted",
        input.notes?.trim() || null,
        timestamp,
        timestamp,
      ],
    );
    const row = await txn.getFirstAsync<ProductStockLotRow>(
      "SELECT * FROM product_stock_lots WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("Legacy Product balance was not recorded.");
    initialized = mapLot(row);
  };

  if (db) {
    await apply(database);
  } else {
    await database.withExclusiveTransactionAsync(apply);
  }

  if (!initialized) throw new Error("Product-lot initialization failed.");
  return initialized;
}

export type AddProductStockLotInput = {
  id?: string;
  businessId: string;
  branchId?: string | null;
  productId: string;
  catalogItemId: string;
  originKind: Exclude<ProductStockLotOrigin, "legacy_balance">;
  productionBatchId?: string | null;
  purchaseReceiptId?: string | null;
  supplierId?: string | null;
  originDate: string;
  expiryDate?: string | null;
  quantity: number;
  unit: string;
  recordedTotalCost?: number | null;
  recordedCostPerUnit?: number | null;
  costState: CostState;
  provenanceState: Exclude<ProductStockLotProvenance, "legacy_unknown">;
  notes?: string | null;
  movementType: string;
  movementReason: string;
};

/**
 * Creates native Product-lot evidence, updates the compatibility scalar, and
 * appends movement evidence in one transaction. Existing drift blocks the
 * mutation and is only reported; it is never repaired here.
 */
export async function addProductStockLotWithScalarProjection(
  input: AddProductStockLotInput,
  db?: RepositoryDatabase,
) {
  if (
    !input.unit.trim() ||
    !input.originDate.trim() ||
    !input.movementType.trim() ||
    !input.movementReason.trim() ||
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0
  ) {
    throw new Error("Product-lot quantity must be greater than zero.");
  }
  validateCostState(
    input.costState,
    input.recordedTotalCost ?? null,
    input.recordedCostPerUnit ?? null,
    input.quantity,
  );
  const database = getRepositoryDatabase(db);
  const timestamp = nowIso();
  const id = input.id ?? makeProductStockLotId();

  const apply = async (txn: RepositoryDatabase) => {
    const { product, lots } = await readProductAndLots(
      input.productId,
      input.businessId,
      txn,
    );
    const catalogItemId = await requireLotTrackedProductBinding(
      input.productId,
      input.businessId,
      txn,
    );
    if (catalogItemId !== input.catalogItemId) {
      throw new Error("Product lot does not match the exact catalog binding.");
    }
    if (
      input.unit.trim() !== product.unit_type ||
      lots.some((lot) => lot.unit !== product.unit_type)
    ) {
      throw new Error("Product-lot unit must match the Product stock unit.");
    }
    const before = reconciliationFromRows(product.stock_qty, lots);
    if (!before.canAllocate) {
      throw new Error(`Product stock reconciliation blocked: ${before.status}.`);
    }
    if (
      input.branchId !== undefined &&
      input.branchId !== product.branch_id
    ) {
      throw new Error("Product lot branch does not match its Product.");
    }
    await validateProductLotOrigin(input, product, txn);

    await txn.runAsync(
      `
        INSERT INTO product_stock_lots (
          id, business_id, branch_id, product_id, catalog_item_id, origin_kind,
          production_batch_id, purchase_receipt_id, supplier_id,
          initialization_token, origin_date, expiry_date, initial_quantity,
          remaining_quantity, unit, recorded_total_cost,
          recorded_cost_per_unit, cost_state, status, provenance_state, notes,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'local', NULL)
      `,
      [
        id,
        input.businessId,
        product.branch_id,
        input.productId,
        input.catalogItemId,
        input.originKind,
        input.productionBatchId?.trim() || null,
        input.purchaseReceiptId?.trim() || null,
        input.supplierId?.trim() || null,
        input.originDate,
        input.expiryDate ?? null,
        input.quantity,
        input.quantity,
        input.unit.trim(),
        input.recordedTotalCost ?? null,
        input.recordedCostPerUnit ?? null,
        input.costState,
        input.provenanceState,
        input.notes?.trim() || null,
        timestamp,
        timestamp,
      ],
    );

    const scalarResult = await txn.runAsync(
      `
        UPDATE products
        SET stock_qty = stock_qty + ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ?
          AND ABS(stock_qty - ?) <= ?
          AND deleted_at IS NULL
      `,
      [
        input.quantity,
        timestamp,
        input.productId,
        input.businessId,
        product.stock_qty,
        INVENTORY_QUANTITY_TOLERANCE,
      ],
    );
    if (scalarResult.changes !== 1) {
      throw new Error("Product scalar changed before the lot write.");
    }

    await txn.runAsync(
      `
        INSERT INTO inventory_movements (
          id, business_id, branch_id, product_id, movement_type, quantity,
          reason, linked_sale_id, unit_cost, total_cost, created_at, updated_at,
          sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'local', NULL)
      `,
      [
        makeMovementId(),
        input.businessId,
        product.branch_id,
        input.productId,
        input.movementType,
        input.quantity,
        input.movementReason,
        input.recordedCostPerUnit ?? null,
        input.recordedTotalCost ?? null,
        timestamp,
        timestamp,
      ],
    );
  };

  if (db) {
    await apply(database);
  } else {
    await database.withExclusiveTransactionAsync(apply);
  }

  const row = await database.getFirstAsync<ProductStockLotRow>(
    "SELECT * FROM product_stock_lots WHERE id = ?",
    [id],
  );
  if (!row) throw new Error("Created Product stock lot is unavailable.");
  return mapLot(row);
}

export type ProductLotDeduction = {
  lotId: string;
  quantity: number;
};

export async function deductProductStockLotsWithScalarProjection(
  input: {
    businessId: string;
    productId: string;
    deductions: ProductLotDeduction[];
    movementType: string;
    movementReason: string;
    linkedSaleId?: string | null;
  },
  db?: RepositoryDatabase,
) {
  if (input.deductions.length === 0) {
    throw new Error("At least one Product-lot deduction is required.");
  }
  const seen = new Set<string>();
  let total = 0;
  for (const deduction of input.deductions) {
    if (
      seen.has(deduction.lotId) ||
      !Number.isFinite(deduction.quantity) ||
      deduction.quantity <= 0
    ) {
      throw new Error("Product-lot deductions must be positive and unique.");
    }
    seen.add(deduction.lotId);
    total += deduction.quantity;
  }

  const database = getRepositoryDatabase(db);
  await database.withExclusiveTransactionAsync(async (txn) => {
    const timestamp = nowIso();
    const { product, lots } = await readProductAndLots(
      input.productId,
      input.businessId,
      txn,
    );
    const catalogItemId = await requireLotTrackedProductBinding(
      input.productId,
      input.businessId,
      txn,
    );
    if (lots.some((lot) => lot.catalog_item_id !== catalogItemId)) {
      throw new Error("Product lots contain contradictory catalog bindings.");
    }
    if (lots.some((lot) => lot.unit !== product.unit_type)) {
      throw new Error("Product lots contain contradictory stock units.");
    }
    const before = reconciliationFromRows(product.stock_qty, lots);
    if (!before.canAllocate) {
      throw new Error(`Product stock reconciliation blocked: ${before.status}.`);
    }
    if (product.stock_qty + INVENTORY_QUANTITY_TOLERANCE < total) {
      throw new Error("Insufficient Product scalar stock.");
    }

    for (const deduction of input.deductions) {
      const result = await txn.runAsync(
        `
          UPDATE product_stock_lots
          SET remaining_quantity = remaining_quantity - ?,
            status = CASE
              WHEN remaining_quantity - ? <= ? THEN 'depleted'
              ELSE 'active'
            END,
            updated_at = ?, sync_status = 'local'
          WHERE id = ? AND product_id = ? AND business_id = ?
            AND status = 'active' AND deleted_at IS NULL
            AND remaining_quantity + ? >= ?
        `,
        [
          deduction.quantity,
          deduction.quantity,
          INVENTORY_QUANTITY_TOLERANCE,
          timestamp,
          deduction.lotId,
          input.productId,
          input.businessId,
          INVENTORY_QUANTITY_TOLERANCE,
          deduction.quantity,
        ],
      );
      if (result.changes !== 1) {
        throw new Error("Product lot changed or became insufficient.");
      }
    }

    const scalarResult = await txn.runAsync(
      `
        UPDATE products
        SET stock_qty = stock_qty - ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL
          AND ABS(stock_qty - ?) <= ?
          AND stock_qty + ? >= ?
      `,
      [
        total,
        timestamp,
        input.productId,
        input.businessId,
        product.stock_qty,
        INVENTORY_QUANTITY_TOLERANCE,
        INVENTORY_QUANTITY_TOLERANCE,
        total,
      ],
    );
    if (scalarResult.changes !== 1) {
      throw new Error("Product scalar changed or became insufficient.");
    }

    await txn.runAsync(
      `
        INSERT INTO inventory_movements (
          id, business_id, branch_id, product_id, movement_type, quantity,
          reason, linked_sale_id, unit_cost, total_cost, created_at, updated_at,
          sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'local', NULL)
      `,
      [
        makeMovementId(),
        input.businessId,
        product.branch_id,
        input.productId,
        input.movementType,
        -total,
        input.movementReason,
        input.linkedSaleId ?? null,
        timestamp,
        timestamp,
      ],
    );
  });
}
