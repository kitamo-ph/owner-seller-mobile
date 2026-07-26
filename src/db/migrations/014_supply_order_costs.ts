export const supplyOrderCostsMigration = {
  id: "014_supply_order_costs",
  up: `
    CREATE TABLE supply_usage_rules (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      branch_id TEXT,
      supply_catalog_item_id TEXT NOT NULL,
      supply_ingredient_id TEXT NOT NULL,
      target_product_id TEXT,
      target_recipe_version_id TEXT,
      supply_category TEXT NOT NULL CHECK (
        supply_category IN (
          'packaging',
          'utensil',
          'condiment',
          'disposable',
          'cleaning_supply',
          'other_consumable'
        )
      ),
      consumption_stage TEXT NOT NULL CHECK (
        consumption_stage IN ('production', 'checkout')
      ),
      scope TEXT NOT NULL CHECK (scope IN ('per_product', 'per_quantity', 'per_order')),
      behavior TEXT NOT NULL CHECK (
        behavior IN ('required', 'default_editable', 'suggested_optional', 'requested_only')
      ),
      rounding_mode TEXT NOT NULL CHECK (
        rounding_mode IN ('multiply_each', 'ceiling_groups', 'once_per_order')
      ),
      trigger_quantity REAL NOT NULL DEFAULT 1 CHECK (trigger_quantity > 0),
      supply_quantity REAL NOT NULL CHECK (supply_quantity >= 0),
      supply_unit TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'superseded', 'archived')
      ),
      supersedes_rule_id TEXT,
      effective_at TEXT NOT NULL,
      archived_at TEXT,
      cost_warning INTEGER NOT NULL DEFAULT 0 CHECK (cost_warning IN (0, 1)),
      stock_warning INTEGER NOT NULL DEFAULT 0 CHECK (stock_warning IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      FOREIGN KEY (supply_catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (supply_ingredient_id) REFERENCES ingredients(id) ON DELETE RESTRICT,
      FOREIGN KEY (target_product_id) REFERENCES products(id) ON DELETE RESTRICT,
      FOREIGN KEY (target_recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (supersedes_rule_id) REFERENCES supply_usage_rules(id) ON DELETE SET NULL,
      CHECK (
        (
          scope = 'per_order'
          AND target_product_id IS NULL
          AND target_recipe_version_id IS NULL
        )
        OR
        (
          scope IN ('per_product', 'per_quantity')
          AND (
            (target_product_id IS NOT NULL AND target_recipe_version_id IS NULL)
            OR
            (target_product_id IS NULL AND target_recipe_version_id IS NOT NULL)
          )
        )
      ),
      CHECK (
        (scope = 'per_product' AND rounding_mode = 'multiply_each')
        OR (scope = 'per_quantity' AND rounding_mode = 'ceiling_groups')
        OR (scope = 'per_order' AND rounding_mode = 'once_per_order')
      )
    );

    CREATE TABLE sale_supply_usages (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      sale_id TEXT,
      checkout_token TEXT NOT NULL,
      supply_catalog_item_id TEXT NOT NULL,
      supply_ingredient_id TEXT NOT NULL,
      rule_id TEXT,
      request_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK (
        status IN ('proposed', 'confirmed', 'void')
      ),
      consumption_stage TEXT NOT NULL DEFAULT 'checkout' CHECK (
        consumption_stage = 'checkout'
      ),
      supply_name_snapshot TEXT NOT NULL,
      proposed_quantity REAL NOT NULL CHECK (proposed_quantity >= 0),
      quantity_used REAL CHECK (quantity_used IS NULL OR quantity_used >= 0),
      unit TEXT NOT NULL,
      required_minimum REAL NOT NULL DEFAULT 0 CHECK (required_minimum >= 0),
      scope_snapshot TEXT CHECK (
        scope_snapshot IS NULL OR scope_snapshot IN ('per_product', 'per_quantity', 'per_order')
      ),
      behavior_snapshot TEXT CHECK (
        behavior_snapshot IS NULL
        OR behavior_snapshot IN (
          'required',
          'default_editable',
          'suggested_optional',
          'requested_only'
        )
      ),
      rule_version_snapshot INTEGER CHECK (
        rule_version_snapshot IS NULL OR rule_version_snapshot > 0
      ),
      is_manual_override INTEGER NOT NULL DEFAULT 0 CHECK (is_manual_override IN (0, 1)),
      cost_category TEXT NOT NULL CHECK (
        cost_category IN ('packaging_cost', 'utensil_condiment_cost', 'other_supply_cost')
      ),
      unit_cost_snapshot REAL CHECK (unit_cost_snapshot IS NULL OR unit_cost_snapshot >= 0),
      cost_contribution REAL CHECK (cost_contribution IS NULL OR cost_contribution >= 0),
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      stock_tracking_state TEXT NOT NULL CHECK (
        stock_tracking_state IN ('tracked', 'untracked')
      ),
      ingredient_movement_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE RESTRICT,
      FOREIGN KEY (supply_catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (supply_ingredient_id) REFERENCES ingredients(id) ON DELETE RESTRICT,
      FOREIGN KEY (rule_id) REFERENCES supply_usage_rules(id) ON DELETE RESTRICT,
      FOREIGN KEY (ingredient_movement_id) REFERENCES ingredient_movements(id) ON DELETE RESTRICT,
      CHECK (
        (status = 'confirmed' AND sale_id IS NOT NULL AND quantity_used IS NOT NULL)
        OR status <> 'confirmed'
      ),
      CHECK (
        (cost_state = 'known' AND unit_cost_snapshot IS NOT NULL AND cost_contribution IS NOT NULL)
        OR
        (
          cost_state <> 'known'
          AND unit_cost_snapshot IS NULL
          AND cost_contribution IS NULL
        )
      ),
      UNIQUE (checkout_token, request_key)
    );

    CREATE TABLE sale_supply_lot_usages (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      sale_supply_usage_id TEXT NOT NULL,
      ingredient_lot_id TEXT NOT NULL,
      ingredient_movement_id TEXT NOT NULL,
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (sale_supply_usage_id) REFERENCES sale_supply_usages(id) ON DELETE RESTRICT,
      FOREIGN KEY (ingredient_lot_id) REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
      FOREIGN KEY (ingredient_movement_id) REFERENCES ingredient_movements(id) ON DELETE RESTRICT,
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

    CREATE INDEX idx_supply_rules_cart_lookup
      ON supply_usage_rules(
        business_id,
        branch_id,
        consumption_stage,
        status,
        target_product_id,
        scope
      );
    CREATE INDEX idx_supply_rules_recipe_lookup
      ON supply_usage_rules(target_recipe_version_id, status)
      WHERE target_recipe_version_id IS NOT NULL;
    CREATE INDEX idx_supply_rules_supply
      ON supply_usage_rules(supply_catalog_item_id, status, effective_at);
    CREATE UNIQUE INDEX uq_supply_rules_version
      ON supply_usage_rules(
        business_id,
        ifnull(branch_id, ''),
        supply_catalog_item_id,
        ifnull(target_product_id, ''),
        ifnull(target_recipe_version_id, ''),
        consumption_stage,
        scope,
        version
      );
    CREATE UNIQUE INDEX uq_supply_rules_active
      ON supply_usage_rules(
        business_id,
        ifnull(branch_id, ''),
        supply_catalog_item_id,
        ifnull(target_product_id, ''),
        ifnull(target_recipe_version_id, ''),
        consumption_stage,
        scope
      )
      WHERE status = 'active' AND deleted_at IS NULL;
    CREATE INDEX idx_sale_supply_usages_sale
      ON sale_supply_usages(sale_id, cost_category)
      WHERE sale_id IS NOT NULL;
    CREATE INDEX idx_sale_supply_usages_checkout
      ON sale_supply_usages(checkout_token, status);
    CREATE INDEX idx_sale_supply_usages_supply
      ON sale_supply_usages(supply_catalog_item_id, created_at);
    CREATE INDEX idx_sale_supply_lot_usages_usage
      ON sale_supply_lot_usages(sale_supply_usage_id);
    CREATE INDEX idx_sale_supply_lot_usages_lot
      ON sale_supply_lot_usages(ingredient_lot_id);
  `,
} as const;
