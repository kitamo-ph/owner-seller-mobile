# KitaMo Android - Final Release Readiness

Status: versionCode 2 artifact conditionally verified for Google Play Internal
Testing; owner actions remain. The Android seller app is authoritative; the PWA
remains frozen and unchanged. No Play upload or public rollout is approved.

## Release identity

- App: **KitaMo**
- Package: **`ph.kitamo.app`**
- Version: **`1.0.0`** (`versionCode` 2)
- Expo SDK 54 / React Native 0.81 / New Architecture
- Production profile: signed Android App Bundle
- Branded launcher icon, adaptive icon, splash, Play icon, and feature graphic are present
- EAS project: `@kitamoandroidapp/kitamo-android`

## Product boundary

- SQLite is the local source of truth. Android backup is disabled.
- Kiosk Mode is local, same-device, and stall-specific. Opening Kiosk requires explicit stall selection and confirmation.
- Notifications are local SQLite alerts only.
- No Supabase, cloud sync, cloud auth, AI, OCR/camera, Bluetooth printing, seller accounts, real shifts, QR joining, remote approvals, push notifications, Customer Mode, or LGU Mode is enabled.
- `offline_queue` records future sync intent but has no consumer in this release. Its rows remain local until pilot data is reset.

## Final QA result

The user approved the redesigned app's manual QA. Codex then reran the release
gates on `codex/gabi-redesign` after the measured low-end fix. This source and
versionCode 1 runtime history remains useful evidence, but it is not presented
as a versionCode 2 install/runtime test:

- `npm run typecheck`: pass
- `npm run lint`: pass
- Owner-context, pricing, recipe, production, COGS, fixed-cost/profit, pilot, checkout-idempotency, and migration checks: pass
- Repeat-safe migrations: 9 applied on first run, 0 on second run, unique checkout token preserved
- Expo Doctor: 18/18
- Production Android export: pass; Hermes bundle approximately 4.02 MB
- Clean first launch, explicit Demo seed, Owner/Kiosk navigation, force-close recovery, Araw/Gabi persistence, Kiosk theme lock, large-font Home, and focused logcat inspection: pass on the constrained emulator
- No tracked QA routes, synthetic seeds, emulator-only code, APKs, AABs, or debug files remain in the repository

## Protected business behavior

The final release changes after the redesign audit touched only startup migration serialization, a native gradient host stability guard, and bounded rendering in Inventory/Grocery screens. They did not alter accounting, inventory writes, exact grocery-lot traceability, recipe costing, production, checkout, bundle pricing, COGS, fixed costs, spoilage, transfers, profit, or reports.

```text
Revenue
- Sold COGS
- Fixed Costs
- Spoilage
= Net Profit
```

## Measured low-end results

Test environment: Android 9/API 28 AVD, 2 GB RAM, 2 CPU cores, 360x800 viewport. The external synthetic SQLite dataset contained 303 products, 3,000 sales and related records, 200 ingredients, 400 exact lots, 100 recipes, and 500 production batches. It was injected into the emulator only and is not part of the app.

- Cold launch: 562-1,171 ms across five runs; median 634 ms
- Warm foreground resume after 60 seconds: 241 ms; same process and Kiosk context retained
- Force-stop/reopen: about 1.02 seconds; persistent data/context restored and transient Kiosk session correctly closed
- 30-minute Kiosk soak: 100,131 KB final PSS, zero swap, no fatal/Fabric/SQLite/font errors; memory was lower than its 103,819 KB baseline
- Network: no app-UID netstats entry during the soak; final manifest has no `INTERNET` permission
- Battery: emulator batterystats did not advance time-on-battery, so a trustworthy drain percentage requires a physical phone
- Large font: 1.3x at 360x800 remained usable without overlapping primary controls

Profiling identified two proven bottlenecks and only those were changed:

- Inventory dropped from roughly 3,900 native views to 644 for the first 30-row batch.
- Grocery Stock dropped from 8,294 native views to 928 for the first 20 ingredient groups.
- `Ipakita pa` reveals the next bounded batch while preserving search, filters, totals, and exact lot details.
- Recipes reached 2,668 views / about 173 MB PSS with the synthetic dataset, but remained usable; no speculative refactor was made.

## Security and artifact checks

