export const recipeVersionsAndDraftsMigration = {
  id: "012_recipe_versions_and_drafts",
  up: `
    CREATE TABLE recipe_versions (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      recipe_id TEXT NOT NULL,
      version_number INTEGER NOT NULL CHECK (version_number > 0),
      status TEXT NOT NULL DEFAULT 'published' CHECK (
        status IN ('published', 'superseded', 'archived')
      ),
      name_snapshot TEXT NOT NULL,
      category_snapshot TEXT,
      output_catalog_item_id TEXT NOT NULL,
      output_product_id_snapshot TEXT,
      expected_output_quantity REAL NOT NULL,
      expected_output_unit TEXT NOT NULL,
      production_mode TEXT NOT NULL CHECK (
        production_mode IN ('prepared_before_selling', 'cook_upon_order')
      ),
      suggested_selling_price_snapshot REAL,
      selling_price_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        selling_price_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      notes_snapshot TEXT,
      source_kind TEXT NOT NULL CHECK (
        source_kind IN ('legacy_import', 'native_publish', 'duplicate')
      ),
      source_draft_id TEXT,
      duplicated_from_version_id TEXT,
      graph_state TEXT NOT NULL DEFAULT 'legacy_review' CHECK (
        graph_state IN ('complete', 'incomplete', 'legacy_review')
      ),
      cost_state TEXT NOT NULL DEFAULT 'legacy_review' CHECK (
        cost_state IN (
          'known',
          'unknown',
          'legacy_zero_unresolved',
          'not_applicable',
          'partial',
          'legacy_review'
        )
      ),
      effective_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE RESTRICT,
      FOREIGN KEY (output_catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (duplicated_from_version_id) REFERENCES recipe_versions(id) ON DELETE SET NULL,
      UNIQUE (recipe_id, version_number)
    );

    CREATE TABLE recipe_version_lines (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      recipe_version_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      source_kind TEXT NOT NULL CHECK (
        source_kind IN ('catalog_item', 'child_recipe_version', 'custom_cost')
      ),
      catalog_item_id TEXT,
      child_recipe_version_id TEXT,
      custom_name_snapshot TEXT,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      normalized_quantity REAL,
      normalized_unit TEXT,
      conversion_id TEXT,
      conversion_factor_snapshot REAL CHECK (
        conversion_factor_snapshot IS NULL OR conversion_factor_snapshot > 0
      ),
      role TEXT NOT NULL DEFAULT 'unset' CHECK (
        role IN ('main', 'supporting', 'seasoning', 'garnish', 'packaging', 'optional', 'unset')
      ),
      is_optional INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0, 1)),
      cost_override REAL,
      cost_per_unit_snapshot REAL,
      line_cost_snapshot REAL,
      cost_state TEXT NOT NULL DEFAULT 'legacy_review' CHECK (
        cost_state IN (
          'known',
          'unknown',
          'legacy_zero_unresolved',
          'not_applicable',
          'partial',
          'legacy_review'
        )
      ),
      allocation_mode TEXT NOT NULL DEFAULT 'none' CHECK (
        allocation_mode IN (
          'none',
          'legacy_selected',
          'manual',
          'recommended_fefo',
          'recommended_fifo',
          'legacy_balance'
        )
      ),
      legacy_ingredient_id_snapshot TEXT,
      legacy_ingredient_lot_id TEXT,
      source_label_snapshot TEXT,
      original_legacy_line_id TEXT,
      notes_snapshot TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (child_recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (conversion_id) REFERENCES item_unit_conversions(id) ON DELETE SET NULL,
      FOREIGN KEY (legacy_ingredient_lot_id) REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
      CHECK (
        (source_kind = 'catalog_item' AND catalog_item_id IS NOT NULL AND child_recipe_version_id IS NULL)
        OR
        (source_kind = 'child_recipe_version' AND catalog_item_id IS NULL AND child_recipe_version_id IS NOT NULL)
        OR
        (
          source_kind = 'custom_cost'
          AND catalog_item_id IS NULL
          AND child_recipe_version_id IS NULL
        )
      )
    );

    CREATE TABLE catalog_item_recipe_roles (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      output_catalog_item_id TEXT NOT NULL,
      recipe_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (
        role IN ('primary', 'alternate', 'kiosk_cook_upon_order')
      ),
      status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'superseded', 'archived')
      ),
      effective_at TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (output_catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE RESTRICT
    );

    CREATE TABLE recipe_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      branch_id TEXT,
      recipe_id TEXT,
      source_version_id TEXT,
      output_catalog_item_id TEXT,
      name TEXT,
      category TEXT,
      expected_output_quantity REAL,
      expected_output_unit TEXT,
      production_mode TEXT CHECK (
        production_mode IS NULL
        OR production_mode IN ('prepared_before_selling', 'cook_upon_order')
      ),
      suggested_selling_price REAL,
      classification_proposal TEXT CHECK (
        classification_proposal IS NULL
        OR classification_proposal IN (
          'purchased_ingredient',
          'prepared_base',
          'finished_product',
          'direct_resale_product',
          'bundle_combo',
          'supply_packaging'
        )
      ),
      selling_price_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        selling_price_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      sellable INTEGER NOT NULL DEFAULT 0 CHECK (sellable IN (0, 1)),
      kiosk_enabled INTEGER NOT NULL DEFAULT 0 CHECK (kiosk_enabled IN (0, 1)),
      editor_step TEXT NOT NULL DEFAULT 'definition',
      lifecycle_status TEXT NOT NULL DEFAULT 'editing' CHECK (
        lifecycle_status IN ('editing', 'ready', 'published', 'abandoned')
      ),
      autosave_revision INTEGER NOT NULL DEFAULT 0 CHECK (autosave_revision >= 0),
      last_saved_at TEXT NOT NULL,
      unresolved_requirement_count INTEGER NOT NULL DEFAULT 0 CHECK (
        unresolved_requirement_count >= 0
      ),
      parent_draft_id TEXT,
      parent_line_id TEXT,
      return_route TEXT,
      published_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE RESTRICT,
      FOREIGN KEY (source_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (output_catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (parent_draft_id) REFERENCES recipe_drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (published_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT
    );

    CREATE TABLE recipe_draft_lines (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      recipe_draft_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      source_kind TEXT NOT NULL CHECK (
        source_kind IN (
          'catalog_item',
          'child_recipe_version',
          'child_draft',
          'custom_cost',
          'unresolved'
        )
      ),
      catalog_item_id TEXT,
      child_recipe_version_id TEXT,
      child_draft_id TEXT,
      custom_name TEXT,
      quantity REAL,
      unit TEXT,
      normalized_quantity REAL,
      normalized_unit TEXT,
      conversion_id TEXT,
      conversion_factor_snapshot REAL CHECK (
        conversion_factor_snapshot IS NULL OR conversion_factor_snapshot > 0
      ),
      role TEXT NOT NULL DEFAULT 'unset' CHECK (
        role IN ('main', 'supporting', 'seasoning', 'garnish', 'packaging', 'optional', 'unset')
      ),
      is_optional INTEGER NOT NULL DEFAULT 0 CHECK (is_optional IN (0, 1)),
      cost_override REAL,
      cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_state IN (
          'known',
          'unknown',
          'legacy_zero_unresolved',
          'not_applicable',
          'partial',
          'legacy_review'
        )
      ),
      allocation_mode TEXT NOT NULL DEFAULT 'none' CHECK (
        allocation_mode IN (
          'none',
          'legacy_selected',
          'manual',
          'recommended_fefo',
          'recommended_fifo',
          'legacy_balance'
        )
      ),
      legacy_ingredient_lot_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_draft_id) REFERENCES recipe_drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (child_recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (child_draft_id) REFERENCES recipe_drafts(id) ON DELETE RESTRICT,
      FOREIGN KEY (conversion_id) REFERENCES item_unit_conversions(id) ON DELETE SET NULL,
      FOREIGN KEY (legacy_ingredient_lot_id) REFERENCES ingredient_lots(id) ON DELETE RESTRICT,
      CHECK (
        (
          source_kind = 'catalog_item'
          AND catalog_item_id IS NOT NULL
          AND child_recipe_version_id IS NULL
          AND child_draft_id IS NULL
        )
        OR
        (
          source_kind = 'child_recipe_version'
          AND catalog_item_id IS NULL
          AND child_recipe_version_id IS NOT NULL
          AND child_draft_id IS NULL
        )
        OR
        (
          source_kind = 'child_draft'
          AND catalog_item_id IS NULL
          AND child_recipe_version_id IS NULL
          AND child_draft_id IS NOT NULL
        )
        OR
        (
          source_kind = 'custom_cost'
          AND catalog_item_id IS NULL
          AND child_recipe_version_id IS NULL
          AND child_draft_id IS NULL
          AND custom_name IS NOT NULL
        )
        OR
        (
          source_kind = 'unresolved'
          AND catalog_item_id IS NULL
          AND child_recipe_version_id IS NULL
          AND child_draft_id IS NULL
        )
      )
    );

    CREATE INDEX idx_recipe_versions_business_recipe
      ON recipe_versions(business_id, recipe_id, version_number);
    CREATE INDEX idx_recipe_versions_active_lookup
      ON recipe_versions(recipe_id, status, deleted_at);
    CREATE INDEX idx_recipe_versions_output
      ON recipe_versions(output_catalog_item_id, status);
    CREATE INDEX idx_recipe_version_lines_version
      ON recipe_version_lines(recipe_version_id, sort_order);
    CREATE INDEX idx_recipe_version_lines_child
      ON recipe_version_lines(child_recipe_version_id)
      WHERE child_recipe_version_id IS NOT NULL;
    CREATE INDEX idx_recipe_version_lines_catalog
      ON recipe_version_lines(catalog_item_id)
      WHERE catalog_item_id IS NOT NULL;
    CREATE INDEX idx_catalog_recipe_roles_lookup
      ON catalog_item_recipe_roles(output_catalog_item_id, role, status);
    CREATE UNIQUE INDEX uq_catalog_recipe_roles_active_primary
      ON catalog_item_recipe_roles(output_catalog_item_id)
      WHERE role = 'primary' AND status = 'active' AND deleted_at IS NULL;
    CREATE UNIQUE INDEX uq_catalog_recipe_roles_active_kiosk
      ON catalog_item_recipe_roles(output_catalog_item_id)
      WHERE role = 'kiosk_cook_upon_order' AND status = 'active' AND deleted_at IS NULL;
    CREATE UNIQUE INDEX uq_catalog_recipe_roles_active_family_role
      ON catalog_item_recipe_roles(output_catalog_item_id, recipe_id, role)
      WHERE status = 'active' AND deleted_at IS NULL;
    CREATE INDEX idx_recipe_drafts_business_lifecycle
      ON recipe_drafts(business_id, lifecycle_status, updated_at);
    CREATE INDEX idx_recipe_drafts_parent
      ON recipe_drafts(parent_draft_id, parent_line_id);
    CREATE INDEX idx_recipe_drafts_revision
      ON recipe_drafts(id, autosave_revision);
    CREATE INDEX idx_recipe_draft_lines_draft
      ON recipe_draft_lines(recipe_draft_id, sort_order);
    CREATE INDEX idx_recipe_draft_lines_child_version
      ON recipe_draft_lines(child_recipe_version_id)
      WHERE child_recipe_version_id IS NOT NULL;
    CREATE INDEX idx_recipe_draft_lines_child_draft
      ON recipe_draft_lines(child_draft_id)
      WHERE child_draft_id IS NOT NULL;

    ALTER TABLE recipes
      ADD COLUMN active_version_id TEXT REFERENCES recipe_versions(id) ON DELETE SET NULL;
    ALTER TABLE recipes
      ADD COLUMN versioning_state TEXT NOT NULL DEFAULT 'legacy_compat' CHECK (
        versioning_state IN ('legacy_compat', 'native', 'review_required')
      );

    INSERT INTO recipe_versions (
      id,
      business_id,
      recipe_id,
      version_number,
      status,
      name_snapshot,
      category_snapshot,
      output_catalog_item_id,
      output_product_id_snapshot,
      expected_output_quantity,
      expected_output_unit,
      production_mode,
      suggested_selling_price_snapshot,
      selling_price_state,
      notes_snapshot,
      source_kind,
      source_draft_id,
      duplicated_from_version_id,
      graph_state,
      cost_state,
      effective_at,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    )
    SELECT
      'legacy:recipe-version:' || r.id || ':1',
      r.business_id,
      r.id,
      1,
      'published',
      r.name,
      NULL,
      b.catalog_item_id,
      r.output_product_id,
      r.output_quantity,
      r.output_unit,
      r.production_mode,
      r.suggested_selling_price,
      CASE
        WHEN r.suggested_selling_price > 0 THEN 'known'
        ELSE 'legacy_zero_unresolved'
      END,
      r.notes,
      'legacy_import',
      NULL,
      NULL,
      'legacy_review',
      'legacy_review',
      r.updated_at,
      r.created_at,
      r.updated_at,
      r.sync_status,
      r.deleted_at
    FROM recipes r
    JOIN legacy_item_bindings b
      ON b.entity_kind = 'product'
      AND b.legacy_entity_id = r.output_product_id;

    INSERT INTO recipe_version_lines (
      id,
      business_id,
      recipe_version_id,
      sort_order,
      source_kind,
      catalog_item_id,
      child_recipe_version_id,
      custom_name_snapshot,
      quantity,
      unit,
      normalized_quantity,
      normalized_unit,
      conversion_id,
      conversion_factor_snapshot,
      role,
      is_optional,
      cost_override,
      cost_per_unit_snapshot,
      line_cost_snapshot,
      cost_state,
      allocation_mode,
      legacy_ingredient_id_snapshot,
      legacy_ingredient_lot_id,
      source_label_snapshot,
      original_legacy_line_id,
      notes_snapshot,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    )
    SELECT
      'legacy:recipe-version-line:' || l.id,
      l.business_id,
      'legacy:recipe-version:' || l.recipe_id || ':1',
      (
        SELECT COUNT(*)
        FROM recipe_ingredient_lines earlier
        WHERE earlier.recipe_id = l.recipe_id
          AND (
            earlier.created_at < l.created_at
            OR (earlier.created_at = l.created_at AND earlier.id < l.id)
          )
      ),
      CASE WHEN l.ingredient_id IS NOT NULL THEN 'catalog_item' ELSE 'custom_cost' END,
      b.catalog_item_id,
      NULL,
      l.custom_name,
      l.quantity,
      l.unit,
      NULL,
      NULL,
      NULL,
      NULL,
      'unset',
      0,
      l.cost_override,
      l.cost_per_unit_snapshot,
      l.line_cost_snapshot,
      CASE
        WHEN COALESCE(l.cost_override, l.cost_per_unit_snapshot, l.line_cost_snapshot, 0) > 0
          THEN 'known'
        ELSE 'legacy_review'
      END,
      CASE WHEN l.ingredient_lot_id IS NOT NULL THEN 'legacy_selected' ELSE 'none' END,
      l.ingredient_id,
      l.ingredient_lot_id,
      l.source_label_snapshot,
      l.id,
      l.notes,
      l.created_at,
      l.updated_at,
      l.sync_status,
      l.deleted_at
    FROM recipe_ingredient_lines l
    LEFT JOIN legacy_item_bindings b
      ON b.entity_kind = 'ingredient'
      AND b.legacy_entity_id = l.ingredient_id;

    UPDATE recipes
    SET
      active_version_id = 'legacy:recipe-version:' || id || ':1',
      versioning_state = 'legacy_compat';
  `,
} as const;
