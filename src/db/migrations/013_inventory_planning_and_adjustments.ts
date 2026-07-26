export const inventoryPlanningAndAdjustmentsMigration = {
  id: "013_inventory_planning_and_adjustments",
  up: `
    CREATE TABLE suppliers (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      name TEXT NOT NULL,
      contact_number TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
    );

    CREATE TABLE purchase_receipts (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      branch_id TEXT,
      supplier_id TEXT,
      reference_number TEXT,
      purchased_at TEXT NOT NULL,
      total_cost REAL,
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      CHECK (total_cost IS NULL OR total_cost >= 0),
      CHECK (
        (cost_state = 'known' AND total_cost IS NOT NULL)
        OR (cost_state <> 'known' AND total_cost IS NULL)
      )
    );

    ALTER TABLE ingredient_lots ADD COLUMN expiry_date TEXT;
    ALTER TABLE ingredient_lots
      ADD COLUMN supplier_id TEXT REFERENCES suppliers(id) ON DELETE RESTRICT;
    ALTER TABLE ingredient_lots
      ADD COLUMN purchase_receipt_id TEXT REFERENCES purchase_receipts(id) ON DELETE RESTRICT;
    ALTER TABLE ingredient_lots
      ADD COLUMN provenance_state TEXT NOT NULL DEFAULT 'legacy_unknown' CHECK (
        provenance_state IN ('legacy_unknown', 'purchase_recorded', 'review_required')
      );
    ALTER TABLE ingredient_lots
      ADD COLUMN cost_state TEXT NOT NULL DEFAULT 'legacy_zero_unresolved' CHECK (
        cost_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      );
    ALTER TABLE ingredient_lots ADD COLUMN recorded_total_cost REAL CHECK (
      recorded_total_cost IS NULL OR recorded_total_cost >= 0
    );
    ALTER TABLE ingredient_lots ADD COLUMN recorded_cost_per_unit REAL CHECK (
      recorded_cost_per_unit IS NULL OR recorded_cost_per_unit >= 0
    );
    ALTER TABLE ingredient_lots ADD COLUMN source_metadata_json TEXT;

    UPDATE ingredient_lots
    SET
      recorded_total_cost = total_cost,
      recorded_cost_per_unit = cost_per_unit,
      cost_state = 'known'
    WHERE total_cost > 0 OR cost_per_unit > 0;

    CREATE TABLE product_stock_lots (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      branch_id TEXT,
      product_id TEXT NOT NULL,
      catalog_item_id TEXT NOT NULL,
      origin_kind TEXT NOT NULL CHECK (
        origin_kind IN ('purchase', 'production', 'adjustment', 'legacy_balance', 'transfer', 'return')
      ),
      production_batch_id TEXT,
      purchase_receipt_id TEXT,
      supplier_id TEXT,
      initialization_token TEXT,
      origin_date TEXT NOT NULL,
      expiry_date TEXT,
      initial_quantity REAL NOT NULL CHECK (initial_quantity >= 0),
      remaining_quantity REAL NOT NULL CHECK (
        remaining_quantity >= 0 AND remaining_quantity <= initial_quantity
      ),
      unit TEXT NOT NULL,
      recorded_total_cost REAL CHECK (recorded_total_cost IS NULL OR recorded_total_cost >= 0),
      recorded_cost_per_unit REAL CHECK (
        recorded_cost_per_unit IS NULL OR recorded_cost_per_unit >= 0
      ),
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'archived')),
      provenance_state TEXT NOT NULL DEFAULT 'exact' CHECK (
        provenance_state IN ('exact', 'legacy_unknown', 'review_required')
      ),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (production_batch_id) REFERENCES production_batches(id) ON DELETE RESTRICT,
      FOREIGN KEY (purchase_receipt_id) REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      CHECK (
        (cost_state = 'known' AND recorded_total_cost IS NOT NULL AND recorded_cost_per_unit IS NOT NULL)
        OR
        (
          cost_state <> 'known'
          AND recorded_total_cost IS NULL
          AND recorded_cost_per_unit IS NULL
        )
      ),
      CHECK (
        (origin_kind = 'production' AND production_batch_id IS NOT NULL)
        OR origin_kind <> 'production'
      )
    );

    CREATE TABLE production_plans (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      branch_id TEXT,
      root_recipe_id TEXT NOT NULL,
      root_recipe_version_id TEXT NOT NULL,
      target_quantity REAL NOT NULL CHECK (target_quantity > 0),
      target_unit TEXT NOT NULL,
      preparation_mode TEXT NOT NULL CHECK (
        preparation_mode IN ('use_prepared_stock_first', 'prepare_fresh')
      ),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'ready', 'in_progress', 'completed', 'cancelled', 'stale')
      ),
      calculation_version INTEGER NOT NULL DEFAULT 1 CHECK (calculation_version > 0),
      stock_observed_at TEXT NOT NULL,
      expected_total_cost REAL CHECK (expected_total_cost IS NULL OR expected_total_cost >= 0),
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN ('known', 'unknown', 'partial', 'legacy_zero_unresolved', 'not_applicable')
      ),
      missing_cost_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_cost_count >= 0),
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      FOREIGN KEY (root_recipe_id) REFERENCES recipes(id) ON DELETE RESTRICT,
      FOREIGN KEY (root_recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      CHECK (
        (cost_state = 'known' AND expected_total_cost IS NOT NULL)
        OR (cost_state <> 'known' AND expected_total_cost IS NULL)
      )
    );

    CREATE TABLE production_plan_stages (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      production_plan_id TEXT NOT NULL,
      recipe_version_id TEXT NOT NULL,
      parent_stage_id TEXT,
      topological_order INTEGER NOT NULL CHECK (topological_order >= 0),
      expected_input_multiplier REAL NOT NULL CHECK (expected_input_multiplier >= 0),
      expected_output_quantity REAL NOT NULL CHECK (expected_output_quantity >= 0),
      expected_output_unit TEXT NOT NULL,
      prepared_stock_quantity REAL NOT NULL DEFAULT 0 CHECK (prepared_stock_quantity >= 0),
      fresh_prepare_quantity REAL NOT NULL DEFAULT 0 CHECK (fresh_prepare_quantity >= 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'ready', 'in_progress', 'completed', 'cancelled', 'stale', 'short')
      ),
      actual_output_quantity REAL CHECK (actual_output_quantity IS NULL OR actual_output_quantity >= 0),
      production_batch_id TEXT,
      shortage_state TEXT NOT NULL DEFAULT 'none' CHECK (
        shortage_state IN ('none', 'short', 'stale')
      ),
      variance_state TEXT NOT NULL DEFAULT 'pending' CHECK (
        variance_state IN ('pending', 'within_tolerance', 'over', 'under')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (production_plan_id) REFERENCES production_plans(id) ON DELETE RESTRICT,
      FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (parent_stage_id) REFERENCES production_plan_stages(id) ON DELETE NO ACTION,
      FOREIGN KEY (production_batch_id) REFERENCES production_batches(id) ON DELETE SET NULL,
      UNIQUE (production_plan_id, topological_order)
    );

    CREATE TABLE production_plan_requirements (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      production_plan_stage_id TEXT NOT NULL,
      catalog_item_id TEXT,
      requirement_kind TEXT NOT NULL CHECK (
        requirement_kind IN ('ingredient', 'supply', 'prepared_product', 'custom')
      ),
      raw_quantity REAL NOT NULL CHECK (raw_quantity >= 0),
      raw_unit TEXT NOT NULL,
      normalized_quantity REAL CHECK (normalized_quantity IS NULL OR normalized_quantity >= 0),
      normalized_unit TEXT,
      provenance_json TEXT NOT NULL,
      is_required INTEGER NOT NULL DEFAULT 1 CHECK (is_required IN (0, 1)),
      expected_cost REAL CHECK (expected_cost IS NULL OR expected_cost >= 0),
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN ('known', 'unknown', 'partial', 'legacy_zero_unresolved', 'not_applicable')
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (production_plan_stage_id) REFERENCES production_plan_stages(id) ON DELETE RESTRICT,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      CHECK (
        (requirement_kind = 'custom' AND catalog_item_id IS NULL)
        OR (requirement_kind <> 'custom' AND catalog_item_id IS NOT NULL)
      ),
      CHECK (
        (cost_state = 'known' AND expected_cost IS NOT NULL)
        OR (cost_state <> 'known' AND expected_cost IS NULL)
      )
    );

    CREATE TABLE production_plan_allocations (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      production_plan_requirement_id TEXT NOT NULL,
      lot_kind TEXT NOT NULL CHECK (lot_kind IN ('ingredient', 'product')),
      ingredient_lot_id TEXT,
      product_stock_lot_id TEXT,
      allocation_mode TEXT NOT NULL CHECK (
        allocation_mode IN (
          'legacy_selected',
          'manual',
          'recommended_fefo',
          'recommended_fifo',
          'legacy_balance'
        )
      ),
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit TEXT NOT NULL,
      normalized_quantity REAL CHECK (normalized_quantity IS NULL OR normalized_quantity > 0),
      normalized_unit TEXT,
      conversion_id TEXT,
      conversion_factor_snapshot REAL CHECK (
        conversion_factor_snapshot IS NULL OR conversion_factor_snapshot > 0
      ),
      unit_cost_snapshot REAL CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0),
      cost_contribution REAL CHECK (cost_contribution IS NULL OR cost_contribution >= 0),
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN ('known', 'unknown', 'partial', 'legacy_zero_unresolved', 'not_applicable')
      ),
      selection_state TEXT NOT NULL DEFAULT 'recommended' CHECK (
        selection_state IN ('recommended', 'manual', 'committed', 'stale')
      ),
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (production_plan_requirement_id)
        REFERENCES production_plan_requirements(id) ON DELETE RESTRICT,
      FOREIGN KEY (ingredient_lot_id) REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (product_stock_lot_id) REFERENCES product_stock_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (conversion_id) REFERENCES item_unit_conversions(id) ON DELETE SET NULL,
      CHECK (
        (lot_kind = 'ingredient' AND ingredient_lot_id IS NOT NULL AND product_stock_lot_id IS NULL)
        OR
        (lot_kind = 'product' AND ingredient_lot_id IS NULL AND product_stock_lot_id IS NOT NULL)
      ),
      CHECK (
        (cost_state = 'known' AND unit_cost_snapshot IS NOT NULL AND cost_contribution IS NOT NULL)
        OR
        (
          cost_state <> 'known'
          AND unit_cost_snapshot IS NULL
          AND cost_contribution IS NULL
        )
      )
    );

    CREATE TABLE sale_product_lot_usages (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      sale_id TEXT NOT NULL,
      sale_item_id TEXT NOT NULL,
      product_stock_lot_id TEXT NOT NULL,
      catalog_item_id TEXT NOT NULL,
      quantity_used REAL NOT NULL CHECK (quantity_used > 0),
      unit TEXT NOT NULL,
      normalized_quantity REAL CHECK (normalized_quantity IS NULL OR normalized_quantity > 0),
      normalized_unit TEXT,
      conversion_id TEXT,
      conversion_factor_snapshot REAL CHECK (
        conversion_factor_snapshot IS NULL OR conversion_factor_snapshot > 0
      ),
      unit_cost_snapshot REAL CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0),
      cost_contribution REAL CHECK (cost_contribution IS NULL OR cost_contribution >= 0),
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      allocation_mode TEXT NOT NULL CHECK (
        allocation_mode IN (
          'legacy_selected',
          'manual',
          'recommended_fefo',
          'recommended_fifo',
          'legacy_balance'
        )
      ),
      source_label_snapshot TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
      FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (product_stock_lot_id) REFERENCES product_stock_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (conversion_id) REFERENCES item_unit_conversions(id) ON DELETE SET NULL,
      CHECK (
        (cost_state = 'known' AND unit_cost_snapshot IS NOT NULL AND cost_contribution IS NOT NULL)
        OR
        (
          cost_state <> 'known'
          AND unit_cost_snapshot IS NULL
          AND cost_contribution IS NULL
        )
      )
    );

    CREATE TABLE production_input_allocations (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      production_batch_id TEXT NOT NULL,
      recipe_version_line_id TEXT,
      production_plan_requirement_id TEXT,
      catalog_item_id TEXT NOT NULL,
      lot_kind TEXT NOT NULL CHECK (lot_kind IN ('ingredient', 'product')),
      ingredient_lot_id TEXT,
      product_stock_lot_id TEXT,
      quantity_used REAL NOT NULL CHECK (quantity_used > 0),
      unit TEXT NOT NULL,
      normalized_quantity REAL CHECK (normalized_quantity IS NULL OR normalized_quantity > 0),
      normalized_unit TEXT,
      conversion_id TEXT,
      conversion_factor_snapshot REAL CHECK (
        conversion_factor_snapshot IS NULL OR conversion_factor_snapshot > 0
      ),
      unit_cost_snapshot REAL CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0),
      cost_contribution REAL CHECK (cost_contribution IS NULL OR cost_contribution >= 0),
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      allocation_mode TEXT NOT NULL CHECK (
        allocation_mode IN (
          'legacy_selected',
          'manual',
          'recommended_fefo',
          'recommended_fifo',
          'legacy_balance'
        )
      ),
      source_label_snapshot TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (production_batch_id) REFERENCES production_batches(id) ON DELETE RESTRICT,
      FOREIGN KEY (recipe_version_line_id) REFERENCES recipe_version_lines(id) ON DELETE RESTRICT,
      FOREIGN KEY (production_plan_requirement_id)
        REFERENCES production_plan_requirements(id) ON DELETE RESTRICT,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (ingredient_lot_id) REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (product_stock_lot_id) REFERENCES product_stock_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (conversion_id) REFERENCES item_unit_conversions(id) ON DELETE SET NULL,
      CHECK (
        (lot_kind = 'ingredient' AND ingredient_lot_id IS NOT NULL AND product_stock_lot_id IS NULL)
        OR
        (lot_kind = 'product' AND ingredient_lot_id IS NULL AND product_stock_lot_id IS NOT NULL)
      ),
      CHECK (
        (cost_state = 'known' AND unit_cost_snapshot IS NOT NULL AND cost_contribution IS NOT NULL)
        OR
        (
          cost_state <> 'known'
          AND unit_cost_snapshot IS NULL
          AND cost_contribution IS NULL
        )
      )
    );

    CREATE TABLE stock_adjustments (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      branch_id TEXT,
      catalog_item_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL CHECK (subject_kind IN ('product', 'ingredient')),
      product_id TEXT,
      ingredient_id TEXT,
      request_token TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('delta', 'set_count', 'mark_empty')),
      reason_code TEXT NOT NULL CHECK (
        reason_code IN (
          'personal_household_use',
          'spoilage',
          'damaged',
          'expired',
          'promotion',
          'counting_correction',
          'lost_missing',
          'returned_to_supplier',
          'other'
        )
      ),
      note TEXT,
      accounting_class TEXT NOT NULL CHECK (
        accounting_class IN (
          'owner_withdrawal',
          'inventory_loss_spoilage',
          'inventory_loss_damage',
          'inventory_loss_expiry',
          'promotional_usage',
          'stock_variance',
          'review_required_variance',
          'supplier_return',
          'owner_selected_review'
        )
      ),
      before_quantity REAL NOT NULL CHECK (before_quantity >= 0),
      entered_after_quantity REAL NOT NULL CHECK (entered_after_quantity >= 0),
      delta_quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      authorized_mode TEXT NOT NULL CHECK (authorized_mode = 'owner'),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE RESTRICT,
      CHECK (
        (subject_kind = 'product' AND product_id IS NOT NULL AND ingredient_id IS NULL)
        OR
        (subject_kind = 'ingredient' AND product_id IS NULL AND ingredient_id IS NOT NULL)
      )
    );

    CREATE TABLE stock_adjustment_allocations (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      stock_adjustment_id TEXT NOT NULL,
      lot_kind TEXT NOT NULL CHECK (
        lot_kind IN ('ingredient', 'product', 'scalar_product')
      ),
      ingredient_lot_id TEXT,
      product_stock_lot_id TEXT,
      before_quantity REAL NOT NULL CHECK (before_quantity >= 0),
      delta_quantity REAL NOT NULL,
      after_quantity REAL NOT NULL CHECK (after_quantity >= 0),
      unit TEXT NOT NULL,
      conversion_id TEXT,
      conversion_factor_snapshot REAL CHECK (
        conversion_factor_snapshot IS NULL OR conversion_factor_snapshot > 0
      ),
      movement_kind TEXT NOT NULL CHECK (movement_kind IN ('ingredient', 'product')),
      ingredient_movement_id TEXT,
      inventory_movement_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (stock_adjustment_id) REFERENCES stock_adjustments(id) ON DELETE RESTRICT,
      FOREIGN KEY (ingredient_lot_id) REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (product_stock_lot_id) REFERENCES product_stock_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (conversion_id) REFERENCES item_unit_conversions(id) ON DELETE SET NULL,
      FOREIGN KEY (ingredient_movement_id) REFERENCES ingredient_movements(id) ON DELETE RESTRICT,
      FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements(id) ON DELETE RESTRICT,
      CHECK (
        (lot_kind = 'ingredient' AND ingredient_lot_id IS NOT NULL AND product_stock_lot_id IS NULL)
        OR
        (lot_kind = 'product' AND ingredient_lot_id IS NULL AND product_stock_lot_id IS NOT NULL)
        OR
        (lot_kind = 'scalar_product' AND ingredient_lot_id IS NULL AND product_stock_lot_id IS NULL)
      ),
      CHECK (
        (
          movement_kind = 'ingredient'
          AND ingredient_movement_id IS NOT NULL
          AND inventory_movement_id IS NULL
        )
        OR
        (
          movement_kind = 'product'
          AND ingredient_movement_id IS NULL
          AND inventory_movement_id IS NOT NULL
        )
      )
    );

    ALTER TABLE production_batches
      ADD COLUMN recipe_version_id TEXT REFERENCES recipe_versions(id) ON DELETE RESTRICT;
    ALTER TABLE production_batches
      ADD COLUMN production_plan_stage_id TEXT REFERENCES production_plan_stages(id) ON DELETE SET NULL;
    ALTER TABLE production_batches ADD COLUMN expected_output_quantity REAL;
    ALTER TABLE production_batches ADD COLUMN actual_output_quantity REAL;
    ALTER TABLE production_batches ADD COLUMN expected_total_cost REAL;
    ALTER TABLE production_batches ADD COLUMN actual_total_cost REAL;
    ALTER TABLE production_batches
      ADD COLUMN cost_state TEXT NOT NULL DEFAULT 'legacy_zero_unresolved' CHECK (
        cost_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      );
    ALTER TABLE production_batches ADD COLUMN yield_variance_quantity REAL;
    ALTER TABLE production_batches ADD COLUMN yield_variance_percent REAL;

    UPDATE production_batches
    SET
      actual_output_quantity = output_quantity,
      actual_total_cost = CASE
        WHEN total_batch_cost > 0 OR cost_per_output_unit > 0 THEN total_batch_cost
        ELSE NULL
      END,
      cost_state = CASE
        WHEN total_batch_cost > 0 OR cost_per_output_unit > 0 THEN 'known'
        ELSE 'legacy_zero_unresolved'
      END;

    CREATE INDEX idx_suppliers_business_status
      ON suppliers(business_id, status, name);
    CREATE INDEX idx_purchase_receipts_business_date
      ON purchase_receipts(business_id, purchased_at);
    CREATE INDEX idx_purchase_receipts_supplier
      ON purchase_receipts(supplier_id, purchased_at);
    CREATE INDEX idx_ingredient_lots_available_expiry
      ON ingredient_lots(ingredient_id, status, expiry_date, purchase_date, created_at, id);
    CREATE INDEX idx_ingredient_lots_cost_state
      ON ingredient_lots(business_id, cost_state, status);
    CREATE INDEX idx_ingredient_lots_supplier
      ON ingredient_lots(supplier_id, purchase_date);
    CREATE INDEX idx_product_stock_lots_available
      ON product_stock_lots(product_id, branch_id, status, expiry_date, origin_date, created_at, id);
    CREATE INDEX idx_product_stock_lots_catalog
      ON product_stock_lots(catalog_item_id, status);
    CREATE INDEX idx_product_stock_lots_origin
      ON product_stock_lots(origin_kind, production_batch_id, purchase_receipt_id);
    CREATE INDEX idx_product_stock_lots_cost_state
      ON product_stock_lots(business_id, cost_state, status);
    CREATE UNIQUE INDEX uq_product_stock_lot_initialization
      ON product_stock_lots(product_id, initialization_token)
      WHERE initialization_token IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX idx_production_plans_business_status
      ON production_plans(business_id, branch_id, status, updated_at);
    CREATE INDEX idx_production_plans_root_version
      ON production_plans(root_recipe_version_id, status);
    CREATE INDEX idx_production_plan_stages_plan_status
      ON production_plan_stages(production_plan_id, status, topological_order);
    CREATE INDEX idx_production_plan_stages_version
      ON production_plan_stages(recipe_version_id, status);
    CREATE INDEX idx_production_plan_requirements_stage
      ON production_plan_requirements(production_plan_stage_id, catalog_item_id);
    CREATE INDEX idx_production_plan_allocations_requirement
      ON production_plan_allocations(production_plan_requirement_id, sort_order);
    CREATE INDEX idx_production_plan_allocations_ingredient_lot
      ON production_plan_allocations(ingredient_lot_id)
      WHERE ingredient_lot_id IS NOT NULL;
    CREATE INDEX idx_production_plan_allocations_product_lot
      ON production_plan_allocations(product_stock_lot_id)
      WHERE product_stock_lot_id IS NOT NULL;
    CREATE INDEX idx_sale_product_lot_usages_sale
      ON sale_product_lot_usages(sale_id, sale_item_id);
    CREATE INDEX idx_sale_product_lot_usages_lot
      ON sale_product_lot_usages(product_stock_lot_id);
    CREATE INDEX idx_production_input_allocations_batch
      ON production_input_allocations(production_batch_id);
    CREATE INDEX idx_production_input_allocations_ingredient_lot
      ON production_input_allocations(ingredient_lot_id)
      WHERE ingredient_lot_id IS NOT NULL;
    CREATE INDEX idx_production_input_allocations_product_lot
      ON production_input_allocations(product_stock_lot_id)
      WHERE product_stock_lot_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_stock_adjustments_request
      ON stock_adjustments(business_id, request_token)
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_stock_adjustments_catalog_created
      ON stock_adjustments(catalog_item_id, created_at);
    CREATE INDEX idx_stock_adjustments_reason
      ON stock_adjustments(business_id, accounting_class, created_at);
    CREATE INDEX idx_stock_adjustment_allocations_adjustment
      ON stock_adjustment_allocations(stock_adjustment_id);
    CREATE INDEX idx_stock_adjustment_allocations_ingredient_movement
      ON stock_adjustment_allocations(ingredient_movement_id)
      WHERE ingredient_movement_id IS NOT NULL;
    CREATE INDEX idx_stock_adjustment_allocations_inventory_movement
      ON stock_adjustment_allocations(inventory_movement_id)
      WHERE inventory_movement_id IS NOT NULL;
    CREATE INDEX idx_production_batches_recipe_version
      ON production_batches(recipe_version_id)
      WHERE recipe_version_id IS NOT NULL;
    CREATE INDEX idx_production_batches_plan_stage
      ON production_batches(production_plan_stage_id)
      WHERE production_plan_stage_id IS NOT NULL;
  `,
} as const;
