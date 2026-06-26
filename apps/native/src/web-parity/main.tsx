// Native parity port of web/src/main.tsx.
//
// The web `main.tsx` is the SPA BOOTSTRAP ENTRY POINT. At import time it runs a
// fixed sequence of side effects and then mounts the React tree with
// `ReactDOM.createRoot(document.getElementById('root')).render(...)`:
//
//   1. initRum()                      -- boots the OpenTelemetry browser SDK.
//   2. installGlobalErrorReporting()  -- window.error / unhandledrejection.
//   3. density bootstrap              -- localStorage -> document.body.dataset.
//   4. dev service-worker cleanup     -- navigator.serviceWorker.getRegistrations.
//   5. createQueryClient()            -- shared TanStack Query defaults.
//   6. queryCache.subscribe(...)      -- forward query failures to the reporter.
//   7. ReactDOM.createRoot(...).render(<providers/><App/></providers>).
//   8. web-vitals reporting           -- PROD ships, DEV logs to console.
//
// ## Native conversion (contract rules 4-7)
//
// Almost every imperative step is browser-only: `ReactDOM.createRoot`, the DOM
// `document`/`<body>`, `localStorage`, `navigator.serviceWorker`,
// `import.meta.env`, the OpenTelemetry browser SDK, and the dynamic `web-vitals`
// imports have no React Native equivalent. React Native also forbids import-time
// DOM side effects, so the parity module does NOT execute the bootstrap on
// import. Instead it:
//
//   - ports every DETERMINISTIC decision the web file makes into pure, exported,
//     independently testable functions (density resolution, the queryCache error
//     decision, the web-vitals mode selection + dev log shape, the dev
//     service-worker guard),
//   - reuses the sibling native `createQueryClient` parity so the L5/L6 wiring is
//     real, not mocked,
//   - exposes the provider tree (lines 89-127) and the bootstrap order as typed
//     data so the structure is preserved and assertable,
//   - records each browser-only step as an explicit unavailable adaptation, and
//   - renders an RN parity panel that visualises the sequence + provider tree.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported -- only React, React Native primitives, the existing
// apps/native theme tokens / UI components, and sibling native parity modules.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {createQueryClient} from './api/queryClient';
import {AppText} from '../components/ui/AppText';
import {GlassPanel} from '../components/ui/GlassPanel';
import {StatusPill} from '../components/ui/StatusPill';
import {WEB_ROOT_ELEMENT_ID} from '../platform/webBootstrap';
import {colors, spacing} from '../theme/tokens';

// ── Density bootstrap (web main.tsx lines 37-54) ──────────────────────────────

/** UI density values the web bootstrap accepts. Mirrors `ALLOWED_DENSITIES`. */
export type Density = 'compact' | 'comfortable' | 'spacious';

/** localStorage key the web bootstrap reads. Kept for cross-surface parity. */
export const DENSITY_LS_KEY = 'teslasync-density';

/** Allowed density values, mirroring the web `ALLOWED_DENSITIES` tuple. */
export const ALLOWED_DENSITIES = [
  'compact',
  'comfortable',
  'spacious',
] as const;

/** Default density used when no valid cached value is present. */
export const DEFAULT_DENSITY: Density = 'comfortable';

/**
 * Pure port of the web density resolution (lines 47-50): use the cached value
 * only when it is one of the allowed densities, otherwise fall back to
 * `comfortable`.
 */
export function resolveInitialDensity(
  cached: string | null | undefined,
): Density {
  if (cached && (ALLOWED_DENSITIES as readonly string[]).includes(cached)) {
    return cached as Density;
  }
  return DEFAULT_DENSITY;
}

// React Native has no `localStorage` and no `document.body` dataset, so the
// pre-paint density (which the web bootstrap stamped onto `<body>`) is held in
// an in-process store. It resets on app restart -- the same fallback the web
// try/catch uses when `localStorage` throws under Safari private mode.
let nativeDensity: Density = DEFAULT_DENSITY;

