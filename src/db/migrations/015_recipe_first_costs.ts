export const recipeFirstCostsMigration = {
  id: "015_recipe_first_costs",
  up: `
    CREATE TABLE catalog_cost_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      catalog_item_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (
        source_kind IN ('owner_estimate', 'recipe_version')
      ),
      total_cost REAL NOT NULL CHECK (total_cost >= 0),
      reference_quantity REAL NOT NULL CHECK (reference_quantity > 0),
      reference_unit TEXT NOT NULL CHECK (length(trim(reference_unit)) > 0),
      request_token TEXT,
      source_recipe_version_id TEXT,
      supersedes_profile_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'superseded', 'archived')
      ),
      effective_at TEXT NOT NULL,
      superseded_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (catalog_item_id) REFERENCES catalog_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (source_recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      FOREIGN KEY (supersedes_profile_id) REFERENCES catalog_cost_profiles(id) ON DELETE RESTRICT,
      CHECK (
        (
          source_kind = 'owner_estimate'
          AND source_recipe_version_id IS NULL
          AND request_token IS NOT NULL
          AND length(trim(request_token)) > 0
        )
        OR
        (
          source_kind = 'recipe_version'
          AND source_recipe_version_id IS NOT NULL
          AND request_token IS NULL
        )
      ),
      CHECK (
        (status = 'active' AND superseded_at IS NULL)
        OR (status = 'superseded' AND superseded_at IS NOT NULL)
        OR status = 'archived'
      ),
      CHECK (supersedes_profile_id IS NULL OR supersedes_profile_id <> id)
    );

    CREATE INDEX idx_catalog_cost_profiles_item_history
      ON catalog_cost_profiles(catalog_item_id, effective_at DESC, id);
    CREATE INDEX idx_catalog_cost_profiles_recipe_version
      ON catalog_cost_profiles(source_recipe_version_id)
      WHERE source_recipe_version_id IS NOT NULL;
    CREATE UNIQUE INDEX uq_catalog_cost_profiles_owner_request
      ON catalog_cost_profiles(business_id, request_token)
      WHERE source_kind = 'owner_estimate' AND request_token IS NOT NULL;
    CREATE UNIQUE INDEX uq_catalog_cost_profiles_recipe_version
      ON catalog_cost_profiles(source_recipe_version_id)
      WHERE source_kind = 'recipe_version'
        AND source_recipe_version_id IS NOT NULL
        AND deleted_at IS NULL;
    CREATE UNIQUE INDEX uq_catalog_cost_profiles_active
      ON catalog_cost_profiles(catalog_item_id)
      WHERE status = 'active' AND deleted_at IS NULL;

    ALTER TABLE recipe_draft_lines
      ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_source IN (
          'purchase_lot',
          'owner_estimate',
          'recipe_version',
          'custom',
          'unknown',
          'legacy_snapshot',
          'not_applicable'
        )
      );
    ALTER TABLE recipe_draft_lines
      ADD COLUMN cost_profile_id TEXT REFERENCES catalog_cost_profiles(id) ON DELETE RESTRICT;

    ALTER TABLE recipe_drafts
      ADD COLUMN notes TEXT;

    ALTER TABLE recipe_version_lines
      ADD COLUMN cost_source TEXT NOT NULL DEFAULT 'unknown' CHECK (
        cost_source IN (
          'purchase_lot',
          'owner_estimate',
          'recipe_version',
          'custom',
          'unknown',
          'legacy_snapshot',
          'not_applicable'
        )
      );
    ALTER TABLE recipe_version_lines
      ADD COLUMN cost_profile_id TEXT REFERENCES catalog_cost_profiles(id) ON DELETE RESTRICT;

    UPDATE recipe_draft_lines
    SET cost_source = CASE
      WHEN source_kind = 'custom_cost' THEN 'custom'
      WHEN legacy_ingredient_lot_id IS NOT NULL THEN 'purchase_lot'
      WHEN cost_state = 'not_applicable' THEN 'not_applicable'
      WHEN cost_state = 'known' THEN 'legacy_snapshot'
      ELSE 'unknown'
    END;

    UPDATE recipe_version_lines
    SET cost_source = CASE
      WHEN cost_state IN (
        'unknown',
        'legacy_zero_unresolved',
        'partial',
        'legacy_review'
      ) THEN 'unknown'
      WHEN source_kind = 'custom_cost' THEN 'custom'
      WHEN legacy_ingredient_lot_id IS NOT NULL THEN 'purchase_lot'
      WHEN cost_state = 'not_applicable' THEN 'not_applicable'
      WHEN cost_state = 'known' THEN 'legacy_snapshot'
      ELSE 'unknown'
    END;

    CREATE INDEX idx_recipe_draft_lines_cost_profile
      ON recipe_draft_lines(cost_profile_id)
      WHERE cost_profile_id IS NOT NULL;
    CREATE INDEX idx_recipe_version_lines_cost_profile
      ON recipe_version_lines(cost_profile_id)
      WHERE cost_profile_id IS NOT NULL;

    CREATE TABLE recipe_version_cost_summaries (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT NOT NULL,
      recipe_version_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('actual', 'estimated', 'incomplete', 'no_price')
      ),
      total_cost REAL CHECK (total_cost IS NULL OR total_cost >= 0),
      cost_per_output_unit REAL CHECK (
        cost_per_output_unit IS NULL OR cost_per_output_unit >= 0
      ),
      known_cost_subtotal REAL NOT NULL DEFAULT 0 CHECK (
        known_cost_subtotal >= 0
      ),
      missing_required_count INTEGER NOT NULL DEFAULT 0 CHECK (
        missing_required_count >= 0
      ),
      estimated_input_count INTEGER NOT NULL DEFAULT 0 CHECK (
        estimated_input_count >= 0
      ),
      created_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (
        sync_status IN ('local', 'pending', 'synced', 'failed')
      ),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_version_id) REFERENCES recipe_versions(id) ON DELETE RESTRICT,
      UNIQUE (recipe_version_id),
      CHECK (
        (
          status = 'actual'
          AND total_cost IS NOT NULL
          AND cost_per_output_unit IS NOT NULL
          AND missing_required_count = 0
          AND estimated_input_count = 0
        )
        OR
        (
          status = 'estimated'
          AND total_cost IS NOT NULL
          AND cost_per_output_unit IS NOT NULL
          AND missing_required_count = 0
          AND estimated_input_count > 0
        )
        OR
        (
          status = 'incomplete'
          AND total_cost IS NULL
          AND cost_per_output_unit IS NULL
          AND missing_required_count > 0
        )
        OR
        (
          status = 'no_price'
          AND total_cost IS NULL
          AND cost_per_output_unit IS NULL
        )
      )
    );

    CREATE INDEX idx_recipe_version_cost_summaries_business_status
      ON recipe_version_cost_summaries(business_id, status, created_at DESC);
  `,
} as const;
