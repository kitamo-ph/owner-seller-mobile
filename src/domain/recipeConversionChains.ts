export const PRACTICAL_RECIPE_UNITS = [
  "g",
  "kg",
  "ml",
  "l",
  "pcs",
  "pack",
  "portion",
  "serving",
  "metric_cup",
  "us_cup",
  "custom_cup",
  "tbsp",
  "tsp",
  "us_gallon",
  "imperial_gallon",
] as const;

export type PracticalRecipeUnit = (typeof PRACTICAL_RECIPE_UNITS)[number];

export type RecipeUnitStandard =
  | "metric"
  | "us_customary"
  | "imperial"
  | "business_custom"
  | "item_specific"
  | "package_breakdown";

const RECIPE_UNIT_STANDARDS: ReadonlySet<string> = new Set<RecipeUnitStandard>([
  "metric",
  "us_customary",
  "imperial",
  "business_custom",
  "item_specific",
  "package_breakdown",
]);

type UnitDefinition = {
  label: string;
  dimension: "mass" | "volume" | "count" | "package" | "portion";
  baseFactor: number | null;
  standard: RecipeUnitStandard;
};

const UNIT_DEFINITIONS: Readonly<Record<PracticalRecipeUnit, UnitDefinition>> = {
  g: { label: "gram", dimension: "mass", baseFactor: 1, standard: "metric" },
  kg: { label: "kilogram", dimension: "mass", baseFactor: 1_000, standard: "metric" },
  ml: { label: "milliliter", dimension: "volume", baseFactor: 1, standard: "metric" },
  l: { label: "liter", dimension: "volume", baseFactor: 1_000, standard: "metric" },
  pcs: { label: "piece", dimension: "count", baseFactor: 1, standard: "item_specific" },
  pack: { label: "pack", dimension: "package", baseFactor: 1, standard: "package_breakdown" },
  portion: { label: "portion", dimension: "portion", baseFactor: 1, standard: "item_specific" },
  serving: { label: "serving", dimension: "portion", baseFactor: 1, standard: "item_specific" },
  metric_cup: { label: "Metric cup (250 mL)", dimension: "volume", baseFactor: 250, standard: "metric" },
  us_cup: { label: "US cup (approximately 236.588 mL)", dimension: "volume", baseFactor: 236.5882365, standard: "us_customary" },
  custom_cup: { label: "Custom business cup", dimension: "volume", baseFactor: null, standard: "business_custom" },
  tbsp: { label: "tablespoon (15 mL)", dimension: "volume", baseFactor: 15, standard: "metric" },
  tsp: { label: "teaspoon (5 mL)", dimension: "volume", baseFactor: 5, standard: "metric" },
  us_gallon: { label: "US gallon", dimension: "volume", baseFactor: 3_785.411784, standard: "us_customary" },
  imperial_gallon: { label: "Imperial gallon", dimension: "volume", baseFactor: 4_546.09, standard: "imperial" },
};

const UNIT_ALIASES: Readonly<Record<string, PracticalRecipeUnit>> = {
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  pc: "pcs",
  pcs: "pcs",
  piece: "pcs",
  pieces: "pcs",
  pack: "pack",
  packs: "pack",
  portion: "portion",
  portions: "portion",
  serving: "serving",
  servings: "serving",
  metric_cup: "metric_cup",
  metriccup: "metric_cup",
  us_cup: "us_cup",
  uscup: "us_cup",
  custom_cup: "custom_cup",
  business_cup: "custom_cup",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  us_gallon: "us_gallon",
  usgallon: "us_gallon",
  imperial_gallon: "imperial_gallon",
  imperialgallon: "imperial_gallon",
};

export function normalizePracticalRecipeUnit(
  value: string,
): PracticalRecipeUnit | null {
  return UNIT_ALIASES[value.trim().toLocaleLowerCase().replace(/[ -]+/g, "_")] ?? null;
}

export function recipeUnitLabel(unit: PracticalRecipeUnit): string {
  return UNIT_DEFINITIONS[unit].label;
}

export function recipeUnitStandard(unit: PracticalRecipeUnit): RecipeUnitStandard {
  return UNIT_DEFINITIONS[unit].standard;
}

export function standardRecipeUnitFactor(
  fromUnitInput: string,
  toUnitInput: string,
): number | null {
  const fromUnit = normalizePracticalRecipeUnit(fromUnitInput);
  const toUnit = normalizePracticalRecipeUnit(toUnitInput);
  if (!fromUnit || !toUnit) return null;
  if (fromUnit === toUnit) return 1;
  const from = UNIT_DEFINITIONS[fromUnit];
  const to = UNIT_DEFINITIONS[toUnit];
  if (
    from.dimension !== to.dimension ||
    from.baseFactor === null ||
    to.baseFactor === null
  ) {
    return null;
  }
  return from.baseFactor / to.baseFactor;
}

export type RecipeConversionStep = {
  fromQuantity: number;
  fromUnit: string;
  toQuantity: number;
  toUnit: string;
  standard: RecipeUnitStandard;
  meaning: string;
};

