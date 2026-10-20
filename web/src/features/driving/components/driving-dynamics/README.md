# Ride-first Driving Dynamics

## Information architecture and preserved functions

1. **Trip review:** existing URL-persisted ride selector and shared header date
   range. New selected-ride headline shows recorded route, timestamps, distance,
   duration, used/recovered energy, speed, battery endpoints, and trip-detail link.
2. **Powertrain summary / Inside this ride:** selected timestamp window only.
   All six motor statistics remain, followed by torque distribution, measured
   power demand, thermal evidence, power/regen history, front/rear torque history,
   front/rear RPM history, and evidence-led guidance.
3. **Vehicle now:** original live motor, pedal, deterministic interpretation,
   speed/gear, G-force, and Autopilot/cruise panels remain. The entire group
   explicitly excludes historical selected-trip interpretation. The speed/gear
   panel separately identifies its date-range speed aggregates.
4. **Beyond this ride:** original coach score, style breakdown, average/best
   efficiency, weekly score trend, driving patterns, and recommendations remain.
   Original speed distribution, load scatter, and recent-trip power profile
   remain with honest data labels.

Only **Per-drive scores** is omitted on this page, by passing
`showPerDriveScores={false}`. `DrivingCoachSection` defaults it to `true`, so
other callers retain the existing table, sorting, pagination, and mobile columns.
All telemetry chart exports and URL-persisted series toggles remain.

## Scope and integrity

- Drive list uses the existing typed `useDrives` instant-bounded query (1,000
  rows) and latest-five query to retain any open drive. UTC date-slice filtering
  is deliberately not repeated over server-scoped results.
- URL `drive` wins over open-drive/latest fallback. Completed drive motor history
  uses `motorWindowForDrive`, including its existing exclusive-end adjustment;
  completed histories do not poll. Open drives retain standard polling.
- All motor-history consumers share the same query window and 200-sample limit.
  Coverage text describes reported samples, not complete or time-weighted trip
  statistics. With no selected drive the history query is disabled.
- Latest-only pedal/G-force hooks are not usable as historical evidence.
  No backend or hook changes are made, and no guessed historical inputs are
  substituted.
- No motor readings remains an independent historical empty state. Missing
  fields in recorded samples stay unknown rather than becoming zero.
- Power demand is not a throttle-style classifier. Thermal samples are not a
  diagnosis or assumed derating threshold. Guidance explains evidence rather
  than generating client-side scores or promised efficiency improvements.
- Range scatter uses actual `avgPowerW`, not a guessed peak. The recent-trip
  profile now uses actual `regenEnergyWh` on its own energy axis, never a
  fabricated zero regen-power series. It chooses the latest 20 by timestamp.
- Current deterministic interpretation is provider-neutral and observation-only;
  partial axle data cannot establish an AWD torque share.
- SI conversions happen at display boundaries through shared settings-aware
  unit/number/date formatters. New surfaces and chart axes use theme tokens.
  Layout uses single-column narrow-screen cards, progressively wider grids,
  wrapping routes and metrics, and a wide primary power trace with paired
  secondary torque/RPM charts.

## Parent-owned catalog handoff

English source changes are confined to `dynamics` in `web/src/i18n/en.json`:
`review`, `trip`, `ride`, `powertrain`, `evidence`, `guidance`,
`liveInterpretation`, `contextCharts`, and new coach scope/empty/style-count/
impact keys. Generated namespace catalogs are intentionally left to the parent.
No DriveDetail, shared DataTable, API hooks, models, or repository files are edited.
Previous settings/precision changes in existing components/tests are preserved.

## Focused validation

From `web`:

```powershell
npx tsc --noEmit
npx eslint src/features/driving/pages/DrivingDynamicsPage.tsx src/features/driving/pages/DrivingDynamicsPage.test.tsx src/features/driving/components/driving-dynamics --max-warnings 0
npx vitest run --config src/features/driving/components/driving-dynamics/__tests__/vitest.config.mts --reporter=dot
```

The isolated Vitest configuration uses the application's normal jsdom setup and
browser-storage settings. It avoids deployment catalog-generation plugins while
parallel owners edit source English; it is not a replacement for the parent's
final catalog/global build checks.

From the repository root:

```powershell
bash .github/skills/verify-api-hooks/verify.sh web/src/api/hooks/useVehicles.ts
bash .github/skills/verify-api-hooks/verify.sh web/src/api/hooks/useDriving.ts
bash .github/skills/verify-api-hooks/verify.sh web/src/api/hooks/useTelemetry.ts
```

The focused tests cover preserved sections, absent sources, selector changes,
completed/open-drive scope, UTC/local-boundary retention, SI conversions,
precision, partial telemetry, neutral interpretation, real regen energy, and
default table preservation versus page-specific omission. Browser visual checks
at 320–2560 and both themes remain a parent-owned follow-up; no shared browser
session is used.
