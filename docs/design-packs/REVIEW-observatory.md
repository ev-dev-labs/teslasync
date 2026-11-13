# Observatory visual review

**Result: passed-with-notes**, not a full visual or accessibility pass.
The pack uses separated reference readings, restrained scientific frames,
and crosshair-like marks while retaining the shared theme and presentation
token boundaries. The Digital Twin subtrees remain protected.

## Round 1

With `DESIGN_PACK_CAPTURE_OUTPUT_ROOT` set to the absolute Observatory shots
directory, the command was:

```powershell
node C:\Users\AtulM\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files\capture-pack-review.mjs observatory
```

Exit **1**: three desktop captures passed; all three phone captures failed.
The phone dashboard stopped with “Main content could not be scrolled for
capture” before its contrast check. Phone drives and energy failed the
16px body-text diagnostic because the navigation buttons computed to 11px.
Axe reported 0 violated rules for the other five captures, but phone
drives/energy had **1/0** incomplete nodes, and desktop
dashboard/drives/energy had **15/7/20**. Incomplete nodes require manual
review and are not contrast passes.

All six images were inspected. The first-round images are preserved as
`dashboard--round-1.png`, `drives--round-1.png`, and `energy--round-1.png`
in each of `shots\observatory\phone-390-scale-1` and
`shots\observatory\desktop-scale-1`.

The five most important findings and pack-owned responses were:

1. The phone navigation buttons computed to 11px despite their visible
   labels; the pack now applies the shared phone body-size token.
2. Mobile page actions unnecessarily occupied a separate row; they can now
   share space with the title when it fits. The second capture revealed a
   resulting two-line “Drive history” heading; a later adjustment reserves
   the title's natural width and lets the actions wrap instead.
3. Dashboard's layout name was ellipsized on both viewports. The context
   selector now allows the actual name to wrap rather than silently truncate.
4. Desktop drives and energy pushed the theme control onto a second header
   row. The first grid rebalance was insufficient; after round 2 the header's
   control track was widened further.
5. Phone brief readings touched adjoining rows and lacked the Observatory
   registration signature. The pack now separates rows, removes a redundant
   section rule, and adds subtle crosshairs. After round 2 it also reduced
   density-relative horizontal padding so the 390px “120 Wh/km” and “No
   baseline” readings can remain on one line.

## Round 2

The same six-image command exited **1**:

```text
  2 failed
    [phone-390] › e2e\design-packs-capture.spec.ts:72:3 › capture dashboard (/) ────────────────────
    [desktop] › e2e\design-packs-capture.spec.ts:72:3 › capture drives (/drives) ───────────────────
  4 passed (2.7m)
```

Phone drives and energy and desktop dashboard and energy passed the runner's
assertions. The phone dashboard reached all diagnostics but failed on the
protected Digital Twin's **Open** link at 36 × 36px, its **Refresh data**
control at 10 × 28px, and three 14px text entries (“Digital twin”, “—”, and
“Aurora”). Desktop drives stopped before contrast analysis because a
same-origin `GET /api/v1/pinned` was still recorded as `pending` after the
fixture's five-second no-escape check. A pending record is not proof of an
external request. See `requests\observatory.md` for both shared follow-ups.

Axe reported 0 violated rules on the five captures it reached. Manual-review
nodes were **11/1/0** for phone dashboard/drives/energy and **15/not run/20**
for desktop dashboard/drives/energy. The incomplete results are not contrast
passes. The first-round dashboard scroll failure did not recur, but its cause
remains unconfirmed.

All six second-round images were inspected: `dashboard.png`, `drives.png`,
and `energy.png` in each of `shots\observatory\phone-390-scale-1` and
`shots\observatory\desktop-scale-1`. The saved image of a failed test is not a
pass. The title, brief-padding, desktop-header, and later standalone-table
frame refinements were made **after** these images and therefore have not
been visually recaptured. No third screenshot round was taken.

## Verification and limitations

- After the visual refinements, but before the later standalone-table frame
  fix below, a screenshot-free 390px synthetic-fixture scroll scan reached the
  end of dashboard, drives and energy in **11/7/8** steps.
  Drives and energy had no undersized body text or touch targets, horizontal
  regions, split metric words, or page errors. Dashboard had only the
  protected-widget text and controls described above. The strict scan exited
  **1** because of those dashboard findings. An earlier exploratory attempt
  used the wrong working directory and failed to load a local fixture image.
