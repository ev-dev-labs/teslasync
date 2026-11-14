# Glass Current bounded review

Status: **passed-with-notes** for the bounded review only, not a full pass.
This is a two-round, three-page, two-viewport review, not full-app,
cross-theme or complete accessibility acceptance.

## Round 1

With `DESIGN_PACK_CAPTURE_OUTPUT_ROOT` set to
`D:\repos\teslasync\docs\design-packs\shots\glass`, ran:

```text
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs glass

  4 failed
  2 passed (3.0m)
GLASS_CAPTURE_ROUND_1_EXIT=1
```

Inspected all six viewport images: Dashboard, Drives and Energy at 390px and
desktop. Copies and the complete diagnostic output are in `shots\glass\round-1`.
The 390px Dashboard, Drives and Energy diagnostics failed; desktop Drives
also failed because `/api/v1/pinned` was still pending in the mock routing
check. Its image was produced before the failure; its contrast audit did not
run. Desktop Dashboard and Energy completed.

The five most important findings:

1. All three phone routes reported the bottom-tab buttons at **11px**, even
   though their child labels were larger. The button itself needs the saved,
   at-least-16px mobile body size.
2. The framed page header forced actions onto a second row on phones, leaving
   particularly conspicuous empty space beside Energy's single bookmark.
3. Dashboard's layout control truncated the selected name to
   “Implementation rev...” instead of allowing the name to wrap.
4. Text-bearing surface gradients made automatic contrast assessment
   indeterminate: phone Drives had **21** and Energy **7** manual-review
   nodes; desktop Energy had **27**. Replace these gradients with opaque,
   token-derived surfaces and reflected inset edges.
5. Phone Dashboard reported a **14px** recent-drive context, **12px**
   widget footer links and other small text, including the protected twin.
   Enlarge owned, non-protected mobile context and links; the protected
   subtree requires the shared follow-up.

Each completed Axe scan reported zero violated contrast rules, but incomplete
nodes are not a contrast pass. Counts were 0/21/7 for phone
Dashboard/Drives/Energy and 2/not run/27 for desktop.
The protected twin's 36×36 Open target and 10×28 refresh target also failed
the phone Dashboard diagnostic. See `requests\glass.md`.

## Round 2

The same command exited **1**:

```text
  1 failed
  5 passed (2.0m)
GLASS_CAPTURE_ROUND_2_EXIT=1
```

Inspected all six final viewport images in `shots\glass\phone-390-scale-1`
and `shots\glass\desktop-scale-1`; raw output is `shots\glass\round-2.log`.
Phone Drives and Energy and all three desktop cases completed. Phone Dashboard
still failed its touch and body-size checks: Open remained 36×36, refresh
10×28, “Digital twin”, “—” and “Aurora” were 14px, and a `km` metric unit
was 12px. The two controls and twin are protected; the unit's ancestry was
not established at capture time. The follow-up below identifies it. Do not
treat this as a phone accessibility pass.

The bottom-tab 11px findings, recent-drive context and footer-link findings
were absent from the final diagnostic. The Energy title and bookmark now
share a compact phone row. The selected dashboard layout name wraps instead
of being truncated, but the final phone image shows its **“Layout” label
split as “Layo” / “ut”**. That capture predates the bounded CSS fix below;
the two permitted screenshot rounds are exhausted.

Opaque surfaces and reflected edges replaced text-bearing gradients. All six
final Axe scans reported zero violated contrast rules. Manual-review counts
were **0/1/0** on phone Dashboard/Drives/Energy and **1/3/13** on desktop;
overlap and chart-label/image cases remain unverified, not contrast passes.

## Other checks and limits

- Before the last header typography adjustment, the focused Glass/Material
  native-composition, metric and steps checks reported `3 passed` files and
  `18 passed | 174 skipped` tests. They were not rerun afterward.
- A screenshot-free synthetic Edge fixture measured 360/390/430px at font
  scales 0.85/1/1.35 without detected overflow or target-size errors, and
  observed `0ms` reduced-motion duration and neutral protected/foreign
  preview fixture text. It did not catch the real “Layout” label split and
  is not production-route acceptance.
- The pre-follow-up CSS parser/ownership check reported `76 owner-qualified
  selectors; 21 reset app roles` and zero unowned selectors, unreset roles,
  panel overrides, hardcoded colors or parse errors.
- The earlier CSS-target audit ran `npx tsc --noEmit` successfully; it was
  not rerun after the review edits until the follow-up below. No build was run.
- Light mode, real forced-colors and Helix interaction states, first-paint
  preference behavior, the six standalone routes and `/period-compare`
  remain unverified. See `requests\glass.md`.

## Bounded follow-up: caption and unit

