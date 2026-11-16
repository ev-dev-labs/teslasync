# Design pack repair checklist

Resumed 2026-11-16 from `41ba181ee4`. Historical review receipts are not
latest-head acceptance. Screenshots remain untouched unless a repaired page
needs a replacement.

| Issue | Status | Fix commit / evidence |
| --- | --- | --- |
| PR base and main integration | Verified | Base `main`, non-draft, mergeable; refreshed `git rev-list --left-right --count HEAD...origin/main` returned `245 0`. |
| Integrated production build | Verified | Fresh `npm run build` passed after chart-grid and light-axis repairs, including postbuild gates. |
| Latest-head CI failures | Monitoring | `f2a7691240`: two independent failures below; coverage/frontend/CI aggregates fail from those dependencies. Remaining quality jobs continue while repairs are verified. |
| `f2a7691240` frontend lint pins obsolete one-worker execution | Locally verified; commit pending | Six workflow contracts pass; require exactly two workers for existing phase and replay commands, retaining all discovery/coverage assertions. Full lint passed. |
| `f2a7691240` shard 2 omits the shared heatmap-token inverse | Locally verified; commit pending | Exact additive shared-cell subtraction preserves the unchanged historical digest; missing/altered tokens are rejected. The CI reproduction passes, and the final seven-file batch passes 831 tests with coverage enabled. |
| Branch-added silent quota-recovery Promise catches | Locally verified; commit pending | Report lazy-module failures through the existing privacy-aware reporter; refetch the exact active query through QueryClient, retaining errors in Query state. Recovery tests: 17 passed. Strict startup budget: 399.4 KB / 400 KB. |
| Backup pending-mutation test ends before the success update | Locally verified; commit pending | Resolve inside `act` and await the restored enabled action. Four tests pass without the former React warning; included in the 831-test batch. |
| Serial cross-browser profile execution exceeds 45 minutes | Fixed; CI verification pending | `f2a7691240`: direct log showed phase 18/23 after 43 minutes, not a deadlock. Two workers preserve all existing profiles/phases/jobs. Four existing Firefox/WebKit cases passed in parallel (2.7m); loopback preview errors 0. Actionlint passed. |
| CI shards 1/3/6/7: LayoutSwitcher source-preservation receipt | Fixed | `a1eaf45a9b`: exact successor hunk and actual translation projection checked without changing historical hashes. Eight affected files passed with CI coverage/reporter flags: 8383 tests. |
| CI shard 5: SQL Clear persistence race | Fixed | `a1eaf45a9b`: editor and storage awaited together; covered in the same eight-file CI reproduction. |
| Phone saved-layout popup | Verified | `8edd91f937`; existing Native progress 390px/dark case passed (5.2m), traversing all 27 packs and checking the real popup's viewport containment. |
| Selected layout unavailable to screen readers | Verified | `a3177bf897`: stable trigger name plus `aria-describedby` exposes the live selected name; existing tests assert its accessible description. |
| Energy source-state fixture recovery and header tooltip | Verified | `8edd91f937`: all four source-state cases passed (31.6m); tooltip case passed separately. Both wrapper runs reported zero proxy escapes. |
| Protected dashboard / Digital Twin phone targets and text | Verified | `8d41a1b725`: original Classic/Pixel 360/430 checks passed; the current 27-pack review has no remaining Twin target/text failures. Native progress also passes all 27 packs. |
| Firefox chart axes | Verified | `f9c93755bf`: three Firefox notification-axis cases passed, including custom font/locale. `f2a7691240` also repairs the independent light-axis contrast defect without changing geometry. |
| Phone overflow/readability at 360-430px | Verified in existing checks | Existing 27-pack context cases pass all three widths and three font scales; the 324-case review's ten small-unit failures were repaired and rechecked. Broader latest-head CI remains required. |
| Editorial / Terminal / Bauhaus / Warm Modern / Neo Brutal phone stat units | Verified | `f2a7691240`: existing selectors now include stat-card context/units. Red run: 8 failed/8 passed. Repaired run: 16 passed. Both all-pack context cases also pass at 360/390/430px and scales 0.85/1/1.35, including Warm Modern. |
| QuickNav explanatory paragraph at 12px on phones | Verified | `a1eaf45a9b`: three existing harness cases and all 12 rebuilt Cyber Dashboard/Drives/Energy captures pass; desktop/protected text remains unchanged. |
| Generated-artifact freshness | Verified on last pushed head | `Generated artifacts are current` passed on `f2a7691240`; require green again after the repair push. |
| Remaining REVIEW defects | Reconciliation in progress | Shared Twin, navigation text, units, contrast and pending-fixture findings have newer evidence; exact desktop restoration remains separately tracked below. Aesthetic redesign suggestions are not applied. |
| Contrast violations and incomplete nodes | Verified for reviewed nodes | `f2a7691240`: all 1,593 nodes from the existing 27-pack review are accounted for: 1,533 conservative passes, 58 repaired patterned-text/axis nodes, and two actually sampled V4 blurred headers. No Axe exclusions. |
| Blueprint / Observatory patterned widget text contrast | Verified | `f2a7691240`: existing secondary ink fixes actual below-AA metadata without changing backgrounds. 64 Blueprint and 48 Observatory painted nodes pass; minima 5.6363:1 and 4.5695:1. All eight phone/desktop capture cases pass. |
| Observatory Verified label intersects its radial gauge | Verified | `f2a7691240`: center the radial headline; retain the default ring and scale it with larger saved text. Native SVG geometry/data remain unchanged. Four scale-1.35 captures and all 50 painted nodes pass, including the explicitly selected label. |
| Light chart ticks on raised surfaces | Verified | `f2a7691240`: light-only override uses existing secondary ink. Actual-stylesheet regression and five affected-pack real-page captures pass. All 33 incomplete nodes meet their bounds (minimum 5.5802:1). |
| Cyber six-capture incomplete contrast nodes | Reviewed | `a1eaf45a9b`: all 74 captured nodes exceed the required ratio using complete background/text geometry; minimum conservative bound 4.9403:1. See REVIEW-cyber.md. |
| V4 blurred table-header contrast incompletes | Verified | `f2a7691240` evidence: original/transparent-text crops sample 1,900 background pixels per theme: minimum contrast 17.0263:1 dark, 17.2314:1 light. Both focused captures passed. |
| 0.5px desktop restoration difference | Open | Investigate exact existing comparison; do not loosen tolerance. |
| Remaining token coverage | Verified for shared presentation gaps | `a1eaf45a9b` and `f2a7691240`: shared axis, grid, small-label and heatmap roles replace identical repeated values. Inventory distinguishes palette definitions, protected illustration paint and unowned feedback fallbacks from pack-token gaps; see DECISIONS.md. |
| Four branch-added conditional test skips | Fixed | `a1eaf45a9b`: removed from two Helix specs, operational-brief responsive and Security Access twin. All 22 cases passed; zero proxy escapes. |
| Browser harness broad error catches | Fixed | `a1eaf45a9b`: cancellation binding and observer cleanup errors propagate; animation handling accepts only expected AbortError. Existing 96 contracts passed. |
| Delayed harness route fulfillment catches | Fixed | `a1eaf45a9b`: wait for route handlers before fixture teardown instead of swallowing fulfill failures. Both affected existing cases passed. |
| AreaChartWrapper duplicated axis/grid values | Fixed | `a1eaf45a9b`: identical shared values; 38 chart tests passed, ESLint and component audit clean. |
| ElevationProfile spreads a React grid element as props | Verified | `f2a7691240`: regression reproduced missing theme stroke; render the real shared element. Four focused files passed (44 tests), ESLint and TypeScript passed. Small labels retain the existing 10px size. |
| SmallMultiplesChart and heatmap duplicated presentation values | Verified | `f2a7691240`: shared 9px axis role and identical heatmap cell class. 72 focused token/heatmap tests pass. Exact inverse source proofs retain every historical hash; 628 preservation tests pass. The additional stale direct test is tracked above. |
| Broader suppression/baseline/threshold diff review | Verified; final-head recheck required | Added-line scans against main and feature/app-design-themes find no prohibited directives, casts, test skips/only/todo or Axe exclusions. Negative transport probes assert their failure ledgers; bridge/module errors are explicitly exposed. Historical fingerprints and thresholds are unchanged. |
| Docker preview refresh | Open | Rebuild latest repairs; replace only task-owned port 3120 container. |
| Repaired-page screenshots | Verified | Ten targeted captures passed; only their ten existing dashboard images were replaced. No additions, deletions or bulk regeneration. |
| PR description and final handoff | Open | Preserve repository template; publish actual final evidence. |

No item is accepted as unfixable without evidence in FOLLOWUPS.md.