/** Current in-process density (native stand-in for `<body>.dataset.density`). */
export function getNativeDensity(): Density {
  return nativeDensity;
}

/**
 * Native-safe equivalent of the web density try/catch block (lines 45-54).
 * Resolves the cached value into the in-process store; any failure falls back
 * to `comfortable`, mirroring the web `catch` branch.
 */
export function applyInitialDensity(cached: string | null | undefined): Density {
  try {
    nativeDensity = resolveInitialDensity(cached);
  } catch {
    nativeDensity = DEFAULT_DENSITY;
  }
  return nativeDensity;
}

// ── Frontend error reporting (web main.tsx lines 28-35, 74-87) ────────────────

/** Error source channels, mirroring `errorReporter.ErrorSource`. */
export type ErrorReportSource = 'window' | 'promise' | 'react' | 'query';

/** Reporter signature mirroring `reportFrontendError(err, source)`. */
export type FrontendErrorReporter = (
  error: unknown,
  source: ErrorReportSource,
) => void;

// Structural shape of a TanStack Query cache notify event -- only the members
// the web subscription reads. The DOM lib is unavailable in native tsconfig and
// the concrete event type is version-specific, so it is modelled structurally.
interface QueryCacheEventLike {
  type?: string;
  action?: {type?: string; error?: unknown};
}

/**
 * Pure port of the web `queryCache.subscribe` decision (lines 80-87): only an
 * `updated` event whose `action.type === 'error'` carrying a non-null error
 * should be reported, always under the `query` source.
 */
export function selectQueryErrorForReport(
  event: unknown,
): {error: unknown; source: ErrorReportSource} | null {
  if (!event || (event as QueryCacheEventLike).type !== 'updated') {
    return null;
  }
  const action = (event as QueryCacheEventLike).action;
  if (action?.type !== 'error') {
    return null;
  }
  if (action.error !== undefined && action.error !== null) {
    return {error: action.error, source: 'query'};
  }
  return null;
}

const PARITY_QUERY_ERROR_RING_LIMIT = 20;
let parityReportedErrors: Array<{error: unknown; source: ErrorReportSource}> =
  [];

/**
 * Native-safe default reporter. The web `reportFrontendError` POSTs to
 * `/api/v1/web-errors`; the parity reporter records into an in-process ring so
 * the forwarding behaviour is observable/testable without performing network
 * I/O or installing browser `window` listeners.
 */
export function recordParityFrontendError(
  error: unknown,
  source: ErrorReportSource,
): void {
  parityReportedErrors = [{error, source}, ...parityReportedErrors].slice(
    0,
    PARITY_QUERY_ERROR_RING_LIMIT,
  );
}

/** Snapshot of the in-process reported-error ring. */
export function getParityReportedErrors(): ReadonlyArray<{
  error: unknown;
  source: ErrorReportSource;
}> {
  return parityReportedErrors.slice();
}

/** Reset the in-process reported-error ring (test/host helper). */
export function clearParityReportedErrors(): void {
  parityReportedErrors = [];
}

type ParityQueryClient = ReturnType<typeof createQueryClient>;

/**
 * Faithful port of the web `queryClient.getQueryCache().subscribe(...)` wiring
 * (lines 80-87). Subscribes the supplied client's query cache and forwards
 * qualifying failures through {@link selectQueryErrorForReport} to `report`
 * (defaulting to the in-process recorder). Returns the unsubscribe function.
 */
export function subscribeQueryErrorReporting(
  queryClient: ParityQueryClient,
  report: FrontendErrorReporter = recordParityFrontendError,
): () => void {
  return queryClient.getQueryCache().subscribe(event => {
    const decision = selectQueryErrorForReport(event);
    if (decision) {
      report(decision.error, decision.source);
    }
  });
}

