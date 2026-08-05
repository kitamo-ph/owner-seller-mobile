import {
  normalizePracticalRecipeUnit,
  standardRecipeUnitFactor,
} from "./recipeConversionChains";
import { shortRecipeUnitLabel } from "./recipeUnitPicker";

/**
 * Formats a quantity for owner-facing conversion copy.
 * Uses thousands separators and trims trailing zeros; never uses float equality.
 */
export function formatConversionQuantity(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(6));
  const abs = Math.abs(rounded);
  const fractionDigits =
    Number.isInteger(rounded) || abs >= 100
      ? 0
      : abs >= 1
        ? Math.min(4, decimalsNeeded(rounded))
        : Math.min(6, decimalsNeeded(rounded));
  return rounded.toLocaleString("en-PH", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  });
}

function decimalsNeeded(value: number): number {
  const text = value.toFixed(6).replace(/0+$/, "").split(".")[1] ?? "";
  return text.length;
}

export function formatConversionPeso(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(4));
  return `₱${rounded.toLocaleString("en-PH", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export type ConversionStepLike = {
  fromQuantity: number;
  fromUnit: string;
  toQuantity: number;
  toUnit: string;
};

/**
 * Renders one conversion step in the direction a person reads it.
 * Stored steps may be usage→reference (1 g = 0.001 kg); display flips those
 * to reference→usage (1 kg = 1,000 g) without changing persistence.
 */
export function formatConversionStepForDisplay(step: ConversionStepLike): string {
  const fromUnit = shortRecipeUnitLabel(step.fromUnit);
  const toUnit = shortRecipeUnitLabel(step.toUnit);
  const shouldFlip =
    step.fromQuantity > 0 &&
    step.toQuantity > 0 &&
    step.toQuantity < 1 &&
    Math.abs(step.fromQuantity - 1) <= 1e-9;

  if (shouldFlip) {
    const inverted = step.fromQuantity / step.toQuantity;
    return `1 ${toUnit} = ${formatConversionQuantity(inverted)} ${fromUnit}`;
  }

  return `${formatConversionQuantity(step.fromQuantity)} ${fromUnit} = ${formatConversionQuantity(step.toQuantity)} ${toUnit}`;
}

export function formatConversionChainSummary(
  steps: readonly ConversionStepLike[],
): string | null {
  if (steps.length === 0) return null;
  return steps.map(formatConversionStepForDisplay).join(" · ");
}

export function formatFactorSnapshotForDisplay(input: {
  usageUnit: string | null | undefined;
  normalizedUnit: string | null | undefined;
  conversionFactorSnapshot: number | null | undefined;
}): string | null {
  if (
    input.conversionFactorSnapshot === null ||
    input.conversionFactorSnapshot === undefined ||
    !Number.isFinite(input.conversionFactorSnapshot) ||
    !input.usageUnit?.trim() ||
    !input.normalizedUnit?.trim()
  ) {
    return null;
  }
  return formatConversionStepForDisplay({
    fromQuantity: 1,
    fromUnit: input.usageUnit,
    toQuantity: input.conversionFactorSnapshot,
    toUnit: input.normalizedUnit,
  });
}

export function parseConversionChainSteps(
  conversionChainJson: string | null | undefined,
): ConversionStepLike[] | null {
  if (!conversionChainJson?.trim()) return null;
  try {
    const parsed = JSON.parse(conversionChainJson) as {
      steps?: ConversionStepLike[];
    };
    if (!Array.isArray(parsed.steps)) return null;
    return parsed.steps;
  } catch {
    return null;
  }
}

export function presentStoredConversionSummary(input: {
  conversionChainJson?: string | null;
  usageUnit?: string | null;
  normalizedUnit?: string | null;
  conversionFactorSnapshot?: number | null;
}): string | null {
  const steps = parseConversionChainSteps(input.conversionChainJson);
  if (steps) {
    return formatConversionChainSummary(steps);
  }
  return formatFactorSnapshotForDisplay({
    usageUnit: input.usageUnit,
    normalizedUnit: input.normalizedUnit,
    conversionFactorSnapshot: input.conversionFactorSnapshot,
  });
}

/**
 * Live one-line derivation shown under reference/usage inputs before Add/Save.
 * Example: `1 kg = 1,000 g  ·  200 g bawat serving  ·  ₱0.08/g  ·  ₱16.00`
 */
export function buildMeasuredCostDerivationLine(input: {
  referenceQuantity: number;
  referenceUnit: string;
  usageQuantity: number;
  usageUnit: string;
  costPerUsageUnit: number | null;
  totalAmount: number | null;
}): string | null {
  if (
    !Number.isFinite(input.referenceQuantity) ||
    input.referenceQuantity <= 0 ||
    !Number.isFinite(input.usageQuantity) ||
    input.usageQuantity < 0
  ) {
    return null;
  }

  const referenceUnit = shortRecipeUnitLabel(input.referenceUnit);
  const usageUnit = shortRecipeUnitLabel(input.usageUnit);
  const sameUnit =
    normalizePracticalRecipeUnit(input.referenceUnit) !== null &&
    normalizePracticalRecipeUnit(input.referenceUnit) ===
      normalizePracticalRecipeUnit(input.usageUnit);

  const parts: string[] = [];
  if (sameUnit) {
    parts.push(
      `${formatConversionQuantity(input.referenceQuantity)} ${referenceUnit}`,
    );
  } else {
    const factor = standardRecipeUnitFactor(
      input.referenceUnit,
      input.usageUnit,
    );
    if (factor === null) return null;
    const convertedQuantity = input.referenceQuantity * factor;
    parts.push(
      `${formatConversionQuantity(input.referenceQuantity)} ${referenceUnit} = ${formatConversionQuantity(convertedQuantity)} ${usageUnit}`,
    );
  }

  parts.push(
    `${formatConversionQuantity(input.usageQuantity)} ${usageUnit} bawat serving`,
  );

  if (
    input.costPerUsageUnit !== null &&
    Number.isFinite(input.costPerUsageUnit)
  ) {
    parts.push(
      `${formatConversionPeso(input.costPerUsageUnit)}/${usageUnit}`,
    );
  }
  if (input.totalAmount !== null && Number.isFinite(input.totalAmount)) {
    parts.push(formatConversionPeso(input.totalAmount));
  }

  return parts.join("  ·  ");
}
