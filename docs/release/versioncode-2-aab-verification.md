# KitaMo VersionCode 2 AAB Verification

Verified: 2026-07-30 (Asia/Manila)

## Release disposition

**Signing-identity release block: cleared.**

Final artifact ruling: **CONDITIONALLY VERIFIED — OWNER ACTIONS REMAIN**.

The EAS production upload-certificate SHA-256 fingerprint was independently
verified and exactly matches the signer of the versionCode 2 AAB. The following
existing binary is the sole designated upload artifact for Google Play Internal
Testing:

`release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`

This designation does not authorize an upload or rollout. The owner-controlled
Play Console, privacy, support, tester, and declaration gates below remain open.
The AAB was inspected read-only; it was not rebuilt, resigned, renamed, moved, or
modified.

## Designated artifact identity

| Property | Recorded or designated value |
| --- | --- |
| Product | KitaMo Owner–Seller mobile application |
| Package | `ph.kitamo.app` |
| Version | `1.0.0` |
| Android versionCode | `2` |
| Planned Internal Testing release name | `1.0.0 (2) - pilot` (prepared, not entered) |
| Artifact | `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab` |
| Size | 57,120,066 bytes |
| Recorded modification time | `2026-07-16T22:18:25+0800` |
| Artifact SHA-256 | `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd` |
| EAS production upload-certificate SHA-256 | `9E:2A:60:C0:C9:28:A2:99:24:50:D8:8D:28:3F:89:1C:58:69:ED:5D:A1:E8:23:53:CB:F3:E8:B8:97:6E:A2:C1` |
| Fingerprint authority | Owner-supplied result of an independent EAS production credential verification for `@kitamoandroidapp/kitamo-android` on 2026-07-30; no keystore or secret material was supplied |
| Expected/designated source baseline | `codex/pre-internal-hardening@6ed9ace3a92f7435f84c2f75f0084a03070ae2e4` (not independently attested by the binary) |
| Track | Google Play Internal Testing only |

The filename and protected-artifact discovery record designate `6ed9ace` as the
expected release baseline; the checksum identifies the exact inspected bytes.
The bundle's embedded VCS field is `NO_SUPPORTED_VCS_FOUND`, so build-time source
commit and branch are not independently established. No EAS build ID or other
build record for this exact versionCode 2 artifact is recorded in the
repository.

## Signing-identity reconciliation

- `jarsigner -verify` accepted the AAB signature.
- The AAB signer is a self-signed RSA-2048 certificate using SHA256withRSA,
  valid from 2026-07-11 through 2053-11-26.
- The independently verified EAS production upload-certificate fingerprint
  exactly equals the AAB signer fingerprint shown above.
- The comparison used the canonical colon-delimited SHA-256 value supplied from
  that independent EAS credential check and the certificate fingerprint
  extracted by `keytool -printcert -jarfile`; equality is exact across all 32
  bytes. `jarsigner` separately verified signature integrity.
- The same upload-certificate fingerprint was observed on the preserved
  versionCode 1 EAS artifact, providing signing continuity.
- The certificate differs from the local Android debug signer.
- The certificate is the **upload certificate**. If Play App Signing is enabled,
  Google Play uses the Play app-signing certificate for distributed APKs; that
  separate Play certificate is not established yet.

The strict `jarsigner` invocation exited `4` because the certificate is
self-signed and has no PKIX trust path. The missing timestamp was a separate
warning. Java also reported JAR-entry ordering/POSIX/JarInputStream warnings.
The archive contains zero duplicate ZIP entry names and passed both `unzip` and
bundletool parsing, so these warnings do not change the successful
signature-integrity result or the independently verified fingerprint match.

## Read-only binary validation summary

- SHA-256, package, version, versionCode, minimum API 24, and target API 36
  matched the recorded values.
- ZIP integrity, bundletool 1.18.3 validation, split generation, and universal
  APK generation completed successfully. The bundle contains one base module,
  three DEX files, resources, and 80 native libraries. The generated inspection
  APKs were intentionally unsigned because no keystore was supplied.
