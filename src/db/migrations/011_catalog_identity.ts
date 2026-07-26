export const catalogIdentityMigration = {
  id: "011_catalog_identity",
  up: `
    CREATE TABLE catalog_items (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      branch_id TEXT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'native' CHECK (
        source_type IN ('legacy_product', 'legacy_ingredient', 'native')
      ),
      classification TEXT NOT NULL DEFAULT 'legacy_unclassified' CHECK (
        classification IN (
          'purchased_ingredient',
          'prepared_base',
          'finished_product',
          'direct_resale_product',
          'bundle_combo',
          'supply_packaging',
          'legacy_unclassified'
        )
      ),
      lifecycle_status TEXT NOT NULL DEFAULT 'draft' CHECK (
        lifecycle_status IN ('draft', 'ready', 'active', 'archived')
      ),
      readiness_state TEXT NOT NULL DEFAULT 'incomplete' CHECK (
        readiness_state IN ('incomplete', 'ready', 'blocked', 'legacy_review')
      ),
      classification_review_required INTEGER NOT NULL DEFAULT 1 CHECK (
        classification_review_required IN (0, 1)
      ),
      sellable INTEGER NOT NULL DEFAULT 0 CHECK (sellable IN (0, 1)),
      kiosk_enabled INTEGER NOT NULL DEFAULT 0 CHECK (kiosk_enabled IN (0, 1)),
      purchase_cost_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        purchase_cost_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      selling_price_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
        selling_price_state IN ('known', 'unknown', 'legacy_zero_unresolved', 'not_applicable')
      ),
      stock_policy TEXT NOT NULL DEFAULT 'untracked' CHECK (
        stock_policy IN ('untracked', 'ingredient_lots', 'product_scalar', 'product_lots')
      ),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    );

    CREATE TABLE legacy_item_bindings (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      catalog_item_id TEXT NOT NULL,
      entity_kind TEXT NOT NULL CHECK (entity_kind IN ('product', 'ingredient')),
      legacy_entity_id TEXT NOT NULL,
      projection_role TEXT NOT NULL CHECK (
        projection_role IN (
          'legacy_product',
          'legacy_ingredient',
          'sale_product',
          'recipe_output',
          'stock_ingredient',
          'supply_ingredient'
        )
      ),
      binding_status TEXT NOT NULL DEFAULT 'active' CHECK (
        binding_status IN ('active', 'archived')
      ),
      compatibility_mode TEXT NOT NULL DEFAULT 'legacy_unclassified' CHECK (
        compatibility_mode IN ('legacy_unclassified', 'reviewed_legacy', 'native')
      ),
      review_required INTEGER NOT NULL DEFAULT 1 CHECK (review_required IN (0, 1)),
      legacy_active_snapshot INTEGER CHECK (legacy_active_snapshot IN (0, 1)),
      legacy_deleted_at_snapshot TEXT,
      migration_provenance TEXT NOT NULL CHECK (
        migration_provenance IN ('migration_011', 'native')
      ),
      reviewed_at TEXT,
      native_activated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      UNIQUE (catalog_item_id),
      UNIQUE (entity_kind, legacy_entity_id)
    );

    CREATE TABLE item_unit_conversions (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      catalog_item_id TEXT NOT NULL,
      from_unit TEXT NOT NULL,
      to_unit TEXT NOT NULL,
      factor REAL NOT NULL CHECK (factor > 0),
      version INTEGER NOT NULL CHECK (version > 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'superseded', 'archived')
      ),
      supersedes_conversion_id TEXT,
      effective_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (supersedes_conversion_id) REFERENCES item_unit_conversions(id) ON DELETE SET NULL,
      CHECK (from_unit <> to_unit),
      UNIQUE (catalog_item_id, from_unit, to_unit, version)
    );

    CREATE INDEX idx_catalog_items_business_lifecycle
      ON catalog_items(business_id, lifecycle_status, deleted_at);
    CREATE INDEX idx_catalog_items_business_classification
      ON catalog_items(business_id, classification, lifecycle_status);
    CREATE INDEX idx_catalog_items_business_review
      ON catalog_items(business_id, classification_review_required, deleted_at);
    CREATE INDEX idx_catalog_items_normalized_name
      ON catalog_items(business_id, normalized_name);
    CREATE INDEX idx_catalog_items_kiosk_eligibility
      ON catalog_items(
        business_id,
        branch_id,
        lifecycle_status,
        classification,
        sellable,
        kiosk_enabled,
        selling_price_state
      )
      WHERE deleted_at IS NULL;
    CREATE INDEX idx_legacy_bindings_catalog_role
      ON legacy_item_bindings(catalog_item_id, projection_role, deleted_at);
    CREATE INDEX idx_legacy_bindings_business_mode
      ON legacy_item_bindings(business_id, compatibility_mode, review_required);
    CREATE INDEX idx_item_conversions_lookup
      ON item_unit_conversions(catalog_item_id, from_unit, to_unit, status);
    CREATE UNIQUE INDEX uq_item_conversions_active
      ON item_unit_conversions(catalog_item_id, from_unit, to_unit)
      WHERE status = 'active' AND deleted_at IS NULL;

    INSERT INTO catalog_items (
      id,
      business_id,
      branch_id,
      name,
      normalized_name,
      source_type,
      classification,
      lifecycle_status,
      readiness_state,
      classification_review_required,
      sellable,
      kiosk_enabled,
      purchase_cost_state,
      selling_price_state,
      stock_policy,
      archived_at,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    )
    SELECT
      'legacy:product:' || id,
      business_id,
      branch_id,
      name,
      lower(trim(name)),
      'legacy_product',
      'legacy_unclassified',
      'draft',
      'legacy_review',
      1,
      0,
      0,
      CASE WHEN cost > 0 THEN 'known' ELSE 'legacy_zero_unresolved' END,
      CASE WHEN price > 0 THEN 'known' ELSE 'legacy_zero_unresolved' END,
      'product_scalar',
      NULL,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    FROM products;

    INSERT INTO legacy_item_bindings (
      id,
      business_id,
      catalog_item_id,
      entity_kind,
      legacy_entity_id,
      projection_role,
      binding_status,
      compatibility_mode,
      review_required,
      legacy_active_snapshot,
      legacy_deleted_at_snapshot,
      migration_provenance,
      reviewed_at,
      native_activated_at,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    )
    SELECT
      'binding:product:' || id,
      business_id,
      'legacy:product:' || id,
      'product',
      id,
      'legacy_product',
      CASE WHEN deleted_at IS NULL THEN 'active' ELSE 'archived' END,
      'legacy_unclassified',
      1,
      active,
      deleted_at,
      'migration_011',
      NULL,
      NULL,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    FROM products;

    INSERT INTO catalog_items (
      id,
      business_id,
      branch_id,
      name,
      normalized_name,
      source_type,
      classification,
      lifecycle_status,
      readiness_state,
      classification_review_required,
      sellable,
      kiosk_enabled,
      purchase_cost_state,
      selling_price_state,
      stock_policy,
      archived_at,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    )
    SELECT
      'legacy:ingredient:' || id,
      business_id,
      NULL,
      name,
      lower(trim(name)),
      'legacy_ingredient',
      'legacy_unclassified',
      'draft',
      'legacy_review',
      1,
      0,
      0,
      'legacy_zero_unresolved',
      'not_applicable',
      'ingredient_lots',
      NULL,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    FROM ingredients;

    INSERT INTO legacy_item_bindings (
      id,
      business_id,
      catalog_item_id,
      entity_kind,
      legacy_entity_id,
      projection_role,
      binding_status,
      compatibility_mode,
      review_required,
      legacy_active_snapshot,
      legacy_deleted_at_snapshot,
      migration_provenance,
      reviewed_at,
      native_activated_at,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    )
    SELECT
      'binding:ingredient:' || id,
      business_id,
      'legacy:ingredient:' || id,
      'ingredient',
      id,
      'legacy_ingredient',
      CASE WHEN deleted_at IS NULL THEN 'active' ELSE 'archived' END,
      'legacy_unclassified',
      1,
      is_active,
      deleted_at,
      'migration_011',
      NULL,
      NULL,
      created_at,
      updated_at,
      sync_status,
      deleted_at
    FROM ingredients;
  `,
} as const;
