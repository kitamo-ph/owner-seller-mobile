/**
 * Pure, persistence-agnostic recipe graph validation and expansion.
 *
 * Published edges always point to an exact child version. Authoring safety is
 * stricter than an exact-version DAG: the reachable graph must also be acyclic
 * after versions are collapsed by stable recipe family and output item.
 *
 * The module intentionally does not read SQLite or mutate inventory. Repository
 * and service adapters are responsible for loading one bounded graph snapshot.
 */

export const DEFAULT_RECIPE_GRAPH_LIMITS = Object.freeze({
  maxNodes: 500,
  maxEdges: 2_000,
  maxDepth: 64,
  maxProvenancePaths: 5_000,
});

export type RecipeGraphLimits = typeof DEFAULT_RECIPE_GRAPH_LIMITS;

export type RecipeGraphVersionStatus = "published" | "superseded" | "archived";

export type RecipeInputRole =
  | "main"
  | "supporting"
  | "seasoning"
  | "garnish"
  | "packaging"
  | "optional"
  | "unset";

export type RecipeGraphCostState =
  | "known"
  | "unknown"
  | "legacy_zero_unresolved"
  | "not_applicable";

type RecipeGraphLineBase = {
  id: string;
  label: string;
  quantity: number;
  unit: string;
  canonicalQuantity?: number;
  canonicalUnit?: string;
  role?: RecipeInputRole;
  optional?: boolean;
};

export type RecipeGraphCatalogLine = RecipeGraphLineBase & {
  sourceKind: "catalog_item";
  itemId: string;
  stockScope?: string;
  costState: RecipeGraphCostState;
  authoritativeUnitCost?: number | null;
};

export type RecipeGraphCustomCostLine = RecipeGraphLineBase & {
  sourceKind: "custom_cost";
  /**
   * Legacy/custom recipe overrides are totals for one configured recipe batch.
   * Native callers may opt into a true per-unit custom cost explicitly.
   */
  costBasis?: "per_recipe_line" | "per_unit";
  costState: RecipeGraphCostState;
  authoritativeUnitCost?: number | null;
};

export type RecipeGraphChildLine = RecipeGraphLineBase & {
  sourceKind: "child_recipe_version";
  childVersionId: string;
};

export type RecipeGraphLine =
  | RecipeGraphCatalogLine
  | RecipeGraphCustomCostLine
  | RecipeGraphChildLine;

export type RecipeGraphVersion = {
  id: string;
  familyId: string;
  outputItemId: string;
  label: string;
  businessId?: string;
  expectedOutputQuantity: number;
  outputUnit: string;
  status: RecipeGraphVersionStatus;
  lines: readonly RecipeGraphLine[];
};

export type RecipeGraphPurpose = "authoring" | "historical";

export type RecipeGraphErrorCode =
  | "duplicate_version_id"
  | "root_version_missing"
  | "invalid_expected_output"
  | "duplicate_line_id"
  | "invalid_line_quantity"
  | "missing_catalog_item"
  | "missing_child_version"
  | "archived_dependency"
  | "cross_business_dependency"
  | "incompatible_child_unit"
  | "missing_conversion_snapshot"
  | "invalid_cost"
  | "exact_version_cycle"
  | "recipe_family_cycle"
  | "output_item_cycle"
  | "node_limit_exceeded"
  | "edge_limit_exceeded"
  | "depth_limit_exceeded"
  | "provenance_limit_exceeded";

export type RecipeGraphError = {
  code: RecipeGraphErrorCode;
  message: string;
  rootVersionId: string;
  offendingVersionId?: string;
  offendingLineId?: string;
  path: readonly string[];
  configuredLimit?: number;
};

export type RecipeGraphValidationSuccess = {
  ok: true;
  rootVersionId: string;
  reachableVersionIds: readonly string[];
  preparationOrder: readonly string[];
  nodeCount: number;
  edgeCount: number;
  maximumDepth: number;
};

export type RecipeGraphValidationResult =
  | RecipeGraphValidationSuccess
  | { ok: false; error: RecipeGraphError };

