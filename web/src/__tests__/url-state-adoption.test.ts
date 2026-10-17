import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { sourceHookCalls } from '../test/sourceHookGraph'

/**
 * `useUrlState` and friends mirror filter state into the URL so selections are
 * bookmarkable, shareable, survive refresh, and work with browser navigation.
 *
 * These canonical filter-bearing pages must use a `useUrl*` helper instead of
 * component-local `useState`, or the bookmark/share contract silently regresses.
 *
 * Static-source guard: each listed surface must call a `useUrl*` helper,
 * directly or through its invoked feature-local controller hooks.
 * Statistics uses the URL-aware canonical vehicle hook instead so it does not
 * create a second owner for `vehicle_id`.
 */
const FILTER_PAGES = [
  'src/features/driving/pages/DrivesListPage.tsx',
  'src/features/charging/pages/ChargingListPage.tsx',
  'src/features/notifications/components/InboxBody.tsx',
  'src/features/telemetry/pages/SignalExplorerPage.tsx',
  'src/features/telemetry/pages/SignalDiffPage.tsx',
  'src/features/telemetry/pages/SignalLogViewerPage.tsx',
  'src/features/admin/pages/ApiLogsPage.tsx',
  'src/features/admin/pages/DevToolsPage.tsx',
  'src/features/system/pages/CommandHistoryPage.tsx',
  'src/features/maps/pages/LocationsPage.tsx',
  'src/features/trips/pages/TripListPage.tsx',
  'src/features/analytics/pages/StatisticsPage.tsx',
  'src/features/analytics/pages/PeriodComparePage.tsx',
] as const

const URL_HOOK_RE = /^useUrl(State|String|Boolean|Number|Enum|Array)$/
const CANONICAL_VEHICLE_FILTER_PAGES = new Set([
  'src/features/analytics/pages/StatisticsPage.tsx',
])

describe('URL state adoption (phase-45/17)', () => {
  for (const rel of FILTER_PAGES) {
    it(`${rel} uses a URL-aware helper for filter state`, () => {
      const abs = path.resolve(process.cwd(), rel)
      const calls = sourceHookCalls(abs)
      if (CANONICAL_VEHICLE_FILTER_PAGES.has(rel)) {
        for (const name of ['useSelectedVehicle', 'useRangeState']) {
          expect(calls.some((call) => call.name === name &&
            call.module === path.resolve(process.cwd(), `src/hooks/${name}.ts`)), name).toBe(true)
        }
      } else {
        expect(calls.some((call) => URL_HOOK_RE.test(call.name) &&
          call.module === path.resolve(process.cwd(), 'src/hooks/useUrlState.ts'))).toBe(true)
      }
    })
  }
})
