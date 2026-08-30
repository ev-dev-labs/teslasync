import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const mainSource = readFileSync(join(srcRoot, 'main.tsx'), 'utf8')
const appSource = readFileSync(join(srcRoot, 'App.tsx'), 'utf8')

/**
 * CLEAN-06 — startup provider/listener ownership contract.
 *
 * Everything mounted above `<Routes>` runs for every user on every route, and
 * everything it *statically imports* is cold-start weight even for the user who
 * only ever opens one page. That cost is invisible in review: adding one line
 * to `main.tsx` can pull a whole feature domain into the entry chunk.
 *
 * A measured audit of the built closure (5 startup chunks, 276 app modules)
 * found exactly one non-universal import chain —
 * `AchievementUnlockListener -> AchievementUnlockedToast ->
 * features/analytics/components/AchievementBadge` — now behind React.lazy with
 * the SSE subscription still eager. Every other global mount is genuinely
 * universal infrastructure and MUST stay eager:
 *
 *   - error boundaries and the global error reporter: must exist before the
 *     first render, or the bootstrap crash they exist to capture is lost;
 *   - QueryClientProvider + the cross-tab broadcast bridge: the data layer;
 *   - BrowserRouter + navigation guard: routing itself;
 *   - Theme/Font/Density: deferring them is a visible flash of the wrong paint;
 *   - i18n, Toast, selected-vehicle and operational-mode context: read by the
 *     shell on the first frame;
 *   - the PWA update host: an offline/update surface that only works if it is
 *     listening before the user navigates;
 *   - a11y route announcer + focus manager: WCAG 2.4.2 / focus management on
 *     the FIRST navigation, which can be the first paint.
 *
 * This test is the ownership record. Adding a global mount without a line in
 * the tables below fails, which forces the "is this universal?" conversation at
 * review time instead of at the next performance regression.
 * `scripts/check-bundle-size.mjs` enforces the measured half
 * (BUNDLE_STARTUP_FEATURE_MODULE_LIMIT).
 */

/** Components mounted in main.tsx's render tree. */
const MAIN_GLOBAL_MOUNTS: Record<string, string> = {
  ErrorBoundary: 'Root render-error trap. Must wrap everything.',
  QueryClientProvider: 'Data layer. Every hook in the app resolves through it.',
  QueryBroadcastBridge: 'Rebroadcasts cross-tab query invalidation into this tab.',
  FormatterPrefsBridge: 'Keeps module-level number/locale formatters in sync with settings.',
  BrowserRouter: 'Routing. Nothing renders without it.',
  NavigationGuardProvider: 'Unsaved-changes guard for in-app navigation; must outlive any route.',
  ThemeProvider: 'Applies theme CSS vars. Deferring flashes the wrong palette.',
  FontProvider: 'Applies typography CSS vars. Deferring reflows the first paint.',
  SelectedVehicleProvider: 'Global vehicle selection read by the shell header on frame one.',
  ToastProvider: 'Global toast portal host used by every surface.',
  OperationalModeProvider: 'Global read-only/degraded mode banner + write gating.',
  App: 'The application.',
  ReloadPrompt: 'PWA update/offline host. Only works if it is listening before navigation.',
  AchievementUnlockListener:
    'Realtime SSE subscription that must not miss events. Its celebration UI is '
    + 'lazy (CLEAN-06); only the subscription is eager.',
}

/** Components mounted in App.tsx above <Routes>. */
const APP_GLOBAL_MOUNTS: Record<string, string> = {
  DemoModeBanner: 'Self-gating synthetic-data label; must be the topmost element of any screenshot.',
  OnboardingGate: 'First-run gate; must decide before a route renders.',
  TaskOnboardingHost: 'Route-scoped onboarding hint host; must observe every navigation.',
  VitalsConsentPolicyGate: 'Publishes cookie-consent policy into RUM before any beacon is sent.',
  ScrollRestoration: 'Scroll position across navigations.',
  DensityApplier: 'Syncs UI density to <body> once settings resolve.',
  RouteAnnouncer: 'WCAG 2.4.2 — announces the new page title on every SPA navigation.',
  RouteFocusManager: 'A11Y-03 — parks focus on the new page heading after navigation.',
  RecentPagesRecorder: 'Records visited routes for the command palette / recent surfaces.',
  ContextMenuRoot: 'Single portal host for the shared right-click menu primitive.',
  Routes: 'The route table.',
  Route: 'Route entries.',
}

