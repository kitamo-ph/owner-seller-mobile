import type { CostState } from "@/domain/costState";
import { validateCostEvidence } from "@/domain/costState";
import {
  makeIngredientMovementId,
  makePurchaseReceiptId,
  makeSaleSupplyLotUsageId,
  makeSaleSupplyUsageId,
  makeSupplierId,
  makeSupplyRuleId,
} from "@/domain/ids";
import {
  orderCostCategoryForSupply,
  type OrderCostEvidence,
} from "@/domain/orderCosts";
import {
  validateSupplyRule,
  type SupplyCategory,
  type SupplyConsumptionStage,
  type SupplyRoundingRule,
  type SupplyRuleBehavior,
  type SupplyRuleScope,
  type SupplyUsageRule,
} from "@/domain/supplyRules";
import { INVENTORY_QUANTITY_TOLERANCE } from "@/domain/stockAuthority";

import {
  getRepositoryDatabase,
  nowIso,
  toBoolean,
  toInteger,
  type RepositoryDatabase,
} from "./shared";

export type SupplyRuleRecord = {
  id: string;
  businessId: string;
  branchId: string | null;
  supplyCatalogItemId: string;
  supplyIngredientId: string;
  targetProductId: string | null;
  targetRecipeVersionId: string | null;
  supplyCategory: SupplyCategory;
  consumptionStage: SupplyConsumptionStage;
  scope: SupplyRuleScope;
  behavior: SupplyRuleBehavior;
  roundingMode: SupplyRoundingRule;
  triggerQuantity: number;
  supplyQuantity: number;
  supplyUnit: string;
  version: number;
  status: "active" | "superseded" | "archived";
  supersedesRuleId: string | null;
  effectiveAt: string;
  archivedAt: string | null;
  costWarning: boolean;
  stockWarning: boolean;
  createdAt: string;
  updatedAt: string;
};

type SupplyRuleRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  supply_catalog_item_id: string;
  supply_ingredient_id: string;
  target_product_id: string | null;
  target_recipe_version_id: string | null;
  supply_category: SupplyCategory;
  consumption_stage: SupplyConsumptionStage;
  scope: SupplyRuleScope;
  behavior: SupplyRuleBehavior;
  rounding_mode: SupplyRoundingRule;
  trigger_quantity: number;
  supply_quantity: number;
  supply_unit: string;
  version: number;
  status: SupplyRuleRecord["status"];
  supersedes_rule_id: string | null;
  effective_at: string;
  archived_at: string | null;
  cost_warning: number;
  stock_warning: number;
  created_at: string;
  updated_at: string;
};

export type CreateSupplyRuleInput = {
  id?: string;
  businessId: string;
  branchId?: string | null;
  supplyCatalogItemId: string;
  supplyIngredientId: string;
  targetProductId?: string | null;
  targetRecipeVersionId?: string | null;
  supplyCategory: SupplyCategory;
  consumptionStage: SupplyConsumptionStage;
  scope: SupplyRuleScope;
  behavior: SupplyRuleBehavior;
  roundingMode: SupplyRoundingRule;
  triggerQuantity: number;
  supplyQuantity: number;
  supplyUnit: string;
  costWarning?: boolean;
  stockWarning?: boolean;
};

function mapRule(row: SupplyRuleRow): SupplyRuleRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    supplyCatalogItemId: row.supply_catalog_item_id,
    supplyIngredientId: row.supply_ingredient_id,
    targetProductId: row.target_product_id,
    targetRecipeVersionId: row.target_recipe_version_id,
    supplyCategory: row.supply_category,
    consumptionStage: row.consumption_stage,
    scope: row.scope,
    behavior: row.behavior,
    roundingMode: row.rounding_mode,
    triggerQuantity: row.trigger_quantity,
    supplyQuantity: row.supply_quantity,
    supplyUnit: row.supply_unit,
    version: row.version,
    status: row.status,
    supersedesRuleId: row.supersedes_rule_id,
    effectiveAt: row.effective_at,
    archivedAt: row.archived_at,
    costWarning: toBoolean(row.cost_warning),
    stockWarning: toBoolean(row.stock_warning),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asDomainRule(
  input: CreateSupplyRuleInput,
  id: string,
): SupplyUsageRule {
  return {
    id,
    supplyItemId: input.supplyCatalogItemId,
    supplyCategory: input.supplyCategory,
    supplyUnit: input.supplyUnit,
    scope: input.scope,
    behavior: input.behavior,
    consumptionStage: input.consumptionStage,
    roundingRule: input.roundingMode,
    targetProductId: input.targetProductId ?? null,
    targetRecipeVersionId: input.targetRecipeVersionId ?? null,
    triggerQuantity: input.triggerQuantity,
    supplyQuantity: input.supplyQuantity,
    active: true,
  };
}