export type ValidateRecipeGraphOptions = {
  purpose?: RecipeGraphPurpose;
  limits?: Partial<RecipeGraphLimits>;
};

export type RecipeLeafProvenance = {
  path: readonly string[];
  quantity: number;
  unit: string;
  expectedCost: number | null;
};

export type AggregatedRecipeLeaf = {
  key: string;
  itemId: string | null;
  label: string;
  stockScope: string;
  quantity: number;
  unit: string;
  costComplete: boolean;
  knownCostSubtotal: number;
  expectedCost: number | null;
  provenance: readonly RecipeLeafProvenance[];
};

export type RecipeExpansionSuccess = {
  ok: true;
  rootVersionId: string;
  targetQuantity: number;
  targetUnit: string;
  preparationOrder: readonly string[];
  requirements: readonly AggregatedRecipeLeaf[];
  costComplete: boolean;
  expectedCost: number | null;
  knownCostSubtotal: number;
  missingCostCount: number;
};

export type RecipeExpansionResult =
  | RecipeExpansionSuccess
  | { ok: false; error: RecipeGraphError };

type ExactEdge = {
  parentVersionId: string;
  childVersionId: string;
  lineId: string;
  parentLabel: string;
  childLabel: string;
};

type TraversalFrame = {
  versionId: string;
  nextChildIndex: number;
  childLines: readonly RecipeGraphChildLine[];
};

type SemanticEdge = {
  parentKey: string;
  childKey: string;
  parentVersionLabel: string;
  childVersionLabel: string;
};

type SemanticFrame = {
  key: string;
  nextEdgeIndex: number;
  incomingEdge: SemanticEdge | null;
};

type UnitLeafContribution = {
  key: string;
  itemId: string | null;
  label: string;
  stockScope: string;
  quantityPerOutputUnit: number;
  unit: string;
  costState: RecipeGraphCostState;
  expectedCostPerOutputUnit: number | null;
  path: readonly string[];
};

const isPositiveFinite = (value: number) => Number.isFinite(value) && value > 0;

function limitsWithDefaults(overrides?: Partial<RecipeGraphLimits>): RecipeGraphLimits {
  return {
    maxNodes: overrides?.maxNodes ?? DEFAULT_RECIPE_GRAPH_LIMITS.maxNodes,
    maxEdges: overrides?.maxEdges ?? DEFAULT_RECIPE_GRAPH_LIMITS.maxEdges,
    maxDepth: overrides?.maxDepth ?? DEFAULT_RECIPE_GRAPH_LIMITS.maxDepth,
    maxProvenancePaths:
      overrides?.maxProvenancePaths ?? DEFAULT_RECIPE_GRAPH_LIMITS.maxProvenancePaths,
  };
}

function error(
  code: RecipeGraphErrorCode,
  rootVersionId: string,
  message: string,
  details: Partial<Omit<RecipeGraphError, "code" | "rootVersionId" | "message">> = {},
): { ok: false; error: RecipeGraphError } {
  return {
    ok: false,
    error: {
      code,
      rootVersionId,
      message,
      path: details.path ?? [],
      ...details,
    },
  };
}

function indexVersions(
  versions: readonly RecipeGraphVersion[],
  rootVersionId: string,
):
  | { ok: true; versionsById: Map<string, RecipeGraphVersion> }
  | {
      ok: false;
      result: { ok: false; error: RecipeGraphError };
    } {
  const versionsById = new Map<string, RecipeGraphVersion>();

  for (const version of versions) {
    if (versionsById.has(version.id)) {
      return {
        ok: false,
        result: error(
          "duplicate_version_id",
          rootVersionId,
          `Recipe version ${version.id} was loaded more than once.`,
          { offendingVersionId: version.id, path: [version.label] },
        ),
      };
    }
    versionsById.set(version.id, version);
  }

  if (!versionsById.has(rootVersionId)) {
    return {
      ok: false,
      result: error(
        "root_version_missing",
        rootVersionId,
        `Root recipe version ${rootVersionId} is unavailable.`,
      ),
    };
  }

  return { ok: true, versionsById };
}