export type RecipeConversionChainSnapshot = {
  version: 1;
  steps: RecipeConversionStep[];
  inputUnit: string;
  outputUnit: string;
  outputQuantityPerInputUnit: number;
  costFactorFromOutputToInput: number;
  unitStandardSummary: string;
};

export type RecipeConversionChainResult =
  | { ok: true; snapshot: RecipeConversionChainSnapshot }
  | {
      ok: false;
      reason:
        | "empty_chain"
        | "too_many_steps"
        | "invalid_quantity"
        | "missing_unit"
        | "disconnected_chain"
        | "circular_conversion"
        | "contradictory_path";
      stepIndex: number | null;
    };

function approximatelyEqual(left: number, right: number) {
  return (
    Math.abs(left - right) <=
    1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function unitKey(value: string) {
  return normalizePracticalRecipeUnit(value) ?? value.trim().toLocaleLowerCase();
}

export function buildRecipeConversionChain(
  steps: readonly RecipeConversionStep[],
): RecipeConversionChainResult {
  if (steps.length === 0) {
    return { ok: false, reason: "empty_chain", stepIndex: null };
  }
  if (steps.length > 8) {
    return { ok: false, reason: "too_many_steps", stepIndex: null };
  }

  let outputPerInput = 1;
  const visited = new Set<string>();
  const edgeFactors = new Map<string, number>();
  let priorOutputUnit: string | null = null;

  for (const [index, step] of steps.entries()) {
    if (
      !Number.isFinite(step.fromQuantity) ||
      step.fromQuantity <= 0 ||
      !Number.isFinite(step.toQuantity) ||
      step.toQuantity <= 0
    ) {
      return { ok: false, reason: "invalid_quantity", stepIndex: index };
    }
    if (!step.fromUnit.trim() || !step.toUnit.trim() || !step.meaning.trim()) {
      return { ok: false, reason: "missing_unit", stepIndex: index };
    }
    if (!RECIPE_UNIT_STANDARDS.has(step.standard)) {
      return { ok: false, reason: "contradictory_path", stepIndex: index };
    }
    const from = unitKey(step.fromUnit);
    const to = unitKey(step.toUnit);
    if (priorOutputUnit !== null && from !== priorOutputUnit) {
      return { ok: false, reason: "disconnected_chain", stepIndex: index };
    }
    if (index === 0) visited.add(from);
    if (visited.has(to)) {
      return { ok: false, reason: "circular_conversion", stepIndex: index };
    }

    const factor = step.toQuantity / step.fromQuantity;
    const edgeKey = `${from}->${to}`;
    const priorFactor = edgeFactors.get(edgeKey);
    if (priorFactor !== undefined && !approximatelyEqual(priorFactor, factor)) {
      return { ok: false, reason: "contradictory_path", stepIndex: index };
    }
    edgeFactors.set(edgeKey, factor);

    const standardFactor = standardRecipeUnitFactor(step.fromUnit, step.toUnit);
    if (
      standardFactor !== null &&
      !approximatelyEqual(standardFactor, factor)
    ) {
      return { ok: false, reason: "contradictory_path", stepIndex: index };
    }

    visited.add(to);
    priorOutputUnit = to;
    outputPerInput *= factor;
  }

  if (!Number.isFinite(outputPerInput) || outputPerInput <= 0) {
    return { ok: false, reason: "invalid_quantity", stepIndex: null };
  }

  const normalizedSteps = steps.map((step) => ({
    ...step,
    fromUnit: step.fromUnit.trim(),
    toUnit: step.toUnit.trim(),
    meaning: step.meaning.trim(),
  }));
  return {
    ok: true,
    snapshot: {
      version: 1,
      steps: normalizedSteps,
      inputUnit: normalizedSteps[0].fromUnit,
      outputUnit: normalizedSteps[normalizedSteps.length - 1].toUnit,
      outputQuantityPerInputUnit: outputPerInput,
      costFactorFromOutputToInput: 1 / outputPerInput,
      unitStandardSummary: [
        ...new Set(normalizedSteps.map((step) => step.standard)),
      ].join(", "),
    },
  };
}

export function serializeRecipeConversionChain(
  snapshot: RecipeConversionChainSnapshot,
): string {
  const validated = buildRecipeConversionChain(snapshot.steps);
  if (!validated.ok) {
    throw new Error(`Invalid Recipe conversion chain: ${validated.reason}.`);
  }
  if (
    !approximatelyEqual(
      validated.snapshot.outputQuantityPerInputUnit,
      snapshot.outputQuantityPerInputUnit,
    ) ||
    !approximatelyEqual(
      validated.snapshot.costFactorFromOutputToInput,
      snapshot.costFactorFromOutputToInput,
    )
  ) {
    throw new Error("Recipe conversion snapshot factor is inconsistent.");
  }
  return JSON.stringify(validated.snapshot);
}

export function parseRecipeConversionChain(
  value: string | null | undefined,
): RecipeConversionChainSnapshot | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<RecipeConversionChainSnapshot>;
    if (parsed.version !== 1 || !Array.isArray(parsed.steps)) return null;
    const validated = buildRecipeConversionChain(
      parsed.steps as RecipeConversionStep[],
    );
    if (!validated.ok) return null;
    if (
      !Number.isFinite(parsed.outputQuantityPerInputUnit) ||
      !Number.isFinite(parsed.costFactorFromOutputToInput) ||
      parsed.inputUnit?.trim() !== validated.snapshot.inputUnit ||
      parsed.outputUnit?.trim() !== validated.snapshot.outputUnit ||
      parsed.unitStandardSummary?.trim() !==
        validated.snapshot.unitStandardSummary ||
      !approximatelyEqual(
        validated.snapshot.outputQuantityPerInputUnit,
        parsed.outputQuantityPerInputUnit as number,
      ) ||
      !approximatelyEqual(
        validated.snapshot.costFactorFromOutputToInput,
        parsed.costFactorFromOutputToInput as number,
      )
    ) {
      return null;
    }
    return validated.snapshot;
  } catch {
    return null;
  }
}