// ── Build environment (web main.tsx import.meta.env: lines 56, 134, 142) ──────

/** The three `import.meta.env` fields the web bootstrap branches on. */
export interface BuildEnvLike {
  DEV?: boolean;
  PROD?: boolean;
  VITE_PWA_DEV?: string;
}

/**
 * Native build env. `import.meta.env` is a Vite construct unavailable under
 * Metro, which exposes the global `__DEV__` flag instead. The two derived
 * fields cover every branch the web bootstrap takes (`DEV` and `PROD`).
 */
export function nativeBuildEnv(): BuildEnvLike {
  const devFlag = (globalThis as {__DEV__?: boolean}).__DEV__;
  const dev = typeof devFlag === 'boolean' ? devFlag : true;
  return {DEV: dev, PROD: !dev};
}

/**
 * Pure port of the dev service-worker cleanup guard (line 56): only clear when
 * running a DEV build, `VITE_PWA_DEV` is not `'true'`, and a service-worker
 * registry exists. Native has no `navigator.serviceWorker`, so callers pass
 * `false` and the result is always `false`.
 */
export function shouldClearDevServiceWorker(
  env: BuildEnvLike,
  hasServiceWorkerApi: boolean,
): boolean {
  return Boolean(env.DEV) && env.VITE_PWA_DEV !== 'true' && hasServiceWorkerApi;
}

// ── Web Vitals reporting (web main.tsx lines 129-157) ─────────────────────────

/** Which web-vitals path the bootstrap takes. */
export type WebVitalsMode = 'production-reporter' | 'dev-console';

/**
 * Pure port of the web-vitals branch (lines 134/142): PROD ships through the
 * backend reporter, everything else logs to the dev console.
 */
export function selectWebVitalsMode(env: BuildEnvLike): WebVitalsMode {
  return env.PROD ? 'production-reporter' : 'dev-console';
}

/** Shape of a web-vitals metric, mirroring the dev `report` callback arg. */
export interface WebVitalMetric {
  name: string;
  value: number;
  id: string;
  rating?: string;
}

/**
 * Pure port of the dev web-vitals log shape (lines 145-147):
 * `console.debug('[web-vitals]', name, Math.round(value), rating ?? '', id)`.
 * Returned as a tuple so the rounding + `rating ?? ''` fallback is testable
 * without a browser console.
 */
export function formatWebVitalDevLog(
  metric: WebVitalMetric,
): [string, string, number, string, string] {
  return [
    '[web-vitals]',
    metric.name,
    Math.round(metric.value),
    metric.rating ?? '',
    metric.id,
  ];
}

// ── Provider tree (web main.tsx lines 89-127) ─────────────────────────────────

/** One node in the bootstrap provider tree, preserving nesting + source line. */
export interface BootstrapProviderNode {
  component: string;
  depth: number;
  sourceLine: number;
  role: string;
}

/**
 * The exact provider composition the web bootstrap renders under
 * `ReactDOM.createRoot(...).render(...)` (lines 89-127), preserving nesting
 * depth, source line, and the documented purpose of each wrapper.
 */
