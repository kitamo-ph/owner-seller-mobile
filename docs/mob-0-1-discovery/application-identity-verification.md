# Application Identity Verification

## Purpose and scope

This report traces the effective local Expo/EAS application identity after the repository relocation. It does not alter package identity, Expo/EAS linkage, versions, update behavior, plugins, build profiles, or signing.

Evidence labels: **Confirmed** is directly supported by static/resolved configuration; **Likely** is supported but not native-artifact verified; **Unresolved** was not verifiable in scope; **Proposed for later review** is not current behavior.

## Audit context

| Item | Value |
| --- | --- |
| Inspection date | 2026-07-25 (Asia/Manila) |
| Repository | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Branch / HEAD | `codex/pre-internal-hardening` / `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4` |
| Configuration form | Static `app.json`; no `app.config.js` or `app.config.ts` found |

## Effective identity

| Identity field | Effective value | Status and evidence |
| --- | --- | --- |
| Display name | `KitaMo` | **Confirmed** by `app.json:3` and public Expo config resolution. |
| Expo slug | `kitamo-android` | **Confirmed** by `app.json:4`. It was not changed to match the folder/repository rename. |
| Android package | `ph.kitamo.app` | **Confirmed** by `app.json:30` and `EXPO_NO_DOTENV=1 npx expo config --type public --json`. |
| Version | `1.0.0` | **Confirmed** by `app.json:5` and resolved Expo config. |
| Android versionCode | `2` | **Confirmed** by `app.json:31` and resolved Expo config. |
| Expo owner | `kitamoandroidapp` | **Confirmed** by `app.json:56`. |
| EAS project ID | `d2ab769c-4916-4efa-ab1e-a2dfdc638607` | **Confirmed** by `app.json:60`; unchanged and linked under `extra.eas.projectId`. |
| Scheme | `kitamo` | **Confirmed** by `app.json:7`. |
| Deep links | Custom scheme only in tracked config | **Confirmed:** no tracked `https` intent/app-link or additional linking config was found. Expo Router is the navigation plugin. |
| iOS bundle identifier | Not declared | **Confirmed:** `ios` contains `supportsTablet: false` only. |
| Runtime version | Not declared | **Confirmed:** neither static nor resolved public config contains `runtimeVersion`. |
| Update configuration | Not declared | **Confirmed:** no `updates` block and no direct `expo-updates` dependency. This does not independently prove native artifact behavior. |
| Dynamic identity overrides | None found | **Confirmed:** no dynamic app config or identity-related `process.env` access exists in tracked app configuration. |

## Configuration chain

```text
package.json (Expo Router entry; dependency versions)
        ↓
app.json (static app identity and plugins)
        ↓
Expo public-config resolver with dotenv/telemetry disabled
        ↓
effective Android package ph.kitamo.app
        +
eas.json (build profile behavior; does not override identity)
```

`expo-env.d.ts` is Expo-generated and ignored. A local `.env.local` exists but is secret-bearing and was not read; more importantly, no dynamic app-config module or identity-related `process.env` expression exists, and validation/start scripts explicitly set `EXPO_NO_DOTENV=1`.

## Build and signing references

- **Confirmed:** `eas.json` uses `appVersionSource: local`.
- **Confirmed:** development and preview profiles use internal-distribution APKs with Node `20.19.4`.
- **Confirmed:** production uses Node `20.19.4`, `autoIncrement: false`, and Android `app-bundle`.
- **Confirmed:** `submit.production` is present but empty.
- **Confirmed:** tracked files contain no `.jks` or `.keystore`.
- **Confirmed:** `expo-secure-store` is configured with Android backup disabled; this affects protected local storage, not package identity.
- **Previously documented, not revalidated:** `docs/release/release-engineering-environment.md` describes EAS-managed Android credentials.
- **Unresolved:** signing identity and lineage were not inspected because credentials and protected artifact contents are out of scope.

## App-config plugins affecting the built app

| Plugin | Current configured role | Identity impact |
| --- | --- | --- |
| `expo-router` | File-based routing and scheme integration | Does not override the declared package, owner, or project ID. |
| `expo-secure-store` | Secure local owner-access state; Android backup configuration disabled | Does not override package identity. |
| `expo-local-authentication` | Biometric Owner unlock support | Adds native capability/configuration; does not override package identity. |

## Confirmed, likely, unresolved

- **Confirmed:** protected package `ph.kitamo.app`, Expo owner, slug, and EAS project ID survived the local folder/repository rename.
- **Confirmed:** values are statically derived from `app.json`; `eas.json` contains no identity override or environment-specific `env` block.
- **Likely:** the custom `kitamo` scheme is the only deep-link entry generated from tracked app configuration.
- **Unresolved:** native generated manifest details, update enablement, signing certificate, and remote EAS project ownership were not inspected in the protected AAB or EAS dashboard.
- **Proposed for later review:** Shared Contracts should treat package, EAS project ID, and slug as deployment identity, not domain entity identifiers.

## Risks

- No tracked iOS bundle ID exists; an eventual iOS target would require a separate approved identity decision.
- With `autoIncrement: false`, a later release process must deliberately manage versionCode; discovery does not change it.
- Absence of `runtimeVersion`/`updates` is a current configuration fact, not a recommendation.

## Shared Contracts implications

Shared Contracts must not rename or derive Android domain behavior from repository/folder identity. `ph.kitamo.app`, `kitamo-android`, and the EAS project UUID are deployment metadata and remain mobile-owned.

## Evidence sources and files inspected

- `app.json`
- `eas.json`
- `package.json` and `package-lock.json`
- `expo-env.d.ts` presence/generation status
- `.gitignore`
- tracked source/config searches for `process.env`, `runtimeVersion`, `updates`, `bundleIdentifier`, package, owner, scheme, and project ID
- resolved public Expo configuration
- release documentation for clearly labeled prior signing claims

## Commands executed and outcomes

- `find` for app/EAS/native/signing config files — only static Expo/EAS config found; no checked-in native Android project or signing file.
- `EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 npx expo config --type public --json` — resolved package `ph.kitamo.app` and the static identity above.
- `rg` for dynamic config, environment access, runtime/update/deep-link/bundle fields — no dynamic identity override.
- Environment key-name/presence checks — `.env.local` exists; values were not emitted.

## Limitations

No EAS API/dashboard, signing keystore, Android native prebuild, AAB manifest, iOS build, physical device, or Play Console was inspected. No claim of Google Play readiness is made.

## Next approval gate

The identity chain is suitable for MOB-0 recommendation. Any package, slug, owner, project, version, scheme, runtime, update, signing, or build-profile change is expressly outside this milestone and requires separate approval.
