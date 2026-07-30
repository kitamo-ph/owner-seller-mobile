export const schemaVersion = 10;

export const syncStatusValues = ["local", "pending", "synced", "failed"] as const;

export const resettableTables = [
  "problem_reports",
  "offline_queue",
  "receipt_records",
  "owner_alerts",
  "sale_ingredient_usages",
  "product_transfers",
  "fixed_cost_payments",
  "fixed_costs",
  "production_ingredient_usages",
  "production_batches",
  "recipe_batches",
  "recipe_ingredient_lines",
  "recipes",
  "ingredient_movements",
  "ingredient_lots",
  "ingredients",
  "inventory_movements",
  "sale_items",
  "sales",
  "products",
  "branches",
  "businesses",
  "app_settings",
] as const;

export const countableTables = [
  "problem_reports",
  "businesses",
  "branches",
  "products",
  "sales",
  "inventory_movements",
  "recipe_batches",
  "owner_alerts",
  "receipt_records",
  "offline_queue",
  "ingredients",
  "ingredient_lots",
  "ingredient_movements",
  "recipes",
  "recipe_ingredient_lines",
  "production_batches",
  "production_ingredient_usages",
  "sale_ingredient_usages",
  "product_transfers",
  "fixed_costs",
  "fixed_cost_payments",
] as const;

export type ResettableTable = (typeof resettableTables)[number];
export type CountableTable = (typeof countableTables)[number];
export type LocalDataCounts = Record<CountableTable, number>;