export const BOOTSTRAP_PROVIDER_TREE: readonly BootstrapProviderNode[] = [
  {component: 'React.StrictMode', depth: 0, sourceLine: 90, role: 'Dev double-invoke checks'},
  {component: 'ErrorBoundary', depth: 1, sourceLine: 91, role: 'Catch render errors -> reporter'},
  {component: 'QueryClientProvider', depth: 2, sourceLine: 92, role: 'TanStack Query context'},
  {component: 'QueryBroadcastBridge', depth: 3, sourceLine: 96, role: 'Cross-tab query invalidation'},
  {component: 'FormatterPrefsBridge', depth: 3, sourceLine: 101, role: 'Sync formatter globals to settings'},
  {component: 'BrowserRouter', depth: 3, sourceLine: 102, role: 'Web history routing (native: in-app router)'},
  {component: 'NavigationGuardProvider', depth: 4, sourceLine: 109, role: 'Unsaved-changes navigation guard'},
  {component: 'ThemeProvider', depth: 5, sourceLine: 110, role: 'Theme + mode context'},
  {component: 'SelectedVehicleProvider', depth: 6, sourceLine: 111, role: 'Selected vehicle store'},
  {component: 'ToastProvider', depth: 7, sourceLine: 112, role: 'Global toast stack'},
  {component: 'App', depth: 8, sourceLine: 113, role: 'Route shell'},
  {component: 'ReloadPrompt', depth: 8, sourceLine: 114, role: 'PWA update prompt (native: n/a)'},
  {component: 'AchievementUnlockListener', depth: 8, sourceLine: 118, role: 'SSE achievement celebrations'},
];

// ── Bootstrap sequence (the imperative order of web main.tsx) ─────────────────

/** Whether a bootstrap step runs natively or is a browser-only adaptation. */
export type BootstrapStepAvailability = 'native' | 'browser-only';

/** One ordered bootstrap step with its source span + native availability. */
export interface BootstrapStep {
  id: string;
  label: string;
  sourceLines: string;
  availability: BootstrapStepAvailability;
  detail: string;
}

/**
 * The fixed bootstrap order from web main.tsx, annotated with whether each step
 * is reproduced natively or recorded as a browser-only adaptation.
 */
export const BOOTSTRAP_SEQUENCE: readonly BootstrapStep[] = [
  {
    id: 'init-rum',
    label: 'initRum()',
    sourceLines: '21-26',
    availability: 'browser-only',
    detail:
      'OpenTelemetry browser SDK (page-load/fetch/XHR auto-instrumentation) requires a DOM; out of scope for native.',
  },
  {
    id: 'install-global-error-reporting',
    label: 'installGlobalErrorReporting()',
    sourceLines: '28-35',
    availability: 'browser-only',
    detail:
      'window.error / window.unhandledrejection listeners are browser-only; native forwards query failures in-process instead.',
  },
  {
    id: 'density-bootstrap',
    label: 'density bootstrap',
    sourceLines: '37-54',
    availability: 'native',
    detail:
      'applyInitialDensity resolves the cached density into an in-process store (no localStorage / <body> dataset in native).',
  },
  {
    id: 'clear-dev-service-worker',
    label: 'dev service-worker cleanup',
    sourceLines: '56-67',
    availability: 'browser-only',
    detail:
      'navigator.serviceWorker has no native registry; shouldClearDevServiceWorker returns false on native.',
  },
  {
    id: 'create-query-client',
    label: 'createQueryClient()',
    sourceLines: '69-72',
    availability: 'native',
    detail:
      'Reuses the sibling native createQueryClient parity (AppState focus manager + shared defaults).',
  },
  {
    id: 'subscribe-query-errors',
    label: 'queryCache.subscribe(...)',
    sourceLines: '74-87',
    availability: 'native',
    detail:
      'subscribeQueryErrorReporting + selectQueryErrorForReport preserve the updated/error/non-null decision.',
  },
  {
    id: 'render-root',
    label: `ReactDOM.createRoot(#${WEB_ROOT_ELEMENT_ID}).render(...)`,
    sourceLines: '89-127',
    availability: 'browser-only',
    detail:
      'DOM mounting is replaced by AppRegistry-based native mounting; the provider tree is preserved as data + this panel.',
  },
  {
    id: 'report-web-vitals',
    label: 'web-vitals reporting',
    sourceLines: '129-157',
    availability: 'browser-only',
    detail:
      'Dynamic import("web-vitals") / webVitalsReporter are web-only; selectWebVitalsMode + formatWebVitalDevLog keep the logic.',
  },
];

