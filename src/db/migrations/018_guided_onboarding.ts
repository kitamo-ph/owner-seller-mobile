export const guidedOnboardingMigration = {
  id: "018_guided_onboarding",
  up: `
    -- Structured location evidence is append-only. Existing barangay/location
    -- values remain untouched and are interpreted as typed legacy fallbacks.
    ALTER TABLE businesses ADD COLUMN location_ref_json TEXT;
    ALTER TABLE businesses ADD COLUMN business_type_custom TEXT;

    ALTER TABLE branches ADD COLUMN location_ref_json TEXT;
    ALTER TABLE branches ADD COLUMN inherits_business_location INTEGER NOT NULL DEFAULT 0
      CHECK (inherits_business_location IN (0, 1));
  `,
} as const;
