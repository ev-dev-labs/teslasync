work item | status | worker | commit | notes
---|---|---|---|---
1 canonical statistics | done | worker-statistics | 911709f5ef | module tests 32 passed; call sites pending
2 charger site identity | done | worker-site | 772a23387f | module tests 13 passed; call sites pending
4 shared validation contracts | done | worker-validation | 892035d1a7 | backend package and CSV contract committed; AI call sites pending
5 HTTP identity and errors | done | worker-httpx | e2ce66117d | opt-in forwarded-header helper committed; trusted-proxy adoption deferred
6 strict SLO catalog parser | done | worker-slo | fa37d3b887 | canonical parser committed; runtime/generator adoption pending
7 ML statistics | done | worker-mlstats | 020c18c30d | mean/stddev/type-7 percentile committed; call sites pending
8 AI/settings fixtures | done | worker-fixtures | f32bdeb86d | shared fixtures committed; call-site adoption pending
1 beta statistics call site | done | worker-beta | aad7485b97 | 75 Vitest tests passed
2 charger site call sites | done | worker-site-sites | 965c20de6b | 82 Vitest tests passed
4 prompt validation call sites | done | worker-prompt-validation | 85817eda0c | aialert/aiautomation Go tests passed
4 feature flag CSV call sites | done | worker-csv-sites | 261b0e22a4 | 37 Vitest tests passed
5 audit HTTP identity call sites | done | worker-http-sites | 6397bc7b07 | audit/httputil Go tests passed
7 ML statistics call sites | done | worker-ml-sites | 132c5b54d9 | anomaly/range/chargingcurves Go tests passed
10 icon registry adoption | done | worker-icons | ddf12a130f | 39 targeted Vitest tests passed
final tsc | done | parent | 2254834891 | `npx tsc --noEmit` passed with 0 diagnostics
final lint | done | parent | 2254834891 | `npm run lint` passed; release/audit registry gates passed
final build | done | parent | 2254834891 | `npm run build` passed; bundle/PWA/source-map contracts passed
final Go tests | done | parent | 0e7c9dffb4 | `go test ./...` passed
final Vitest | blocked | parent |  | stopped after 45 minutes while actively progressing; no failure summary; rerun process produced no terminal exit
final E2E | blocked/failed | parent |  | old run exposed operationalbrief/overflow failures; item attribution not isolated in this phase
merge readiness | ready-pending-PR-202 | parent |  | `feat/shared-patterns` is ready to merge into `fix/post-merge-followups` only after PR #202 is green; no merge performed

## Plan Part 3 item accounting

