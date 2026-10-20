import { writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'

/**
 * Row-16 guard: every dashboard widget body must never scroll horizontally,
 * and no text element may be clipped without a truncation affordance
 * (a `title` tooltip or a `truncate`/`line-clamp` class on itself or an
 * ancestor). Each widget renders at its registry minimum, default and a
 * large grid size, in both view and edit mode.
 *
 * The size table below mirrors `src/features/dashboard/widgets/registry/`
 * (`defaultSize`/`minSize`/`maxSize` per widget id). Regenerate it with
 * `node /tmp/extract-widget-sizes.mjs` (see plan row 16) when the registry
 * gains, loses or resizes a widget; a stale id fails loudly as `missing`.
 *
 * `large` is full max cols with rows capped (`def + 4`, at most 12): big
 * enough to exercise container-query re-flow without rendering 40-row
 * pages for all 121 widgets.
 *
 * A "text element" is an element with its OWN direct text (nested content
 * is attributed to the descendant that owns it, so containers can't hide
 * behind — or be blamed for — their children). Skipped: `.sr-only`
 * subtrees (accessible text intentionally clipped to 1px), `svg` subtrees
 * (`<title>`/`<desc>` never paint; SVG text doesn't wrap like HTML), and
 * `.leaflet-container` subtrees (map panes are absolutely positioned by
 * design; verified visually that attribution stays intact).
 *
 * `assertMockApiComplete` is intentionally NOT called: rendering every
 * widget hits endpoints outside the smoke fixtures (those widgets render
 * error/empty states, which are still valid geometry subjects). API
 * completeness stays enforced by the contract specs.
 */

interface WidgetSizeEntry {
  id: string
  def: [number, number]
  min: [number, number]
  max: [number, number]
}

const WIDGET_SIZES: WidgetSizeEntry[] = [
  { id: 'alert-feed', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'notification-stats', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'fleet-stats', def: [4,2], min: [2,2], max: [4,40] },
  { id: 'fleet-stats-bar', def: [4,2], min: [3,2], max: [4,40] },
  { id: 'weekly-summary-card', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'weekly-digest', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'fsd-weekly', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'monthly-mileage', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'lifetime-stats', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'mileage-stats', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'state-timeline', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'anomaly-detector', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'fsm-distribution', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'cost-breakdown', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'year-review', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'analytics-summary', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'recently-unlocked-achievements', def: [2,2], min: [1,2], max: [4,4] },
  { id: 'automation-status', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'automation-history', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'battery-gauge', def: [1,2], min: [1,2], max: [2,40] },
  { id: 'battery-radial-gauge', def: [1,2], min: [1,2], max: [3,40] },
  { id: 'range-estimate', def: [1,2], min: [1,2], max: [2,40] },
  { id: 'range-bar', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'battery-degradation-trend', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'energy-flow', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'projected-range', def: [2,2], min: [1,2], max: [3,40] },
  { id: 'battery-cells', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'battery-degradation-forecast', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'battery-health-analytics', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'charge-status', def: [2,2], min: [1,2], max: [3,40] },
  { id: 'charge-status-live', def: [2,2], min: [1,2], max: [3,40] },
  { id: 'charge-history', def: [2,4], min: [2,2], max: [4,40] },
  { id: 'charge-session-chart', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'charge-cost-tracker', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'charging-schedule', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'cost-forecast', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'charging-optimizer', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'wall-connector', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'charging-telemetry', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'supercharger-history', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'charge-plans', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'next-charge-decision', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'charging-session-detail', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'climate-status', def: [1,2], min: [1,2], max: [2,40] },
  { id: 'climate-control-panel', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'weather-at-car', def: [1,2], min: [1,2], max: [3,40] },
  { id: 'climate-history', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'command-quick-actions', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'command-history', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'recent-drives', def: [2,4], min: [2,2], max: [4,40] },
  { id: 'drive-score', def: [1,2], min: [1,2], max: [2,40] },
  { id: 'recent-drives-list', def: [2,4], min: [1,4], max: [4,40] },
  { id: 'drive-score-gauge', def: [1,2], min: [1,2], max: [2,40] },
  { id: 'drive-efficiency-chart', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'speed-heatmap', def: [2,4], min: [1,4], max: [4,40] },
  { id: 'driving-dynamics', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'speed-profile', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'regen-efficiency', def: [1,2], min: [1,2], max: [3,40] },
  { id: 'route-efficiency', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'driving-coach', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'trip-summary', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'drive-telemetry', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'energy-flow-animated', def: [2,4], min: [2,4], max: [3,40] },
  { id: 'vampire-drain', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'sleep-efficiency', def: [1,2], min: [1,2], max: [3,40] },
  { id: 'solar-production', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'live-power-flow', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'energy-site-info', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'backup-history', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'power-flow-history', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'energy-stats', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'location-map', def: [2,4], min: [1,4], max: [4,40] },
  { id: 'location-favorites', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'geofence-status', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'destination-eta', def: [2,2], min: [1,2], max: [3,40] },
  { id: 'position-heatmap', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'media-now-playing', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'media-history', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'security-status', def: [1,2], min: [1,2], max: [2,40] },
  { id: 'door-window-status', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'sentry-event-log', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'safety-features', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'safety-history', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'guard-mode', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'vehicle-access', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'onboarding-checklist', def: [2,4], min: [2,3], max: [4,8] },
  { id: 'fleet-posture', def: [2,8], min: [2,5], max: [4,12] },
  { id: 'uptime-monitor', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'mqtt-status', def: [2,2], min: [1,2], max: [3,40] },
  { id: 'quick-nav', def: [4,2], min: [2,2], max: [4,40] },
  { id: 'api-usage', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'system-health', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'telemetry-errors', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'audit-log', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'backup-monitor', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'export-status', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'version-info', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'dashboard-stats', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'live-signals', def: [2,4], min: [2,2], max: [4,40] },
  { id: 'live-signal-sparklines', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'signal-health', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'signal-catalog', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'signal-log', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'tire-pressure-visual', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'tire-pressure-history', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'vehicle-hero', def: [2,6], min: [2,4], max: [4,40] },
  { id: 'vehicle-hero-card', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'vehicle-twin', def: [2,4], min: [2,4], max: [3,40] },
  { id: 'digital-twin-mini', def: [2,4], min: [1,4], max: [4,40] },
  { id: 'software-update-status', def: [2,2], min: [1,2], max: [4,40] },
  { id: 'software-update-history', def: [2,4], min: [1,4], max: [4,40] },
  { id: 'odometer-counter', def: [1,2], min: [1,2], max: [2,40] },
  { id: 'drivetrain-health', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'motor-performance', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'motor-history', def: [2,4], min: [2,4], max: [4,40] },
  { id: 'vehicle-specs', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'watch-summary', def: [1,2], min: [1,2], max: [2,40] },
  { id: 'maintenance-tracker', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'warranty-status', def: [2,2], min: [1,2], max: [3,40] },
  { id: 'subscriptions', def: [2,4], min: [1,2], max: [4,40] },
  { id: 'vehicle-upgrades', def: [2,4], min: [1,2], max: [4,40] },
]

type SizeName = 'min' | 'default' | 'large'

function sizeFor(entry: WidgetSizeEntry, size: SizeName): [number, number] {
  if (size === 'min') return entry.min
  if (size === 'default') return entry.def
  return [Math.min(entry.max[0], 4), Math.min(entry.max[1], entry.def[1] + 4, 12)]
}

// Mirrors `buildDefaultLayouts` in useDashboardLayout.ts (row-flow per
// breakpoint). Only the lg breakpoint is measured (1440px viewport); the
// others keep the seed valid if RGL falls back during hydration.
const GRID_COLS: Record<string, number> = { lg: 4, md: 3, sm: 2, xs: 1 }

function buildSeed(size: SizeName) {
  const widgets = WIDGET_SIZES.map((entry, index) => ({
    id: `overflow-guard-${index}`,
    widgetId: entry.id,
  }))
  const layouts: Record<string, unknown[]> = {}
  for (const [bp, cols] of Object.entries(GRID_COLS)) {
    let x = 0
    let y = 0
    let rowMaxH = 0
    const items: unknown[] = []
    WIDGET_SIZES.forEach((entry, index) => {
      const [w0, h0] = sizeFor(entry, size)
      const w = Math.min(w0, cols)
      const h = h0
      if (x + w > cols) {
        x = 0
        y += rowMaxH
        rowMaxH = 0
      }
      items.push({
        i: `overflow-guard-${index}`,
        x,
        y,
        w,
        h,
        minW: Math.min(entry.min[0], cols),
        minH: entry.min[1],
        maxW: Math.min(entry.max[0], cols),
        maxH: entry.max[1],
      })
      x += w
      rowMaxH = Math.max(rowMaxH, h)
    })
    layouts[bp] = items
  }
  const now = new Date().toISOString()
  return {
    dashboards: [{
      id: 'overflow-guard',
      name: 'Overflow guard',
      widgets,
      layouts,
      createdAt: now,
      updatedAt: now,
      isDefault: true,
    }],
    active: 'overflow-guard',
  }
}

interface ClipDetail {
  tag: string
  text: string
  cls: string
  scroll: number
  client: number
}

interface WidgetRecord {
  id: string
  status: 'pass' | 'body-overflow' | 'text-clipped' | 'body-overflow+text-clipped' | 'missing' | 'not-rendered' | 'error-boundary'
  bodyScroll: number | null
  bodyClient: number | null
  clipped: ClipDetail[]
}

async function measureAll(page: Page): Promise<WidgetRecord[]> {
  return page.evaluate((ids: string[]) => {
    const hasAffordance = (el: HTMLElement, body: HTMLElement): boolean => {
      let node: HTMLElement | null = el
      while (node) {
        if ((node.getAttribute('title') ?? '').trim() !== '') return true
        const cls = typeof node.className === 'string' ? node.className : ''
        if (/\btruncate\b/.test(cls) || /\bline-clamp(-\d+)?\b/.test(cls)) return true
        if (node === body) break
        node = node.parentElement
      }
      return false
    }
    return ids.map((id, index): WidgetRecord => {
      const root = document.querySelector(`[data-widget-id="overflow-guard-${index}"]`)
      if (!root) return { id, status: 'missing', bodyScroll: null, bodyClient: null, clipped: [] }
      const body = root.querySelector<HTMLElement>('[data-testid="widget-body"]')
      if (!body) {
        const failed = /failed to load/i.test(root.textContent ?? '')
        return {
          id,
          status: failed ? 'error-boundary' : 'not-rendered',
          bodyScroll: null,
          bodyClient: null,
          clipped: [],
        }
      }
      const record: WidgetRecord = {
        id,
        status: 'pass',
        bodyScroll: body.scrollWidth,
        bodyClient: body.clientWidth,
        clipped: [],
      }
      if (body.scrollWidth > body.clientWidth + 1) {
        record.status = 'body-overflow'
        const boundary = body.getBoundingClientRect()
        const clientRight = boundary.left + body.clientLeft + body.clientWidth
        const style = getComputedStyle(body)
        Object.assign(record, { bodyGeometry: {
          width: boundary.width, clientLeft: body.clientLeft,
          scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
          cssWidth: style.width, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
          overflowX: style.overflowX, overflowY: style.overflowY,
          boxSizing: style.boxSizing, transform: style.transform, scrollbarGutter: style.scrollbarGutter,
          afterMeasurement: body.scrollWidth,
          nestedOverflow: [...body.querySelectorAll<HTMLElement>('*')]
            .filter(el => el.scrollWidth > el.clientWidth + 1).slice(0, 16).map(el => ({
              tag: el.tagName, cls: String(el.className), text: el.textContent?.slice(0, 80),
              scroll: el.scrollWidth, client: el.clientWidth,
              width: el.getBoundingClientRect().width,
              right: el.getBoundingClientRect().right - clientRight,
              overflow: getComputedStyle(el).overflowX,
            })),
          pseudo: ['::before', '::after'].map(pseudo => {
            const computed = getComputedStyle(body, pseudo)
            return { pseudo, content: computed.content, width: computed.width, position: computed.position }
          }),
        }, overflowingElements: [...body.querySelectorAll<HTMLElement>('*')]
          .filter(el => el.getBoundingClientRect().right > clientRight + 1)
          .slice(0, 12).map(el => ({
            tag: el.tagName, text: el.textContent?.slice(0, 100), cls: String(el.className),
            right: el.getBoundingClientRect().right - clientRight,
            visibility: getComputedStyle(el).visibility, position: getComputedStyle(el).position,
          })) })
      }
      const candidates = body.querySelectorAll<HTMLElement>(
        'p,span,div,h1,h2,h3,h4,h5,h6,li,td,th,a,button,label,dt,dd',
      )
      for (const el of candidates) {
        if (el.closest('.sr-only, svg, .leaflet-container')) continue
        const ownText = Array.from(el.childNodes)
          .filter((node) => node.nodeType === 3)
          .map((node) => node.textContent ?? '')
          .join('')
          .trim()
        if (!ownText) continue
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        if (el.scrollWidth <= el.clientWidth + 1) continue
        const overflowX = getComputedStyle(el).overflowX
        if (overflowX !== 'hidden' && overflowX !== 'clip' && overflowX !== 'scroll' && overflowX !== 'auto') continue
        if (hasAffordance(el, body)) continue
        record.clipped.push({
          tag: el.tagName.toLowerCase(),
          text: ownText.slice(0, 60),
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
          scroll: el.scrollWidth,
          client: el.clientWidth,
        })
        if (record.clipped.length >= 5) break
      }
      if (record.clipped.length > 0) {
        record.status = record.status === 'pass' ? 'text-clipped' : 'body-overflow+text-clipped'
      }
      return record
    })
  }, WIDGET_SIZES.map((entry) => entry.id))
}

// Representative widgets for the small/large verification screenshots.
const SHOT_WIDGETS = ['fleet-posture', 'battery-gauge', 'location-map', 'vehicle-hero', 'vehicle-twin', 'recent-drives'] as const

type MockApi = Awaited<ReturnType<typeof installApiMocks>>

// `waitForHarnessReady` needs 750ms without any mocked request completing,
// which 121 live widgets never grant (their polls interleave). Geometry —
// not API quiet — is what this guard asserts, so fall back to DOM
// stability when the full harness settle times out.
async function waitForGeometrySettled(page: Page, mockApi: MockApi): Promise<void> {
  try {
    await waitForHarnessReady(page, mockApi)
    return
  } catch {
    // Fall through to drain + DOM-stability settle below.
  }
  if (mockApi) {
    await expect.poll(() => mockApi.pending, {
      message: 'mock API requests did not drain',
      timeout: 30_000,
    }).toBe(0)
  }
  await page.waitForTimeout(2500)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
}

// Live widgets mutate the DOM continuously (polls, tickers), so byte-level
// DOM stability never arrives. Instead each config is measured 3 times and
// the per-widget WORST status wins (fail-closed against flapping).
const STATUS_RANK: Record<WidgetRecord['status'], number> = {
  pass: 0,
  'not-rendered': 0,
  'text-clipped': 1,
  'body-overflow': 1,
  'body-overflow+text-clipped': 1,
  'error-boundary': 2,
  missing: 2,
}

async function measureSettled(page: Page): Promise<WidgetRecord[]> {
  const samples: WidgetRecord[][] = []
  for (let i = 0; i < 3; i++) {
    samples.push(await measureAll(page))
    await page.waitForTimeout(2000)
  }
  return samples[0].map((first, index) => {
    let worst = first
    for (const sample of samples.slice(1)) {
      const candidate = sample[index]
      if (STATUS_RANK[candidate.status] > STATUS_RANK[worst.status]) worst = candidate
    }
    return worst
  })
}

test('widget bodies never overflow horizontally at min, default and large sizes in view and edit mode', async ({ page }, testInfo) => {
  test.setTimeout(480_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedBrowserState(page, 'dark', '/', { preserveDashboardState: true })
  const mockApi = await installApiMocks(page, 'populated', 'dark')
  const instanceId = new Map(WIDGET_SIZES.map((entry, index) => [entry.id, `overflow-guard-${index}`]))

  const violations: string[] = []
  const records: Array<{ size: SizeName; mode: 'view' | 'edit'; rows: WidgetRecord[] }> = []

  for (const size of ['min', 'default', 'large'] as const) {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate((seed) => {
      localStorage.setItem('teslasync-dashboards', JSON.stringify(seed.dashboards))
      localStorage.setItem('teslasync-active-dashboard', seed.active)
      localStorage.setItem('teslasync-row-height-version', '2')
      localStorage.removeItem('teslasync-dashboard-pending-save')
    }, buildSeed(size))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForGeometrySettled(page, mockApi)

    for (const mode of ['view', 'edit'] as const) {
      if (mode === 'edit') {
        await page.getByRole('button', { name: 'Customize' }).click()
        await waitForGeometrySettled(page, mockApi)
      }
      const rows = await measureSettled(page)
      records.push({ size, mode, rows })
      // Incremental record: a later config must never lose an earlier one.
      await writeFile(
        testInfo.outputPath(`records-${size}-${mode}.json`),
        JSON.stringify(rows, null, 1),
      )
      const bad = rows.filter((r) => r.status !== 'pass' && r.status !== 'not-rendered')
      for (const row of bad) {
        const detail = row.status === 'missing' || row.status === 'error-boundary'
          ? row.status
          : `body ${row.bodyScroll}/${row.bodyClient}px`
            + (row.clipped.length > 0
              ? ` clipped: ${row.clipped.map((c) => `<${c.tag}> "${c.text}" (${c.scroll}/${c.client}px)`).join('; ')}`
              : '')
        violations.push(`${size}/${mode} ${row.id}: ${detail}`)
        console.log(`[overflow-guard] VIOLATION ${size}/${mode} ${row.id}: ${row.status} ${detail}`)
        console.log(JSON.stringify(Reflect.get(row, 'bodyGeometry') ?? {}))
        console.log(JSON.stringify(Reflect.get(row, 'overflowingElements') ?? []))
      }
      console.log(
        `[overflow-guard] ${size}/${mode}: `
        + `${rows.filter((r) => r.status === 'pass').length}/${rows.length} pass, `
        + `${rows.filter((r) => r.status === 'not-rendered').length} not-rendered, `
        + `${bad.length} violations`,
      )
      if (mode === 'view' && (size === 'min' || size === 'large')) {
        for (const widgetId of SHOT_WIDGETS) {
          const panel = page.locator(`[data-widget-id="${instanceId.get(widgetId)}"]`)
          if (await panel.count() > 0) {
            await panel.screenshot({
              path: testInfo.outputPath(`row16-${widgetId}-${size}.png`),
              animations: 'disabled',
            })
          }
        }
      }
    }
  }

  await writeFile(
    testInfo.outputPath('per-widget-records.json'),
    JSON.stringify(records, null, 1),
  )
  expect(violations).toEqual([])
})
