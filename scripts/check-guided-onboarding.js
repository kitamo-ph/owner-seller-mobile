const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const workspace = process.cwd();
const compiledDir = path.join(workspace, "node_modules/.cache/kitamo-guided-onboarding-check");

function compileContracts() {
  fs.rmSync(compiledDir, { recursive: true, force: true });
  execFileSync(
    path.join(workspace, "node_modules/.bin/tsc"),
    [
      path.join(workspace, "src/domain/onboarding.ts"),
      path.join(workspace, "src/db/migrations/018_guided_onboarding.ts"),
      "--rootDir",
      path.join(workspace, "src"),
      "--outDir",
      compiledDir,
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--strict",
      "--skipLibCheck",
      "--esModuleInterop",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function checkDomainContracts(onboarding) {
  const expectedTypes = [
    "Food / Restaurant",
    "Sari-sari Store",
    "Grocery / Mini Mart",
    "Hardware",
    "Retail",
    "Online Selling",
    "Beauty / Salon",
    "Services",
    "Repair Shop",
    "Pharmacy / Health",
    "Clothing / Fashion",
    "Other",
  ];
  assert.deepEqual([...onboarding.TURN6_BUSINESS_TYPES], expectedTypes, "Turn 6 categories must remain exact and ordered");
  assert.equal(new Set(onboarding.TURN6_BUSINESS_TYPES).size, 12, "Turn 6 categories must be unique");

  const emptyBusiness = onboarding.validateBusinessSetup({
    businessName: "",
    businessType: null,
    locationRef: null,
  });
  assert.equal(emptyBusiness.valid, false);
  assert.ok(emptyBusiness.errors.businessName, "business name must be required");
  assert.ok(emptyBusiness.errors.businessType, "business type must be required");
  assert.ok(emptyBusiness.errors.location, "business location must be required");

  const typedLocation = onboarding.createTypedLocationRef("  Brgy. San Isidro, Makati  ", {
    barangay: "San Isidro",
    cityMunicipality: "Makati",
  });
  assert.deepEqual(
    { lat: typedLocation.lat, lng: typedLocation.lng, source: typedLocation.source },
    { lat: null, lng: null, source: "typed" },
    "typed-only locations must not fabricate coordinates",
  );
  assert.equal(typedLocation.formattedAddress, "Brgy. San Isidro, Makati");
  assert.equal(
    onboarding.parseLocationRefJson(onboarding.serializeLocationRef(typedLocation))?.formattedAddress,
    typedLocation.formattedAddress,
    "LocationRef must round-trip",
  );
  assert.equal(
    onboarding.parseLocationRefJson("{invalid", "Legacy Barangay")?.formattedAddress,
    "Legacy Barangay",
    "invalid structured evidence must fall back to the legacy typed address",
  );
  assert.throws(
    () => onboarding.normalizeLocationRef({ ...typedLocation, lat: 14.5 }),
    /Latitude and longitude must be provided together/,
    "partial coordinates must be rejected",
  );

  assert.equal(onboarding.suggestBusinessType("Rovs Sushi"), "Food / Restaurant");
  assert.equal(onboarding.suggestBusinessType("Mila Hardware"), "Hardware");
  assert.equal(onboarding.suggestBusinessType("Unrelated Name"), null);
  assert.equal(onboarding.getBusinessTypeLabel("karinderia"), "Food / Restaurant");

  const missingOther = onboarding.validateBusinessSetup({
    businessName: "Rovs Specialty",
    businessType: "Other",
    businessTypeCustom: "",
    locationRef: typedLocation,
  });
  assert.ok(missingOther.errors.businessTypeCustom, "Other must require a custom type");
  assert.equal(
    onboarding.validateBusinessSetup({
      businessName: "Rovs Specialty",
      businessType: "Other",
      businessTypeCustom: "Mobile cart",
      locationRef: typedLocation,
    }).valid,
    true,
  );
  assert.equal(
    onboarding.validateBusinessSetup({
      businessName: "Rovs Sushi",
      businessType: "Retail",
      locationRef: typedLocation,
    }).valid,
    true,
    "the owner must be able to replace a deterministic suggestion",
  );

  const emptyStall = onboarding.validateStallSetup({ stallName: "", businessId: null, locationRef: null });
  assert.equal(emptyStall.valid, false);
  assert.ok(emptyStall.errors.stallName, "stall name must be required");
  assert.ok(emptyStall.errors.business, "stall business must be required");
  assert.ok(emptyStall.errors.location, "stall location must be required");

  const inheritedLocation = onboarding.inheritLocationRef(typedLocation);
  assert.deepEqual(inheritedLocation, typedLocation, "inherited locations must retain their evidence");
  assert.notEqual(inheritedLocation, typedLocation, "inherited locations must be safe cloned values");
  assert.equal(
    onboarding.validateStallSetup({
      stallName: "Main Stall",
      businessId: "business-1",
      locationRef: inheritedLocation,
    }).valid,
    true,
  );
  const overriddenLocation = onboarding.createTypedLocationRef("Market Road, Pasig");
  assert.notEqual(overriddenLocation.formattedAddress, inheritedLocation.formattedAddress);

  const destination = onboarding.resolveGuidedSetupDestination;
  assert.equal(
    destination({ hasBusiness: false, hasStall: false, firstRunComplete: false }),
    "name",
    "new installs must start with name",
  );
  assert.equal(
    destination({ displayName: "Rovs", hasBusiness: false, hasStall: false, firstRunComplete: false }),
    "role",
    "role follows name",
  );
  assert.equal(
    destination({ displayName: "Rovs", role: "owner", hasBusiness: false, hasStall: false, firstRunComplete: false }),
    "owner-business",
  );
  assert.equal(
    destination({ hasBusiness: true, hasStall: false, firstRunComplete: false }),
    "owner-stall",
    "a legacy business without a stall resumes at first stall",
  );
  assert.equal(
    destination({ hasBusiness: true, hasStall: true, firstRunComplete: false }),
    "owner-app",
    "configured legacy owners must bypass onboarding even without the old flag",
  );
  assert.equal(
    destination({ hasBusiness: false, hasStall: false, firstRunComplete: true }),
    "name",
    "the old empty-Fresh flag must not bypass meaningful setup",
  );
  assert.equal(
    destination({
      displayName: "Mia",
      role: "seller",
      hasBusiness: false,
      hasStall: false,
      firstRunComplete: true,
      sellerConnectionState: "not_applicable",
    }),
    "seller-connect",
    "the old completion flag alone must not skip Seller code entry",
  );
  assert.equal(
    destination({
      displayName: "Mia",
      role: "seller",
      hasBusiness: false,
      hasStall: false,
      firstRunComplete: true,
      sellerConnectionState: "unconnected",
    }),
    "seller-limited",
    "Seller skip must resolve to an intentional limited state",
  );

  console.log("guided onboarding domain and route contracts: passed");
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(workspace, relativePath), "utf8");
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function checkSourceContracts() {
  const rootSource = readSource("app/index.tsx");
  const onboardingSource = readSource("app/onboarding.tsx");
  const addBusinessSource = readSource("app/owner/add-business.tsx");
  const addStallSource = readSource("app/owner/add-stall.tsx");
  const guidedServiceSource = readSource("src/services/guidedOnboarding.ts");
  const stallFormSource = readSource("src/components/onboarding/StallDetailsForm.tsx");
  const locationProviderSource = readSource("src/services/locationProvider.ts");

  assert.doesNotMatch(rootSource, /Start Fresh Business|Try Demo Data/, "old first-run hierarchy must be removed");
  assert.match(rootSource, /router\.replace\("\/onboarding"/, "incomplete setup must enter guided onboarding");
  assert.match(onboardingSource, /Kumusta![\s\S]*Ano ang pangalan mo\?/);
  assert.match(onboardingSource, /label="Pangalan mo"[\s\S]*required/);
  assert.match(onboardingSource, /if \(!normalizedName\)/, "name submission must reject blank input");
  assert.match(onboardingSource, /if \(!role\)/, "role submission must reject no selection");
  assert.match(onboardingSource, /Tingnan muna ang halimbawa \(demo\)/, "Demo must remain a quiet secondary action");
  assert.match(onboardingSource, /stallName: "Main Stall"/, "first stall must default to Main Stall");
  assert.match(onboardingSource, /inheritsBusinessLocation: true/, "first stall must inherit the business location");
  assert.match(onboardingSource, /preselectedBusinessId=\{stall\.businessId\}/, "first stall business must be preselected");

  const sellerSection = sourceSection(
    onboardingSource,
    'if (step === "seller-connect") {\n    return (',
    'if (step === "seller-limited") {\n    return (',
  );
  assert.match(sellerSection, /label="Owner \/ Stall code"/);
  assert.match(sellerSection, /label="I-paste"/);
  assert.match(sellerSection, /Wala pa akong code/);
  assert.match(onboardingSource, /Clipboard\.getStringAsync\(\)/, "Seller paste must reuse approved clipboard support");
  assert.doesNotMatch(
    sellerSection,
    /BusinessDetailsForm|StallDetailsForm|Pangalan ng negosyo|Uri ng negosyo/,
    "Seller setup must not request Owner business fields",
  );
  assert.match(onboardingSource, /onboarding-seller-limited-screen/);
  assert.match(onboardingSource, /Sadyang unconnected ang state/);

  const joinSection = sourceSection(
    guidedServiceSource,
    "export async function attemptSellerCodeJoin",
    "export async function createGuidedBusiness",
  );
  assert.match(joinSection, /unsupported_local_only/);
  assert.match(joinSection, /Walang data na ipinadala o stall na sinalihan/);
  assert.doesNotMatch(
    joinSection,
    /fetch\s*\(|createBranch\s*\(|setAppSetting\s*\(|runAsync\s*\(|withExclusiveTransactionAsync\s*\(/,
    "unsupported Seller codes must perform no network or persistence join",
  );

  const addBusinessSection = sourceSection(
    guidedServiceSource,
    "export async function createGuidedBusiness",
    "export async function createGuidedStall",
  );
  assert.match(
    addBusinessSection,
    /previousOwnerStatus\.activeBusiness[\s\S]*previousOwnerStatus\.activeBranch[\s\S]*activeBranchSettingKey\(previousOwnerStatus\.activeBusiness\.id\)[\s\S]*previousOwnerStatus\.activeBranch\.id/,
    "Add Business must remember the previous active Stall before changing Owner context",
  );

  assert.match(guidedServiceSource, /const role = existingBusiness \? "owner" : identity\.role/);
  assert.match(stallFormSource, /preselectedBusinessId\?: string \| null/);
  assert.match(stallFormSource, /business\.id === preselectedBusinessId/);
  assert.match(stallFormSource, /inheritLocationRef\(business\.locationRef\)/);
  assert.match(stallFormSource, /Kapareho ng lokasyon ng negosyo/);
  assert.match(addBusinessSource, /BusinessDetailsForm/, "Add Business must reuse the guided business form");
  assert.match(addBusinessSource, /validateBusinessSetup/, "Add Business must reuse guided validation");
  assert.match(addBusinessSource, /Magdagdag ng Stall/, "Add Business must offer the natural Stall continuation");
  assert.match(addStallSource, /StallDetailsForm/, "Add Stall must reuse the guided stall form");
  assert.match(addStallSource, /validateStallSetup/, "Add Stall must reuse guided validation");
  assert.match(addStallSource, /requestedBusiness[\s\S]*selectedBusiness/, "Add Stall must honor a requested Business");
  assert.match(addStallSource, /stallName: "Main Stall"/, "Add Stall must default its name");
  assert.match(addStallSource, /inheritLocationRef\(selectedBusiness\.locationRef\)/);
  assert.match(addStallSource, /preselectedBusinessId=\{preselectedBusinessId\}/);

  assert.match(locationProviderSource, /id: "unconfigured-local-only"/);
  assert.doesNotMatch(locationProviderSource, /from "expo-location"|from "react-native-maps"/);
  assert.match(locationProviderSource, /no network request, permission request, geocoding, or native map operation/);

  console.log("guided onboarding screen, reuse, and local-only source contracts: passed");
}

function sql(dbPath, statement, json = false) {
  const args = ["-bail"];
  if (json) args.push("-json");
  args.push(dbPath, `PRAGMA foreign_keys = ON; ${statement}`);
  return execFileSync("sqlite3", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function applyGuidedMigration(dbPath, migration) {
  const exists = Number(
    sql(dbPath, `SELECT COUNT(*) FROM schema_migrations WHERE id = '${migration.id}';`),
  );
  if (exists > 0) return 0;
  sql(
    dbPath,
    `BEGIN EXCLUSIVE;
     ${migration.up}
     INSERT INTO schema_migrations (id, applied_at)
     VALUES ('${migration.id}', datetime('now'));
     COMMIT;`,
  );
  return 1;
}

function tableColumns(dbPath, tableName) {
  return JSON.parse(sql(dbPath, `PRAGMA table_info(${tableName});`, true) || "[]");
}

function checkMigration(migration, onboarding) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitamo-guided-onboarding-"));
  const dbPath = path.join(temporaryRoot, "guided-onboarding.sqlite");
  try {
    sql(
      dbPath,
      `CREATE TABLE schema_migrations (
         id TEXT PRIMARY KEY NOT NULL,
         applied_at TEXT NOT NULL
       );
       CREATE TABLE businesses (
         id TEXT PRIMARY KEY NOT NULL,
         business_name TEXT NOT NULL,
         business_type TEXT NOT NULL,
         owner_name TEXT NOT NULL,
         barangay TEXT NOT NULL
       );
       CREATE TABLE branches (
         id TEXT PRIMARY KEY NOT NULL,
         business_id TEXT NOT NULL,
         branch_name TEXT NOT NULL,
         location TEXT,
         FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
       );
       INSERT INTO businesses (
         id, business_name, business_type, owner_name, barangay
       ) VALUES (
         'legacy-business', 'Legacy Karinderia', 'karinderia', 'Rovs', 'Legacy Barangay'
       );
       INSERT INTO branches (
         id, business_id, branch_name, location
       ) VALUES (
         'legacy-stall', 'legacy-business', 'Legacy Main', 'Legacy Market'
       );`,
    );

    const before = sql(
      dbPath,
      `SELECT id, business_name, business_type, owner_name, barangay
       FROM businesses ORDER BY id;
       SELECT id, business_id, branch_name, location
       FROM branches ORDER BY id;`,
    );
    assert.equal(applyGuidedMigration(dbPath, migration), 1, "migration 018 must apply once");
    assert.equal(applyGuidedMigration(dbPath, migration), 0, "migration 018 runner must replay safely");
    const after = sql(
      dbPath,
      `SELECT id, business_name, business_type, owner_name, barangay
       FROM businesses ORDER BY id;
       SELECT id, business_id, branch_name, location
       FROM branches ORDER BY id;`,
    );
    assert.equal(after, before, "migration 018 must preserve every legacy address and identity value");

    const businessColumns = tableColumns(dbPath, "businesses");
    const branchColumns = tableColumns(dbPath, "branches");
    assert.ok(businessColumns.some((column) => column.name === "location_ref_json"));
    assert.ok(businessColumns.some((column) => column.name === "business_type_custom"));
    assert.ok(branchColumns.some((column) => column.name === "location_ref_json"));
    assert.ok(
      branchColumns.some(
        (column) => column.name === "inherits_business_location" && String(column.dflt_value) === "0",
      ),
    );

    const legacyBusiness = JSON.parse(
      sql(
        dbPath,
        "SELECT barangay, location_ref_json, business_type_custom FROM businesses WHERE id = 'legacy-business';",
        true,
      ) || "[]",
    )[0];
    const legacyStall = JSON.parse(
      sql(
        dbPath,
        "SELECT location, location_ref_json, inherits_business_location FROM branches WHERE id = 'legacy-stall';",
        true,
      ) || "[]",
    )[0];
    assert.deepEqual(legacyBusiness, {
      barangay: "Legacy Barangay",
      location_ref_json: null,
      business_type_custom: null,
    });
    assert.deepEqual(legacyStall, {
      location: "Legacy Market",
      location_ref_json: null,
      inherits_business_location: 0,
    });

    const structuredLocation = onboarding.serializeLocationRef(
      onboarding.createTypedLocationRef("Brgy. San Isidro, Makati"),
    );
    const escapedLocation = structuredLocation.replaceAll("'", "''");
    sql(
      dbPath,
      `INSERT INTO businesses (
         id, business_name, business_type, business_type_custom, owner_name,
         barangay, location_ref_json
       ) VALUES (
         'guided-business', 'Rovs Sushi', 'Food / Restaurant', NULL, 'Rovs',
         'Brgy. San Isidro, Makati', '${escapedLocation}'
       );
       INSERT INTO branches (
         id, business_id, branch_name, location, location_ref_json,
         inherits_business_location
       ) VALUES (
         'guided-stall', 'guided-business', 'Main Stall',
         'Brgy. San Isidro, Makati', '${escapedLocation}', 1
       );`,
    );
    const guidedStall = JSON.parse(
      sql(
        dbPath,
        "SELECT branch_name, location, location_ref_json, inherits_business_location FROM branches WHERE id = 'guided-stall';",
        true,
      ) || "[]",
    )[0];
    assert.equal(guidedStall.branch_name, "Main Stall");
    assert.equal(guidedStall.inherits_business_location, 1);
    assert.equal(onboarding.parseLocationRefJson(guidedStall.location_ref_json)?.source, "typed");

    assert.throws(
      () =>
        sql(
          dbPath,
          "UPDATE branches SET inherits_business_location = 2 WHERE id = 'guided-stall';",
        ),
      "inheritance metadata must reject values outside 0/1",
    );
    assert.equal(sql(dbPath, "PRAGMA integrity_check;"), "ok");
    assert.equal(sql(dbPath, "PRAGMA foreign_key_check;"), "");
    assert.equal(
      Number(sql(dbPath, "SELECT COUNT(*) FROM schema_migrations WHERE id = '018_guided_onboarding';")),
      1,
    );

    console.log("guided onboarding migration preservation and replay: passed");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

compileContracts();
const onboarding = require(path.join(compiledDir, "domain/onboarding.js"));
const { guidedOnboardingMigration } = require(
  path.join(compiledDir, "db/migrations/018_guided_onboarding.js"),
);

checkDomainContracts(onboarding);
checkSourceContracts();
checkMigration(guidedOnboardingMigration, onboarding);
console.log("ALL GUIDED ONBOARDING CHECKS PASSED");
