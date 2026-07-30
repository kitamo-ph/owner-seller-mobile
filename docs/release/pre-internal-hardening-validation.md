# KitaMo Android - Pre-Internal Hardening Validation

Status: release candidate for Google Play Internal Testing after the two confirmed
medium-severity local security findings were fixed. This work does not authorize a
Play upload or public rollout.

## Release identity

- Branch: `codex/pre-internal-hardening`
- Base: `codex/gabi-redesign@f87eb5e`
- App: `KitaMo`
- Package: `ph.kitamo.app`
- Version: `1.0.0`
- Android versionCode: `2`
- Expo SDK: `54.0.36`
- Android backup: disabled
- Internet permission: blocked

The prior signed versionCode 1 artifact remains preserved at:

Status: **Superseded — do not upload**.

`release-artifacts/KitaMo-1.0.0-production-eas-376b2f1.aab`

Expected SHA-256:

`51c515df2b9da82687f68fd553e4f4936801c77bea650c44190ae4538fa6efcd`

The versionCode 2 artifact must use a different filename and must not overwrite
that file.

## Scope completed

### Independent audit checkpoint

- Preserved the independent read-only audit as its own commit.
- Confirmed no Critical or High code finding.
- Selected only the two confirmed Medium local security findings for this pass.
- Left protected inventory, checkout, pricing, recipe, production, COGS,
  fixed-cost, spoilage, transfer, profit, and reporting behavior unchanged.

### Owner PIN hardening

- Failed-attempt count and lockout deadline are persisted in Android Secure Store.
- Five wrong attempts trigger a 30-second lockout.
- Force-closing or relaunching the app does not clear the lockout.
- Successful PIN or biometric verification clears the persisted throttle.
- The full local-data reset is blocked when no Owner PIN exists.
- When a PIN exists, the reset requires the current PIN after the destructive
  warning.
- Cancelled or incorrect confirmation does not wipe data.
- A single-flight guard prevents duplicate wipe execution from repeated taps.

### Local problem reporting

- Migration 010 creates the repeat-safe `problem_reports` table and indexes.
- Owner Mode can create and review all local reports.
- Kiosk Mode can create and review reports for the confirmed stall only.
- Reports remain local SQLite records; there is no background upload, polling,
  cloud endpoint, crash SDK, or remote support claim.
- Diagnostics are allowlisted and sanitized. They include app/build, Android
  release/model, mode/route, business/stall IDs, safe network state, and up to 12
  bounded local breadcrumbs.
- Owner PINs, passwords, receipt details, customer names, full records, database
  contents, IP addresses, and arbitrary environment values are not collected.
- Copy and Share are explicit user actions and use sanitized text.
- Opening Help or Report Problem from Kiosk preserves the transient cart and the
  confirmed Kiosk-session stall.

## Automated verification

The release gate includes:

```sh
npm run typecheck
npm run lint
npm run check:owner-context
npm run check:owner-pin-security
npm run check:pricing
npm run check:recipes
npm run check:production
npm run check:cogs
npm run check:fixedcosts
npm run check:pilot
npm run check:migrations
npm run check:problem-reports
EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 npx expo-doctor
EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 npx expo export --platform android
```

Expected migration result: 10 migrations on the first run and 0 on a repeat run.
The migration suite also retains the unique checkout-token/idempotency check.

Expo Doctor passes 18/18 after aligning Expo to the SDK 54 patch release
`54.0.36`. This is a patch-level dependency correction, not an SDK upgrade.

`npm audit --omit=dev` continues to report 13 moderate advisories in Expo build
tooling dependencies. The available forced remediation requires a breaking Expo
upgrade and is intentionally deferred to the next supported SDK upgrade. There
are no High or Critical advisories in that report.

## Focused emulator QA

Environment: Android 9/API 28 low-end AVD at a logical 360x800 viewport.

- A local report was validated, saved once, reopened from report history, and
  retained after force-close/reopen.
- The saved diagnostic context reported KitaMo `1.0.0 (2)`, Android 9, the
  current Owner route, business/stall IDs, and safe Wi-Fi state only.
