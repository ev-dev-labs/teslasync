import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { installApiMocks, seedBrowserState, waitForHarnessReady } from './mockApi'
import { measureTz, type TzSweep } from './timezoneSweep'
import { auditCardGeometry, measureCardGeometry, type CardGeometry, type CardLayoutViolation } from './cardLayoutGeometry'
import { installCardLayoutFixtures } from './cardLayoutFixtures'
import { monitorPage } from './qualityAssertions'

/**
 * Row-17 guard + gallery: every route renders a readable layout in both
 * themes, retaining the original widths and adding the 390px mobile band.
 * Fails a route/width when:
 * - any card/panel (`[data-surface-variant]`, `.widget-panel`) is narrower
 *   than 200px at >= 768px viewport width;
 * - any short text element wraps per character (its line count approaches
 *   its character count);
 * - the page overflows horizontally (document/body scrollWidth).
 * - neighboring cards leave a large row hole, titles/actions or sibling
 *   statistics/plot offsets disagree, or a short empty body is not centered.
 *   CSS-column masonry is measured within columns, not as equal-height rows.
 *
 * Screenshots (viewport, 1280px + 375px) and per-chunk records land in
 * `web/test-results-guard/<runId>/` — OUTSIDE Playwright's outputDir, which
 * is cleaned at the start of every run (a filtered re-run once wiped a full
 * sweep's artifacts). `GUARD_RUN_ID` pins the directory; otherwise one stamp
 * per minute keeps parallel workers together while consecutive runs never
 * collide. The committed `docs/ui-simplification/route-gallery/` is a
 * curated copy of the JPEGs.
 *
 * `GALLERY_ONLY=/a,/b` restricts the run to those routes (attribution and
 * iteration). Routes are split into up to 64 nonempty chunks x 6 widths x
 * 2 themes; use Playwright's existing grep and shard options for bounded runs.
 * Small independently seeded batches let CI distribute the expensive route
 * sweep across runners instead of assigning 15 giant tests to one shard.
 *
 * Route table extracted from `src/App.tsx`:
 * 277 entries. Parameterized routes use canonical mock ids (drives/412,
 * charging/201, vehicles/7, trips/1, automations/1/edit,
 * system-status/incidents/1, year-review/2025, s/e2e-token); `*` becomes
 * one bogus path exercising the not-found page.
 *
 * TZ-5 sweep: the same pass also fails a route/width when visible text
 * contains a raw ISO timestamp (`2026-10-22T07:00:00.000Z`), a time zone
 * name/offset (`America/Los_Angeles`, `UTC`, `GMT-7`), or the same instant
 * in two different strings (friendly + raw pairs). `TZ_ALLOW` below excuses
 * design-accepted hits per route (`'*'` excuses a whole category); GMT
 * offsets inside SVG axis ticks are accepted globally (chart ticks by
 * design) but still recorded. Calibrate with
 * `GALLERY_ONLY=/a,/b` plus `-g "at 1280px"`.
 */