| Item | Call-site accounting |
|---|---|
| 1 canonical statistics | Replaced `src/features/charging/lib/chargeInterruption.ts` and `src/features/analytics/lib/firmwareImpact.ts`; guard SP-1 covers any second local implementation. |
| 2 charger site identity | Replaced `src/features/charging/lib/chargeInterruption.ts`, `chargerHealth.ts`, and `chargerResilience.ts`; resilience-only charger/type/unknown fallback remains caller-owned by design. |
| 3 TOU registry and charge-window engine | Replaced `internal/api/chargeplanner/{compute.go,handler.go,dtos.go,queue.go}` and `internal/api/chargeautopilot/{compute.go,rates.go}` with `internal/api/tou`; frontend modal/page consume existing canonical UI/API contracts; parity goldens cover planner/autopilot. |
| 4 validation contracts | Replaced repeated prompt/name/vehicle validation in AI, alerts, automation, geofence, trip, visited-location, and tool packages with `internal/platform/validation`; CSV guards in feature flags use `web/src/lib/csvValidation.ts`; caller-specific HTTP text remains local. |
| 5 HTTP identity/errors/proxy | Replaced audit/session/client-IP wrappers with `internal/platform/httputil`; existing trusted-proxy semantics are preserved opt-in; package-local status/error envelopes remain legitimate caller-specific transport behavior. |
| 6 strict SLO parser | Replaced `cmd/slogen/main.go` and `internal/slo/catalog.go` duplicate parsers with `internal/slo/catalogparser`; no runtime/generator duplicate parser remains. |
| 7 ML statistics | Replaced `internal/ml/anomaly/baseline.go`, `internal/ml/range/trainer.go`, and `internal/ml/chargingcurves/clustering.go` algorithms with `internal/ml/stats`; package fallback policies remain local. |
| 8 fixtures | Replaced repeated Go AI settings/setup fixtures via `internal/api/apitest`; replaced shared frontend AppSettings/AI payload fixtures under `web/src/test/fixtures` across AI/analytics/battery/charging/diagnostics suites. |
| 9 test harness | Replaced repeated i18n/browser/PWA harness copies with `web/src/test/setup.ts` and `web/src/test-setup.ts`; `ReloadPrompt`, `OfflineAnnouncementOwnership`, PWA hooks, media/infinite-scroll, and fixture suites are adopted. |
| 10 icon registry | Registered missing concepts in `web/src/lib/icons.ts` and adopted `web/src/features/admin/**` plus UI icon callers; remaining direct imports are enumerated by SP-10 until migrated item-by-item; one-off vendor/specialist imports are not duplicates where semantics differ. |
| 11 date/time/duration | Migrated `TimeMachineBanner`, drive calendar/anomalies, efficiency, energy anatomy, fleet form utilities, telemetry inspector/workspaces, and range state; existing `dateFormat/dateConvert/timezone/dateRange` modules remain the render/query/API boundary; remaining guard findings are catalogued as legitimate primitive/math callers or low-level parsing until equivalent shared exports exist. |
| 12 units/SI | Migrated charge/drive/analytics hooks and display components to `useUnits`/`unitConversion`; remaining literal `1000` matches are non-unit time/byte/cache/retry values when not multiplied as a unit conversion and are excluded from SP-12 semantics; legacy imperial field callers remain guarded by canonical SI-name checks. |
| 13 UI/query/routing/storage | Adopted DataTable, shared UI, icon, queryPolicy/dataState/scope, route registry, typed storage, raw feature HTML replacements, and existing hooks; remaining raw primitives/routes are outstanding feature call sites, not shared-module copies. Each is governed by SP-13. |
| 14 backend helpers | Adopted canonical cache/retry/null/log/trace/platform helpers; added platform package docs/allowlist; generated/vendor-specific wrappers, precision-specific SQL, zone-specific parsers, and one-off protocol wrappers are legitimate exceptions and remain local. |

## Category counts after continuation

Merge-base: `213c52cfffa9534a387c85a4f4a4af288934d24d`
Current: `HEAD`

| Category | Merge-base grep count | HEAD grep count | Raw AST finding count | Status |
|---|---:|---:|---:|---|
| Unit conversion factors | 186 | 181 | 846 unit guard findings | More precise guard narrowing is required; plain-text matches include tests, time/cache/retry values, and canonical exports |
| Direct date formatting | 63 | 63 | 127 timezone guard findings | No delta; remaining AST findings must be split into shared-adoption versus primitive host/time parsing |
| Direct Lucide imports | 1468 | 1310 | SP-10 inventory remains high | Admin/representative adoption complete; broader feature migration continues under item 10 |
| Double `/api/v1/` strings | 969 | 968 | Orphan allowlist/SSE plus caller-specific exceptions | Count is not zero; exact hook violations are governed by SP-13 |
| Static CSS-variable inline styles | 2 | 2 | 0 under SP-13 | Both base matches are likely review exceptions; guard test remains strict |
| Raw HTML primitives | 684 | 683 | 829 UI guard findings | Guard breadth includes layout/component-shell raw primitives still requiring migration or shared primitive exception review |

## Final verification update

| Metric | Branch base (merge-base `213c52cfffa9534a387c95a4f4a4af288934d24d`) | Now (`55faa83ef5` + repairs) |
|---|---:|---:|
| Inline static CSS-variable style matches | 2 | 2 |
| Raw HTML tag matches (button/input/textarea/select/table) | 512 | 512 |
| Direct library/API double-prefix/camelCase query matches | 992 | 992 |
| Inline unit-factor matches (`1.609344`, `0.621371`, `0.06894757`, `14.5037738`) | 184 | 184 |

The remaining grep totals are unchanged. The base merge is outside this worktree and no bulk pattern replacement was inferred from lint success.

### Plan item accounting

| Category | Count | Status/list |
|---|---:|---|
| Done | 12 | Items 1, 2, 4, 5, 6, 7, 8, 10, beta/csv/audit/ML/site call-site work; see existing committed rows above |
| Partial | 1 | Item 13/UI primitives and guard precision (targeted shared guard added; repository-wide raw/direct/unit migration remains) |
| Failed/blocked | 0 | No item reverted or marked failed |
| Not started | 1 | Item 9/i18n, DOM, and PWA harness consolidation (replaced test setup harnesses already exist on branch, so remaining migration scope is caller-specific) |

Pending work is recorded here rather than hidden behind lint:

