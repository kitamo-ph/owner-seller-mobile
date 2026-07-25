# Validation and Test Inventory

## Purpose and scope

This report inventories available local validation for MOB-0/MOB-1 and records read-only discovery commands. It distinguishes executable checks from physical-device, release, cloud, and end-to-end claims that were not run.

Evidence labels: **Confirmed** is directly supported by inspected scripts/commands; **Likely** is supported but not device verified; **Unresolved** is untested or unavailable; **Proposed for later review** is not current behavior.

## Audit context

| Item | Value |
| --- | --- |
| Inspection date | 2026-07-25 (Asia/Manila) |
| Repository | `/Users/rovs/Documents/KitaMo-ph/owner-seller-mobile` |
| Branch / HEAD | `codex/pre-internal-hardening` / `6ed9ace3a92f7435f84c2f75f0084a03070ae2e4` |
| Package manager | npm (`package-lock.json`) |
| Required Node | `>=20.19.4` |
| Observed Node / npm | `v20.20.2` / `10.8.2` |
| Expo / React Native | Expo `54.0.36` / React Native `0.81.5` installed |
| TypeScript | Declared `~5.9.2`; installed `5.9.3` |

## Available commands

| Command | Classification | Coverage / mutation assessment |
| --- | --- | --- |
| `npm run lint` | Static validation | Expo ESLint; dotenv and telemetry disabled. No intended source mutation. |
| `npm run typecheck` | Static validation | `tsc --noEmit`; no output files. |
| `npm run check:owner-context` | Focused regression | Compiles pure context code into ignored `node_modules/.cache`, then checks active business/stall resolution. |
| `npm run check:owner-pin-security` | Focused regression | Uses in-memory fake secure storage; checks persisted throttle semantics and protected wipe coordination without real PIN data. |
| `npm run check:pricing` | Focused regression | Pure bundle/cart arithmetic. |
| `npm run check:recipes` | Focused regression | Pure selected-lot costing, conversions, and makeable quantity. |
| `npm run check:production` | Focused regression | Pure production plan, shortfall, aggregation, and unit behavior. |
| `npm run check:cogs` | Focused regression | Pure cook-upon-order COGS/shortfall planning. |
| `npm run check:fixedcosts` | Focused regression | Pure fixed-cost recurrence and profit formulas. |
| `npm run check:pilot` | Scenario regression | Combined pure pricing, recipe, production, COGS, fixed-cost, and profit scenario. |
| `npm run check:migrations` | Temporary SQLite integration | Compiles migrations to ignored cache, creates a uniquely named database in the OS temp directory, applies migrations twice, checks checkout-token uniqueness/problem-report presence, then deletes the temp DB. It does not open `kitamo_local.db`. |
| `npm run check:problem-reports` | Temporary SQLite/domain integration | Compiles to ignored cache, uses a temporary SQLite file, validates idempotence and redaction, then removes the temp DB. |
| `npm test` | Unavailable | No `test` script, Jest/Vitest configuration, or tracked test/spec files found. |
| `npm run android` / `npm start` | Interactive development | Available but not appropriate for this documentation-only audit. |
| `eas build -p android --profile …` | Remote build | Profiles exist; not run because it could create new artifacts/use signing infrastructure. |

## Test-boundary assessment

- **Confirmed:** focused scripts cover protected arithmetic and migration properties without using the application’s production database.
- **Confirmed:** there is no general unit-test runner, app-level integration suite, E2E harness, Detox/Playwright configuration, or automated UI/device test.
- **Confirmed:** scripts do not exercise the complete service transaction graphs for checkout, production, transfer, spoilage, or grocery adjustment against Expo SQLite.
- **Likely:** pure-domain coverage is stronger than service/UI integration coverage.
- **Unresolved:** behavior under actual Android process death, concurrent UI actions, disk-full conditions, and device clock/timezone changes.

## Build profiles

| Profile | Distribution / artifact | Node | Other |
| --- | --- | --- | --- |
| `development` | Internal APK | `20.19.4` | Development client |
| `preview` | Internal APK | `20.19.4` | No development client flag |
| `production` | App bundle | `20.19.4` | `autoIncrement: false` |

No build was run. `submit.production` has no configured service-account path.

## Commands executed and discovery outcomes

The following read-only or temporary-only command families were executed. All completed successfully unless an outcome is explicitly noted.