The Glass-owned layout caption now resists flex shrink while allowing long
translations to wrap within half the control. The selected name retains its
normal wrapping. The 12px `km` was the **Range** unit in the
`pack-review-charge-status` widget's `WidgetStatGrid`/`StatCard`, not a
Digital Twin: its live DOM carried `pack-glass` ownership and had neither a
preserve nor vehicle-twin ancestor. The mobile Glass rule now sizes owned
stat-rail units using `--app-body-size`, excluding preserved/twin and
report/kiosk subtrees.

The screenshot-free Edge check used the existing synthetic dashboard fixtures
and real CSS from the shared server, with an in-page EventSource stub and no
new server. At 360/390/430px and scales 0.85/1/1.35 its exact output was:

```text
DOM 360px scale=0.85: captionLines=1 nameLines=2 unit=16px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
DOM 360px scale=1: captionLines=1 nameLines=2 unit=16px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
DOM 360px scale=1.35: captionLines=1 nameLines=3 unit=21.6px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
DOM 390px scale=0.85: captionLines=1 nameLines=2 unit=16px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
DOM 390px scale=1: captionLines=1 nameLines=2 unit=16px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
DOM 390px scale=1.35: captionLines=1 nameLines=3 unit=21.6px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
DOM 430px scale=0.85: captionLines=1 nameLines=2 unit=16px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
DOM 430px scale=1: captionLines=1 nameLines=2 unit=16px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
DOM 430px scale=1.35: captionLines=1 nameLines=2 unit=21.6px pageOverflow=0 unitOverflow=0 overlap=false nameInside=true
TRANSLATION 360px scale=1: captionLines=2 captionInside=true nameInside=true overlap=false pageOverflow=0
TRANSLATION 360px scale=1.35: captionLines=2 captionInside=true nameInside=true overlap=false pageOverflow=0
TRANSLATION 390px scale=1: captionLines=2 captionInside=true nameInside=true overlap=false pageOverflow=0
TRANSLATION 390px scale=1.35: captionLines=3 captionInside=true nameInside=true overlap=false pageOverflow=0
TRANSLATION 430px scale=1: captionLines=2 captionInside=true nameInside=true overlap=false pageOverflow=0
TRANSLATION 430px scale=1.35: captionLines=3 captionInside=true nameInside=true overlap=false pageOverflow=0
ISOLATION {"foreign":false,"report":false,"kiosk":false,"preservedFont":"12px"}
MENU open and Escape close: PASS
SCREENSHOT-FREE REAL-DOM CHECK: PASS
```

In a separate real-DOM comparison, the unit rule was temporarily removed from
the in-memory stylesheet and restored. The protected clone font, widget bounds
and twin width/height/text comparison produced:

```text
PROTECTED_FONT_ISOLATION [{"scale":1,"owned":"16px","preserved":"12px","twin":"12px","report":"12px"},{"scale":1.35,"owned":"21.6px","preserved":"16.2px","twin":"16.2px","report":"16.2px"}]
CAPTION_SELECTOR_ISOLATION {"foreign":false,"report":false,"kiosk":false}
GEOMETRY {"ruleFound":true,"changedWidget":{"width":358,"height":493.3},"baselineUnit":"12px","baselineWidget":{"width":358,"height":493.3},"restoredUnit":"16px","restoredWidget":{"width":358,"height":493.3},"twinUnchanged":true}
MENU open and Escape close: PASS
OWNERSHIP/GEOMETRY/INTERACTION CHECK: PASS
```

Two preliminary fixture assertions failed: an immediate computed-shrink
probe after toggling ownership/mode returned `foreign=0, report=0, kiosk=1`;
an isolated real-CSS check showed the rule did not match those excluded
states and computed shrink was 1. Another probe expected a fixed 12px
protected font at scale 1.35, where it correctly measured 16.2px. The final
checks above use selector matching and scale-correct expectations.

The post-edit parser reported:

```text
GLASS_CSS_SELECTOR_COUNT=78
UNOWNED_FINAL_TARGETS=0
CSS_PARSE_AND_OWNERSHIP=PASS
```

The scoped violations audit and TypeScript check reported:

```text
▸ [1/7] Static inline styles (var(--*))...
  ✅ 0 violations
▸ [2/7] Raw HTML elements...
  ✅ 0 violations
▸ [3/7] Direct library imports...
  ✅ 0 violations
▸ [4/7] Old API imports...
  ✅ 0 violations
▸ [5/7] Double /api/v1/ prefix...
  ✅ 0 violations
▸ [6/7] camelCase query params (vehicleId=)...
  ✅ 0 violations
▸ [7/7] TypeScript compilation...
  ✅ TypeScript passes
SCOPED_AUDIT_EXIT=0
TSC_EXIT=0
```

