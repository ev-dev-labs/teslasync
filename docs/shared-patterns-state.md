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
