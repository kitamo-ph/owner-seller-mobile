import type { LocationRef, Turn6BusinessType } from "./onboarding";

export type PaymentMethod = "cash" | "GCash" | "Maya" | "bank transfer" | "other";

export type SyncStatus = "local" | "pending" | "synced" | "failed";

export type LegacyBusinessType =
  | "sari-sari store"
  | "karinderia"
  | "street food"
  | "kiosk"
  | "school canteen"
  | "small booth"
  | "other";

export type BusinessType = LegacyBusinessType | Turn6BusinessType;

export type LanguagePreference = "Taglish" | "Filipino" | "English";
export type ProductType = "retail item" | "cooked food" | "ingredient-based item" | "service/other";
export type UnitType = "piece" | "bottle" | "pack" | "sachet" | "kilo" | "serving" | "case" | "tray" | "other";
export type PaymentStatus = "paid" | "unpaid" | "pending" | "failed";

export type LocalEntity = {
  id: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: SyncStatus;
  deletedAt: string | null;
};

export type Business = LocalEntity & {
  businessName: string;
  businessType: BusinessType;
  businessTypeCustom: string | null;
  ownerName: string;
  barangay: string;
  locationRef: LocationRef;
  contactNumber: string | null;
  notes: string | null;
  preferredLanguage: LanguagePreference;
  currency: "PHP";
};

export type Branch = LocalEntity & {
  businessId: string;
  branchName: string;
  location: string | null;
  locationRef: LocationRef | null;
  inheritsBusinessLocation: boolean;
  branchType: "stall" | "branch" | "kiosk" | "booth" | "home kitchen" | "pop-up";
  active: boolean;
  notes: string | null;
};

export type Product = LocalEntity & {
  businessId: string;
  branchId: string | null;
  name: string;
  category: string;
  price: number;
  cost: number;
  stockQty: number;
  unitType: UnitType;
  lowStockThreshold: number;
  bundleQuantity: number | null;
  bundlePrice: number | null;
  bundleLabel: string | null;
  active: boolean;
  productType: ProductType;
};

export type Sale = LocalEntity & {
  businessId: string;
  branchId: string | null;
  transactionNo: string;
  happenedAt: string;
  amount: number;
  discount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  externalReferenceNumber: string | null;
  notes: string | null;
};

export type SaleCogsSource = "simple" | "production_average" | "cook_upon_order_actual" | "cook_upon_order_estimated";

export type SaleItem = LocalEntity & {
  saleId: string;
  businessId: string;
  branchId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  bundleApplied: boolean;
  discountAmount: number;
  cogsTotal: number | null;
  cogsPerUnit: number | null;
  cogsSource: SaleCogsSource | null;
  cogsIsEstimated: boolean;
  relatedRecipeId: string | null;
};

export type InventoryMovementType =
  | "stock_in"
  | "stock_out_sale"
  | "manual_adjustment"
  | "cooked"
  | "spoilage"
  | "transfer_in"
  | "transfer_out"
  | "return_to_supplier"
  | "customer_return";

export type InventoryMovement = LocalEntity & {
  businessId: string;
  branchId: string | null;
  productId: string | null;
  movementType: InventoryMovementType;
  quantity: number;
  reason: string;
  linkedSaleId: string | null;
  unitCost: number | null;
  totalCost: number | null;
};

export type IngredientUnit = "g" | "kg" | "ml" | "L" | "pcs" | "pack";

export type Ingredient = LocalEntity & {
  businessId: string;
  name: string;
  defaultUnit: IngredientUnit;
  category: string;
  lowStockThreshold: number;
  isActive: boolean;
};

export type IngredientLotStatus = "active" | "depleted" | "archived";

export type IngredientLot = LocalEntity & {
  businessId: string;
  ingredientId: string;
  brandName: string | null;
  sourceName: string | null;
  purchaseDate: string;
  purchasedQuantity: number;
  remainingQuantity: number;
  unit: IngredientUnit;
  totalCost: number;
  costPerUnit: number;
  notes: string | null;
  status: IngredientLotStatus;
};