/** Explicit unavailable-state notes for the browser-only bootstrap behaviour. */
export const WEB_BOOTSTRAP_UNAVAILABLE_ADAPTATIONS = [
  `ReactDOM.createRoot(document.getElementById("${WEB_ROOT_ELEMENT_ID}")) is replaced by AppRegistry-based native mounting; this panel renders the provider tree it would have wired.`,
  'document.body.dataset.density is unavailable; the cached UI density resolves into an in-process store (resets on restart) via applyInitialDensity.',
  'localStorage.getItem(DENSITY_LS_KEY) has no native equivalent; the in-process density store stands in, matching the web try/catch fallback to "comfortable".',
  'navigator.serviceWorker dev cleanup is browser-only; shouldClearDevServiceWorker returns false on native where no service-worker registry exists.',
  'initRum() boots the OpenTelemetry browser SDK; native RUM is out of scope and reported as unavailable.',
  'installGlobalErrorReporting() installs window listeners and POSTs to /api/v1/web-errors; native records query failures in-process via recordParityFrontendError.',
  'import.meta.env (Vite) is replaced by nativeBuildEnv() reading the Metro __DEV__ global for the DEV/PROD branches.',
  'The dynamic import("web-vitals") / import("./lib/webVitalsReporter") modules are web-only; selectWebVitalsMode + formatWebVitalDevLog preserve the mode selection and dev log shape.',
] as const;

// ── Imperative orchestrator (native-safe; no import-time side effects) ────────

/** Options for {@link runWebBootstrapParity}. All have native-safe defaults. */
export interface WebBootstrapParityOptions {
  cachedDensity?: string | null;
  env?: BuildEnvLike;
  hasServiceWorkerApi?: boolean;
  reportError?: FrontendErrorReporter;
}

/** Structured result of running the native-safe bootstrap parity. */
export interface WebBootstrapParityResult {
  density: Density;
  webVitalsMode: WebVitalsMode;
  clearDevServiceWorker: boolean;
  queryClient: ParityQueryClient;
  providerTree: readonly BootstrapProviderNode[];
  sequence: readonly BootstrapStep[];
  unavailableAdaptations: readonly string[];
  unsubscribeQueryErrors: () => void;
}

/**
 * Native-safe analogue of the web main.tsx top-level execution. Unlike the web
 * file (which runs on import), this is an explicit call so React Native never
 * performs DOM side effects at module load. It reproduces every reproducible
 * decision and returns them as structured data plus an unsubscribe handle.
 */
export function runWebBootstrapParity(
  options: WebBootstrapParityOptions = {},
): WebBootstrapParityResult {
  const env = options.env ?? nativeBuildEnv();
  const density = applyInitialDensity(options.cachedDensity ?? getNativeDensity());
  const queryClient = createQueryClient();
  const unsubscribeQueryErrors = subscribeQueryErrorReporting(
    queryClient,
    options.reportError,
  );

  return {
    density,
    webVitalsMode: selectWebVitalsMode(env),
    clearDevServiceWorker: shouldClearDevServiceWorker(
      env,
      options.hasServiceWorkerApi ?? false,
    ),
    queryClient,
    providerTree: BOOTSTRAP_PROVIDER_TREE,
    sequence: BOOTSTRAP_SEQUENCE,
    unavailableAdaptations: WEB_BOOTSTRAP_UNAVAILABLE_ADAPTATIONS,
    unsubscribeQueryErrors,
  };
}

// ── Parity panel (visualises the bootstrap the web entry point performs) ──────

function availabilityState(
  availability: BootstrapStepAvailability,
): 'online' | 'warning' {
  return availability === 'native' ? 'online' : 'warning';
}

function SequenceRow({step, index}: {step: BootstrapStep; index: number}) {
  return (
    <View style={styles.sequenceRow}>
      <View style={styles.sequenceHeader}>
        <AppText weight="semibold">
          {index + 1}. {step.label}
        </AppText>
        <StatusPill
          label={step.availability === 'native' ? 'Native' : 'Native-safe'}
          state={availabilityState(step.availability)}
        />
      </View>
      <AppText variant="caption" tone="muted">
        web/src/main.tsx L{step.sourceLines}
      </AppText>
      <AppText tone="secondary">{step.detail}</AppText>
    </View>
  );
}

