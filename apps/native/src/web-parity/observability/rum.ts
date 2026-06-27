// Native parity port of web/src/observability/rum.ts.
//
// The web module is the Real-User-Monitoring bootstrap: it stands up the
// OpenTelemetry *browser* SDK (WebTracerProvider + BatchSpanProcessor +
// OTLPTraceExporter + ZoneContextManager + getWebAutoInstrumentations) and
// ships browser spans (page loads, route changes, fetch/XHR) to the cluster's
// OTel collector over OTLP/HTTP. Every one of those building blocks is
// browser-only and none of the `@opentelemetry/*` packages are bundled into the
// native binary, so the SDK construction cannot run under Hermes. The two
// explicit instrumentation helpers (route-change spans + global error capture)
// are generic logic that only needs `window`/`history` plus a Tracer.
//
// Following the established parity convention for browser-only behaviour
// (safeUUID / notificationSound / InstallPrompt: "prefer the real global when
// present, otherwise an explicit unavailable state"), this port:
//   * Preserves the full public surface and every state name exactly —
//     `initRum`, `installRouteSpanEmitter`, `installGlobalErrorRecorder`, plus
//     the module flags `initialised`, `routeListenerInstalled`,
//     `errorListenerInstalled`.
//   * Preserves every configuration knob (VITE_OTLP_HTTP_ENDPOINT,
//     VITE_OTEL_SERVICE_NAME default "teslasync-web", VITE_OTEL_DEPLOY_ENV /
//     MODE / "unknown", VITE_APP_VERSION / "unknown"), the empty-endpoint dev
//     no-op + console.info, the resource attributes (service.name /
//     service.version / deployment.environment.name), the BatchSpanProcessor
//     sizing (2048 / 512 / 5000 ms), the same-origin-only fetch/XHR trace-header
//     propagation patterns, the `route.<path>` span name + app.route.* attribute
//     contract, the point-in-time span.end(), the idempotent install guards, and
//     the window error / unhandledrejection ERROR-span recording.
//   * Replaces Vite's `import.meta.env` with `resolveRumEnv()` reading an
//     injected `globalThis.TESLASYNC_RUM_ENV` (typed below; DEV falls back to the
//     React Native `__DEV__` global), mirroring the api/client.ts globalThis
//     config precedent.
//   * Replaces the hard `@opentelemetry/*` imports with a minimal, locally-typed
//     OTel-api-shaped tracer facade reached via `globalThis`. A capable host (a
//     react-native-web build with OpenTelemetry wired up, or a test harness) can
//     inject `globalThis.TESLASYNC_RUM_TRACER_PROVIDER` to light up real span
//     export; with none injected — the pure-native default — the tracer is an
//     inert no-op so the module never throws and ships nothing.
//   * Replaces the DOM `window` / `history` / `location` globals (the native
//     tsconfig omits the `dom` lib) with `getRumWindow()` / `getRumHistory()`
//     probes. On a pure native runtime there is no history router or window event
//     target, so both emitters early-return exactly like the web `typeof window
//     === 'undefined'` guards; on react-native-web the real DOM lights them up.
//   * Documents the browser-only reality via the exported `nativeRumCapabilities`
//     matrix and the parity sidecar.
//
// No DOM elements, Recharts, Leaflet, react-router-dom, OpenTelemetry packages,
// or web UI components are imported; the module has no runtime imports.

// ── OTel-api facade ──────────────────────────────────────────────────────────
// Minimal structural views of the `@opentelemetry/api` surface the web source
// touches (trace.getTracer -> Tracer.startSpan -> Span.end/recordException/
// setStatus, SpanStatusCode.ERROR). Declared locally because the packages are
// not bundled and the native tsconfig omits the DOM lib. They are satisfied by a
// real OTel API object when a host injects one on `globalThis`.

interface RumExceptionLike {
  name?: string;
  message?: string;
  stack?: string;
}

interface RumSpan {
  end(): void;
  recordException(exception: RumExceptionLike): void;
  setStatus(status: {code: number; message?: string}): void;
}

interface RumTracer {
  startSpan(
    name: string,
    options?: {attributes?: Record<string, string | number | boolean>},
  ): RumSpan;
}