function validateVersionShape(
  rootVersionId: string,
  version: RecipeGraphVersion,
): RecipeGraphValidationResult | null {
  if (!isPositiveFinite(version.expectedOutputQuantity) || !version.outputUnit.trim()) {
    return error(
      "invalid_expected_output",
      rootVersionId,
      `${version.label} has an invalid expected output.`,
      { offendingVersionId: version.id, path: [version.label] },
    );
  }

  const lineIds = new Set<string>();
  for (const line of version.lines) {
    if (lineIds.has(line.id)) {
      return error(
        "duplicate_line_id",
        rootVersionId,
        `${version.label} contains duplicate input line ${line.id}.`,
        {
          offendingVersionId: version.id,
          offendingLineId: line.id,
          path: [version.label, line.label],
        },
      );
    }
    lineIds.add(line.id);

    if (!isPositiveFinite(line.quantity) || !line.unit.trim()) {
      return error(
        "invalid_line_quantity",
        rootVersionId,
        `${line.label} has an invalid quantity or unit.`,
        {
          offendingVersionId: version.id,
          offendingLineId: line.id,
          path: [version.label, line.label],
        },
      );
    }

    if (line.sourceKind === "catalog_item" && !line.itemId.trim()) {
      return error(
        "missing_catalog_item",
        rootVersionId,
        `${line.label} has no catalog item.`,
        {
          offendingVersionId: version.id,
          offendingLineId: line.id,
          path: [version.label, line.label],
        },
      );
    }

    if (
      line.canonicalUnit &&
      line.canonicalUnit !== line.unit &&
      !isPositiveFinite(line.canonicalQuantity ?? Number.NaN)
    ) {
      return error(
        "missing_conversion_snapshot",
        rootVersionId,
        `${line.label} changes units without a positive conversion snapshot.`,
        {
          offendingVersionId: version.id,
          offendingLineId: line.id,
          path: [version.label, line.label],
        },
      );
    }

    if (
      line.sourceKind !== "child_recipe_version" &&
      line.costState === "known" &&
      (!Number.isFinite(line.authoritativeUnitCost ?? Number.NaN) ||
        (line.authoritativeUnitCost as number) < 0)
    ) {
      return error(
        "invalid_cost",
        rootVersionId,
        `${line.label} is marked with a known cost but has no valid cost value.`,
        {
          offendingVersionId: version.id,
          offendingLineId: line.id,
          path: [version.label, line.label],
        },
      );
    }
  }

  return null;
}

function exactCyclePath(
  stack: readonly TraversalFrame[],
  childVersionId: string,
  versionsById: ReadonlyMap<string, RecipeGraphVersion>,
): readonly string[] {
  const index = stack.findIndex((frame) => frame.versionId === childVersionId);
  const cycle = index >= 0 ? stack.slice(index) : stack;
  return [
    ...cycle.map((frame) => versionsById.get(frame.versionId)?.label ?? frame.versionId),
    versionsById.get(childVersionId)?.label ?? childVersionId,
  ];
}

