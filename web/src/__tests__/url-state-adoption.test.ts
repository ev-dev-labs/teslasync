import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * `useUrlState` and friends mirror filter state into the URL so selections are
 * bookmarkable, shareable, survive refresh, and work with browser navigation.
 *
 * These canonical filter-bearing pages must use a `useUrl*` helper instead of
 * component-local `useState`, or the bookmark/share contract silently regresses.
 *
 * Static-source guard: each listed file must import or call a `useUrl*` helper.
 */
const FILTER_PAGES = [
  'src/features/driving/pages/DrivesListPage.tsx',
  'src/features/charging/pages/ChargingListPage.tsx',
  'src/features/notifications/components/InboxBody.tsx',
  'src/features/notifications/pages/AlertsListPage.tsx',
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

const URL_HOOK_RE = /useUrl(State|String|Boolean|Number|Enum|Array)/

describe('URL state adoption (phase-45/17)', () => {
  for (const rel of FILTER_PAGES) {
    it(`${rel} uses a useUrl* helper for filter state`, () => {
      const abs = path.resolve(process.cwd(), rel)
      const src = fs.readFileSync(abs, 'utf8')
      expect(src).toMatch(URL_HOOK_RE)
    })
  }
})