- A screenshot-free desktop geometry probe covered drives and energy at
  1280px and 1440px: the breadcrumb context, search, and controls did not
  overlap, and all four header controls stayed on one row. It exited **0**;
  it did not repeat the capture runner's mock-accounting assertion. A
  separate 1280px drives candidate probe did run that assertion, reproduced
  the pending `/api/v1/pinned` request, and exited **1**. An earlier 13-case
  exploratory probe completed mock accounting without errors but did not make
  its forced-color scroll finding a failing gate; it is not a forced-color pass.
- At 390px the DOM measures the “Drive history” heading and the “120 Wh/km”
  and “No baseline” readings on one line after the post-capture fixes. At
  360px the latter two readings can still wrap between words.
- Eight screenshot-free dark-mode geometry cases for drives and energy at
  360px/430px and 85%/135% font scale had no detected document or region
  overflow, clipped navigation, or split navigation labels:
  `PHONE_EXTREMES_GEOMETRY_EXIT=0`. One exploratory light-mode energy case at
  390px/135% also had no detected geometry issues; no visual contrast review
  of these cases was possible after the captures.
- In forced colors, the real `/energy` fixture at 390px exposes a horizontally
  scrolling “Charger type breakdown — data table”: its viewport is 312px and
  its content is 412px wide. This is a shared embedded-table fallback issue,
  not a pass: `FORCED_PHONE_GEOMETRY_EXIT=1`. See the request.
- The focused preservation and nearest-owner isolation tests ran after the
  visual refinements and before the standalone-table frame fix:

  ```powershell
  cd web
  npx vitest run src\components\ui\app-designs\packs\PackNativeCompositionPreservation.test.tsx src\components\ui\app-designs\packs\PackNativeStepsPreservation.test.tsx src\components\ui\AppDesignBridge.test.tsx --testNamePattern="observatory.*native|nearest design boundary isolation" --reporter=dot
  ```

  ```text
  Test Files  3 passed (3)
       Tests  13 passed | 165 skipped (178)
  FINAL_PRESERVATION_EXIT=0
  ```

- Before the standalone-table frame fix, `cd web; npx tsc --noEmit` produced
  no diagnostics:
  `TSC_NO_EMIT_EXIT=0`.
- The scoped `audit-violations` script, also run before that frame fix,
  reported:

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
  FINAL_AUDIT_EXIT=0
  ```

  Those categories primarily scan TS/TSX; they are not a complete CSS
  accessibility audit.
- A final CSS parser check found **95 rules, 97 selectors, 0 unowned selectors,
  0 unreset app-token declarations, and 0 literal colors**. `git diff --check`
  exited 0.
- No production build was run. API hooks, page sections, and page/component
  line counts were unchanged and are not applicable to this stylesheet-only
  implementation.

### Standalone DataTable-frame follow-up

The shared source-to-consumer contract initially found that Observatory's
panel surface rule required the panel-background class, so it did not match
the standalone DataTable frame:

```text
 FAIL  src/components/ui/DataTable.appDesign.test.tsx > DataTable standalone frame source-to-consumer contracts > observatory binds only the painted frame to existing base and identity surface rules
AssertionError: expected 0 to be greater than 0
 Test Files  1 failed (1)
      Tests  1 failed | 34 skipped (35)
OBSERVATORY_DATATABLE_FRAME_EXIT=1
```

The pack now applies the same token-derived panel treatment to its
owner-qualified standalone table frame, without applying it to embedded
tables. The test also exercises selection, sorting, sticky headings, and the
scroll viewport. Re-running the requested focused contract:

```powershell
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='observatory binds only the painted frame' --reporter=dot
```

```text
 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
OBSERVATORY_DATATABLE_FRAME_EXIT=0
```

The same focused contract was subsequently rerun with the shared-machine
worker limit:

```powershell
cd web
npx vitest run src\components\ui\DataTable.appDesign.test.tsx --testNamePattern='observatory binds only the painted frame' --reporter=dot --maxWorkers=1
```

```text
 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
OBSERVATORY_DATATABLE_FRAME_ONE_WORKER_EXIT=0
```

This is a source/consumer contract, not a rendered or visual acceptance test.

Broader light/forced-color coverage, menus, Helix, and the Axe incomplete
nodes still require further review. The runner removed its unique output child;
the project-local Playwright transform cache under
`shots\observatory\playwright-transform-cache` is not a review deliverable.

The orchestrator subsequently fixed the shared chart fallback presentation
and tested the real `/energy` table at 360, 390 and 430px in forced colors:

```text
1 passed (6.1s)
```

No new Observatory screenshot or full-route contrast pass is implied.