function mountedComponents(source: string, region: string): string[] {
  const start = source.indexOf(region)
  const slice = start === -1 ? source : source.slice(start)
  // Strip JSX `{/* … */}` comment blocks: they document sibling components by
  // name (`<GuardedLink>`) and would otherwise read as mounts.
  const withoutComments = slice.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  const names = new Set<string>()
  for (const match of withoutComments.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)) names.add(match[1])
  return [...names]
}

describe('startup provider/listener ownership (CLEAN-06)', () => {
  it('mounts only registered globals in main.tsx', () => {
    const rendered = mountedComponents(mainSource, 'ReactDOM.createRoot')
      .filter((name) => name !== 'React' && name !== 'StrictMode')
    const unregistered = rendered.filter((name) => !(name in MAIN_GLOBAL_MOUNTS))
    expect(
      unregistered,
      'New app-root mounts must be justified in MAIN_GLOBAL_MOUNTS: everything they '
      + 'statically import becomes cold-start weight for every user.',
    ).toEqual([])
  })

  it('mounts only registered globals above <Routes> in App.tsx', () => {
    const appBody = appSource.slice(appSource.indexOf('export default function App()'))
    const preRoutes = appBody.slice(appBody.indexOf('return ('), appBody.indexOf('<Routes>'))
    const rendered = mountedComponents(preRoutes, 'return (')
    const unregistered = rendered.filter((name) => !(name in APP_GLOBAL_MOUNTS))
    expect(
      unregistered,
      'New App-level mounts must be justified in APP_GLOBAL_MOUNTS.',
    ).toEqual([])
  })

  it('keeps optional telemetry off the critical path', () => {
    // RUM (OpenTelemetry + Zone.js) and web-vitals are opt-in and must never be
    // statically imported: most deployments leave RUM disabled and should not
    // download the SDK to execute its no-op branch.
    expect(mainSource).not.toMatch(/^import .*['"]\.\/observability\/rum['"]/m)
    expect(mainSource).not.toMatch(/^import .*['"]web-vitals['"]/m)
    expect(mainSource).toMatch(/import\(['"]\.\/observability\/rum['"]\)/)
    expect(mainSource).toMatch(/import\(['"]\.\/lib\/webVitalsReporter['"]\)/)
  })

  it('never statically imports a feature module into the entry', () => {
    // App.tsx reaches features through React.lazy; main.tsx must not reach them
    // at all. A static `features/` import here lands the whole domain in the
    // entry chunk.
    const staticFeatureImports = [...mainSource.matchAll(/^import[^\n]*from\s*['"]([^'"]+)['"]/gm)]
      .map((m) => m[1])
      .filter((spec) => spec.includes('features/'))
    expect(staticFeatureImports).toEqual([])
  })

  it('defers the achievement celebration UI but not its subscription', () => {
    const listener = readFileSync(
      join(srcRoot, 'components', 'feedback', 'AchievementUnlockListener.tsx'),
      'utf8',
    )
    // Subscription stays eager so no SSE event can be missed.
    expect(listener).toMatch(/^import \{ useAchievementUnlocks \}/m)
    // UI is behind a lazy boundary.
    expect(listener).toMatch(/lazy\(\(\) =>\s*\n?\s*import\('\.\/AchievementUnlockedToast'\)/)
    expect(listener).toMatch(/<Suspense fallback=\{null\}>/)
  })
})