- Owner Settings exposed Report Problem and My Problem Reports.
- Kiosk Help truthfully stated that reports are local and manual, with no cloud
  upload, seller account, automatic crash reporting, or remote support.
- A one-item Kiosk cart and the confirmed `Night Bazaar Booth` context survived
  Help -> Report Problem -> Back -> Back.
- Araw and Gabi both rendered correctly. Gabi persisted after force-close/reopen.
- The active Kiosk session retained its resolved theme and did not expose Owner
  Settings as an in-session theme-change path.
- At 1.3x system font scale, the Gabi report form remained scrollable and primary
  controls retained usable wrapping and touch targets at 360x800.
- Focused `ReactNativeJS`, `AndroidRuntime`, and Expo error logs were empty.
- A focused log scan found none of the entered report text, Owner PIN wording, or
  generated report ID in logcat.
- Emulator font scale and app theme were restored to 1.0x and Araw after QA.

## Production export

The Android production export completes with Hermes and the approved bundled
fonts/assets. No temporary QA route, seed, emulator-only code, APK, or AAB is
tracked by this branch.

## Artifact validation gate

Build the replacement signed AAB only after this branch is committed and clean.
Validate all of the following against the downloaded artifact:

- EAS build source commit matches the final branch commit.
- Package is `ph.kitamo.app`.
- Version is `1.0.0` and versionCode is `2`.
- The bundle is signed by the expected EAS upload key.
- `allowBackup=false` and Secure Store backup is disabled.
- No Internet, camera, microphone, storage, location, Bluetooth, or overlay
  permission is present.
- Expected biometric, network-state, Wi-Fi-state, vibration, and framework-local
  permissions only are present.
- Native libraries pass 16 KB page-alignment validation.
- The AAB passes bundletool validation and receives its own recorded SHA-256.
- The prior versionCode 1 AAB and checksum remain unchanged; its status is
  **Superseded — do not upload**.

### Subsequent artifact-verification outcome

On 2026-07-30, the existing
`release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab` passed the static
artifact gate. Its signer exactly matches the independently verified EAS
production upload-certificate fingerprint, clearing the signing-identity release
block. See the
[versionCode 2 AAB verification record](versioncode-2-aab-verification.md) for
the exact checksum, evidence, and limitations.

This later verification did not install the versionCode 2 build or perform a
Play upload/pre-launch analysis. The remaining owner-controlled gates below are
still open.

## Product and privacy boundary

- SQLite remains the source of truth.
- Kiosk remains same-device, local, explicit-stall, and session-specific.
- `offline_queue` remains inactive future-sync intent and does not transmit data.
- No Supabase, Clerk, cloud sync, AI, OCR, seller accounts, remote approvals,
  shifts, push notifications, Customer Mode, or LGU Mode is enabled.
- Problem reports are deleted by the existing full local pilot-data reset.
- The privacy policy and Play Data Safety answers must describe local problem
  reports, explicit user-initiated sharing, backup disabled, and no automatic
  transmission.

## Known limitations and deferred items

- The Fresh/Demo first-launch choice remains for the pilot. Starting Fresh by
  default and moving Demo into Settings is post-pilot work.
- Problem reporting is manual; it is not automatic crash reporting.
- There is no in-app upload or ticket tracking. The owner must Copy or Share a
  report deliberately.
- All app data remains local to one Android device and is lost on uninstall or a
  confirmed local-data reset.
- Real-device battery, thermal, biometric-vendor, storage-pressure, and OEM
  behavior still require observation during Internal Testing.
- The independent audit's Low/Informational findings remain deferred unless a
  measured pilot issue justifies a narrowly scoped fix.

## Play Console owner actions

1. Provide a monitored public support email.
2. Host the approved privacy policy at a public HTTPS URL.
3. Confirm the Data Safety, App Access, content-rating, target-audience, and
   financial-feature answers in Play Console.
4. Supply the Internal Testing Gmail tester list.
5. Upload only
   `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab` to Internal
   Testing and enable Play App Signing.
6. Add Internal Testing release notes and distribute the opt-in link.
7. Review the Play pre-launch report before any wider track.
8. Do not begin public rollout from this branch.

Any later or replacement build must use versionCode 3 or higher.