- The exact merged permission set is biometric, fingerprint fallback, vibration,
  network state, Wi-Fi state, and the app-local
  `ph.kitamo.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`.
- In manifest terms, those permissions are
  `android.permission.USE_BIOMETRIC`,
  `android.permission.USE_FINGERPRINT`, `android.permission.VIBRATE`,
  `android.permission.ACCESS_WIFI_STATE`, and
  `android.permission.ACCESS_NETWORK_STATE`, plus the app-local permission
  above. The two state permissions do not grant network transport.
- No Internet, camera, microphone, location, Bluetooth, storage, or overlay
  permission is present.
- `allowBackup=false`; the manifest contains no `fullBackupContent` or
  `dataExtractionRules` attribute. Packaged Secure Store XML resources exclude
  `sharedpref/SecureStore` from legacy backup, cloud backup, and device transfer,
  but those resources are not referenced by manifest attributes. Global backup
  remains disabled by `allowBackup=false`.
- Static scans found no bundled Supabase/PostgREST/GoTrue SDK, Clerk SDK,
  Cloudflare/R2/AWS client, OpenAI Platform API URL/client, KitaMo remote API,
  or `EXPO_PUBLIC_SUPABASE_*` name/value. They also found no valid JWT, AWS key,
  private-key marker, bearer token, or OpenAI-key-shaped token. One lowercase
  `cloudflare` framework literal was present without a URL, endpoint, client, or
  request marker. Expo Updates is embedded as disabled with no update URL.
- The bundle declares `PAGE_ALIGNMENT_16K`. All four generated ABI-bearing split
  APKs and the universal APK passed 16 KB ZIP alignment checks.
- All arm64-v8a and x86_64 native-library load segments use 16 KB alignment.
  All load segments across the four packaged ABIs passed offset/address
  congruence checks.

This is static artifact validation, not packet-capture evidence. No signed
versionCode 2 APK was installed in a 16 KB runtime during this reconciliation,
and no Google Play pre-launch report or server-side bundle analysis exists yet.

## Native-library 16 KB evidence

All 40 applicable 64-bit library instances (20 per ABI) passed the Android 16 KB
load-segment gate: every arm64-v8a and x86_64 `PT_LOAD p_align` is `0x4000`.
Bundletool generated four ABI-bearing split APKs and a universal APK whose
uncompressed native-library offsets are all divisible by 16,384; Android Build
Tools 36.1.0 `zipalign -c -P 16 -v 4` passed. The ELF inspection used NDK
27.1.12297006 LLVM 18.0.2. The 32-bit values below are `PT_LOAD p_align`
observations outside the 64-bit gate, not ZIP offsets and not failures.

| Native library | arm64-v8a `p_align` | armeabi-v7a `p_align` observation | x86 `p_align` observation | x86_64 `p_align` |
| --- | --- | --- | --- | --- |
| `libappmodules.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libc++_shared.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libexpo-modules-core.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libexpo-sqlite.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libfbjni.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libgesturehandler.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libgifimage.so` | 16 KB pass | 16 KB | 16 KB | 16 KB pass |
| `libhermes.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libhermestooling.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libimagepipeline.so` | 16 KB pass | 16 KB | 16 KB | 16 KB pass |
| `libjsi.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libnative-filters.so` | 16 KB pass | 16 KB | 16 KB | 16 KB pass |
| `libnative-imagetranscoder.so` | 16 KB pass | 16 KB | 16 KB | 16 KB pass |
| `libreact_codegen_rnscreens.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libreact_codegen_safeareacontext.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libreactnative.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libreanimated.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `librnscreens.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |
| `libstatic-webp.so` | 16 KB pass | 16 KB | 16 KB | 16 KB pass |
| `libworklets.so` | 16 KB pass | 4 KB | 4 KB | 16 KB pass |