// Mirrors the relevant slice of the browser tracing backend the web source
// builds (exporter endpoint, BatchSpanProcessor sizing, resource attributes, and
// the same-origin fetch/XHR propagation patterns). Handed to an injected
// provider's optional `bootstrap` hook so none of the web configuration is lost.
interface RumTracingBackendConfig {
  endpoint: string;
  resource: Record<string, string>;
  batch: {
    maxQueueSize: number;
    maxExportBatchSize: number;
    scheduledDelayMillis: number;
  };
  propagateTraceHeaderCorsUrls: Array<string | RegExp>;
  clearTimingResources: boolean;
}

interface RumTracerProvider {
  getTracer(name: string): RumTracer;
  bootstrap?(config: RumTracingBackendConfig): void;
}

// ── Native-safe env + DOM facades ────────────────────────────────────────────

// Build-time RUM configuration, mirroring the Vite `import.meta.env` knobs the
// web source reads. Injected by the host shell; absent on a pure native runtime
// (defaults below preserve web behaviour).
interface RumEnv {
  VITE_OTLP_HTTP_ENDPOINT?: string;
  VITE_OTEL_SERVICE_NAME?: string;
  VITE_OTEL_DEPLOY_ENV?: string;
  VITE_APP_VERSION?: string;
  MODE?: string;
  DEV?: boolean;
}

interface RumLocation {
  pathname: string;
  search: string;
  origin: string;
}

type RumHistoryStateMethod = (
  data: unknown,
  unused: string,
  url?: string | null,
) => void;

interface RumHistory {
  pushState: RumHistoryStateMethod;
  replaceState: RumHistoryStateMethod;
}