export type IngredientMovementType =
  | "purchase"
  | "adjustment"
  | "recipe_usage"
  | "sale_supply_usage"
  | "spoilage";

export type IngredientMovement = LocalEntity & {
  businessId: string;
  ingredientId: string;
  lotId: string | null;
  movementType: IngredientMovementType;
  quantity: number;
  unit: IngredientUnit;
  unitCost: number | null;
  totalCost: number | null;
  reason: string;
};

export type RecipeProductionMode = "prepared_before_selling" | "cook_upon_order";

export type Recipe = LocalEntity & {
  businessId: string;
  outputProductId: string;
  name: string;
  outputQuantity: number;
  outputUnit: IngredientUnit;
  productionMode: RecipeProductionMode;
  suggestedSellingPrice: number | null;
  notes: string | null;
  isActive: boolean;
};

export type RecipeIngredientLine = LocalEntity & {
  businessId: string;
  recipeId: string;
  ingredientId: string | null;
  ingredientLotId: string | null;
  customName: string | null;
  quantity: number;
  unit: IngredientUnit;
  costOverride: number | null;
  costPerUnitSnapshot: number | null;
  lineCostSnapshot: number;
  sourceLabelSnapshot: string | null;
  isCustom: boolean;
  notes: string | null;
};

export type ProductionBatch = LocalEntity & {
  businessId: string;
  branchId: string | null;
  recipeId: string | null;
  outputProductId: string | null;
  recipeName: string;
  outputQuantity: number;
  outputUnit: IngredientUnit;
  batchMultiplier: number;
  totalBatchCost: number;
  costPerOutputUnit: number;
  notes: string | null;
};

export type ProductionIngredientUsage = LocalEntity & {
  businessId: string;
  productionBatchId: string;
  ingredientId: string | null;
  ingredientLotId: string | null;
  quantityUsed: number;
  unit: IngredientUnit;
  lineCost: number;
  sourceLabelSnapshot: string | null;
  isCustom: boolean;
};

export type FixedCostCategory =
  | "rent"
  | "wages"
  | "electricity"
  | "water"
  | "transport"
  | "lpg_gas"
  | "market_fee"
  | "internet_load"
  | "other";

export type FixedCostFrequencyType = "daily" | "weekly" | "monthly" | "one_time";

export type FixedCost = LocalEntity & {
  businessId: string;
  branchId: string | null;
  name: string;
  category: FixedCostCategory;
  amount: number;
  frequency: FixedCostFrequencyType;
  dueDate: string;
  startDate: string;
  endDate: string | null;
  status: "active" | "archived";
  notes: string | null;
};

export type FixedCostPayment = LocalEntity & {
  businessId: string;
  fixedCostId: string;
  branchId: string | null;
  dueDate: string;
  paidDate: string | null;
  amount: number;
  status: "paid" | "skipped";
  notes: string | null;
};

export type OwnerAlertSeverity = "info" | "warning" | "critical";
export type OwnerAlertStatus = "active" | "resolved";

export type OwnerAlert = LocalEntity & {
  businessId: string;
  branchId: string | null;
  productId: string | null;
  alertType: string;
  title: string;
  message: string;
  severity: OwnerAlertSeverity;
  status: OwnerAlertStatus;
  source: string;
};

export type RecipeBatch = LocalEntity & {
  businessId: string;
  branchId: string | null;
  recipeName: string;
  batches: number;
  expectedServings: number;
  actualServings: number;
  totalBatchCost: number;
  notes: string | null;
};

export type AppSettingKey =
  | "themeMode"
  | "activeBusinessId"
  | "activeBranchId"
  | `activeBranchId:${string}`
  | "hasCompletedFirstRun"
  | "hasSeededDemoData"
  | "setupPersonName"
  | "setupRole"
  | "sellerConnectionState"
  | "favoriteProductIds"
  | "recentProductIds";

export type AppSetting = {
  id: string;
  key: AppSettingKey;
  value: string;
  valueType: "string" | "boolean" | "number" | "json";
  createdAt: string;
  updatedAt: string;
};
