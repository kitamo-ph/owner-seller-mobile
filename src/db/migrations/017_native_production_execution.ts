export const nativeProductionExecutionMigration = {
  id: "017_native_production_execution",
  up: `
    -- One non-deleted production batch may claim a plan stage. This is the
    -- idempotency key for the first native Recipe production executor.
    CREATE UNIQUE INDEX idx_production_batches_plan_stage_unique
      ON production_batches(production_plan_stage_id)
      WHERE production_plan_stage_id IS NOT NULL
        AND deleted_at IS NULL;
  `,
};