interface RumWindow {
  location: RumLocation;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

// Structural views of the browser `ErrorEvent` / `PromiseRejectionEvent` the
// global error recorder reads — the native tsconfig omits the DOM lib.
interface RumErrorEventLike {
  error?: unknown;
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface RumPromiseRejectionEventLike {
  reason?: unknown;
}

declare global {
  // A react-native-web build with OpenTelemetry configured (or a test harness)
  // may inject an OTel-api-compatible tracer provider here. Absent by default —
  // the pure-native reality — so RUM tracing is an inert no-op.
  var TESLASYNC_RUM_TRACER_PROVIDER: RumTracerProvider | undefined;
  // Build-time RUM env, mirroring Vite `import.meta.env`. Injected by the host.
  var TESLASYNC_RUM_ENV: RumEnv | undefined;
}

// service.name / service.version semantic-convention keys, inlined verbatim from
// `@opentelemetry/semantic-conventions` so the resource shape is byte-identical.
const ATTR_SERVICE_NAME = 'service.name';
const ATTR_SERVICE_VERSION = 'service.version';
// OTel SpanStatusCode.ERROR === 2 (UNSET 0 / OK 1 / ERROR 2).
const RUM_SPAN_STATUS_ERROR = 2;

const rumNoop = (): void => undefined;
const NOOP_SPAN: RumSpan = {
  end: rumNoop,
  recordException: rumNoop,
  setStatus: rumNoop,
};
const NOOP_TRACER: RumTracer = {
  startSpan: () => NOOP_SPAN,
};

/** Explicit capability matrix for the native RUM surface. Each flag describes a
 * pure native runtime (no OTel browser SDK, no DOM). The react-native-web target
 * — or a host that injects `globalThis.TESLASYNC_RUM_TRACER_PROVIDER` — may light
 * the tracing pieces up at runtime; documented in the parity sidecar. */
export const nativeRumCapabilities = {
  /** WebTracerProvider / BatchSpanProcessor / OTLPTraceExporter / ZoneContextManager. */
  otelWebSdkAvailable: false,
  /** getWebAutoInstrumentations fetch/XHR auto-instrumentation. */
  fetchXhrAutoInstrumentationAvailable: false,
  /** history.pushState/replaceState + popstate/hashchange route spans. */
  historyRouteSpansAvailable: false,
  /** window 'error' / 'unhandledrejection' global error spans. */
  globalErrorSpansAvailable: false,
  /** OTLP/HTTP span export to the collector (needs the SDK or an injected provider). */
  otlpSpanExportAvailable: false,
} as const;

function getInjectedTracerProvider(): RumTracerProvider | undefined {
  const candidate = globalThis.TESLASYNC_RUM_TRACER_PROVIDER;
  return candidate && typeof candidate.getTracer === 'function'
    ? candidate
    : undefined;
}

// Native-safe analogue of the web `trace.getTracer(name)`: delegate to an
// injected OTel-api provider when present, else hand back the inert no-op tracer.
function getRumTracer(name: string): RumTracer {
  const provider = getInjectedTracerProvider();
  if (provider) {
    try {
      return provider.getTracer(name);
    } catch {
      // Fall through to the inert no-op tracer.
    }
  }
  return NOOP_TRACER;
}

// Native-safe analogue of the web SDK construction (WebTracerProvider +
// exporter + auto-instrumentations). The browser SDK is unavailable, so we hand
// the faithfully-rebuilt config to an injected provider's optional bootstrap
// hook; with none present the OTLP backend stays inert (see nativeRumCapabilities).
function bootstrapTracingBackend(config: RumTracingBackendConfig): void {
  const provider = getInjectedTracerProvider();
  if (provider && typeof provider.bootstrap === 'function') {
    try {
      provider.bootstrap(config);
    } catch {
      // Never let RUM bootstrap crash app startup.
    }
  }
}

function resolveRumEnv(): RumEnv {
  return globalThis.TESLASYNC_RUM_ENV ?? {};
}

// Web `import.meta.env.DEV`. Prefer the injected env flag; otherwise fall back to
// the React Native `__DEV__` global (probed off globalThis so the bare
// identifier need not be declared under the native tsconfig).
function isDevEnvironment(env: RumEnv): boolean {
  if (typeof env.DEV === 'boolean') {
    return env.DEV;
  }
  const flag = (globalThis as typeof globalThis & {__DEV__?: boolean}).__DEV__;
  return flag === true;
}

/** The react-native-web `window` when a real DOM is present, else undefined on a
 * pure native runtime (mirrors the web `typeof window === 'undefined'` guard). */
function getRumWindow(): RumWindow | undefined {
  const candidate = (globalThis as typeof globalThis & {window?: unknown})
    .window;
  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof (candidate as RumWindow).addEventListener === 'function' &&
    typeof (candidate as {location?: unknown}).location === 'object'
  ) {
    return candidate as RumWindow;
  }
  return undefined;
}

/** The react-native-web `history` when present, else undefined on a pure native
 * runtime (mirrors the web `typeof history === 'undefined'` guard). */
function getRumHistory(): RumHistory | undefined {
  const candidate = (globalThis as typeof globalThis & {history?: unknown})
    .history;
  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof (candidate as RumHistory).pushState === 'function' &&
    typeof (candidate as RumHistory).replaceState === 'function'
  ) {
    return candidate as RumHistory;
  }
  return undefined;
}

let initialised = false;
let routeListenerInstalled = false;
let errorListenerInstalled = false;

