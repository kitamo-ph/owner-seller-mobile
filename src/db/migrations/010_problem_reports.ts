export const problemReportsMigration = {
  id: "010_problem_reports",
  up: `
    CREATE TABLE IF NOT EXISTS problem_reports (
      id TEXT PRIMARY KEY NOT NULL,
      business_id TEXT,
      branch_id TEXT,
      mode TEXT NOT NULL CHECK (mode IN ('owner', 'kiosk')),
      category TEXT NOT NULL CHECK (category IN (
        'app_crashed',
        'app_slow',
        'button_not_working',
        'incorrect_information',
        'confusing_screen',
        'pin_problem',
        'other'
      )),
      description TEXT NOT NULL,
      user_action TEXT NOT NULL,
      expected_result TEXT NOT NULL,
      actual_result TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local', 'pending', 'synced', 'failed')),
      deleted_at TEXT,
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL,
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_problem_reports_business_id ON problem_reports(business_id);
    CREATE INDEX IF NOT EXISTS idx_problem_reports_branch_id ON problem_reports(branch_id);
    CREATE INDEX IF NOT EXISTS idx_problem_reports_status ON problem_reports(status);
    CREATE INDEX IF NOT EXISTS idx_problem_reports_created_at ON problem_reports(created_at DESC);
  `,
} as const;