function findSemanticCycle(
  edges: readonly SemanticEdge[],
): { path: readonly string[]; offendingKey: string } | null {
  const adjacency = new Map<string, SemanticEdge[]>();
  const allKeys = new Set<string>();

  for (const edge of edges) {
    allKeys.add(edge.parentKey);
    allKeys.add(edge.childKey);
    const current = adjacency.get(edge.parentKey);
    if (current) current.push(edge);
    else adjacency.set(edge.parentKey, [edge]);
  }

  const color = new Map<string, 0 | 1 | 2>();

  for (const start of allKeys) {
    if ((color.get(start) ?? 0) !== 0) continue;

    const stack: SemanticFrame[] = [{ key: start, nextEdgeIndex: 0, incomingEdge: null }];
    const activeIndex = new Map<string, number>([[start, 0]]);
    color.set(start, 1);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const outgoing = adjacency.get(frame.key) ?? [];

      if (frame.nextEdgeIndex >= outgoing.length) {
        color.set(frame.key, 2);
        activeIndex.delete(frame.key);
        stack.pop();
        continue;
      }

      const edge = outgoing[frame.nextEdgeIndex];
      frame.nextEdgeIndex += 1;
      const childColor = color.get(edge.childKey) ?? 0;

      if (childColor === 1) {
        const cycleStart = activeIndex.get(edge.childKey) ?? 0;
        const cycleEdges = stack
          .slice(cycleStart + 1)
          .map((item) => item.incomingEdge)
          .filter((item): item is SemanticEdge => item !== null);
        cycleEdges.push(edge);

        return {
          offendingKey: edge.childKey,
          path:
            cycleEdges.length === 0
              ? [edge.parentVersionLabel, edge.childVersionLabel]
              : [
                  cycleEdges[0].parentVersionLabel,
                  ...cycleEdges.map((item) => item.childVersionLabel),
                ],
        };
      }

      if (childColor === 0) {
        color.set(edge.childKey, 1);
        activeIndex.set(edge.childKey, stack.length);
        stack.push({ key: edge.childKey, nextEdgeIndex: 0, incomingEdge: edge });
      }
    }
  }

  return null;
}

/**
 * Validates the exact reachable graph and the stricter stable-identity graphs.
 * Traversal is iterative and fails instead of truncating when a limit is hit.
 */
