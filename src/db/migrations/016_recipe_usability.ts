export const recipeUsabilityMigration = {
  id: "016_recipe_usability",
  up: `
    ALTER TABLE recipe_draft_lines
      ADD COLUMN conversion_chain_json TEXT CHECK (
        conversion_chain_json IS NULL OR length(trim(conversion_chain_json)) > 0
      );
    ALTER TABLE recipe_draft_lines
      ADD COLUMN unit_standard_snapshot TEXT CHECK (
        unit_standard_snapshot IS NULL OR length(trim(unit_standard_snapshot)) > 0
      );

    ALTER TABLE recipe_version_lines
      ADD COLUMN conversion_chain_json TEXT CHECK (
        conversion_chain_json IS NULL OR length(trim(conversion_chain_json)) > 0
      );
    ALTER TABLE recipe_version_lines
      ADD COLUMN unit_standard_snapshot TEXT CHECK (
        unit_standard_snapshot IS NULL OR length(trim(unit_standard_snapshot)) > 0
      );

    ALTER TABLE ingredient_lots
      ADD COLUMN entered_quantity REAL CHECK (
        entered_quantity IS NULL OR entered_quantity >= 0
      );
    ALTER TABLE ingredient_lots
      ADD COLUMN entered_unit TEXT CHECK (
        entered_unit IS NULL OR length(trim(entered_unit)) > 0
      );
    ALTER TABLE ingredient_lots
      ADD COLUMN unit_standard_snapshot TEXT CHECK (
        unit_standard_snapshot IS NULL OR length(trim(unit_standard_snapshot)) > 0
      );
    ALTER TABLE ingredient_lots
      ADD COLUMN conversion_chain_json TEXT CHECK (
        conversion_chain_json IS NULL OR length(trim(conversion_chain_json)) > 0
      );

    UPDATE ingredient_lots
    SET entered_quantity = purchased_quantity,
        entered_unit = unit
    WHERE entered_quantity IS NULL AND entered_unit IS NULL;
  `,
} as const;