const ROUTES: string[] = [
  '/',
  '/__e2e-no-such-route__',
  '/account/2fa',
  '/account/privacy',
  '/account/sessions',
  '/action-center',
  '/activity',
  '/admin',
  '/admin/audit-log',
  '/admin/data-quality',
  '/admin/disk-forecast',
  '/admin/dlq',
  '/admin/feedback',
  '/admin/flags',
  '/admin/gdpr-exports',
  '/admin/ingest-xray',
  '/admin/live-signals',
  '/admin/schema-drift',
  '/admin/secret-rotation',
  '/admin/slow-queries',
  '/admin/telemetry/coverage',
  '/admin/vehicle-cost',
  '/alert-fatigue',
  '/alert-rules',
  '/alert-studio',
  '/analytics',
  '/analytics/anomalies',
  '/analytics/carbon',
  '/analytics/compare',
  '/analytics/lifetime',
  '/analytics/range',
  '/analytics/tco',
  '/anomaly-detection',
  '/api-keys',
  '/api-logs',
  '/api-playground',
  '/arrival-reliability',
  '/automations',
  '/automations/1/edit',
  '/automations/history',
  '/automations/list',
  '/automations/new',
  '/backup',
  '/battery',
  '/battery-care',
  '/battery-cells',
  '/battery-degradation',
  '/battery-passport',
  '/battery/health',
  '/benchmarks/privacy',
  '/cabin-thermal',
  '/charge-advisor',
  '/charge-departure-alignment',
  '/charge-interruption',
  '/charger-health',
  '/charger-resilience',
  '/charging',
  '/charging-curve',
  '/charging-heatmap',
  '/charging-thermal-tax',
  '/charging/201',
  '/charging/costs',
  '/charging/curves',
  '/charging/schedule',
  '/charging/vampire-drain',
  '/chatbot',
  '/climate',
  '/climate-control',
  '/cold-start',
  '/comfort-consistency',
  '/command-history',
  '/command-reliability',
  '/commands',
  '/compare',
  '/connect',
  '/cost-analysis',
  '/cycle-stress',
  '/dashcam',
  '/data-export',
  '/data-repair',
  '/day-log',
  '/db-health',
  '/departure-forecast',
  '/destination-transitions',
  '/dev-tools',
  '/dev/grid-states',
  '/dev/layout',
  '/dev/shared-library',
  '/dev/stats',
  '/diagnostics/root-cause',
  '/diagnostics/rul',
  '/diagnostics/service-evidence',
  '/digital-twin',
  '/docs/status-api',
  '/drive-archetypes',
  '/drive-calendar',
  '/drive-compare',
  '/drive-dna',
  '/drive-score',
  '/drives',
  '/drives/412',
  '/drives/412/replay',
  '/drivetrain-health',
  '/driving-dynamics',
  '/driving-rhythm',
  '/efficiency',
  '/efficiency-target',
  '/energy',
  '/energy-flow',
  '/energy-ledger',
  '/energy-orchestrator',
  '/energy-products',
  '/explore',
  '/explorer',
  '/exports',
  '/firmware-impact',
  '/fleet-api',
  '/fleet-operations',
  '/fsd',
  '/gas-price',
  '/geofences',
  '/glance',
  '/guard-mode',
  '/help',
  '/hvac-cycling',
  '/integrations/helix',
  '/intelligence-packs',
  '/intelligence/behavioral-sentinel',
  '/intelligence/causal-lab',
  '/intelligence/charging-forensics',
  '/intelligence/charging-site-twin',
  '/intelligence/component-survival',
  '/intelligence/emergency-resilience',
  '/intelligence/federated-learning',
  '/intelligence/firmware-canary',
  '/intelligence/journey-assurance',
  '/intelligence/road-hazards',
  '/intelligence/tco-optimizer',
  '/intelligence/twin-lab',
  '/journey-fragmentation',
  '/journeys',
  '/lifetime-stats',
  '/live',
  '/live-monitor',
  '/locations',
  '/logbook',
  '/maintenance',
  '/me/activity',
  '/media-player',
  '/mileage',
  '/mileage-budget',
  '/milestones',
  '/mqtt-inspector',
  '/navigation',
  '/notification-burn-rate',
  '/notification-latency',
  '/notifications',
  '/notifications/archived',
  '/notifications/audit',
  '/notifications/browser',
  '/notifications/channels',
  '/notifications/health',
  '/notifications/inbox',
  '/notifications/packs',
  '/notifications/quiet-hours',
  '/notifications/rules',
  '/notifications/studio',
  '/notifications/webhooks',
  '/onboarding',
  '/outage',
  '/ownership/charging-reconciliation',
  '/ownership/consumables-lifecycle',
  '/ownership/data-governance',
  '/ownership/driver-attribution',
  '/ownership/insurance-telematics',
  '/ownership/jurisdiction-compliance',
  '/ownership/model-trust',
  '/ownership/subscription-roi',
  '/ownership/tariff-lab',
  '/ownership/warranty-command',
  '/pack-capacity',
  '/parking',
  '/period-compare',
  '/physics-cockpit',
  '/power-flow',
  '/power/dashboards',
  '/power/grafana',
  '/power/sql',
  '/powershare',
  '/preconditioning-effectiveness',
  '/projected-range',
  '/quick-stats',
  '/range-buffer',
  '/redis-signals',
  '/regen-efficiency',
  '/resale-vault',
  '/roadmap',
  '/route-efficiency',
  '/s/e2e-token',
  '/safety-settings',
  '/science',
  '/search',
  '/seasonal-efficiency',
  '/security-access',
  '/segments',
  '/service-intelligence',
  '/settings',
  '/settings/fleet-setup',
  '/settings/safety',
  '/share-card',
  '/sharing/trips',
  '/signal-change-points',
  '/signal-correlation',
  '/signal-deadband',
  '/signal-diff',
  '/signal-entropy',
  '/signal-explorer',
  '/signal-gaps',
  '/signal-log',
  '/signal-mutual-information',
  '/signal-trend',
  '/signals',
  '/sleep-efficiency',
  '/smart-charge',
  '/software-updates',
  '/speed-profile',
  '/speed-sweetspot',
  '/state-debugger',
  '/statistics',
  '/system-status',
  '/system-status/incidents/1',
  '/tco',
  '/temperature-impact',
  '/tesla-account',
  '/tesla-api-usage',
  '/tesla-charging-history',
  '/tesla-charging-sessions',
  '/tesla-features',
  '/tesla-only',
  '/tesla-orders',
  '/tesla-physics',
  '/tesla-physics/black-box',
  '/tesla-physics/car-kept-living',
  '/tesla-physics/charge-port',
  '/tesla-physics/clocks',
  '/tesla-physics/contradictions',
  '/tesla-physics/dictionary',
  '/tesla-physics/firmware-epochs',
  '/tesla-physics/ledger',
  '/tesla-physics/life-tape',
  '/tesla-physics/logbook',
  '/tesla-physics/meters',
  '/tesla-physics/modes',
  '/tesla-physics/nervous-system',
  '/tesla-physics/range',
  '/tesla-physics/unknown',
  '/tesla-physics/vault',
  '/tesla-region',
  '/time-machine',
  '/timeline',
  '/tire-differential-drift',
  '/tire-pressure',
  '/trip-planner',
  '/trips',
  '/trips/1',
  '/utilization',
  '/vampire-drain',
  '/vehicle-comparison',
  '/vehicle-management',
  '/vehicle-systems/software',
  '/vehicles',
  '/vehicles/7',
  '/vehicles/7/access',
  '/watch',
  '/weekly-digest',
  '/what-if',
  '/year-review/2025',
]

