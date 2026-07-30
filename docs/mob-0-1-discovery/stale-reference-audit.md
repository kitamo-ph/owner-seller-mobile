# Stale Reference Audit

## Purpose and scope

This MOB-0 report classifies rename and relocation references for the former repository name `KitaMo_android_app`, old local paths, the authoritative name `owner-seller-mobile`, developer-specific absolute paths, and obsolete GitHub URLs. It is an audit only; no reference was automatically replaced.

Evidence labels: **Confirmed** is directly supported by inspected local evidence; **Likely** is supported but not independently guaranteed; **Unresolved** was not verifiable in scope; **Proposed for later review** is not current behavior.

## Audit context

| Item | Value |
| --- | --- |
| Inspection date | 2026-07-25 (Asia/Manila) |
| Repository | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Branch / HEAD | `codex/pre-internal-hardening` / `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4` |
| Search scope | Tracked source, scripts, configuration, documentation; targeted checks of ignored/generated locations |

## Confirmed findings

| Match | Classification | Evidence and disposition |
| --- | --- | --- |
| `KitaMo_android_app` | No result | **Confirmed:** no tracked source, script, configuration, CI, or documentation match. |
| Obsolete `github.com/.../KitaMo_android_app` | No result | **Confirmed:** no result. Local Git remote is the authoritative URL. |
| `owner-seller-mobile` / `github.com/kitamo-ph/` in tracked content | No stale result | **Confirmed:** there is no hard-coded workflow/script dependency on the repository directory name. Git remote metadata supplies the authoritative URL. |
| `/Users/rovs/Documents/KitaMo` in `README.md:700` | Active documentation reference; not the relocated Android path | **Confirmed:** the line explicitly identifies a separate PWA repository and warns not to modify it from Android. It is developer-specific and non-portable, but it is not a stale reference to this repository. Leave unchanged pending approval. |
| `.env.local` | Secret-bearing file not inspected | **Confirmed:** file exists and is ignored. Values were not printed or copied. A content-suppressing exact-pattern check found no former repository name. |
| `.expo/`, `dist/`, `release-artifacts/` | Generated/local artifacts | **Confirmed:** ignored. Targeted former-name checks found no material tracked reference; these locations are not documentation or CI authority. |
| Windows drive paths | No result | **Confirmed:** no tracked match for `[A-Za-z]:\\`. |
| CI configuration | Absent | **Confirmed:** no `.github` workflow files were found, so there is no CI repository-name reference to update. |
| Badges | No repository badge URL found | **Confirmed:** tracked docs contained no rename-sensitive badge target. |

## Likely findings

- The README’s separate PWA absolute path is likely intentional historical/operational guidance. It is non-portable, so a later documentation-only change could replace it with a configurable or relative description if the repository owner approves.
- Because app and build scripts run from the current working directory and contain no absolute Android repository path, relocation should not affect their behavior.

## Unresolved findings

- Generated artifacts may contain build-machine paths that were not exhaustively decoded. They are ignored and are not source authority.
- Secret-bearing files were not inspected for arbitrary values. Only a content-suppressing former-name presence check is appropriate without separate authorization.
- Remote GitHub-side badges, Actions settings, repository rules, and EAS dashboard metadata cannot be inferred from local tracked files.

## Risks

- Copy-pasting the separate PWA path from `README.md:700` on another machine will fail.
- An absent tracked repository URL means consumers must obtain authority from Git metadata or this discovery report; that is not currently a functional problem.

## Shared Contracts implications

No stale former-name mapping needs to be carried into Shared Contracts. The Android evidence source should be named `kitamo-ph/owner-seller-mobile`; references to the separate PWA repository must not be conflated with the mobile source.

## Evidence sources and files inspected

- `README.md`
- `docs/**`
- `scripts/**`
- `package.json`, `app.json`, `eas.json`, `.gitignore`
- Presence-only checks for `.env.local`
- Bounded inventories of `.github`, `.expo`, `dist`, and `release-artifacts`

## Commands executed and outcomes

- `rg -n --hidden` with exclusions for `.git`, `node_modules`, build output, `dist`, and `.expo` against former name, GitHub URL, `/Users/`, and Windows paths — one separate-PWA absolute path; no former repository match.
- A second targeted `rg` for `owner-seller-mobile` and `github.com/kitamo-ph/` — no rename-sensitive tracked dependency.
- `find .github`, `find` for configuration/scripts/docs, and file inventories — no CI workflow.
- Content-suppressing `rg -q` checks for the former name in ignored sensitive/generated locations — no reported former-name hit; no values emitted.

## Limitations

The audit does not inspect remote connector settings, GitHub Actions variables, EAS web metadata, IDE recent-workspace databases, shell history, or secret values. Generated binary content was not opened.

## Next approval gate

No active stale reference requires a change. Any portability edit to the separate PWA path must wait for explicit approval at Verification Pause A.