1. Attachment/instruction reads: `sed -n` over the supplied brief; bounded `find`/`sed` for `AGENTS.md` (none found).
2. Repository preflight: `pwd`, `pwd -P`, `git rev-parse`, `git remote -v`, `git branch --show-current`, `git log -1`, `git status`, `git worktree list`, `git show`, and `git merge-base --is-ancestor`.
3. Ignored/nested state: `git status --ignored`, `git ls-files --others --ignored`, and bounded `find` searches. The broad ignored-file listing was very large because installed `node_modules/` is ignored; targeted follow-ups were used.
4. Rename audit: targeted `rg` searches for `KitaMo_android_app`, old GitHub patterns, `/Users/`, Windows drives, repository names, badge/workflow strings, and absolute paths. One separate-PWA README path was found.
5. Identity/config: bounded `find`, `sed`, `rg`, `npm pkg get`, and `EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 npx expo config --type public --json`.
6. Artifact metadata: `find`, `stat`, `shasum -a 256`, `git check-ignore -v`, `git ls-files --error-unmatch`, and targeted `rg`. The artifact was read only by the checksum command and was not unpacked, executed, content-inspected, moved, renamed, or modified.
7. Source evidence: `find`, `rg`, `nl -ba`, and bounded `sed` across `src/db`, migrations, repositories, domain modules, services, stores, routes, scripts, and relevant documentation.
8. Schema replay: a `node -e` reader extracted migration `up` strings, applied them to a uniquely named OS-temp SQLite database through `sqlite3`, queried `sqlite_master`/PRAGMAs, printed evidence, and removed the temp database. Result: 24 tables including `schema_migrations`, 334 columns, 41 declared indexes, 0 triggers, 0 views.
9. Tool/dependency inventory: `node --version`, `npm --version`, `npm ls --depth=0 --json`, `npm pkg get`, and tracked test/config searches. Dependencies were already installed; no install/update ran.
10. One initial combined shell search before the attached milestone brief failed with `zsh: unmatched "` and made no change; searches were rerun as simpler commands. A later deletion-pattern search had the same quoting-only failure and was rerun successfully.
11. Final script inspection: `npm pkg get scripts` reconfirmed the exact definitions and temporary/cache behavior before execution.
12. Final project validation: `npm run typecheck`, `npm run lint`, and all ten `npm run check:*` scripts listed above — all exited 0.
13. Documentation QA: Node JSON/count/required-field parsing, required-file/section checks, relative-link resolution, final-newline checks, and `rg` trailing-whitespace/consistency searches — all passed. One first pass identified a documentation heading that was corrected; a later QA command had a case-normalization bug and was corrected/rerun. Neither failed check changed functional files.
14. Final scope/integrity: `git diff --check`, `git status --short`, `git status --branch --short`, AAB `stat`, and sorted discovery-file inventory — only the new discovery directory is untracked; protected artifact size/timestamp are unchanged.

The final validation outcomes are recorded below after documentation generation.

## Validation outcomes

| Check | Outcome |
| --- | --- |
| `npm run typecheck` | **Passed** (exit 0; `tsc --noEmit`) |
| `npm run lint` | **Passed** (exit 0; Expo ESLint) |
| Ten focused `check:*` scripts | **Passed:** owner context, owner PIN security, pricing, recipes, production, COGS, fixed costs, pilot scenario, migrations, and problem reports |
| `git diff --check` | **Passed** for tracked diffs. Because the discovery directory is entirely untracked, an explicit trailing-whitespace/final-newline scan also passed for all new Markdown/JSON files. |
| Documentation JSON parse | **Passed:** 7 files; declared counts match 24/334/41/10/23/27/21 records; every decision has all 19 required fields |
| Documentation structure/link QA | **Passed:** 13 required Markdown files; required metadata/sections present; 157 relative links resolve |
| `git status --short` | **Passed scope check:** only `?? docs/mob-0-1-discovery/`; no functional/config/lockfile/release file is modified |
| Protected AAB metadata recheck | **Passed:** size and modification timestamp remain 57,120,066 bytes and `2026-07-16T22:18:25+0800` |

No executed validation failed.

### Skipped checks

- `npm test` — skipped because no `test` script, configured unit-test runner, or tracked test/spec suite exists.
- `npm start` and `npm run android` — skipped because they are interactive development sessions and do not add proportionate documentation assurance.
- Native prebuild/Gradle, EAS build/submit, and release rebuild — skipped because they can mutate native/build/signing/artifact state and are outside discovery.
- AAB content/signature/16 KB inspection — skipped to protect the baseline artifact and because it was not requested as a content-analysis gate.
- Emulator/physical-device, Play Console, performance, battery, RAM, and mobile-data validation — skipped because they belong to later approved gates.
- Cloud/sync/authentication tests — skipped because no such implementation exists and this task forbids introducing one.

## Risks

- Compilation-based check scripts write only ignored cache output, but they are not hermetic test packages.
- Temporary SQLite tests use host `sqlite3`, not Expo SQLite on Android.
- The absence of app-level integration/E2E tests leaves transaction/UI wiring risks unresolved.

## Shared Contracts implications

Shared Contracts should reuse arithmetic fixtures conceptually only after explicit approval; the current scripts are mobile regression evidence, not canonical contract tests. MOB-2 should introduce cross-repository fixtures in the appropriate repository rather than modifying these during discovery.

## Evidence sources and files inspected

- `package.json`, `package-lock.json`, `eas.json`, `tsconfig.json`, `eslint.config.js`
- all `scripts/check-*.js`
- relevant pure domain modules compiled by those scripts
- migration sources and runner
- tracked test/spec/config file inventory

## Limitations

No dependency install, network build, native prebuild, EAS build, emulator, device, Play Console, performance, battery, RAM, mobile-data, or signing validation was performed.

## Next approval gate

Only safe local static and temporary regression checks will be run for this discovery diff. Any build, device, release, or cloud validation belongs to a later approved milestone.