export function initRum(): void {
  if (initialised) return;

  const env = resolveRumEnv();
  const endpoint = (env.VITE_OTLP_HTTP_ENDPOINT ?? '').trim();
  if (!endpoint) {
    if (isDevEnvironment(env)) {
      console.info(
        '[rum] VITE_OTLP_HTTP_ENDPOINT not set; OpenTelemetry RUM disabled.',
      );
    }
    return;
  }

  const serviceName = (
    env.VITE_OTEL_SERVICE_NAME ?? 'teslasync-web'
  ).toString();
  const deployEnv = (
    env.VITE_OTEL_DEPLOY_ENV ?? env.MODE ?? 'unknown'
  ).toString();
  const serviceVersion = (env.VITE_APP_VERSION ?? 'unknown').toString();

  const resource: Record<string, string> = {
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    'deployment.environment.name': deployEnv,
  };

  // Same-origin only — never propagate trace context to third-party hosts
  // (privacy + CORS). Mirrors the web getWebAutoInstrumentations fetch/XHR
  // `propagateTraceHeaderCorsUrls: [/^\//, new RegExp(window.location.origin)]`.
  const origin = getRumWindow()?.location.origin;
  const propagateTraceHeaderCorsUrls: Array<string | RegExp> = origin
    ? [/^\//, new RegExp(origin)]
    : [/^\//];

  // The OTel browser SDK (WebTracerProvider + BatchSpanProcessor +
  // OTLPTraceExporter + ZoneContextManager + getWebAutoInstrumentations) is
  // browser-only and not bundled into the native binary — see
  // nativeRumCapabilities. The faithfully-rebuilt config is handed to an injected
  // provider when present; otherwise the OTLP export backend stays inert.
  bootstrapTracingBackend({
    endpoint,
    resource,
    batch: {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 5000,
    },
    propagateTraceHeaderCorsUrls,
    clearTimingResources: true,
  });

  // Explicit instrumentation on top of the (unavailable) auto-instrumentations:
  // route-change spans + global error capture. Each is idempotent and safe to
  // call multiple times.
  installRouteSpanEmitter();
  installGlobalErrorRecorder();

  initialised = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route-change spans.
//
// React Router v6 uses `history.pushState` / `history.replaceState` under the
// hood. We monkey-patch both so we don't need to touch RouterProvider or any
// page. Spans are named `route.<pathname>` so Tempo can group them. On a pure
// native runtime there is no history router, so the emitter is an inert no-op.
// ─────────────────────────────────────────────────────────────────────────────
export function installRouteSpanEmitter(): void {
  if (routeListenerInstalled) return;
  const win = getRumWindow();
  const history = getRumHistory();
  if (!win || !history) return;

  const tracer = getRumTracer('teslasync-web/route');

  const emit = (kind: 'push' | 'replace' | 'pop' | 'hash') => {
    const path = win.location.pathname || '/';
    const span = tracer.startSpan(`route.${path}`, {
      attributes: {
        'app.route.path': path,
        'app.route.search': win.location.search,
        'app.route.kind': kind,
      },
    });
    // Route changes are point-in-time events; close the span immediately so the
    // exporter ships them in the next batch.
    span.end();
  };

  const wrap = (method: 'pushState' | 'replaceState', kind: 'push' | 'replace') => {
    const original = history[method].bind(history);
    history[method] = (data, unused, url) => {
      original(data, unused, url);
      try {
        emit(kind);
      } catch {
        // Never let instrumentation crash the app.
      }
    };
  };

  wrap('pushState', 'push');
  wrap('replaceState', 'replace');
  win.addEventListener('popstate', () => {
    try {
      emit('pop');
    } catch {
      /* ignore */
    }
  });
  win.addEventListener('hashchange', () => {
    try {
      emit('hash');
    } catch {
      /* ignore */
    }
  });

  routeListenerInstalled = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global error recorder.
//
// Listens for uncaught synchronous errors and unhandled promise rejections and
// records them on a dedicated short-lived span. Uses recordException so the
// stack trace lands in Tempo as a span event, putting errors in trace context so
// Grafana's "View trace" link from a metric exemplar lands on the failing
// request. On a pure native runtime there is no window event target, so the
// recorder is an inert no-op.
// ─────────────────────────────────────────────────────────────────────────────
export function installGlobalErrorRecorder(): void {
  if (errorListenerInstalled) return;
  const win = getRumWindow();
  if (!win) return;

  const tracer: RumTracer = getRumTracer('teslasync-web/error');

  const record = (
    name: string,
    err: unknown,
    extra: Record<string, string | number | boolean> = {},
  ) => {
    try {
      const span = tracer.startSpan(name, {attributes: extra});
      const e =
        err instanceof Error
          ? err
          : new Error(typeof err === 'string' ? err : JSON.stringify(err));
      span.recordException(e);
      span.setStatus({code: RUM_SPAN_STATUS_ERROR, message: e.message});
      span.end();
    } catch {
      // Never let instrumentation crash the app.
    }
  };

  win.addEventListener('error', event => {
    const ev = event as RumErrorEventLike;
    record('window.error', ev.error ?? ev.message, {
      'error.filename': ev.filename ?? '',
      'error.lineno': ev.lineno ?? 0,
      'error.colno': ev.colno ?? 0,
    });
  });

  win.addEventListener('unhandledrejection', event => {
    const ev = event as RumPromiseRejectionEventLike;
    record('window.unhandledrejection', ev.reason);
  });

  errorListenerInstalled = true;
}