const WIDTHS = [
  { width: 375, height: 844 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1920, height: 900 },
] as const

/**
 * Design-accepted TZ hits per route. Each entry excuses hits whose text
 * contains the substring; `'*'` excuses the whole category for the route.
 * - `/dev-tools` ISO: the TimestampTool converter's subject is the raw
 *   format itself (tz-tool-subject).
 * - `/settings` zones: the page's own time-zone explanation (tz-settings).
 * - `/notifications/quiet-hours` zones containing `/`: each window carries
 *   its own IANA zone as schedule data (tz-schedule-data); bare UTC/GMT
 *   hits are still flagged.
 * - `/day-log` GMT offsets: fall-back disambiguation on the timeline
 *   (tz-dst-offset, same class as the shared formatChartInstant).
 */
const TZ_ALLOW: Record<string, { iso?: string[]; zones?: string[]; dupes?: string[] }> = {
  '/dev-tools': { iso: ['*'] },
  '/settings': { zones: ['*'] },
  '/notifications/quiet-hours': { zones: ['/'] },
  '/day-log': { zones: ['GMT-', 'GMT+'] },
}

function tzExcused(route: string, kind: 'iso' | 'zones' | 'dupes', text: string): boolean {
  const allow = TZ_ALLOW[route]?.[kind] ?? []
  return allow.some((sub) => sub === '*' || text.includes(sub))
}