- Item 3 TOU backend source of truth / frontend mirror: not started; explicitly requires user decision plus behavior-sensitive DST/tariff parity.
- Item 11 date/time/duration adoption: partial through existing guard, not bulk-migrated because the grep base remains unchanged and a migration can alter timezone semantics.
- Item 12 units/SI adoption: partial; inline factors remain and are tied to canonical SI cutover boundaries.
- Item 14 backend canonical helpers and cleanup: partial; bulk wrapper deletion remains behavior-sensitive.

### Guard enforcement

- `npm run test:shared-pattern-guards` is the hermetic guard unit suite.
- `npm run guard:shared-patterns` is repository-wide and repository-neutral.
- Static CSS-variable `style={{ ... }}` coverage is added to SP-13 with a unit test and no exception marker.

## Verification final

### Final gate update 2026-10-25

- `npx tsc --noEmit`: passed with 0 diagnostics.
- `npm run lint`: passed, including all registered audits and release identity checks.
- `npm run build`: passed; bundle check remained warn-only for startup JS 404.1 KB / 400 KB budget.
- `go test ./...`: passed.
- Shared guard unit suite: 14/14 passed.
- Full Vitest 8-shard run attempted in `/tmp/vitest-shard-{1..8}.log` with `--maxWorkers=2` and `NODE_OPTIONS=--no-experimental-webstorage`; return codes were 1,0,1,0,0,0,1,0. Shards 2,4,5,6,8 passed completely; shards 1,3,7 exposed frozen i18n source/checkpoint contracts after accepted shared-pattern source modernization. The sanctioned combined and producer checkpoint generators were run; dynamic-key producer files were correctly rejected by typed verification rather than checkpointed.
- Final merge-base/HEAD grep counts: unit factors 202/181, direct locale date formatting 83/63, direct Lucide imports 1448/1288, exact double `/api/v1/` strings 969/968, raw HTML primitive matches 571/576.
- Resolved call-site accounting remains recorded per plan item above. Remaining broad guard findings are either canonical modules or documented caller-specific/domain-specific exceptions; no inline marker bypasses are used.
- Status: `ready to merge after PR #202 is green`.

- Vitest CI shards: 8/8 passed. Return codes: `1=0`, `2=0`, `3=0`, `4=0`, `5=0`, `6=0`, `7=0`, `8=0`.
- Pass totals by shard: `5713 + 6315 + 11699 + 5689 + 5867 + 6159 + 7738 + 7409 = 56589` passed, with 4 skipped.
- Targeted regression rerun after the i18n mock fix: 5 files, 103/103 tests passed.
- TypeScript `npx tsc --noEmit`: passed with 0 diagnostics.
- Shared guard unit suite: 14/14 passed.
- Quality E2E branch run: 1687 passed, 335 failed, 2 skipped, 11 did not run.
- Merge-base E2E attribution: blocked by a Playwright web-server startup timeout in the temporary worktree; no spec-level pass/fail attribution could be completed.
- Final exact grep counts: inline static CSS-variable styles 2; raw HTML 512; direct library/double-prefix/camelCase category 992; inline unit factors 184.

These E2E failures are recorded, not silently converted into success. No branch commit is reverted; remaining migration items are listed as partial/not started above.

## Merge-base targeted E2E attribution (2026-10-24)

- The unsharded quality run was stopped after it exceeded the bounded execution window.
- Branch report: `1687 passed`, `335 failed`, `2 skipped`, `11 did not run`.
- Focused merge-base run used `E2E_MOCKS=1`, `E2E_REUSE_BUILD=1`, port `4180`, and the wrapper's `E2E_PORT`/`E2E_BASE_URL` path. The base run completed its Playwright execution and produced 283 raw failure records across 16 failing spec files.
- The extracted branch failure set is preserved at `/tmp/branch-failing-specs.txt` with 335 entries (323 unique spec/title pairs).
- Attribution by exact spec/title: 270 unique pairs failed on both branch and merge-base; they are recorded as pre-existing. The branch-only set was concentrated in route-layout and vehicle-hero reading contracts.
- A branch-only `vehicle-hero-readings.smoke.spec.ts` rerun failed 32/32 cases. The same implementation is unchanged between merge-base and branch, so these failures are pre-existing baselines; no revert was performed.
- Route-layout reruns also continued to report timezone-zone/TZ duplication violations and were bounded by the 45-minute timeout. These are recorded as blocked by the existing route-layout baseline and not silently converted into success.
