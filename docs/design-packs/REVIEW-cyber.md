# Cyberdeck review

## Scope and first capture

Implemented the existing `cyber` application pack using theme-derived
instrument surfaces, compact framed metrics, segmented controls, circuit
rules, and simulated cut corners without clipping content. Native data,
chart palettes, saved preferences, widget grid geometry, and protected
Digital Twin subtrees remain owned by their existing components.

The first six-image capture command was run with the shared server at
`127.0.0.1:54872`, with `DESIGN_PACK_CAPTURE_OUTPUT_ROOT`, `TEMP`, `TMP`, and
`TMPDIR` set to the absolute path of `docs\design-packs\shots\cyber`:

```text
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs cyber
exit 1
3 failed, 3 passed (2.5m)
```

All six first-round images were opened and inspected:

- `shots\cyber\phone-390-scale-1\dashboard.png`
- `shots\cyber\phone-390-scale-1\drives.png`
- `shots\cyber\phone-390-scale-1\energy.png`
- `shots\cyber\desktop-scale-1\dashboard.png`
- `shots\cyber\desktop-scale-1\drives.png`
- `shots\cyber\desktop-scale-1\energy.png`

All desktop cases passed the runner. All phone cases failed its body-text
diagnostic; dashboard also failed touch-target diagnostics. Axe reported zero
violated contrast rules but required manual contrast review for 12, 1, 7,
21, 12, and 21 nodes respectively in the order above. Incomplete results
are not contrast passes.

## First-round findings and changes

1. The dashboard layout name was truncated on phone and desktop. The
   owner-qualified menu trigger and name now wrap instead of ellipsizing.
2. Drives and Energy operational metrics consumed a very tall single column
   at 390px. A smaller, font-scale-aware brief-column minimum and compact
   tile padding allow two columns where they fit; row gaps remain deliberate.
3. The Energy header action took a separate row even when it could fit beside
   the title. Phone action sizing now permits wrapping beside the title.
4. The diagnostic measured phone navigation buttons at 11px and unprotected
   dashboard metric context, units, and footer links below 16px. Applied the
   existing phone body-size floor to those owner-qualified targets, without
   touching protected widgets.
5. The canvas grid made automated contrast evaluation ambiguous. Moving it to
   a pointer-inert pseudo-element increased the second capture's incomplete
   results, so the final stylesheet returns the same grid to the canvas
   background. This last paint-only correction was made after the final
   capture and has not been recaptured.

The desktop onboarding widget retains a large empty area because its size is
the native saved widget-grid geometry. It was not collapsed or replaced.
The first phone dashboard also exposed a 36×36 Open action, a 10×28
freshness button, and undersized text inside the protected Digital Twin. Those
cannot be changed by this pack; see `requests\cyber.md`.

## Focused regression checks

After the final canvas correction, the focused tests reported:

```text
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='cyber binds only the painted frame' --reporter=dot --maxWorkers=1
Test Files  1 passed (1)
     Tests  1 passed | 34 skipped (35)
exit 0

npx vitest run src\components\ui\app-designs\packs\PackCMetricPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx -t cyber --maxWorkers=1
Test Files  3 passed (3)
     Tests  9 passed | 183 skipped (192)
exit 0

npx tsc --noEmit
exit 0 (no output)

PostCSS parse: CSS parse OK: 86 rules
selectors missing final-target Cyberdeck ownership: 0
git diff --check -- web/src/components/ui/app-designs/packs/cyber.css
exit 0
```

The DataTable check exercises one Cyberdeck case, including standalone
surface binding and embedded/native selection, sorting, and scroll contracts;
it is not rendered-browser acceptance.

The TypeScript command completed before the final CSS-only canvas correction.
A scoped text-pattern scan of the CSS-only change reported:

```text
static inline styles: 0
raw form/table tags: 0
direct chart/map imports: 0
old API imports: 0
double API prefixes: 0
camelCase vehicle query: 0
```

These TSX/API patterns do not constitute a meaningful CSS contrast audit.
An in-memory, screenshot-free Edge/Axe probe using a synthetic canvas
confirmed the pseudo-element issue:

```text
pseudo: 0 contrast violation nodes, 2 manual review nodes
background: 0 contrast violation nodes, 0 manual review nodes
```

This synthetic comparison is not a full-route contrast result. Its first
attempt exited 1 because Axe required `browser.newContext()` instead of
`browser.newPage()`; the corrected probe exited 0.

## Final capture

The same six-image command was run once more:

```text
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs cyber
exit 1
1 failed
  [phone-390] capture dashboard (/)
5 passed (2.6m)
```

All six final images at the paths listed above were opened and inspected.
The dashboard layout name now wraps in full; Drives and Energy show two
phone metric columns where space permits, the Energy action fits beside the
title, and the navigation labels remain readable. The phone Drives and Energy
cases and all three desktop cases passed the runner. Phone dashboard failed
on the protected Digital Twin's 36×36 Open link, 10×28 freshness button, and
three 14px text elements (`Digital twin`, `—`, and `Aurora`).

Axe reported zero violated contrast rules in the second capture, but the
following nodes needed manual review:

```text
phone dashboard: 15
phone drives:    39
phone energy:    18
desktop dashboard: 32
desktop drives:    62
desktop energy:    60
```

These numbers describe the pseudo-element version seen in the captures,
not the final background-only correction. No third screenshot invocation was
used, and the corrected stylesheet has not received a full-route contrast
recheck. Manual contrast evaluation remains necessary, especially for the
separately owned Cyberdeck widget scanlines.

Light mode, 360px and 430px, non-default font scales, forced colors, Helix,
and other routes were not visually reviewed. No build was run because the
orchestrator owns builds. Page line/section comparisons and API-hook route
verification do not apply to this stylesheet-only implementation.
