# Design pack repair checklist

Resumed 2026-11-16 from `41ba181ee4`. Historical review receipts are not
latest-head acceptance. Screenshots remain untouched unless a repaired page
needs a replacement.

| Issue | Status | Fix commit / evidence |
| --- | --- | --- |
| PR base and main integration | Verified | Base `main`, non-draft; `git rev-list --left-right --count HEAD...origin/main` returned `244 0`. |
| Integrated production build | Verified; phone rebuild running | Fresh `npm run build` passed including postbuild gates after chart token adoption; rebuilding phone paragraph repair. |
| Latest-head CI failures | Monitoring | Six workflows at `41ba181ee4`; pending checks remain. |
| CI shards 1/3/6/7: LayoutSwitcher source-preservation receipt | Locally verified; commit pending | Exact new hunk and actual translation projection checked without changing historical hashes. All eight affected test files passed with CI coverage/reporter flags: 8383 tests. |
| CI shard 5: SQL Clear persistence race | Locally verified; commit pending | Editor and storage now awaited together; covered in the same eight-file CI reproduction. |
| Phone saved-layout popup | Verification pending | `8edd91f937`; existing focused browser cases still required. |
| Energy source-state fixture recovery and header tooltip | Verification pending | `8edd91f937`; previous local run was interrupted. |
| Protected dashboard / Digital Twin phone targets and text | Evidence review pending | Reconcile existing fixes and latest CI with historical REVIEW findings. |
| Firefox chart axes | Evidence review pending | Reconcile existing fixes and latest CI with historical REVIEW findings. |
| Phone overflow/readability at 360-430px | Open | Reconcile every unresolved REVIEW finding; no redesign or new matrix. |
| QuickNav explanatory paragraph at 12px on phones | Locally verified; rebuilt-page check pending | Strengthened capture failed on the exact paragraph; three existing harness cases passed after phone-only token repair, including preserved/desktop invariants. |
| Generated-artifact freshness | Verified on starting head | `Generated artifacts are current` passed on `41ba181ee4`; require green again after push. |
| Remaining REVIEW defects | Open | Historical reports must be reconciled individually with subsequent fixes. |
| Contrast violations and incomplete nodes | Open | Previous deferral is not proof of impossibility. |
| Cyber six-capture incomplete contrast nodes | Reviewed; commit pending | All 74 captured nodes exceed the required ratio using complete background/text geometry; minimum conservative bound 4.9403:1. See REVIEW-cyber.md. |
| 0.5px desktop restoration difference | Open | Investigate exact existing comparison; do not loosen tolerance. |
| Remaining token coverage | Open | Preserve rendered values; no cosmetic changes. |
| Four branch-added conditional test skips | Locally verified; commit pending | Removed from two Helix specs, operational-brief responsive and Security Access twin. All 22 cases passed; zero proxy escapes. |
| Browser harness broad error catches | Locally verified; commit pending | Cancellation binding and observer cleanup errors propagate; animation handling accepts only expected AbortError. Existing 96 contracts passed. |
| Delayed harness route fulfillment catches | Locally verified; commit pending | Wait for route handlers before fixture teardown instead of swallowing fulfill failures. Both affected existing cases passed. |
| AreaChartWrapper duplicated axis/grid values | Locally verified; commit pending | Uses identical existing shared values; 38 chart tests passed, ESLint and component audit clean. |
| ElevationProfile spreads a React grid element as props | Open | Token review found `<CartesianGrid {...chartGrid} />`, but chartUtils exports an element. Verify and repair the actual consumer; do not alter accepted pack styles. |
| Broader suppression/baseline/threshold diff review | Open | Initial added-line search found no eslint/TypeScript/stylelint directives or `as any`; full review remains. |
| Docker preview refresh | Open | Rebuild latest repairs; replace only task-owned port 3120 container. |
| PR description and final handoff | Open | Preserve repository template; publish actual final evidence. |

No item is accepted as unfixable without evidence in FOLLOWUPS.md.
