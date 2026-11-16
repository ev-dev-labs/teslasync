# Design pack repair checklist

Resumed 2026-11-16 from `41ba181ee4`. Historical review receipts are not
latest-head acceptance. Screenshots remain untouched unless a repaired page
needs a replacement.

| Issue | Status | Fix commit / evidence |
| --- | --- | --- |
| PR base and main integration | Verified | Base `main`, non-draft, mergeable; refreshed `git rev-list --left-right --count HEAD...origin/main` returned `245 0`. |
| Integrated production build | Verified | Fresh `npm run build` passed after chart-grid and light-axis repairs, including postbuild gates. |
| Latest-head CI failures | Monitoring | Six workflows at `a1eaf45a9b`; unfinished quality jobs rerun once after 45 minutes. No test failure observed in that cohort; pending checks remain. |
| Serial cross-browser profile execution exceeds 45 minutes | Locally verified; commit pending | Direct log shows phase 18/23 after 43 minutes, not a deadlock. Two workers preserve all existing profiles/phases/jobs. Four existing Firefox/WebKit cases passed in parallel (2.7m); loopback preview errors 0. Actionlint passed. |
| CI shards 1/3/6/7: LayoutSwitcher source-preservation receipt | Fixed | `a1eaf45a9b`: exact successor hunk and actual translation projection checked without changing historical hashes. Eight affected files passed with CI coverage/reporter flags: 8383 tests. |
| CI shard 5: SQL Clear persistence race | Fixed | `a1eaf45a9b`: editor and storage awaited together; covered in the same eight-file CI reproduction. |
| Phone saved-layout popup | Verification pending | `8edd91f937`; existing focused browser cases still required. |
| Energy source-state fixture recovery and header tooltip | Verified | `8edd91f937`: all four source-state cases passed (31.6m); tooltip case passed separately. Both wrapper runs reported zero proxy escapes. |
| Protected dashboard / Digital Twin phone targets and text | Evidence review pending | Reconcile existing fixes and latest CI with historical REVIEW findings. |
| Firefox chart axes | Evidence review pending | Reconcile existing fixes and latest CI with historical REVIEW findings. |
| Phone overflow/readability at 360-430px | Open | Reconcile every unresolved REVIEW finding; no redesign or new matrix. |
| Editorial / Terminal / Bauhaus / Warm Modern / Neo Brutal phone stat units | Locally verified; commit pending | Existing selectors now include stat-card context/units. Red run: 8 failed/8 passed. Repaired run: 16 passed. Both all-pack context cases also pass at 360/390/430px and scales 0.85/1/1.35, including Warm Modern. |
| QuickNav explanatory paragraph at 12px on phones | Verified | `a1eaf45a9b`: three existing harness cases and all 12 rebuilt Cyber Dashboard/Drives/Energy captures pass; desktop/protected text remains unchanged. |
| Generated-artifact freshness | Verified on starting head | `Generated artifacts are current` passed on `41ba181ee4`; require green again after push. |
| Remaining REVIEW defects | Open | Historical reports must be reconciled individually with subsequent fixes. |
| Contrast violations and incomplete nodes | Open | Previous deferral is not proof of impossibility. |
| Blueprint / Observatory patterned widget text contrast | Locally verified; commit pending | Existing secondary ink fixes actual below-AA metadata without changing backgrounds. 64 Blueprint and 48 Observatory painted nodes pass; minima 5.6363:1 and 4.5695:1. All eight phone/desktop capture cases pass. |
| Observatory Verified label intersects its radial gauge | Locally verified; commit pending | Center the radial headline; retain the default ring and scale it with larger saved text. Native SVG geometry/data remain unchanged. Four scale-1.35 captures and all 50 painted nodes pass, including the explicitly selected label. |
| Light chart ticks on raised surfaces | Locally verified; commit pending | Light-only override uses existing secondary ink. Actual-stylesheet regression and five affected-pack real-page captures pass. All 33 incomplete nodes meet their bounds (minimum 5.5802:1). |
| Cyber six-capture incomplete contrast nodes | Reviewed | `a1eaf45a9b`: all 74 captured nodes exceed the required ratio using complete background/text geometry; minimum conservative bound 4.9403:1. See REVIEW-cyber.md. |
| V4 blurred table-header contrast incompletes | Reviewed; evidence pending commit | Original/transparent-text crops sample 1,900 background pixels per theme: minimum contrast 17.0263:1 dark, 17.2314:1 light. Both focused captures passed. |
| 0.5px desktop restoration difference | Open | Investigate exact existing comparison; do not loosen tolerance. |
| Remaining token coverage | Open | Preserve rendered values; no cosmetic changes. |
| Four branch-added conditional test skips | Fixed | `a1eaf45a9b`: removed from two Helix specs, operational-brief responsive and Security Access twin. All 22 cases passed; zero proxy escapes. |
| Browser harness broad error catches | Fixed | `a1eaf45a9b`: cancellation binding and observer cleanup errors propagate; animation handling accepts only expected AbortError. Existing 96 contracts passed. |
| Delayed harness route fulfillment catches | Fixed | `a1eaf45a9b`: wait for route handlers before fixture teardown instead of swallowing fulfill failures. Both affected existing cases passed. |
| AreaChartWrapper duplicated axis/grid values | Fixed | `a1eaf45a9b`: identical shared values; 38 chart tests passed, ESLint and component audit clean. |
| ElevationProfile spreads a React grid element as props | Locally verified; commit pending | Regression reproduced missing theme stroke; render the real shared element. Four focused files passed (44 tests), ESLint and TypeScript passed. Small labels retain the existing 10px size. |
| SmallMultiplesChart and heatmap duplicated presentation values | Locally verified; commit pending | Shared 9px axis role and identical heatmap cell class. 72 focused token/heatmap tests pass. Exact inverse source proofs retain every historical hash; 628 preservation tests pass. |
| Broader suppression/baseline/threshold diff review | Open | Initial added-line search found no eslint/TypeScript/stylelint directives or `as any`; full review remains. |
| Docker preview refresh | Open | Rebuild latest repairs; replace only task-owned port 3120 container. |
| Repaired-page screenshots | Verified | Ten targeted captures passed; only their ten existing dashboard images were replaced. No additions, deletions or bulk regeneration. |
| PR description and final handoff | Open | Preserve repository template; publish actual final evidence. |

No item is accepted as unfixable without evidence in FOLLOWUPS.md.