- Owner Mode uses a salted local PIN, optional Android biometric confirmation, retry cooldown, background lock, and Kiosk-entry lock.
- Owner protection is a shared-device access control, not database encryption and not protection against a rooted/compromised phone.
- Expected merged permissions: network/Wi-Fi state, vibration, biometric, fingerprint fallback, and an app-local signature receiver permission.
- Forbidden permissions: Internet, camera, microphone, storage, location, Bluetooth, and system overlay.
- `allowBackup=false`; Secure Store backup is also disabled.
- The versionCode 2 AAB static scan found no Supabase/Clerk/OpenAI/Lis client,
  endpoint, or credential-shaped token. Remote EAS environment state was not
  rechecked by that binary inspection.
- `npm audit --omit=dev` reports 13 moderate and 0 high/critical advisories in Expo build/configuration transitive dependencies. The offered remediation requires a breaking Expo 57 upgrade; defer to the next supported SDK upgrade.
- The designated Internal Testing artifact is
  `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`.
- Its SHA-256 is
  `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`.
- Its package/version identity is `ph.kitamo.app` / `1.0.0` / versionCode `2`,
  with minimum API 24 and target API 36.
- Its signer exactly matches the independently verified EAS production
  upload-certificate SHA-256 fingerprint
  `9E:2A:60:C0:C9:28:A2:99:24:50:D8:8D:28:3F:89:1C:58:69:ED:5D:A1:E8:23:53:CB:F3:E8:B8:97:6E:A2:C1`.
- Bundletool/ZIP processing, the expected permission and backup boundary, static
  offline/cloud exclusion scans, APK ZIP alignment, and all 40 applicable
  arm64/x86_64 16 KB ELF checks passed. A versionCode 2 signed APK was not
  installed; Play analysis remains pending.
- The complete evidence and limitations are in the
  [versionCode 2 AAB verification record](versioncode-2-aab-verification.md).

Historical versionCode 1 evidence remains preserved:

- EAS build `362a9631-f557-4ac4-9b0c-b770c10ea637`, source `376b2f1`, artifact
  `release-artifacts/KitaMo-1.0.0-production-eas-376b2f1.aab`, SHA-256
  `51c515df2b9da82687f68fd553e4f4936801c77bea650c44190ae4538fa6efcd`.
- Its earlier bundletool, signature, package/version, permission, backup,
  universal-APK signing/install, 16 KB, and 1.09-second clean-launch checks remain
  dated evidence for that binary.
- That artifact and every instruction to upload it are
  **Superseded — do not upload**.

## Known limitations

- Fresh/Demo choice remains on first launch for the pilot. Post-pilot, start Fresh by default and move Demo into Settings or Pilot Guide.
- All data is local to one device; uninstall/reset permanently removes it.
- Pending queue rows do not sync and can grow during a long pilot.
- No remote seller access, multi-device assignments, cloud backup, or server recovery exists.
- Real-device battery, thermal, vendor-firmware, storage-pressure, and biometric behavior cannot be proven by the emulator.

## Human-owned Play gates

1. [ ] Create or grant access to the KitaMo Play Console app for package
   `ph.kitamo.app`.
2. [ ] Supply a monitored public support email.
3. [ ] Host the approved privacy policy at a public HTTPS URL.
4. [ ] Supply the Internal Testing Google-account email list.
5. [ ] Capture final store screenshots from the signed candidate on a physical
   phone.
6. [ ] Enter and owner-confirm the drafted Data Safety, App Access,
   content-rating, target-audience, and financial-feature answers.
7. [ ] Enable Play App Signing and upload only the designated versionCode 2 AAB
   to Internal Testing.
8. [ ] Enter the prepared release notes and approve the Internal Testing rollout.
9. [ ] Review the Play pre-launch report before considering any later track.

No Play upload, tester rollout, pre-launch report, or public release can be claimed until those owner-controlled gates are complete.

## Verification commands and future-build boundary

```sh
npm run typecheck
npm run lint
npm run check:owner-context
npm run check:pricing
npm run check:recipes
npm run check:production
npm run check:cogs
npm run check:fixedcosts
npm run check:pilot
npm run check:migrations
EXPO_NO_DOTENV=1 npx expo-doctor
EXPO_NO_DOTENV=1 npx expo export --platform android
```

Do not rebuild or replace the designated versionCode 2 artifact. A separately
approved later build must use versionCode 3 or higher.