const onlyEnv = process.env.GALLERY_ONLY?.split(',').map((s) => s.trim()).filter(Boolean) ?? null
const ACTIVE_ROUTES = onlyEnv ? ROUTES.filter((r) => onlyEnv.includes(r)) : ROUTES
const CHUNKS = Math.min(64, Math.max(1, ACTIVE_ROUTES.length))

interface NarrowCard { selector: string; width: number; height: number; text: string }
interface PerChar { tag: string; text: string; width: number; height: number; lines: number }
interface RouteRecord {
  route: string
  width: number
  finalUrl: string
  status: 'pass' | 'load-error' | 'violation'
  cards: number
  narrow: NarrowCard[]
  perchar: PerChar[]
  overflow: { root: [number, number]; body: [number, number] } | null
  error: string | null
  tz: TzSweep
  theme: 'dark' | 'light'
  geometry: CardGeometry[]
  layout: CardLayoutViolation[]
  networkEscapes: string[]
  unmatchedMocks: string[]
  runtimeErrors: string[]
}

function slug(route: string): string {
  const s = route.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
  return s === '' ? 'home' : s
}

// Run-stamped artifact root: Playwright cleans its own outputDir at the
// start of every run, so records + screenshots live in a sibling tree that
// survives consecutive runs (full sweep followed by a filtered re-run).
const HERE = path.dirname(fileURLToPath(import.meta.url))
function resolveGuardRunId(): string {
  const pinned = process.env.GUARD_RUN_ID?.trim()
  if (pinned) return pinned.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `run-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
}
const GUARD_ARTIFACT_DIR = process.env.GUARD_ARTIFACT_DIR
  ? path.resolve(process.env.GUARD_ARTIFACT_DIR, resolveGuardRunId())
  : path.resolve(HERE, '../test-results-guard', resolveGuardRunId())
async function guardArtifactPath(name: string): Promise<string> {
  await mkdir(GUARD_ARTIFACT_DIR, { recursive: true })
  return path.join(GUARD_ARTIFACT_DIR, name)
}

type MockApi = Awaited<ReturnType<typeof installApiMocks>>

async function settle(page: Page, mockApi: MockApi): Promise<void> {
  try {
    await waitForHarnessReady(page, mockApi)
  } catch {
    if (mockApi) {
      await expect.poll(() => mockApi.pending, {
        message: 'mock API requests did not drain',
        timeout: 20_000,
      }).toBe(0)
    }
    await page.waitForTimeout(1200)
  }
}

async function measure(page: Page, width: number): Promise<
  Pick<RouteRecord, 'cards' | 'narrow' | 'perchar'> & { overflow: NonNullable<RouteRecord['overflow']> }
> {
  return page.evaluate((viewportWidth: number) => {
    const narrow: NarrowCard[] = []
    let cards = 0
    for (const el of document.querySelectorAll<HTMLElement>('[data-surface-variant], .widget-panel')) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      cards += 1
      if (viewportWidth >= 768 && rect.width < 200) {
        narrow.push({
          selector: el.className?.toString?.().slice(0, 60) ?? el.tagName,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: (el.textContent ?? '').trim().slice(0, 50),
        })
      }
    }
    const perchar: PerChar[] = []
    const candidates = document.querySelectorAll<HTMLElement>(
      'p,span,div,h1,h2,h3,h4,h5,h6,li,td,th,a,button,label,dt,dd,time',
    )
    for (const el of candidates) {
      if (el.closest('.sr-only, svg, .leaflet-container')) continue
      const rawText = Array.from(el.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? '')
        .join('')
      // Explicit author breaks (pre/code/poetry) are intentional, not collapse.
      if (!rawText || /[\r\n]/.test(rawText)) continue
      const ownText = rawText.replace(/\s+/g, ' ').trim()
      if (!ownText) continue
      const len = ownText.length
      if (len < 4 || len > 60) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      if (rect.width >= 120) continue
      const cs = getComputedStyle(el)
      if (cs.writingMode !== 'horizontal-tb') continue
      // True visual line count via line boxes: element height lies for table
      // cells (they stretch to row height). Only the element's OWN text
      // nodes are measured, so nested blocks never inflate the count, and
      // adjacent inline boxes sharing a line cluster into one row.
      const rows: { top: number; bottom: number }[] = []
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== 3) continue
        const range = document.createRange()
        range.selectNode(node)
        for (const r of Array.from(range.getClientRects())) {
          if (r.width === 0 || r.height === 0) continue
          const row = rows.find((candidate) => r.top < candidate.bottom - r.height * 0.5 && r.bottom > candidate.top + r.height * 0.5)
          if (row) {
            row.top = Math.min(row.top, r.top)
            row.bottom = Math.max(row.bottom, r.bottom)
          } else {
            rows.push({ top: r.top, bottom: r.bottom })
          }
        }
        range.detach()
      }
      const lines = rows.length
      if (lines >= 4 && lines >= len * 0.6) {
        perchar.push({
          tag: el.tagName.toLowerCase(),
          text: ownText.slice(0, 50),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          lines,
        })
        if (perchar.length >= 10) break
      }
    }
    const root = document.documentElement
    const body = document.body
    return {
      cards,
      narrow,
      perchar,
      overflow: {
        root: [root.scrollWidth, root.clientWidth] as [number, number],
        body: [body.scrollWidth, body.clientWidth] as [number, number],
      },
    }
  }, width)
}

for (let chunk = 0; chunk < CHUNKS; chunk += 1) {
  for (const { width, height } of WIDTHS) {
    for (const theme of ['dark', 'light'] as const) {
    test(`route layout guard chunk ${chunk} at ${width}px in ${theme}`, async ({ page }) => {
      test.setTimeout(600_000)
      const routes = ACTIVE_ROUTES.filter((_, index) => index % CHUNKS === chunk)
      if (routes.length === 0) test.skip()
      await page.setViewportSize({ width, height })
      await seedBrowserState(page, theme, '/')
      const { mockApi, networkEscapes } = await installCardLayoutFixtures(page, theme)
      const diagnostics = monitorPage(page)

      const records: RouteRecord[] = []
      const violations: string[] = []

      for (const route of routes) {
        mockApi.unmatched.clear()
        networkEscapes.length = 0
        for (const errors of Object.values(diagnostics)) errors.length = 0
        const record: RouteRecord = {
          route, width, finalUrl: '', status: 'pass', cards: 0,
          narrow: [], perchar: [], overflow: null, error: null,
          tz: { iso: [], zones: [], dupes: [] },
          theme, geometry: [], layout: [], networkEscapes: [], unmatchedMocks: [], runtimeErrors: [],
        }
        try {
          await page.goto(route, { waitUntil: 'domcontentloaded' })
          await settle(page, mockApi)
          record.networkEscapes = [...networkEscapes]
          record.unmatchedMocks = [...mockApi.unmatched]
          // Top-level routes (glance, watch, onboarding, …) render outside
          // the app Layout and own no <main>; measurable content is the
          // readiness signal, not the landmark.
          const hasContent = await page.evaluate(() =>
            document.querySelectorAll('main').length > 0
            || (document.querySelector('#root')?.textContent?.trim().length ?? 0) > 50,
          )
          if (!hasContent) throw new Error('page rendered no measurable content')
          record.finalUrl = page.url()
          const m = await measure(page, width)
          record.cards = m.cards
          record.narrow = m.narrow
          record.perchar = m.perchar
          record.overflow = m.overflow
          record.geometry = await measureCardGeometry(page)
          record.layout = auditCardGeometry(record.geometry)
          if (record.layout.length > 0) {
            record.status = 'violation'
            violations.push(...record.layout.map(hit =>
              `${route} @${width} ${theme}: ${hit.kind} ${hit.difference}px <${hit.cards.join(' / ')}>`))
          }
          const over = m.overflow.root[0] > m.overflow.root[1] + 1
            || m.overflow.body[0] > m.overflow.body[1] + 1
          if (m.narrow.length > 0 || m.perchar.length > 0 || over) {
            record.status = 'violation'
            const parts = [
              ...m.narrow.map((n) => `narrow ${n.width}px <${n.text}>`),
              ...m.perchar.map((p) => `perchar <${p.tag}> "${p.text}" ${p.width}x${p.height} ${p.lines} lines`),
            ]
            if (over) parts.push(`overflow root ${m.overflow.root[0]}/${m.overflow.root[1]} body ${m.overflow.body[0]}/${m.overflow.body[1]}`)
            violations.push(`${route} @${width}: ${parts.join('; ')}`)
          }
          const tz = await measureTz(page)
          record.tz = tz
          // GMT offsets inside SVG axis ticks are chart ticks by design
          // (shared formatChartInstant); everything else must be allowlisted.
          const tzIso = tz.iso.filter((h) => !tzExcused(route, 'iso', h.text))
          const tzZones = tz.zones.filter(
            (h) => !(h.inSvg && /^GMT[+-]/.test(h.text)) && !tzExcused(route, 'zones', h.text),
          )
          const tzDupes = tz.dupes.filter((d) => !tzExcused(route, 'dupes', d))
          if (tzIso.length > 0 || tzZones.length > 0 || tzDupes.length > 0) {
            record.status = 'violation'
            const parts = [
              ...tzIso.slice(0, 5).map((h) => `raw-iso "${h.text}"${h.inSvg ? ' [svg]' : ''} <<${h.context}>>`),
              ...tzZones.slice(0, 5).map((h) => `zone "${h.text}"${h.inSvg ? ' [svg]' : ''} <<${h.context}>>`),
              ...tzDupes.slice(0, 5).map((d) => `dupe ${d}`),
            ]
            violations.push(`${route} @${width}: TZ ${parts.join('; ')}`)
            await writeFile(
              await guardArtifactPath(`tz-dom-${slug(route)}-${width}-${theme}.html`),
              await page.content(),
            )
          }
          if (width === 1280 || width === 375 || width === 390) {
            await page.screenshot({
              path: await guardArtifactPath(`${slug(route)}-${width}-${theme}.jpg`),
              type: 'jpeg',
              quality: 70,
              animations: 'disabled',
            })
          }
        } catch (error) {
          record.status = 'load-error'
          const raw = error instanceof Error ? error.message.split('\n', 1)[0] : String(error)
          const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
          record.error = raw.replace(ansiPattern, '').slice(0, 160)
          violations.push(`${route} @${width}: LOAD ERROR ${record.error}`)
        }
        record.unmatchedMocks = [...mockApi.unmatched]
        record.networkEscapes = [...networkEscapes]
        record.runtimeErrors = Object.values(diagnostics).flat()
        if (record.unmatchedMocks.length > 0 || record.networkEscapes.length > 0 || record.runtimeErrors.length > 0) {
          if (record.status === 'pass') record.status = 'violation'
          if (record.unmatchedMocks.length > 0) {
            violations.push(`${route} @${width} ${theme}: unmatched synthetic API requests ${record.unmatchedMocks.join('; ')}`)
          }
          if (record.networkEscapes.length > 0) {
            violations.push(`${route} @${width} ${theme}: attempted external requests ${record.networkEscapes.join('; ')}`)
          }
          if (record.runtimeErrors.length > 0) {
            violations.push(`${route} @${width} ${theme}: runtime errors ${record.runtimeErrors.join('; ')}`)
          }
        }
        records.push(record)
        await writeFile(await guardArtifactPath(`records-chunk${chunk}-${width}-${theme}.json`), JSON.stringify(records, null, 1))
        console.log(
          `[route-guard] ${route} @${width} ${theme}: ${record.status} `
          + `cards=${record.cards} narrow=${record.narrow.length} perchar=${record.perchar.length}`
          + ` tzIso=${record.tz.iso.length} tzZones=${record.tz.zones.length} tzDupes=${record.tz.dupes.length}`
          + ` layout=${record.layout.length}`
          + (record.error ? ` error=${record.error}` : ''),
        )
      }

      expect(violations).toEqual([])
    })
    }
  }
}