export function validateRecipeGraph(
  versions: readonly RecipeGraphVersion[],
  rootVersionId: string,
  options: ValidateRecipeGraphOptions = {},
): RecipeGraphValidationResult {
  const indexed = indexVersions(versions, rootVersionId);
  if (!indexed.ok) return indexed.result;

  const versionsById = indexed.versionsById;
  const limits = limitsWithDefaults(options.limits);
  const purpose = options.purpose ?? "authoring";
  const root = versionsById.get(rootVersionId) as RecipeGraphVersion;
  const rootShapeError = validateVersionShape(rootVersionId, root);
  if (rootShapeError) return rootShapeError;

  const rootChildren = root.lines.filter(
    (line): line is RecipeGraphChildLine => line.sourceKind === "child_recipe_version",
  );
  const stack: TraversalFrame[] = [
    { versionId: rootVersionId, nextChildIndex: 0, childLines: rootChildren },
  ];
  const color = new Map<string, 0 | 1 | 2>([[rootVersionId, 1]]);
  const reachable = new Set<string>([rootVersionId]);
  const exactEdges: ExactEdge[] = [];
  const preparationOrder: string[] = [];
  let maximumDepth = 1;
  let edgeCount = 0;

  if (limits.maxNodes < 1) {
    return error(
      "node_limit_exceeded",
      rootVersionId,
      `Recipe graph exceeds the configured ${limits.maxNodes}-node limit.`,
      { configuredLimit: limits.maxNodes, path: [root.label] },
    );
  }

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const version = versionsById.get(frame.versionId) as RecipeGraphVersion;

    if (frame.nextChildIndex >= frame.childLines.length) {
      color.set(frame.versionId, 2);
      preparationOrder.push(frame.versionId);
      stack.pop();
      continue;
    }

    const line = frame.childLines[frame.nextChildIndex];
    frame.nextChildIndex += 1;
    edgeCount += 1;

    if (edgeCount > limits.maxEdges) {
      return error(
        "edge_limit_exceeded",
        rootVersionId,
        `Recipe graph exceeds the configured ${limits.maxEdges}-edge limit.`,
        {
          offendingVersionId: version.id,
          offendingLineId: line.id,
          configuredLimit: limits.maxEdges,
          path: [...stack.map((item) => versionsById.get(item.versionId)?.label ?? item.versionId)],
        },
      );
    }

    const child = versionsById.get(line.childVersionId);
    if (!child) {
      return error(
        "missing_child_version",
        rootVersionId,
        `${line.label} references unavailable recipe version ${line.childVersionId}.`,
        {
          offendingVersionId: version.id,
          offendingLineId: line.id,
          path: [
            ...stack.map((item) => versionsById.get(item.versionId)?.label ?? item.versionId),
            line.label,
          ],
        },
      );
    }

    if (
      version.businessId &&
      child.businessId &&
      version.businessId !== child.businessId
    ) {
      return error(
        "cross_business_dependency",
        rootVersionId,
        `${version.label} and ${child.label} belong to different businesses.`,
        {
          offendingVersionId: child.id,
          offendingLineId: line.id,
          path: [...stack.map((item) => versionsById.get(item.versionId)?.label ?? item.versionId), child.label],
        },
      );
    }

    const childUsageUnit = line.canonicalUnit ?? line.unit;
    if (childUsageUnit !== child.outputUnit) {
      return error(
        "incompatible_child_unit",
        rootVersionId,
        `${line.label} requires ${childUsageUnit}, but ${child.label} outputs ${child.outputUnit}.`,
        {
          offendingVersionId: child.id,
          offendingLineId: line.id,
          path: [...stack.map((item) => versionsById.get(item.versionId)?.label ?? item.versionId), child.label],
        },
      );
    }

    if (purpose === "authoring" && child.status === "archived" && !line.optional) {
      return error(
        "archived_dependency",
        rootVersionId,
        `${child.label} is archived and cannot be selected by a new published version.`,
        {
          offendingVersionId: child.id,
          offendingLineId: line.id,
          path: [...stack.map((item) => versionsById.get(item.versionId)?.label ?? item.versionId), child.label],
        },
      );
    }

    exactEdges.push({
      parentVersionId: version.id,
      childVersionId: child.id,
      lineId: line.id,
      parentLabel: version.label,
      childLabel: child.label,
    });

    const childColor = color.get(child.id) ?? 0;
    if (childColor === 1) {
      return error(
        "exact_version_cycle",
        rootVersionId,
        "The recipe graph contains an exact-version cycle.",
        {
          offendingVersionId: child.id,
          offendingLineId: line.id,
          path: exactCyclePath(stack, child.id, versionsById),
        },
      );
    }

    if (childColor === 2) continue;

    const shapeError = validateVersionShape(rootVersionId, child);
    if (shapeError) return shapeError;

    if (!reachable.has(child.id)) {
      reachable.add(child.id);
      if (reachable.size > limits.maxNodes) {
        return error(
          "node_limit_exceeded",
          rootVersionId,
          `Recipe graph exceeds the configured ${limits.maxNodes}-node limit.`,
          {
            offendingVersionId: child.id,
            offendingLineId: line.id,
            configuredLimit: limits.maxNodes,
            path: [
              ...stack.map((item) => versionsById.get(item.versionId)?.label ?? item.versionId),
              child.label,
            ],
          },
        );
      }
    }

    const nextDepth = stack.length + 1;
    if (nextDepth > limits.maxDepth) {
      return error(
        "depth_limit_exceeded",
        rootVersionId,
        `Recipe graph exceeds the configured depth of ${limits.maxDepth}.`,
        {
          offendingVersionId: child.id,
          offendingLineId: line.id,
          configuredLimit: limits.maxDepth,
          path: [
            ...stack.map((item) => versionsById.get(item.versionId)?.label ?? item.versionId),
            child.label,
          ],
        },
      );
    }

    maximumDepth = Math.max(maximumDepth, nextDepth);
    color.set(child.id, 1);
    stack.push({
      versionId: child.id,
      nextChildIndex: 0,
      childLines: child.lines.filter(
        (candidate): candidate is RecipeGraphChildLine =>
          candidate.sourceKind === "child_recipe_version",
      ),
    });
  }

  const familyEdges: SemanticEdge[] = [];
  const outputEdges: SemanticEdge[] = [];
  for (const edge of exactEdges) {
    const parent = versionsById.get(edge.parentVersionId) as RecipeGraphVersion;
    const child = versionsById.get(edge.childVersionId) as RecipeGraphVersion;
    familyEdges.push({
      parentKey: parent.familyId,
      childKey: child.familyId,
      parentVersionLabel: edge.parentLabel,
      childVersionLabel: edge.childLabel,
    });
    outputEdges.push({
      parentKey: parent.outputItemId,
      childKey: child.outputItemId,
      parentVersionLabel: edge.parentLabel,
      childVersionLabel: edge.childLabel,
    });
  }

  const familyCycle = findSemanticCycle(familyEdges);
  if (familyCycle) {
    return error(
      "recipe_family_cycle",
      rootVersionId,
      "The recipe graph returns to the same stable recipe family.",
      { path: familyCycle.path },
    );
  }

  const outputCycle = findSemanticCycle(outputEdges);
  if (outputCycle) {
    return error(
      "output_item_cycle",
      rootVersionId,
      "The recipe graph returns to the same output item.",
      { path: outputCycle.path },
    );
  }

  return {
    ok: true,
    rootVersionId,
    reachableVersionIds: [...reachable],
    preparationOrder,
    nodeCount: reachable.size,
    edgeCount,
    maximumDepth,
  };
}

