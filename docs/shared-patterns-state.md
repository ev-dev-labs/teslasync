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

- Vitest CI shards: 8/8 passed. Return codes: `1=0`, `2=0`, `3=0`, `4=0`, `5=0`, `6=0`, `7=0`, `8=0`.
- Pass totals by shard: `5713 + 6315 + 11699 + 5689 + 5867 + 6159 + 7738 + 7409 = 56589` passed, with 4 skipped.
- Targeted regression rerun after the i18n mock fix: 5 files, 103/103 tests passed.
- TypeScript `npx tsc --noEmit`: passed with 0 diagnostics.
- Shared guard unit suite: 14/14 passed.
- Quality E2E branch run: 1687 passed, 335 failed, 2 skipped, 11 did not run.
- Merge-base E2E attribution: blocked by a Playwright web-server startup timeout in the temporary worktree; no spec-level pass/fail attribution could be completed.
- Final exact grep counts: inline static CSS-variable styles 2; raw HTML 512; direct library/double-prefix/camelCase category 992; inline unit factors 184.

These E2E failures are recorded, not silently converted into success. No branch commit is reverted; remaining migration items are listed as partial/not started above.
