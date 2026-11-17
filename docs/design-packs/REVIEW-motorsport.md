# Motorsport review

## First round

Edge, default scale 1, isolated fixtures, 390 × 844 phone and 1440 × 900
desktop. Inspected all six viewport images, preserved under
`shots/motorsport/round-1/`: `phone-390-scale-1/dashboard.png`, `drives.png`,
`energy.png`, and the corresponding three `desktop-scale-1` images. Images
are evidence, not passing results.

The prescribed capture wrapper exited **1**:

```text
3 failed: phone-390 dashboard, drives, energy
3 passed: desktop dashboard, drives, energy (7.8m)
```

The contrast scan reported zero violated rules in each run, but respectively
0, 1, 0, 3, 6, and 14 incomplete nodes for phone dashboard/drives/energy and
desktop dashboard/drives/energy. Incomplete findings need manual review.

The five highest-priority findings:

1. The pack's page-title border duplicates the native blue title rule on all
   three pages. On the 390px Drives image the duplicated gutter also consumes
   scarce title space; “Drive history” wraps.
2. Mobile Drives and Energy operational reading boxes touch vertically,
   producing heavy doubled seams and making adjacent instruments harder to scan.
3. Desktop Drives and Energy reading labels are visually too small relative to
   their large instrument cells and values.
4. The phone scan finds 11px computed text on the bottom-tab button wrappers,
   and dashboard copy/links at 12–14px. The actual tab-label spans render at
   16px, but the wrappers retain their smaller sizing. Dashboard
   non-protected Recent Drives context and footer links need a readable floor.
5. The preserved Digital Twin still has 36 × 36 Open and 10 × 28 refresh
   targets, plus 14px text. Its geometry and content are outside this pack's
   ownership; this remains a shared accessibility request.

The dashboard diagnostic also reports a 12px `km` unit and 12px “Open vehicle”
link. No horizontal overflow, clipped navigation label, split navigation word,
or violated Axe contrast rule was reported in this round.

Before the final round, the pack removes its redundant title border, gives
operational rows a small vertical separation and 14px scale-aware desktop
labels, and applies the shared phone text floor to owned tab wrappers and the
identified non-protected widget text and footer links. It does not change
Digital Twin subtrees. A screenshot-free Edge fixture covering the late-loaded
navigation CSS at 360/390/430px, scales 0.85/1/1.35, and normal/forced colors
reported:

```text
PASS 18 synthetic mobile cases (late-loaded navigation, 16px content and protected isolation) plus desktop metric-label size
```

This fixture is not production-route or visual evidence.

## Final round and subsequent diagnostic-only refinements

The same prescribed wrapper was invoked exactly twice in total:

```text
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs motorsport
round 1: exit 1 — 3 failed, 3 passed (7.8m)
round 2: exit 1 — 1 failed, 5 passed (2.1m)
```

Inspected all six final viewport images under `shots/motorsport/`:
`phone-390-scale-1/dashboard.png`, `drives.png`, `energy.png`, and the same
three files under `desktop-scale-1`. The duplicate title rail is gone,
instrument rows have visible separation, and desktop labels are larger. The
final Drives phone image still shows “Drive history” wrapping.

The final dashboard phone capture failed: the protected Digital Twin retains
the 36 × 36 Open and 10 × 28 refresh targets and three 14px text elements.
The unprotected Charge Status `km` unit also remained 12px because a
widget utility overrode the initial pack selector. The other five captures
reported no test failure. Each contrast scan reported zero violated rules;
incomplete findings remained at 0, 1, 0, 3, 6, and 14 nodes for phone
dashboard/drives/energy and desktop dashboard/drives/energy respectively.
They are not contrast passes.

After inspecting the final images, owner-scoped CSS tightened the phone header
gaps and increased the Charge Status unit's selector specificity. No third
screenshot was taken: **the final images predate these two refinements**.
A screenshot-free Edge diagnostic on the real fixture routes reported:

```text
DASHBOARD_SMALL_UNIT []
CHARGE_STATUS_UNIT {"text":"km","fontSize":"16px","preserved":false}
DRIVE_TITLE_GEOMETRY heading height 31.1875px, line-height 31.2px; title/action separated
DRIVE_RESPONSIVE_GEOMETRY 18 cases: no title/action overlap or horizontal overflow; help target >=44px
1 passed (1.2m)
```

The 18 cases cover 360/390/430px, scales 0.85/1/1.35, and normal/forced
colors on Drives; they do not establish a fresh visual or full-route pass.

After the final CSS edit, focused preservation and isolation tests reported:

```text
Test Files  3 passed (3)
     Tests  13 passed | 165 skipped (178)
```

The scoped audit of the CSS reported zero matches for its six source-code
checks and `TypeScript passes`; those checks are largely inapplicable to CSS.
An isolated build of the committed shared foundation plus this exact
stylesheet ran `npm run build` and exited 0:

```text
[pwa-contract] OK — source + build contracts satisfied
[source-maps] OK — no publicly reachable source maps, serving path denies .map
```

No production light-mode capture, open-state capture, or other-route visual
review was run. The protected-widget and shared contrast issues are recorded
in `requests/motorsport.md`; the bounded review is passed-with-notes, not a
full pass.