export async function createSupplyUsageRule(
  input: CreateSupplyRuleInput,
  db?: RepositoryDatabase,
) {
  const id = input.id ?? makeSupplyRuleId();
  const issues = validateSupplyRule(asDomainRule(input, id));
  if (issues.length > 0) {
    throw new Error(`Invalid supply rule: ${issues.join(", ")}.`);
  }
  const database = getRepositoryDatabase(db);
  let record: SupplyRuleRecord | null = null;

  await database.withExclusiveTransactionAsync(async (txn) => {
    const binding = await txn.getFirstAsync<{
      business_id: string;
      legacy_entity_id: string;
      classification: string;
      lifecycle_status: string;
      readiness_state: string;
      review_required: number;
      binding_status: string;
      compatibility_mode: string;
    }>(
      `
        SELECT
          item.business_id,
          binding.legacy_entity_id,
          item.classification,
          item.lifecycle_status,
          item.readiness_state,
          binding.review_required,
          binding.binding_status,
          binding.compatibility_mode
        FROM catalog_items item
        INNER JOIN legacy_item_bindings binding
          ON binding.catalog_item_id = item.id
          AND binding.entity_kind = 'ingredient'
          AND binding.deleted_at IS NULL
        WHERE item.id = ? AND item.deleted_at IS NULL
      `,
      [input.supplyCatalogItemId],
    );
    if (
      !binding ||
      binding.business_id !== input.businessId ||
      binding.legacy_entity_id !== input.supplyIngredientId ||
      binding.classification !== "supply_packaging" ||
      !["ready", "active"].includes(binding.lifecycle_status) ||
      binding.readiness_state !== "ready" ||
      binding.review_required !== 0 ||
      binding.binding_status !== "active" ||
      !["reviewed_legacy", "native"].includes(binding.compatibility_mode)
    ) {
      throw new Error("Supply rule requires an exact reviewed Supply binding.");
    }

    const previous = await txn.getFirstAsync<SupplyRuleRow>(
      `
        SELECT *
        FROM supply_usage_rules
        WHERE business_id = ?
          AND branch_id IS ?
          AND supply_catalog_item_id = ?
          AND target_product_id IS ?
          AND target_recipe_version_id IS ?
          AND consumption_stage = ?
          AND scope = ?
          AND status = 'active'
          AND deleted_at IS NULL
      `,
      [
        input.businessId,
        input.branchId ?? null,
        input.supplyCatalogItemId,
        input.targetProductId ?? null,
        input.targetRecipeVersionId ?? null,
        input.consumptionStage,
        input.scope,
      ],
    );
    const versionRow = await txn.getFirstAsync<{ next_version: number }>(
      `
        SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM supply_usage_rules
        WHERE business_id = ?
          AND branch_id IS ?
          AND supply_catalog_item_id = ?
          AND target_product_id IS ?
          AND target_recipe_version_id IS ?
          AND consumption_stage = ?
          AND scope = ?
      `,
      [
        input.businessId,
        input.branchId ?? null,
        input.supplyCatalogItemId,
        input.targetProductId ?? null,
        input.targetRecipeVersionId ?? null,
        input.consumptionStage,
        input.scope,
      ],
    );
    const timestamp = nowIso();
    if (previous) {
      await txn.runAsync(
        `
          UPDATE supply_usage_rules
          SET status = 'superseded', archived_at = ?, updated_at = ?,
            sync_status = 'local'
          WHERE id = ? AND status = 'active'
        `,
        [timestamp, timestamp, previous.id],
      );
    }

    await txn.runAsync(
      `
        INSERT INTO supply_usage_rules (
          id, business_id, branch_id, supply_catalog_item_id,
          supply_ingredient_id, target_product_id, target_recipe_version_id,
          supply_category, consumption_stage, scope, behavior, rounding_mode,
          trigger_quantity, supply_quantity, supply_unit, version, status,
          supersedes_rule_id, effective_at, archived_at, cost_warning,
          stock_warning, created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?, ?, 'local', NULL)
      `,
      [
        id,
        input.businessId,
        input.branchId ?? null,
        input.supplyCatalogItemId,
        input.supplyIngredientId,
        input.targetProductId ?? null,
        input.targetRecipeVersionId ?? null,
        input.supplyCategory,
        input.consumptionStage,
        input.scope,
        input.behavior,
        input.roundingMode,
        input.triggerQuantity,
        input.supplyQuantity,
        input.supplyUnit,
        versionRow?.next_version ?? 1,
        previous?.id ?? null,
        timestamp,
        toInteger(input.costWarning ?? false),
        toInteger(input.stockWarning ?? false),
        timestamp,
        timestamp,
      ],
    );
    const row = await txn.getFirstAsync<SupplyRuleRow>(
      "SELECT * FROM supply_usage_rules WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("Supply rule could not be read after insert.");
    record = mapRule(row);
  });

  if (!record) throw new Error("Supply rule creation failed.");
  return record;
}

export async function listActiveSupplyRulesForContext(
  input: {
    businessId: string;
    branchId: string;
    productIds: string[];
    recipeVersionIds: string[];
    consumptionStage: SupplyConsumptionStage;
  },
  db?: RepositoryDatabase,
) {
  const productIds = [...new Set(input.productIds)];
  const recipeVersionIds = [...new Set(input.recipeVersionIds)];
  const targetClauses = ["scope = 'per_order'"];
  const parameters: (string | number | null)[] = [
    input.businessId,
    input.branchId,
    input.consumptionStage,
  ];
  if (productIds.length > 0) {
    targetClauses.push(
      `target_product_id IN (${productIds.map(() => "?").join(", ")})`,
    );
    parameters.push(...productIds);
  }
  if (recipeVersionIds.length > 0) {
    targetClauses.push(
      `target_recipe_version_id IN (${recipeVersionIds
        .map(() => "?")
        .join(", ")})`,
    );
    parameters.push(...recipeVersionIds);
  }

  const rows = await getRepositoryDatabase(db).getAllAsync<SupplyRuleRow>(
    `
      SELECT *
      FROM supply_usage_rules
      WHERE business_id = ?
        AND (branch_id = ? OR branch_id IS NULL)
        AND consumption_stage = ?
        AND status = 'active'
        AND deleted_at IS NULL
        AND (${targetClauses.join(" OR ")})
      ORDER BY effective_at ASC, id ASC
    `,
    parameters,
  );
  return rows.map(mapRule);
}

export type SupplyUsageProposalInput = {
  id?: string;
  requestKey: string;
  supplyCatalogItemId: string;
  supplyIngredientId: string;
  ruleId?: string | null;
  supplyNameSnapshot: string;
  proposedQuantity: number;
  unit: string;
  requiredMinimum: number;
  scopeSnapshot?: SupplyRuleScope | null;
  behaviorSnapshot?: SupplyRuleBehavior | null;
  ruleVersionSnapshot?: number | null;
  supplyCategory: SupplyCategory;
  isManualOverride?: boolean;
  stockTrackingState: "tracked" | "untracked";
};

export async function recordSupplyUsageProposals(
  input: {
    businessId: string;
    checkoutToken: string;
    proposals: SupplyUsageProposalInput[];
  },
  db?: RepositoryDatabase,
) {
  if (!input.checkoutToken.trim()) {
    throw new Error("Checkout token is required for supply proposals.");
  }
  const keys = new Set<string>();
  for (const proposal of input.proposals) {
    if (
      !proposal.requestKey.trim() ||
      keys.has(proposal.requestKey) ||
      !Number.isFinite(proposal.proposedQuantity) ||
      proposal.proposedQuantity < 0 ||
      !Number.isFinite(proposal.requiredMinimum) ||
      proposal.requiredMinimum < 0
    ) {
      throw new Error("Supply proposal keys/quantities are invalid.");
    }
    keys.add(proposal.requestKey);
  }

  const database = getRepositoryDatabase(db);
  await database.withExclusiveTransactionAsync(async (txn) => {
    const timestamp = nowIso();
    for (const proposal of input.proposals) {
      const supply = await txn.getFirstAsync<{
        stock_policy: string;
        binding_status: string;
        review_required: number;
        compatibility_mode: string;
      }>(
        `
          SELECT item.stock_policy, binding.binding_status,
            binding.review_required, binding.compatibility_mode
          FROM catalog_items item
          INNER JOIN legacy_item_bindings binding
            ON binding.catalog_item_id = item.id
            AND binding.entity_kind = 'ingredient'
            AND binding.legacy_entity_id = ?
            AND binding.deleted_at IS NULL
          WHERE item.id = ? AND item.business_id = ?
            AND item.classification = 'supply_packaging'
            AND item.lifecycle_status IN ('ready', 'active')
            AND item.readiness_state = 'ready'
            AND item.deleted_at IS NULL
        `,
        [
          proposal.supplyIngredientId,
          proposal.supplyCatalogItemId,
          input.businessId,
        ],
      );
      const expectedTracking =
        supply?.stock_policy === "ingredient_lots" ? "tracked" : "untracked";
      if (
        !supply ||
        supply.binding_status !== "active" ||
        supply.review_required !== 0 ||
        !["reviewed_legacy", "native"].includes(
          supply.compatibility_mode,
        ) ||
        proposal.stockTrackingState !== expectedTracking
      ) {
        throw new Error("Supply proposal requires an exact reviewed Supply binding.");
      }

      if (proposal.ruleId) {
        const rule = await txn.getFirstAsync<{
          version: number;
          supply_category: SupplyCategory;
        }>(
          `
            SELECT version, supply_category
            FROM supply_usage_rules
            WHERE id = ? AND business_id = ?
              AND supply_catalog_item_id = ?
              AND supply_ingredient_id = ?
              AND consumption_stage = 'checkout'
              AND status = 'active' AND deleted_at IS NULL
          `,
          [
            proposal.ruleId,
            input.businessId,
            proposal.supplyCatalogItemId,
            proposal.supplyIngredientId,
          ],
        );
        if (
          !rule ||
          rule.supply_category !== proposal.supplyCategory ||
          (proposal.ruleVersionSnapshot !== null &&
            proposal.ruleVersionSnapshot !== undefined &&
            proposal.ruleVersionSnapshot !== rule.version)
        ) {
          throw new Error("Supply proposal rule snapshot is unavailable.");
        }
      }

      const prior = await txn.getFirstAsync<{
        id: string;
        status: string;
      }>(
        `
          SELECT id, status
          FROM sale_supply_usages
          WHERE checkout_token = ? AND request_key = ? AND deleted_at IS NULL
        `,
        [input.checkoutToken, proposal.requestKey],
      );
      if (prior?.status === "confirmed") {
        continue;
      }
      if (prior) {
        const result = await txn.runAsync(
          `
            UPDATE sale_supply_usages
            SET supply_catalog_item_id = ?, supply_ingredient_id = ?,
              rule_id = ?, supply_name_snapshot = ?, proposed_quantity = ?,
              unit = ?, required_minimum = ?, scope_snapshot = ?,
              behavior_snapshot = ?, rule_version_snapshot = ?,
              is_manual_override = ?, cost_category = ?,
              stock_tracking_state = ?, updated_at = ?, sync_status = 'local'
            WHERE id = ? AND status = 'proposed' AND deleted_at IS NULL
          `,
          [
            proposal.supplyCatalogItemId,
            proposal.supplyIngredientId,
            proposal.ruleId ?? null,
            proposal.supplyNameSnapshot,
            proposal.proposedQuantity,
            proposal.unit,
            proposal.requiredMinimum,
            proposal.scopeSnapshot ?? null,
            proposal.behaviorSnapshot ?? null,
            proposal.ruleVersionSnapshot ?? null,
            toInteger(proposal.isManualOverride ?? false),
            `${orderCostCategoryForSupply(proposal.supplyCategory)}_cost`,
            proposal.stockTrackingState,
            timestamp,
            prior.id,
          ],
        );
        if (result.changes !== 1) {
          throw new Error("Supply proposal changed before autosave.");
        }
      } else {
        await txn.runAsync(
          `
            INSERT INTO sale_supply_usages (
              id, business_id, sale_id, checkout_token,
              supply_catalog_item_id, supply_ingredient_id, rule_id,
              request_key, status, consumption_stage, supply_name_snapshot,
              proposed_quantity, quantity_used, unit, required_minimum,
              scope_snapshot, behavior_snapshot, rule_version_snapshot,
              is_manual_override, cost_category, unit_cost_snapshot,
              cost_contribution, cost_state, stock_tracking_state,
              ingredient_movement_id, created_at, updated_at, sync_status,
              deleted_at
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'proposed', 'checkout', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'unknown', ?, NULL, ?, ?, 'local', NULL)
          `,
          [
            proposal.id ?? makeSaleSupplyUsageId(),
            input.businessId,
            input.checkoutToken,
            proposal.supplyCatalogItemId,
            proposal.supplyIngredientId,
            proposal.ruleId ?? null,
            proposal.requestKey,
            proposal.supplyNameSnapshot,
            proposal.proposedQuantity,
            proposal.unit,
            proposal.requiredMinimum,
            proposal.scopeSnapshot ?? null,
            proposal.behaviorSnapshot ?? null,
            proposal.ruleVersionSnapshot ?? null,
            toInteger(proposal.isManualOverride ?? false),
            `${orderCostCategoryForSupply(proposal.supplyCategory)}_cost`,
            proposal.stockTrackingState,
            timestamp,
            timestamp,
          ],
        );
      }
    }
  });
}

export type ConfirmSupplyLotAllocation = {
  id?: string;
  ingredientLotId: string;
  quantityUsed: number;
  unit: string;
  normalizedQuantity?: number | null;
  normalizedUnit?: string | null;
  conversionId?: string | null;
  conversionFactorSnapshot?: number | null;
  unitCostSnapshot?: number | null;
  costContribution?: number | null;
  costState: CostState;
  allocationMode:
    | "legacy_selected"
    | "manual"
    | "recommended_fefo"
    | "recommended_fifo"
    | "legacy_balance";
};

/**
 * Future checkout transaction primitive. It does not start or commit a
 * transaction and is intentionally not called by the current checkout path.
 * The caller must pass the same transaction handle used to write the Sale.
 */
export async function confirmSupplyUsageInTransaction(
  input: {
    businessId: string;
    saleId: string;
    checkoutToken: string;
    requestKey: string;
    quantityUsed: number;
    unitCostSnapshot?: number | null;
    costContribution?: number | null;
    costState: CostState;
    allocations: ConfirmSupplyLotAllocation[];
  },
  txn: RepositoryDatabase,
) {
  const evidence = {
    state: input.costState,
    amount: input.costContribution ?? null,
    legacyValue: null,
  };
  if (!validateCostEvidence(evidence).ok) {
    throw new Error("Supply usage cost evidence is inconsistent.");
  }
  if (
    (input.costState === "known" &&
      (input.unitCostSnapshot === null ||
        input.unitCostSnapshot === undefined ||
        !Number.isFinite(input.unitCostSnapshot) ||
        input.unitCostSnapshot < 0)) ||
    (input.costState !== "known" &&
      input.unitCostSnapshot !== null &&
      input.unitCostSnapshot !== undefined)
  ) {
    throw new Error("Supply usage unit-cost evidence is inconsistent.");
  }
  if (!Number.isFinite(input.quantityUsed) || input.quantityUsed < 0) {
    throw new Error("Supply usage quantity is invalid.");
  }
  const usage = await txn.getFirstAsync<{
    id: string;
    sale_id: string | null;
    supply_catalog_item_id: string;
    supply_ingredient_id: string;
    quantity_used: number | null;
    required_minimum: number;
    unit: string;
    stock_tracking_state: "tracked" | "untracked";
    status: "proposed" | "confirmed" | "void";
  }>(
    `
      SELECT id, sale_id, supply_catalog_item_id, supply_ingredient_id,
        quantity_used, required_minimum, unit, stock_tracking_state, status
      FROM sale_supply_usages
      WHERE checkout_token = ? AND request_key = ? AND business_id = ?
        AND deleted_at IS NULL
    `,
    [input.checkoutToken, input.requestKey, input.businessId],
  );
  if (!usage) throw new Error("Supply usage proposal is unavailable.");
  if (usage.status === "confirmed") {
    if (
      usage.sale_id !== input.saleId ||
      usage.quantity_used !== input.quantityUsed
    ) {
      throw new Error("Confirmed supply usage differs from retry.");
    }
    return usage.id;
  }
  if (
    usage.status !== "proposed" ||
    input.quantityUsed + INVENTORY_QUANTITY_TOLERANCE <
      usage.required_minimum
  ) {
    throw new Error("Reviewed supply usage is below its required minimum.");
  }

  const supply = await txn.getFirstAsync<{
    stock_policy: string;
    binding_status: string;
    review_required: number;
    compatibility_mode: string;
  }>(
    `
      SELECT item.stock_policy, binding.binding_status,
        binding.review_required, binding.compatibility_mode
      FROM catalog_items item
      INNER JOIN legacy_item_bindings binding
        ON binding.catalog_item_id = item.id
        AND binding.entity_kind = 'ingredient'
        AND binding.legacy_entity_id = ?
        AND binding.deleted_at IS NULL
      WHERE item.id = ? AND item.business_id = ?
        AND item.classification = 'supply_packaging'
        AND item.lifecycle_status IN ('ready', 'active')
        AND item.readiness_state = 'ready'
        AND item.deleted_at IS NULL
    `,
    [
      usage.supply_ingredient_id,
      usage.supply_catalog_item_id,
      input.businessId,
    ],
  );
  const expectedTracking =
    supply?.stock_policy === "ingredient_lots" ? "tracked" : "untracked";
  if (
    !supply ||
    supply.binding_status !== "active" ||
    supply.review_required !== 0 ||
    !["reviewed_legacy", "native"].includes(supply.compatibility_mode) ||
    usage.stock_tracking_state !== expectedTracking
  ) {
    throw new Error("Supply usage binding changed before confirmation.");
  }

  const sale = await txn.getFirstAsync<{ id: string }>(
    `
      SELECT id
      FROM sales
      WHERE id = ? AND business_id = ? AND checkout_token = ?
        AND deleted_at IS NULL
    `,
    [input.saleId, input.businessId, input.checkoutToken],
  );
  if (!sale) throw new Error("Supply usage Sale is unavailable.");

  if (
    usage.stock_tracking_state === "tracked" &&
    input.quantityUsed > 0 &&
    input.allocations.length === 0
  ) {
    throw new Error("Tracked supply usage requires exact lot allocations.");
  }
  if (
    usage.stock_tracking_state === "untracked" &&
    input.allocations.length > 0
  ) {
    throw new Error("Untracked supply usage cannot deduct lots.");
  }

  const timestamp = nowIso();
  const seenLotIds = new Set<string>();
  const resolvedAllocations: {
    allocation: ConfirmSupplyLotAllocation;
    lotUnit: string;
    normalizedQuantity: number;
    conversionFactorSnapshot: number;
    conversionId: string | null;
  }[] = [];

  for (const allocation of input.allocations) {
    const allocationEvidence = {
      state: allocation.costState,
      amount: allocation.costContribution ?? null,
      legacyValue: null,
    };
    if (
      !validateCostEvidence(allocationEvidence).ok ||
      !Number.isFinite(allocation.quantityUsed) ||
      allocation.quantityUsed <= 0 ||
      !allocation.unit.trim() ||
      seenLotIds.has(allocation.ingredientLotId) ||
      (allocation.costState === "known" &&
        (allocation.unitCostSnapshot === null ||
          allocation.unitCostSnapshot === undefined ||
          !Number.isFinite(allocation.unitCostSnapshot) ||
          allocation.unitCostSnapshot < 0)) ||
      (allocation.costState !== "known" &&
        allocation.unitCostSnapshot !== null &&
        allocation.unitCostSnapshot !== undefined)
    ) {
      throw new Error("Supply lot allocation evidence is invalid.");
    }
    seenLotIds.add(allocation.ingredientLotId);

    const lot = await txn.getFirstAsync<{
      unit: string;
      remaining_quantity: number;
      status: string;
    }>(
      `
        SELECT unit, remaining_quantity, status
        FROM ingredient_lots
        WHERE id = ? AND ingredient_id = ? AND business_id = ?
          AND deleted_at IS NULL
      `,
      [
        allocation.ingredientLotId,
        usage.supply_ingredient_id,
        input.businessId,
      ],
    );
    if (
      !lot ||
      lot.status !== "active" ||
      allocation.unit.trim() !== lot.unit ||
      lot.remaining_quantity + INVENTORY_QUANTITY_TOLERANCE <
        allocation.quantityUsed
    ) {
      throw new Error("Supply lot is unavailable or uses a different unit.");
    }

    let conversionId: string | null = null;
    let conversionFactor = 1;
    if (lot.unit === usage.unit) {
      if (
        allocation.conversionId ||
        (allocation.conversionFactorSnapshot !== null &&
          allocation.conversionFactorSnapshot !== undefined &&
          Math.abs(allocation.conversionFactorSnapshot - 1) >
            INVENTORY_QUANTITY_TOLERANCE)
      ) {
        throw new Error("Same-unit supply allocation has invalid conversion evidence.");
      }
    } else {
      if (
        !allocation.conversionId ||
        allocation.conversionFactorSnapshot === null ||
        allocation.conversionFactorSnapshot === undefined ||
        !Number.isFinite(allocation.conversionFactorSnapshot) ||
        allocation.conversionFactorSnapshot <= 0
      ) {
        throw new Error("Supply allocation requires an exact unit conversion.");
      }
      const conversion = await txn.getFirstAsync<{
        factor: number;
      }>(
        `
          SELECT factor
          FROM item_unit_conversions
          WHERE id = ? AND business_id = ? AND catalog_item_id = ?
            AND from_unit = ? AND to_unit = ? AND status = 'active'
            AND deleted_at IS NULL
        `,
        [
          allocation.conversionId,
          input.businessId,
          usage.supply_catalog_item_id,
          lot.unit,
          usage.unit,
        ],
      );
      if (
        !conversion ||
        Math.abs(
          conversion.factor - allocation.conversionFactorSnapshot,
        ) > INVENTORY_QUANTITY_TOLERANCE
      ) {
        throw new Error("Supply allocation conversion changed before confirmation.");
      }
      conversionId = allocation.conversionId;
      conversionFactor = conversion.factor;
    }

    const normalizedQuantity = allocation.quantityUsed * conversionFactor;
    if (
      allocation.normalizedQuantity === null ||
      allocation.normalizedQuantity === undefined ||
      !Number.isFinite(allocation.normalizedQuantity) ||
      Math.abs(allocation.normalizedQuantity - normalizedQuantity) >
        INVENTORY_QUANTITY_TOLERANCE ||
      allocation.normalizedUnit?.trim() !== usage.unit
    ) {
      throw new Error("Supply allocation normalized quantity is inconsistent.");
    }
    if (
      allocation.costState === "known" &&
      Math.abs(
        (allocation.costContribution as number) -
          allocation.quantityUsed *
            (allocation.unitCostSnapshot as number),
      ) > INVENTORY_QUANTITY_TOLERANCE
    ) {
      throw new Error("Supply allocation cost contribution is inconsistent.");
    }

    resolvedAllocations.push({
      allocation,
      lotUnit: lot.unit,
      normalizedQuantity,
      conversionFactorSnapshot: conversionFactor,
      conversionId,
    });
  }

  const allocationTotal = resolvedAllocations.reduce(
    (sum, resolved) => sum + resolved.normalizedQuantity,
    0,
  );
  if (
    resolvedAllocations.length > 0 &&
    Math.abs(allocationTotal - input.quantityUsed) >
      INVENTORY_QUANTITY_TOLERANCE
  ) {
    throw new Error("Supply lot allocations do not match reviewed quantity.");
  }
  if (resolvedAllocations.length > 0) {
    const allKnown = resolvedAllocations.every(
      ({ allocation }) => allocation.costState === "known",
    );
    const allocationCost = resolvedAllocations.reduce(
      (sum, { allocation }) =>
        sum + (allocation.costContribution ?? 0),
      0,
    );
    if (
      (allKnown &&
        (input.costState !== "known" ||
          input.costContribution === null ||
          input.costContribution === undefined ||
          Math.abs(input.costContribution - allocationCost) >
            INVENTORY_QUANTITY_TOLERANCE)) ||
      (!allKnown && input.costState === "known")
    ) {
      throw new Error("Supply usage cost does not match lot evidence.");
    }
  }

  let firstMovementId: string | null = null;
  for (const resolved of resolvedAllocations) {
    const { allocation } = resolved;
    const lotResult = await txn.runAsync(
      `
        UPDATE ingredient_lots
        SET remaining_quantity = remaining_quantity - ?,
          status = CASE
            WHEN remaining_quantity - ? <= ? THEN 'depleted'
            ELSE 'active'
          END,
          updated_at = ?, sync_status = 'local'
        WHERE id = ? AND ingredient_id = ? AND business_id = ?
          AND status = 'active' AND deleted_at IS NULL
          AND remaining_quantity + ? >= ?
      `,
      [
        allocation.quantityUsed,
        allocation.quantityUsed,
        INVENTORY_QUANTITY_TOLERANCE,
        timestamp,
        allocation.ingredientLotId,
        usage.supply_ingredient_id,
        input.businessId,
        INVENTORY_QUANTITY_TOLERANCE,
        allocation.quantityUsed,
      ],
    );
    if (lotResult.changes !== 1) {
      throw new Error("Supply lot changed or became insufficient.");
    }
    const movementId = makeIngredientMovementId();
    firstMovementId ??= movementId;
    await txn.runAsync(
      `
        INSERT INTO ingredient_movements (
          id, business_id, ingredient_id, lot_id, movement_type, quantity,
          unit, unit_cost, total_cost, reason, created_at, updated_at,
          sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, 'sale_supply_usage', ?, ?, ?, ?, 'checkout supply usage', ?, ?, 'local', NULL)
      `,
      [
        movementId,
        input.businessId,
        usage.supply_ingredient_id,
        allocation.ingredientLotId,
        -allocation.quantityUsed,
        resolved.lotUnit,
        allocation.unitCostSnapshot ?? null,
        allocation.costContribution ?? null,
        timestamp,
        timestamp,
      ],
    );
    await txn.runAsync(
      `
        INSERT INTO sale_supply_lot_usages (
          id, business_id, sale_supply_usage_id, ingredient_lot_id,
          ingredient_movement_id, quantity_used, unit, normalized_quantity,
          normalized_unit, conversion_id, conversion_factor_snapshot,
          unit_cost_snapshot, cost_contribution, cost_state, allocation_mode,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL)
      `,
      [
        allocation.id ?? makeSaleSupplyLotUsageId(),
        input.businessId,
        usage.id,
        allocation.ingredientLotId,
        movementId,
        allocation.quantityUsed,
        resolved.lotUnit,
        resolved.normalizedQuantity,
        usage.unit,
        resolved.conversionId,
        resolved.conversionFactorSnapshot,
        allocation.unitCostSnapshot ?? null,
        allocation.costContribution ?? null,
        allocation.costState,
        allocation.allocationMode,
        timestamp,
        timestamp,
      ],
    );
  }

  const result = await txn.runAsync(
    `
      UPDATE sale_supply_usages
      SET sale_id = ?, status = 'confirmed', quantity_used = ?,
        unit_cost_snapshot = ?, cost_contribution = ?, cost_state = ?,
        ingredient_movement_id = ?, updated_at = ?, sync_status = 'local'
      WHERE id = ? AND status = 'proposed' AND deleted_at IS NULL
    `,
    [
      input.saleId,
      input.quantityUsed,
      input.unitCostSnapshot ?? null,
      input.costContribution ?? null,
      input.costState,
      firstMovementId,
      timestamp,
      usage.id,
    ],
  );
  if (result.changes !== 1) {
    throw new Error("Supply usage changed before confirmation.");
  }
  return usage.id;
}

export async function getOrderCostEvidenceForSale(
  saleId: string,
  db?: RepositoryDatabase,
): Promise<OrderCostEvidence[]> {
  const database = getRepositoryDatabase(db);
  const productRows = await database.getAllAsync<{
    id: string;
    cogs_total: number | null;
  }>(
    `
      SELECT id, cogs_total
      FROM sale_items
      WHERE sale_id = ? AND deleted_at IS NULL
      ORDER BY id ASC
    `,
    [saleId],
  );
  const supplyRows = await database.getAllAsync<{
    id: string;
    cost_category:
      | "packaging_cost"
      | "utensil_condiment_cost"
      | "other_supply_cost";
    cost_contribution: number | null;
    cost_state: CostState;
  }>(
    `
      SELECT id, cost_category, cost_contribution, cost_state
      FROM sale_supply_usages
      WHERE sale_id = ? AND status = 'confirmed'
        AND consumption_stage = 'checkout' AND deleted_at IS NULL
      ORDER BY id ASC
    `,
    [saleId],
  );

  return [
    ...productRows.map<OrderCostEvidence>((row) => ({
      evidenceId: `sale-item:${row.id}`,
      category: "product_cogs",
      source: "sale_item_cogs",
      consumptionStage: null,
      cost:
        row.cogs_total === null
          ? { state: "unknown", amount: null, legacyValue: null }
          : { state: "known", amount: row.cogs_total, legacyValue: null },
    })),
    ...supplyRows.map<OrderCostEvidence>((row) => ({
      evidenceId: `supply-usage:${row.id}`,
      category:
        row.cost_category === "packaging_cost"
          ? "packaging"
          : row.cost_category === "utensil_condiment_cost"
            ? "utensil_condiment"
            : "other_supply",
      source: "supply_usage",
      consumptionStage: "checkout",
      cost: {
        state: row.cost_state,
        amount: row.cost_contribution,
        legacyValue: null,
      },
    })),
  ];
}

export async function createSupplier(
  input: {
    id?: string;
    businessId: string;
    name: string;
    contactNumber?: string | null;
    notes?: string | null;
  },
  db?: RepositoryDatabase,
) {
  if (!input.name.trim()) throw new Error("Supplier name is required.");
  const id = input.id ?? makeSupplierId();
  const timestamp = nowIso();
  await getRepositoryDatabase(db).runAsync(
    `
      INSERT INTO suppliers (
        id, business_id, name, contact_number, notes, status, created_at,
        updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 'local', NULL)
    `,
    [
      id,
      input.businessId,
      input.name.trim(),
      input.contactNumber?.trim() || null,
      input.notes?.trim() || null,
      timestamp,
      timestamp,
    ],
  );
  return id;
}

export async function createPurchaseReceipt(
  input: {
    id?: string;
    businessId: string;
    branchId?: string | null;
    supplierId?: string | null;
    referenceNumber?: string | null;
    purchasedAt: string;
    totalCost?: number | null;
    costState: CostState;
    notes?: string | null;
  },
  db?: RepositoryDatabase,
) {
  const cost = {
    state: input.costState,
    amount: input.totalCost ?? null,
    legacyValue: null,
  };
  if (!validateCostEvidence(cost).ok) {
    throw new Error("Purchase receipt cost evidence is inconsistent.");
  }
  const id = input.id ?? makePurchaseReceiptId();
  const timestamp = nowIso();
  await getRepositoryDatabase(db).runAsync(
    `
      INSERT INTO purchase_receipts (
        id, business_id, branch_id, supplier_id, reference_number,
        purchased_at, total_cost, cost_state, notes, created_at, updated_at,
        sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL)
    `,
    [
      id,
      input.businessId,
      input.branchId ?? null,
      input.supplierId ?? null,
      input.referenceNumber?.trim() || null,
      input.purchasedAt,
      input.totalCost ?? null,
      input.costState,
      input.notes?.trim() || null,
      timestamp,
      timestamp,
    ],
  );
  return id;
}