## Evidence methods and integrity

The read-only inspection used SHA-256 hashing and file metadata, `unzip`,
bundletool 1.18.3 manifest/config dumps and validation, `jarsigner` normal and
strict verification, `keytool -printcert -jarfile`, Android SDK manifest/APK
analyzers, boundary-aware static string scans, Android Build Tools 36.1.0
`zipalign`, and NDK/LLVM ELF program header inspection. Bundletool output and
extracted files were created only in temporary storage and deleted after
inspection.

The artifact checksum was unchanged after the audit. No application source,
configuration, migration, dependency, lockfile, environment file, Expo/EAS
identity, signing credential, release binary, cloud integration, or Play Console
state was changed. No signing secret or credential material was exposed.

## Superseded versionCode 1 evidence

Historical evidence is retained; its upload disposition has changed.

| Historical property | Preserved value |
| --- | --- |
| Status | **Superseded — do not upload** |
| Artifact | `release-artifacts/KitaMo-1.0.0-production-eas-376b2f1.aab` |
| SHA-256 | `51c515df2b9da82687f68fd553e4f4936801c77bea650c44190ae4538fa6efcd` |
| EAS build ID | `362a9631-f557-4ac4-9b0c-b770c10ea637` |
| Source commit | `376b2f12598d36939d25dd8cd61398ab7bb93746` |
| Package/version | `ph.kitamo.app` / `1.0.0` / versionCode `1` |

All former operator instructions that identify the versionCode 1 artifact,
versionCode 1 release name, or an unspecified "final AAB" for upload are
**Superseded — do not upload**. The historical audit and hashes remain available
in [the independent versionCode 1 audit](claude-independent-pre-release-audit.md)
and [the pre-internal hardening record](pre-internal-hardening-validation.md).

## Current operator rule

1. Use only
   `release-artifacts/KitaMo-1.0.0-vc2-pre-internal-6ed9ace.aab`.
2. Recompute its SHA-256 immediately before upload and require an exact match to
   `9b94ed36f38e26206564a902d93925c6a7645a5472b3e2e19a23a1546ae020cd`.
3. Use release name `1.0.0 (2) - pilot`.
4. Upload only to Google Play Internal Testing after every unresolved owner gate
   below is complete.
5. Any later build or replacement upload must use versionCode `3` or higher.
   Never rebuild or replace a binary while retaining versionCode `2`.

The current execution references are the
[Internal Testing checklist](../play-store/internal-testing-checklist.md),
[Play Console upload checklist](play-console-upload-checklist.md),
[App Content checklist](play-console-app-content-checklist.md), and
[release notes](../play-store/release-notes-internal.md).

## Unresolved owner-controlled gates

| Gate | Status |
| --- | --- |
| Play Console app/access for `ph.kitamo.app` | **Not established** |
| Play App Signing | **Owner action required — not established** |
| Public HTTPS privacy-policy URL | **Not established** |
| Monitored public support email | **Not established** |
| Internal Testing Gmail tester list | **Owner action required — not established** |
| Data Safety declaration | **Prepared but not entered; owner review required** |
| App Access declaration | **Prepared but not entered** |
| Content rating | **Owner action required** |
| Target audience | **Prepared but not entered** |
| Financial-feature declaration | **Prepared but not entered; owner review required** |
| Physical-phone listing screenshots | **Owner action required** |
| VersionCode 2 release notes | **Prepared but not entered** |
| Tester instructions | **Prepared but not distributed** |
| Internal Testing rollout approval | **Owner action required** |
| Play warnings and pre-launch evidence | **Blocked until an owner-authorized upload** |

The drafts remain in the
[privacy-policy document](../play-store/privacy-policy-draft.md),
[store-listing document](../play-store/store-listing-draft.md),
[Data Safety guide](../play-store/data-safety-draft.md), and
[tester plan](tester-plan.md). None of those owner-controlled values or Console
declarations is represented as complete by this artifact designation.