export function normalizeRecipeGraphLeafLine(
  line: RecipeGraphCatalogLine | RecipeGraphCustomCostLine,
): { quantity: number; unit: string } {
  return {
    quantity: line.canonicalQuantity ?? line.quantity,
    unit: line.canonicalUnit ?? line.unit,
  };
}

function expansionError(
  rootVersionId: string,
  code: RecipeGraphErrorCode,
  message: string,
  details: Partial<Omit<RecipeGraphError, "code" | "rootVersionId" | "message">> = {},
): RecipeExpansionResult {
  return error(code, rootVersionId, message, details);
}

/**
 * Expands the exact pinned graph and aggregates repeated leaves. Memoized
 * per-output expansions avoid recomputing a shared child while preserving one
 * provenance contribution for every real parent edge.
 */
export function expandRecipeLeaves(
  versions: readonly RecipeGraphVersion[],
  rootVersionId: string,
  targetQuantity: number,
  options: ValidateRecipeGraphOptions = {},
): RecipeExpansionResult {
  const validation = validateRecipeGraph(versions, rootVersionId, options);
  if (!validation.ok) return validation;

  const indexed = indexVersions(versions, rootVersionId);
  if (!indexed.ok) return indexed.result;
  const versionsById = indexed.versionsById;
  const root = versionsById.get(rootVersionId) as RecipeGraphVersion;
  const limits = limitsWithDefaults(options.limits);

  if (!isPositiveFinite(targetQuantity)) {
    return expansionError(
      rootVersionId,
      "invalid_expected_output",
      "The requested output quantity must be positive.",
      { offendingVersionId: rootVersionId, path: [root.label] },
    );
  }

  const memo = new Map<string, readonly UnitLeafContribution[]>();

  for (const versionId of validation.preparationOrder) {
    const version = versionsById.get(versionId) as RecipeGraphVersion;
    const contributions: UnitLeafContribution[] = [];

    for (const line of version.lines) {
      if (line.sourceKind === "child_recipe_version") {
        const childContributions = memo.get(line.childVersionId) ?? [];
        const childScale =
          (line.canonicalQuantity ?? line.quantity) /
          version.expectedOutputQuantity;

        for (const childContribution of childContributions) {
          if (contributions.length >= limits.maxProvenancePaths) {
            return expansionError(
              rootVersionId,
              "provenance_limit_exceeded",
              `Recipe expansion exceeds the configured ${limits.maxProvenancePaths}-path limit.`,
              {
                offendingVersionId: version.id,
                offendingLineId: line.id,
                configuredLimit: limits.maxProvenancePaths,
                path: [version.label, ...childContribution.path],
              },
            );
          }

          contributions.push({
            ...childContribution,
            quantityPerOutputUnit:
              childContribution.quantityPerOutputUnit * childScale,
            expectedCostPerOutputUnit:
              childContribution.expectedCostPerOutputUnit === null
                ? null
                : childContribution.expectedCostPerOutputUnit * childScale,
            path: [version.label, ...childContribution.path],
          });
        }
        continue;
      }

      const normalized = normalizeRecipeGraphLeafLine(line);
      const itemId = line.sourceKind === "catalog_item" ? line.itemId : null;
      const stockScope =
        line.sourceKind === "catalog_item" ? line.stockScope ?? "default" : "custom_cost";
      const key =
        line.sourceKind === "catalog_item"
          ? `${line.itemId}\u0000${normalized.unit}\u0000${stockScope}`
          : `custom:${version.id}:${line.id}`;

      if (contributions.length >= limits.maxProvenancePaths) {
        return expansionError(
          rootVersionId,
          "provenance_limit_exceeded",
          `Recipe expansion exceeds the configured ${limits.maxProvenancePaths}-path limit.`,
          {
            offendingVersionId: version.id,
            offendingLineId: line.id,
            configuredLimit: limits.maxProvenancePaths,
            path: [version.label, line.label],
          },
        );
      }

      contributions.push({
        key,
        itemId,
        label: line.label,
        stockScope,
        quantityPerOutputUnit: normalized.quantity / version.expectedOutputQuantity,
        unit: normalized.unit,
        costState: line.costState,
        expectedCostPerOutputUnit:
          line.costState === "not_applicable"
            ? 0
            : line.costState !== "known" ||
                !Number.isFinite(line.authoritativeUnitCost ?? Number.NaN)
              ? null
              : line.sourceKind === "custom_cost" &&
                  (line.costBasis ?? "per_recipe_line") === "per_recipe_line"
                ? (line.authoritativeUnitCost as number) /
                  version.expectedOutputQuantity
                : (normalized.quantity / version.expectedOutputQuantity) *
                  (line.authoritativeUnitCost as number),
        path: [version.label, line.label],
      });
    }

    memo.set(versionId, contributions);
  }

  const aggregate = new Map<
    string,
    {
      itemId: string | null;
      label: string;
      stockScope: string;
      quantity: number;
      unit: string;
      costComplete: boolean;
      knownCostSubtotal: number;
      provenance: RecipeLeafProvenance[];
    }
  >();

  for (const contribution of memo.get(rootVersionId) ?? []) {
    const quantity = contribution.quantityPerOutputUnit * targetQuantity;
    const expectedCost =
      contribution.expectedCostPerOutputUnit === null
        ? null
        : contribution.expectedCostPerOutputUnit * targetQuantity;
    const costComplete = expectedCost !== null;
    const existing = aggregate.get(contribution.key);

    if (existing) {
      existing.quantity += quantity;
      existing.costComplete = existing.costComplete && costComplete;
      existing.knownCostSubtotal += expectedCost ?? 0;
      existing.provenance.push({
        path: contribution.path,
        quantity,
        unit: contribution.unit,
        expectedCost,
      });
    } else {
      aggregate.set(contribution.key, {
        itemId: contribution.itemId,
        label: contribution.label,
        stockScope: contribution.stockScope,
        quantity,
        unit: contribution.unit,
        costComplete,
        knownCostSubtotal: expectedCost ?? 0,
        provenance: [
          {
            path: contribution.path,
            quantity,
            unit: contribution.unit,
            expectedCost,
          },
        ],
      });
    }
  }

  const requirements: AggregatedRecipeLeaf[] = [...aggregate.entries()].map(
    ([key, item]) => ({
      key,
      itemId: item.itemId,
      label: item.label,
      stockScope: item.stockScope,
      quantity: item.quantity,
      unit: item.unit,
      costComplete: item.costComplete,
      knownCostSubtotal: item.knownCostSubtotal,
      expectedCost: item.costComplete ? item.knownCostSubtotal : null,
      provenance: item.provenance,
    }),
  );
  const costComplete = requirements.every((item) => item.costComplete);
  const knownCostSubtotal = requirements.reduce(
    (sum, item) => sum + item.knownCostSubtotal,
    0,
  );

  return {
    ok: true,
    rootVersionId,
    targetQuantity,
    targetUnit: root.outputUnit,
    preparationOrder: validation.preparationOrder,
    requirements,
    costComplete,
    expectedCost: costComplete ? knownCostSubtotal : null,
    knownCostSubtotal,
    missingCostCount: requirements.filter((item) => !item.costComplete).length,
  };
}
