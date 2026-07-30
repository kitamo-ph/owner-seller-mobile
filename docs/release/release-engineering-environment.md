# KitaMo Android Release Engineering Environment

Environment snapshot verified: 2026-07-14 (Asia/Manila)

VersionCode 2 artifact verification added: 2026-07-30 (Asia/Manila)

This document records the workstation and account prerequisites for the
`1.0.0 (2)` Internal Testing candidate. It contains no passwords, tokens,
keystore material, or Play credentials.

## Installed workstation tools

- macOS arm64
- Node.js `20.20.2` (Homebrew `node@20`, first in shell `PATH`)
- npm `10.8.2`
- OpenJDK `17.0.19` (`JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`)
- Android Studio Quail `2026.1.1 Patch 2`
- Android SDK: platform/API 36, Build Tools 36.0.0 and 35.0.0 in the 2026-07-14
  environment snapshot
- Android Build Tools 36.1.0 `zipalign`, used by the 2026-07-30 artifact
  inspection
- Android Platform Tools / ADB `37.0.0`
- Android Emulator `36.6.11`
- Android NDK `27.1.12297006`, CMake `3.22.1`
- bundletool `1.18.3`
- Watchman `2026.07.06.00`
- EAS CLI `20.5.1`

Shell configuration defines `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and places Node 20, the emulator, platform tools, and command-line tools on `PATH`.

## Android virtual devices

- `KitaMo_LowEnd_API28`: Android 9 / API 28, Nexus 5 profile, 2 GB RAM, 2 CPU cores.
- `KitaMo_16KB_API35`: Android 15 / API 35, Pixel 6 profile, 16 KB page-size system image.

These support constrained-device and 16 KB compatibility checks. A real low-end phone remains required before rollout because an emulator cannot reproduce vendor firmware, thermal throttling, storage pressure, or real biometric behavior.

## Expo and EAS

- Signed-in user: `rawbeans`
- Organization: `kitamoandroidapp`
- Project: `@kitamoandroidapp/kitamo-android`
- EAS project ID: `d2ab769c-4916-4efa-ab1e-a2dfdc638607`
- Android credentials: EAS-managed keystore; never store or commit the keystore in this repository.
- `preview` profile: internal-distribution APK.
- `production` profile: Android App Bundle for Google Play.
- The 2026-07-14 environment snapshot recorded no EAS environment variables for
  preview or production. That remote control-plane state was not rechecked by
  the 2026-07-30 local artifact inspection.
- Preview build complete: `f3b64c64-04d0-4f71-ac54-1ceba8029403`.
- Designated versionCode 2 artifact:
  `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`.
- SHA-256:
  `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`.
- Package/version: `ph.kitamo.app` / `1.0.0` / versionCode `2`.
- EAS production upload-certificate SHA-256:
  `9E:2A:60:C0:C9:28:A2:99:24:50:D8:8D:28:3F:89:1C:58:69:ED:5D:A1:E8:23:53:CB:F3:E8:B8:97:6E:A2:C1`.
- The independently verified EAS fingerprint exactly matches the AAB signer;
  the signing-identity release block is cleared.
- Static validation passed for bundletool/ZIP processing, the exact package and
  version, AAB signature, approved permission set with no Internet, backup
  posture, cloud/credential exclusion scan, APK 16 KB ZIP alignment, and all 40
  applicable arm64/x86_64 ELF load-segment checks. A versionCode 2 install/runtime
  and Play pre-launch analysis remain pending.
- The later artifact inspection additionally used Android Build Tools 36.1.0;
  it does not retroactively change the workstation snapshot above.
- Full evidence:
  [versionCode 2 AAB verification](versioncode-2-aab-verification.md).

### Historical versionCode 1 build

Status: **Superseded — do not upload**.

- EAS build: `362a9631-f557-4ac4-9b0c-b770c10ea637`, built from commit
  `376b2f12598d36939d25dd8cd61398ab7bb93746`.
- Build page:
  `https://expo.dev/accounts/kitamoandroidapp/projects/kitamo-android/builds/362a9631-f557-4ac4-9b0c-b770c10ea637`.
- Artifact URL:
  `https://expo.dev/artifacts/eas/TgXP3hkOEQ2gZrfJ_4IgV_XpcWMsm9TKFIaH0fnNGr4.aab`.
- Downloaded ignored artifact:
  `release-artifacts/KitaMo-1.0.0-production-eas-376b2f1.aab`.
- SHA-256:
  `51c515df2b9da82687f68fd553e4f4936801c77bea650c44190ae4538fa6efcd`.
- Its historical validation evidence remains preserved in the
  [independent pre-release audit](claude-independent-pre-release-audit.md).

## Human-owned prerequisites before Play upload

1. A verified Google Play Console developer account with access to create/manage KitaMo.
2. A Play Console app named `KitaMo` using package `ph.kitamo.app`. The package cannot be changed after the first upload.
3. A final public support email monitored by the KitaMo team.
4. A public HTTPS privacy-policy URL hosting the approved content from `docs/play-store/privacy-policy-draft.md`.
5. Final website URL if one will be shown in the store listing; it is optional, unlike the support email and privacy policy.
6. A tester email list and the people authorized to receive the Internal Testing opt-in link.
7. Final owner review of the Data Safety and content-rating answers.
8. Real-phone screenshots captured from the signed candidate, following `docs/play-store/screenshot-plan.md`.
9. Play App Signing enabled when the first AAB is uploaded.
10. Owner approval to start the Internal Testing rollout after the Play pre-launch report is reviewed.

Do not put Play Console credentials, Google service-account JSON, passwords, or keystore files in this repository. EAS Submit is intentionally not configured until the Play app exists and the owner chooses whether to provide a narrowly scoped Google service account.

## Release artifact handling

Downloaded APK/AAB files belong under ignored `release-artifacts/`. Validate their package, version, permissions, signature, and 16 KB alignment, but do not commit binaries or signing material.

The following EAS build-view commands are preserved for preview and historical
versionCode 1 evidence only. The versionCode 1 operator instruction is
**Superseded — do not upload**:

```sh
eas build:view f3b64c64-04d0-4f71-ac54-1ceba8029403
eas build:view 362a9631-f557-4ac4-9b0c-b770c10ea637
```

For the current release, use only the designated versionCode 2 artifact and
recheck its exact checksum immediately before upload. Do not run `eas submit` or
upload manually until the Play Console app, privacy URL, support email, tester
list, owner-approved declarations, and rollout approval exist. Any later build
must use versionCode 3 or higher.