The audit target was only `glass.css`; its JSX/TypeScript-pattern counts are
not a full-frontend audit. No new screenshots were taken. Both rounds' images
and contrast/touch results predate this follow-up, and the protected twin
touch/text findings and incomplete contrast reviews remain outstanding.

## Distinctness follow-up

The Glass page header is now a canvas-matched, asymmetric sheet with thin
top and leading reflections. The layout trigger and selected phone tab are
flatter, while the selection indicator and keyboard focus remain. Unprotected
Glass widget frames have asymmetric corners; widget headers and empty-state
leads no longer form nested pills. The treatments use existing theme tokens.
No native metric, chart, grid or Digital Twin internals were edited.

After the orchestrator's shared phone layout-switcher change, an isolated
Edge fixture loaded the current application and CSS without taking screenshots
or starting another server. The shared button, caption and name selectors
each matched once. Glass's existing caption rule still supplies the computed
50% maximum; the caption does not shrink. Exact geometry output:

```text
UPDATED_GEOMETRY dark 360px scale=0.85: captionLines=1 nameLines=2 button=295x57.8 tabsMin=48 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY dark 390px scale=0.85: captionLines=1 nameLines=2 button=325x57.8 tabsMin=48 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY dark 430px scale=0.85: captionLines=1 nameLines=2 button=365x57.8 tabsMin=71 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY dark 360px scale=1: captionLines=1 nameLines=2 button=295x57.8 tabsMin=48 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY dark 390px scale=1: captionLines=1 nameLines=2 button=325x57.8 tabsMin=48 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY dark 430px scale=1: captionLines=1 nameLines=2 button=365x57.8 tabsMin=71 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY dark 360px scale=1.35: captionLines=1 nameLines=3 button=295x103.7 tabsMin=62 unit=21.6px overflow=0 twins=preserved
UPDATED_GEOMETRY dark 390px scale=1.35: captionLines=1 nameLines=3 button=325x103.7 tabsMin=62 unit=21.6px overflow=0 twins=preserved
UPDATED_GEOMETRY dark 430px scale=1.35: captionLines=1 nameLines=2 button=365x73.4 tabsMin=66.4 unit=21.6px overflow=0 twins=preserved
UPDATED_INTERACTION dark: focus={"visible":true,"outline":"solid","width":"2px"} menuOpenEscapeClose=PASS
UPDATED_GEOMETRY light 360px scale=0.85: captionLines=1 nameLines=2 button=295x57.8 tabsMin=48 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY light 390px scale=0.85: captionLines=1 nameLines=2 button=325x57.8 tabsMin=48 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY light 430px scale=0.85: captionLines=1 nameLines=2 button=365x57.8 tabsMin=71 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY light 360px scale=1: captionLines=1 nameLines=2 button=295x57.8 tabsMin=48 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY light 390px scale=1: captionLines=1 nameLines=2 button=325x57.8 tabsMin=48 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY light 430px scale=1: captionLines=1 nameLines=2 button=365x57.8 tabsMin=71 unit=16px overflow=0 twins=preserved
UPDATED_GEOMETRY light 360px scale=1.35: captionLines=1 nameLines=3 button=295x103.7 tabsMin=62 unit=21.6px overflow=0 twins=preserved
UPDATED_GEOMETRY light 390px scale=1.35: captionLines=1 nameLines=3 button=325x103.7 tabsMin=62 unit=21.6px overflow=0 twins=preserved
UPDATED_GEOMETRY light 430px scale=1.35: captionLines=1 nameLines=2 button=365x73.4 tabsMin=66.4 unit=21.6px overflow=0 twins=preserved
UPDATED_INTERACTION light: focus={"visible":true,"outline":"solid","width":"2px"} menuOpenEscapeClose=PASS
UPDATED_SHARED_MOBILE_GEOMETRY=PASS
UPDATED_SHARED_GEOMETRY_EXIT=0
```

The selected tab's actual `::before` indicator was separately measured at
24×3px with the saved accent and `aria-current="true"`:

```text
ACTIVE_INDICATOR=PASS
ACTIVE_INDICATOR_EXIT=0
```

In both modes the full selected name remained inside the trigger without
overlapping its caption. The computed saved accent, font stack and scale
matched the values applied on the root. The light fixture requested Atkinson,
but external font requests were blocked, so actual downloaded-font metrics
were not established. In the preceding light-only fixture, a longer
synthetic caption also remained contained:

```text
TRANSLATION light 360px scale=1 {"captionLines":1,"captionInside":true,"nameInside":true,"overlap":false,"overflow":0}
TRANSLATION light 390px scale=1 {"captionLines":1,"captionInside":true,"nameInside":true,"overlap":false,"overflow":0}
TRANSLATION light 430px scale=1 {"captionLines":1,"captionInside":true,"nameInside":true,"overlap":false,"overflow":0}
TRANSLATION light 360px scale=1.35 {"captionLines":2,"captionInside":true,"nameInside":true,"overlap":false,"overflow":0}
TRANSLATION light 390px scale=1.35 {"captionLines":2,"captionInside":true,"nameInside":true,"overlap":false,"overflow":0}
TRANSLATION light 430px scale=1.35 {"captionLines":1,"captionInside":true,"nameInside":true,"overlap":false,"overflow":0}
```

With the three new widget chrome rules temporarily disabled in the live
fixture's in-memory CSSOM, both protected twins retained their width, height,
text and sampled styles. The new rules did not match their preserved
subtrees or foreign-owner, report or kiosk targets:

```text
PRESERVATION dark {"count":2,"ruleMatches":[0,0,0],"unchanged":true,"protectedOwners":[{"id":"pack-review-vehicle-twin","owner":null,"descendants":0},{"id":"pack-review-digital-twin-mini","owner":null,"descendants":0}],"geometry":[{"id":"pack-review-vehicle-twin","width":358,"height":900},{"id":"pack-review-digital-twin-mini","width":358,"height":504}],"normal":[true,true,true],"modes":{"report":[false,false,false],"kiosk":[false,false,false]},"foreign":[false,false,false]}
PRESERVATION light {"count":2,"ruleMatches":[0,0,0],"unchanged":true,"protectedOwners":[{"id":"pack-review-vehicle-twin","owner":null,"descendants":0},{"id":"pack-review-digital-twin-mini","owner":null,"descendants":0}],"geometry":[{"id":"pack-review-vehicle-twin","width":358,"height":900},{"id":"pack-review-digital-twin-mini","width":358,"height":504}],"normal":[true,true,true],"modes":{"report":[false,false,false],"kiosk":[false,false,false]},"foreign":[false,false,false]}
CONTRAST dark {"violations":0,"violationNodes":0,"incompleteNodes":0}
CONTRAST light {"violations":0,"violationNodes":0,"incompleteNodes":0}
```

These Axe results cover only the dashboard header, onboarding widget and
phone navigation at 390px, not the entire application or the earlier
incomplete scans. The first probe found that a shared shell rule overrode
the flat selected-tab background; the owned selector's specificity was fixed.
Two subsequent probes stopped at incorrect CSSOM lookup/filter assumptions.
Another stopped on an overly strict expectation of a fully transparent light
trigger: the shared light-mode rule intentionally supplies a 3% tint. The
final focused light check accepted that tint and passed; these were
screenshot-free fixture attempts, not additional capture rounds.

The final CSS parser and selector-ownership check reported:

```text
GLASS_CSS_SELECTOR_COUNT=82
UNOWNED_FINAL_TARGETS=0
CSS_PARSE_AND_OWNERSHIP=PASS
CSS_SELECTOR_EXIT=0
```

The scoped audit of `glass.css` reported:

```text
▸ [1/7] Static inline styles (var(--*))...
  ✅ 0 violations
▸ [2/7] Raw HTML elements...
  ✅ 0 violations
▸ [3/7] Direct library imports...
  ✅ 0 violations
▸ [4/7] Old API imports...
  ✅ 0 violations
▸ [5/7] Double /api/v1/ prefix...
  ✅ 0 violations
▸ [6/7] camelCase query params (vehicleId=)...
  ✅ 0 violations
▸ [7/7] TypeScript compilation...
  ✅ TypeScript passes
SCOPED_AUDIT_EXIT=0
```

Those JSX/API pattern counts are not a full-frontend audit. The focused
preservation and DataTable command after the shared change was:

```text
cd web
npx vitest run src\components\ui\app-designs\packs\PackCMetricPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx src\components\ui\DataTable.appDesign.test.tsx --reporter=dot -t 'glass|DataTable'

 Test Files  4 passed (4)
      Tests  44 passed | 183 skipped (227)
   Duration  24.33s (transform 31.84s, setup 2.19s, import 59.26s, tests 6.88s, environment 2.55s)

POST_SHARED_FOCUSED_EXIT=0
```

The standalone post-shared TypeScript command produced no diagnostics:

```text
cd web
npx tsc --noEmit
POST_SHARED_TSC_EXIT=0
```

Before that shared change the same four files also ran without a name filter:
`4 passed` files, `227 passed` tests, `FOCUSED_TEST_EXIT=0`. No build was
run, as directed. This task changes no page sections or API hooks, so page
line/section comparisons and hook-route checks do not apply.

Both permitted screenshot rounds were already spent. No image shows the
distinctness changes, so their visual effect and separation from Material
remain unverified. The earlier protected-twin touch/text findings and
incomplete full-page contrast reviews remain outstanding.