function ProviderRow({node}: {node: BootstrapProviderNode}) {
  return (
    <View style={styles.providerRow}>
      <AppText variant="caption" tone="muted" weight="semibold">
        L{node.depth}
      </AppText>
      <View style={styles.providerCopy}>
        <AppText weight="semibold">{node.component}</AppText>
        <AppText variant="caption" tone="muted">
          {node.role}
        </AppText>
      </View>
    </View>
  );
}

/**
 * Presentational native parity panel for the web bootstrap entry point. Pure
 * and side-effect free (it never mounts a query client) -- it visualises the
 * ported bootstrap sequence, the provider tree, the resolved density /
 * web-vitals mode, and the browser-only adaptations.
 */
export function WebBootstrapParityPanel() {
  const env = nativeBuildEnv();
  const density = getNativeDensity();
  const webVitalsMode = selectWebVitalsMode(env);
  const nativeSteps = BOOTSTRAP_SEQUENCE.filter(
    step => step.availability === 'native',
  ).length;

  return (
    <View style={styles.root}>
      <GlassPanel style={styles.panel}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <AppText variant="display" weight="bold">
              Web bootstrap parity
            </AppText>
            <AppText tone="secondary">
              Native-safe conversion of web/src/main.tsx: the imperative bootstrap
              order and provider tree without ReactDOM, document, localStorage,
              navigator, or import.meta.
            </AppText>
          </View>
          <View style={styles.summaryPills}>
            <StatusPill
              label={`${nativeSteps}/${BOOTSTRAP_SEQUENCE.length} native`}
              state="online"
            />
            <StatusPill label={`density: ${density}`} state="online" />
            <StatusPill
              label={`web-vitals: ${webVitalsMode}`}
              state={webVitalsMode === 'production-reporter' ? 'online' : 'warning'}
            />
          </View>
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <AppText variant="title" weight="bold">
          Bootstrap sequence
        </AppText>
        {BOOTSTRAP_SEQUENCE.map((step, index) => (
          <SequenceRow index={index} key={step.id} step={step} />
        ))}
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <AppText variant="title" weight="bold">
          Provider tree
        </AppText>
        <AppText tone="secondary">
          ReactDOM.createRoot render tree (lines 89-127), preserved as data.
        </AppText>
        {BOOTSTRAP_PROVIDER_TREE.map(node => (
          <ProviderRow key={`${node.component}-${node.sourceLine}`} node={node} />
        ))}
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <View style={styles.headerRow}>
          <AppText variant="title" weight="bold">
            Browser-only adaptations
          </AppText>
          <StatusPill label="Native-safe" state="warning" />
        </View>
        {WEB_BOOTSTRAP_UNAVAILABLE_ADAPTATIONS.map(adaptation => (
          <View key={adaptation} style={styles.adaptationRow}>
            <View style={styles.bullet} />
            <AppText tone="secondary" style={styles.adaptationText}>
              {adaptation}
            </AppText>
          </View>
        ))}
      </GlassPanel>
    </View>
  );
}

WebBootstrapParityPanel.displayName = 'WebBootstrapParityPanel';

export default WebBootstrapParityPanel;

const styles = StyleSheet.create({
  adaptationRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  adaptationText: {
    flex: 1,
  },
  bullet: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    height: 8,
    marginTop: 7,
    width: 8,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  panel: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  providerCopy: {
    flex: 1,
    gap: 2,
  },
  providerRow: {
    alignItems: 'baseline',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  root: {
    gap: spacing.lg,
  },
  sequenceHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  sequenceRow: {
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  summaryPills: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
});
