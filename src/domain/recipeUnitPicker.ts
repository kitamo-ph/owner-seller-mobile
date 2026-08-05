import {
  isCountableRecipeUnitDimension,
  isMeasuredRecipeUnitDimension,
  normalizePracticalRecipeUnit,
  recipeUnitDimension,
  recipeUnitLabel,
  standardRecipeUnitFactor,
  type PracticalRecipeUnit,
  type RecipeUnitDimension,
} from "./recipeConversionChains";

/** Most common units shown as inline chips; everything else is behind "Iba pa". */
export const COMMON_RECIPE_UNIT_KEYS = [
  "g",
  "kg",
  "ml",
  "l",
  "pcs",
  "pack",
] as const;

export type RecipeUnitPickerGroupKey = "mass" | "volume" | "countable";

export type RecipeUnitPickerGroup = {
  key: RecipeUnitPickerGroupKey;
  header: string;
  units: string[];
};

export type RecipeUnitPickerPartition = {
  common: string[];
  more: RecipeUnitPickerGroup[];
  moreFlat: string[];
};

export type RecipeUnitCompatibility = "enabled" | "ghosted";

export type GhostedUnitRoute =
  | "custom_conversion"
  | "package_breakdown"
  | "custom_cup";

export type GhostedUnitGuidance = {
  route: GhostedUnitRoute;
  message: string;
  primaryActionLabel: string;
};

const COMMON_KEY_SET: ReadonlySet<string> = new Set(COMMON_RECIPE_UNIT_KEYS);

const GROUP_ORDER: readonly RecipeUnitPickerGroupKey[] = [
  "mass",
  "volume",
  "countable",
];

const GROUP_HEADERS: Readonly<Record<RecipeUnitPickerGroupKey, string>> = {
  mass: "Timbang (g, kg)",
  volume: "Sukat (ml, L, cup, tbsp, tsp)",
  countable: "Bilang (pcs, pack, portion, serving)",
};

/** @deprecated Prefer ghostedUnitGuidance; kept for pack→g string assertions. */
export const COUNTABLE_MEASURED_CONVERSION_GUIDANCE =
  "Walang awtomatikong conversion mula pack papuntang gramo. Gamitin ang Package breakdown o Custom conversion.";

function unitKey(value: string): string {
  return (
    normalizePracticalRecipeUnit(value) ??
    value.trim().toLocaleLowerCase().replace(/[ -]+/g, "_")
  );
}

function groupKeyForDimension(
  dimension: RecipeUnitDimension,
): RecipeUnitPickerGroupKey {
  if (dimension === "mass") return "mass";
  if (dimension === "volume") return "volume";
  return "countable";
}

export function shortRecipeUnitLabel(unit: string): string {
  const normalized = normalizePracticalRecipeUnit(unit);
  if (!normalized) return unit.trim() || "unit";
  if (normalized === "l") return "L";
  if (normalized === "ml") return "mL";
  if (normalized === "metric_cup") return "Metric cup";
  if (normalized === "us_cup") return "US cup";
  if (normalized === "custom_cup") return "Custom cup";
  if (normalized === "us_gallon") return "US gal";
  if (normalized === "imperial_gallon") return "Imp gal";
  if (normalized === "tbsp") return "tbsp";
  if (normalized === "tsp") return "tsp";
  // Never surface bare "oz" — mass ounce vs fluid ounce must stay distinct.
  if (normalized === "oz") return "oz (timbang)";
  if (normalized === "lb") return "lb (timbang)";
  if (normalized === "floz_us") return "US fl oz";
  if (normalized === "floz_imp") return "Imp fl oz";
  return normalized;
}

export function detailedRecipeUnitLabel(unit: string): string {
  const normalized = normalizePracticalRecipeUnit(unit);
  if (!normalized) return unit.trim() || "unit";
  if (normalized === "l") return "Liter (L)";
  if (normalized === "ml") return "Milliliter (mL)";
  return recipeUnitLabel(normalized);
}

/**
 * Splits the provided options into common chips and dimension-grouped "Iba pa"
 * entries. Option strings are preserved as supplied (e.g. grocery `L`).
 */
export function partitionRecipeUnitOptions(
  options: readonly string[],
): RecipeUnitPickerPartition {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const option of options) {
    const key = unitKey(option);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(option);
  }

  const common: string[] = [];
  for (const key of COMMON_RECIPE_UNIT_KEYS) {
    const match = unique.find((option) => unitKey(option) === key);
    if (match) common.push(match);
  }

  const buckets = new Map<RecipeUnitPickerGroupKey, string[]>();
  for (const option of unique) {
    if (COMMON_KEY_SET.has(unitKey(option))) continue;
    const dimension = recipeUnitDimension(option);
    const groupKey = dimension
      ? groupKeyForDimension(dimension)
      : "countable";
    const list = buckets.get(groupKey) ?? [];
    list.push(option);
    buckets.set(groupKey, list);
  }

  const more: RecipeUnitPickerGroup[] = [];
  for (const key of GROUP_ORDER) {
    const units = buckets.get(key);
    if (!units || units.length === 0) continue;
    more.push({
      key,
      header: GROUP_HEADERS[key],
      units,
    });
  }

  return {
    common,
    more,
    moreFlat: more.flatMap((group) => group.units),
  };
}

