import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Phase-45 / Prompt 17 — URL state adoption.
 *
 * `useUrlState` and friends (`useUrlString`, `useUrlBoolean`, `useUrlNumber`,
 * `useUrlEnum`, `useUrlArray`) mirror filter state into the URL so that
 * filter selections are bookmarkable, shareable, and survive a page refresh
 * (and play nicely with browser back/forward).
 *
 * The pages below are the canonical filter-bearing list/explorer pages.
 * Every one of them MUST hold its filter state in the URL via one of the
 * `useUrl*` helpers — otherwise we silently regress the bookmark/share
 * contract by reverting to component-local `useState`.
 *
 * This test is a static-source guard: it grep-asserts each listed file
 * imports / calls a `useUrl*` helper. Cheap, deterministic, and
 * resilient to future refactors that don't actually break adoption.
 */
const FILTER_PAGES = [
  'src/features/driving/pages/DrivesListPage.tsx',
  'src/features/charging/pages/ChargingListPage.tsx',
  'src/features/notifications/pages/NotificationsPage.tsx',
  'src/features/notifications/pages/AlertsPage.tsx',
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