export type RecipeConversionSnapshotEvidenceValidation =
  | { ok: true; snapshot: RecipeConversionChainSnapshot }
  | {
      ok: false;
      reason:
        | "invalid_snapshot"
        | "unit_standard_mismatch"
        | "input_unit_mismatch"
        | "output_unit_mismatch"
        | "factor_mismatch";
    };

/**
 * Validates a persisted conversion snapshot against the evidence it explains.
 *
 * Conversion direction is always one entered/usage unit to the resolved
 * normalized/evidence unit. Callers may omit an expected output or factor only
 * while they are still resolving the exact persisted source inside a
 * transaction; the repository must call this helper again with that evidence
 * before accepting the write.
 */
export function validateRecipeConversionSnapshotEvidence(input: {
  conversionChainJson: string;
  unitStandardSnapshot: string | null | undefined;
  expectedInputUnit: string;
  expectedOutputUnit?: string | null;
  expectedOutputQuantityPerInputUnit?: number | null;
}): RecipeConversionSnapshotEvidenceValidation {
  const snapshot = parseRecipeConversionChain(input.conversionChainJson);
  if (!snapshot) return { ok: false, reason: "invalid_snapshot" };
  if (
    input.unitStandardSnapshot?.trim() !== snapshot.unitStandardSummary
  ) {
    return { ok: false, reason: "unit_standard_mismatch" };
  }
  if (unitKey(input.expectedInputUnit) !== unitKey(snapshot.inputUnit)) {
    return { ok: false, reason: "input_unit_mismatch" };
  }
  if (
    input.expectedOutputUnit !== null &&
    input.expectedOutputUnit !== undefined &&
    unitKey(input.expectedOutputUnit) !== unitKey(snapshot.outputUnit)
  ) {
    return { ok: false, reason: "output_unit_mismatch" };
  }
  if (
    input.expectedOutputQuantityPerInputUnit !== null &&
    input.expectedOutputQuantityPerInputUnit !== undefined &&
    (!Number.isFinite(input.expectedOutputQuantityPerInputUnit) ||
      !approximatelyEqual(
        input.expectedOutputQuantityPerInputUnit,
        snapshot.outputQuantityPerInputUnit,
      ))
  ) {
    return { ok: false, reason: "factor_mismatch" };
  }
  return { ok: true, snapshot };
}

export function packageBreakdownConversion(input: {
  packagesPurchased: number;
  piecesPerPackage: number;
  portionsPerPiece: number;
}): RecipeConversionChainResult {
  return buildRecipeConversionChain([
    {
      fromQuantity: input.packagesPurchased,
      fromUnit: "pack",
      toQuantity: input.packagesPurchased * input.piecesPerPackage,
      toUnit: "pcs",
      standard: "package_breakdown",
      meaning: `${input.piecesPerPackage} pieces per package`,
    },
    {
      fromQuantity: 1,
      fromUnit: "pcs",
      toQuantity: input.portionsPerPiece,
      toUnit: "portion",
      standard: "item_specific",
      meaning: `${input.portionsPerPiece} portions per piece`,
    },
  ]);
}

export function calculateConversionChainUsageCost(input: {
  totalCost: number;
  referenceQuantity: number;
  usageQuantity: number;
  chain: RecipeConversionChainSnapshot;
}): number | null {
  if (
    !Number.isFinite(input.totalCost) ||
    input.totalCost < 0 ||
    !Number.isFinite(input.referenceQuantity) ||
    input.referenceQuantity <= 0 ||
    !Number.isFinite(input.usageQuantity) ||
    input.usageQuantity < 0
  ) {
    return null;
  }
  const availableOutput =
    input.referenceQuantity * input.chain.outputQuantityPerInputUnit;
  return availableOutput > 0
    ? (input.totalCost / availableOutput) * input.usageQuantity
    : null;
}