export function isCommonRecipeUnit(unit: string): boolean {
  return COMMON_KEY_SET.has(unitKey(unit));
}

/**
 * Classify a candidate against the opposite side using the live factor table.
 * No hard-coded matrix — new UNIT_DEFINITIONS entries flow through automatically.
 */
export function classifyRecipeUnitCompatibility(
  candidateUnit: string,
  oppositeUnit: string | null | undefined,
): RecipeUnitCompatibility {
  if (!oppositeUnit?.trim()) return "enabled";
  if (unitKey(candidateUnit) === unitKey(oppositeUnit)) return "enabled";
  return standardRecipeUnitFactor(oppositeUnit, candidateUnit) === null
    ? "ghosted"
    : "enabled";
}

export function ghostedUnitGuidance(
  oppositeUnit: string,
  attemptedUnit: string,
): GhostedUnitGuidance {
  const opposite = normalizePracticalRecipeUnit(oppositeUnit);
  const attempted = normalizePracticalRecipeUnit(attemptedUnit);
  const oppositeLabel = shortRecipeUnitLabel(oppositeUnit);
  const attemptedLabel = shortRecipeUnitLabel(attemptedUnit);

  if (opposite === "custom_cup" || attempted === "custom_cup") {
    return {
      route: "custom_cup",
      message: "Itakda muna ang laki ng inyong cup sa mL.",
      primaryActionLabel: "Itakda ang custom cup",
    };
  }

  const oppositeDimension = recipeUnitDimension(oppositeUnit);
  const attemptedDimension = recipeUnitDimension(attemptedUnit);
  const countableMeasured =
    oppositeDimension &&
    attemptedDimension &&
    ((isCountableRecipeUnitDimension(oppositeDimension) &&
      isMeasuredRecipeUnitDimension(attemptedDimension)) ||
      (isMeasuredRecipeUnitDimension(oppositeDimension) &&
        isCountableRecipeUnitDimension(attemptedDimension)));

  if (countableMeasured) {
    const countableLabel = isCountableRecipeUnitDimension(
      oppositeDimension!,
    )
      ? oppositeLabel
      : attemptedLabel;
    return {
      route: "package_breakdown",
      message: `Ang ${countableLabel} ay binibilang, hindi sinusukat. Ilagay kung ilan ang laman ng isang pack.`,
      primaryActionLabel: "Gamitin ang Package breakdown",
    };
  }

  return {
    route: "custom_conversion",
    message: `Walang awtomatikong conversion mula ${oppositeLabel} papuntang ${attemptedLabel} — nag-iiba ang bigat kada sangkap. Gusto mong itakda ang sukat para sa item na ito?`,
    primaryActionLabel: "Gamitin ang Custom conversion",
  };
}

/**
 * Owner-facing next step when a countable unit is mixed with a measured one.
 * Prefer ghostedUnitGuidance for picker UX; retained for string assertions.
 */
export function countableMeasuredConversionGuidance(
  fromUnit: string,
  toUnit: string,
): string | null {
  const fromDimension = recipeUnitDimension(fromUnit);
  const toDimension = recipeUnitDimension(toUnit);
  if (!fromDimension || !toDimension) return null;
  if (fromDimension === toDimension) return null;
  const mixed =
    (isCountableRecipeUnitDimension(fromDimension) &&
      isMeasuredRecipeUnitDimension(toDimension)) ||
    (isMeasuredRecipeUnitDimension(fromDimension) &&
      isCountableRecipeUnitDimension(toDimension));
  if (!mixed) return null;

  const countable = isCountableRecipeUnitDimension(fromDimension)
    ? fromUnit
    : toUnit;
  const measured = isMeasuredRecipeUnitDimension(fromDimension)
    ? fromUnit
    : toUnit;
  const countableLabel = shortRecipeUnitLabel(countable);
  const measuredLabel =
    recipeUnitDimension(measured) === "mass"
      ? unitKey(measured) === "kg"
        ? "kilo"
        : "gramo"
      : shortRecipeUnitLabel(measured);

  return `Walang awtomatikong conversion mula ${countableLabel} papuntang ${measuredLabel}. Gamitin ang Package breakdown o Custom conversion.`;
}

export function unitsShareConversionFamily(
  leftUnit: string,
  rightUnit: string,
): boolean {
  const left = recipeUnitDimension(leftUnit);
  const right = recipeUnitDimension(rightUnit);
  if (!left || !right) return false;
  if (left === right) return true;
  return (
    isMeasuredRecipeUnitDimension(left) ===
      isMeasuredRecipeUnitDimension(right) &&
    isCountableRecipeUnitDimension(left) ===
      isCountableRecipeUnitDimension(right)
  );
}

export type { PracticalRecipeUnit, RecipeUnitDimension };
