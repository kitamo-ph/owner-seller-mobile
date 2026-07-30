# Play Store Internal Testing Checklist — KitaMo Android

Goal: get the first internal-testing build into a small trusted tester group's hands. Internal testing comes FIRST — before closed testing, open testing, or production. Nothing in this checklist publishes the app publicly.

## Prerequisites

- [ ] Real-phone QA pass complete (see `docs/pilot/android-seller-pilot-checklist.md`).
- [x] Source validation for the pre-internal baseline is recorded in
  [`pre-internal-hardening-validation.md`](../release/pre-internal-hardening-validation.md):
  typecheck, lint, the release regression suite, Expo Doctor, and production
  export. This is source evidence, not a versionCode 2 install/runtime test.
- [x] App icon, adaptive icon, splash, Play icon, and feature graphic added and visually checked.
- [ ] Privacy policy hosted at a public URL (draft: `privacy-policy-draft.md`; Play Console requires a URL, not a document).
- [ ] Final support email supplied and added to the listing/privacy policy.
- [ ] Signed build tested on a low-end physical Android device.

## Google Play Console account

- [ ] Google Play Console developer account created ($25 one-time) under the owner's Google account.
- [ ] Developer identity verification completed (can take days — start early).
- [ ] "KitaMo" app created in the Console: App → Create app → App/Game: App, Free, package `ph.kitamo.app`.
- [ ] Data Safety form filled using `data-safety-draft.md` (final answers reviewed by the owner).
- [ ] Content rating questionnaire completed (business/productivity app, no user-generated public content).
- [ ] Target audience: 18+ (business tool).

## App signing

- [ ] Use Play App Signing (default; Google holds the app signing key).
- [x] EAS production upload certificate independently verified against the
  versionCode 2 signer. Keep the existing EAS-managed credentials; do not
  regenerate or replace them.
- [x] No keystore file is committed to the repository.

## Build artifact (EAS)

One-time setup:

- [x] `eas login` completed as `rawbeans`, with owner access to organization `kitamoandroidapp`.
- [x] `eas build:configure` and project link completed for `@kitamoandroidapp/kitamo-android`.
- [x] Confirm `app.json`: name `KitaMo`, package `ph.kitamo.app`,
  versionCode `2`, version `1.0.0`, backup disabled, release permissions
  minimized.

Build:

- [x] Standalone preview APK built with the EAS-managed keystore (`f3b64c64-04d0-4f71-ac54-1ceba8029403`).
- [ ] Download/install that EAS APK and complete the full physical-device regression.
- [x] Designate
  `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab` as the sole
  Internal Testing upload artifact.
- [x] Verify its SHA-256:
  `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`.
- [x] Verify package/version, merged permissions, backup policy, AAB signature,
  bundle processing, static offline/cloud boundary, and 16 KB alignment for all
  40 applicable arm64/x86_64 native libraries.
- [x] Independently confirm that the AAB signer exactly matches the EAS
  production upload-certificate SHA-256 fingerprint recorded in the
  [versionCode 2 verification](../release/versioncode-2-aab-verification.md).
- [x] Preserve the versionCode 1 artifact, build ID, checksum, and audit as
  history: **Superseded — do not upload**.
- [ ] Install/runtime-test the delivered versionCode 2 build through Google Play
  on the pilot device; local static verification did not perform this step.

## Upload to internal testing

- [ ] Play Console → Testing → Internal testing → Create new release.
- [ ] Recompute the designated AAB's SHA-256 and require the exact value above.
- [ ] Upload only
  `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`.
- [ ] Release name: `1.0.0 (2) - pilot`. Release notes: paste from
  `release-notes-internal.md`.
- [ ] Save → Review release → Start rollout to Internal testing.

## Tester list

- [ ] Create an email list (Testing → Internal testing → Testers): up to 100 testers; start with 3–10 trusted people.
- [ ] Each tester's Google account email added to the list.
- [ ] Copy the opt-in URL and send it with `internal-tester-guide.md`.

## Install/test

- [ ] Tester opens the opt-in URL, accepts, installs from the Play Store link.
- [ ] Tester follows the smoke test below, then the full guide.

## Smoke test (5 minutes)

1. Launch → choose Try Demo Data → Home loads with the selected demo business and stall context.
2. Enter Kiosk from Home → explicitly choose/confirm the demo stall → sell 8 Sushi Rolls → receipt shows ₱150 (bundle price).
3. Records shows the sale; Insights shows the kita.
4. Kill the app, reopen → Owner context and data remain, but Kiosk requires stall confirmation again.
5. Business/stall context does not overlap the status bar, bottom tabs, or large text on a 360×800 device.

## Issue reporting

Use the format in `internal-tester-guide.md` (screen, steps, expected, actual, screenshot, phone model + Android version). Collect in one shared chat/thread.

## Next build / rollback

- Next build: any later or replacement build must use versionCode `3` or higher.
  Change `version` as appropriate, rebuild only under separate approval, and
  upload as a new internal release. versionCode must always increase.
- Rollback: internal testing has no true rollback; upload a fixed build with
  versionCode `3` or higher instead. Testers get it automatically from the Play
  Store.
- Promote to closed testing only after internal feedback is folded in — not part of this phase.
