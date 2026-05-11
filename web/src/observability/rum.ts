// Phase 44 / Prompt 0060 — RUM bootstrap.
//
// Bootstraps the OpenTelemetry browser SDK and ships browser spans (page
// loads, route changes, fetch/XHR) to the cluster's OTel collector via OTLP
// over HTTP. Per ADR-008 lock #6, this module is imported exactly once from
// `web/src/main.tsx`. Pages and components MUST NOT import from here.
//
// Configuration knobs (all read from Vite env so they're build-time inlined):
//
//   VITE_OTLP_HTTP_ENDPOINT  Full URL of the collector's OTLP/HTTP traces
//                            ingest, e.g.
//                            https://otel-collector.example.com/v1/traces
//                            When empty (the dev default) the SDK is NOT
//                            initialised and `initRum` is a no-op.
//
//   VITE_OTEL_SERVICE_NAME   service.name resource attribute. Defaults to
//                            "teslasync-web".
//
//   VITE_OTEL_DEPLOY_ENV     deployment.environment resource attribute.
//                            Defaults to MODE (dev/prod/test).
//
// Sampling: this module does NOT install a tail sampler — it sends every
// span and lets the OTel collector apply tail sampling per
// docs/runbooks/phase-44-trace-sampling.md.

import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { trace, SpanStatusCode, type Tracer } from '@opentelemetry/api';

let initialised = false;
let routeListenerInstalled = false;
let errorListenerInstalled = false;

export function initRum(): void {
  if (initialised) return;

  const endpoint = (import.meta.env.VITE_OTLP_HTTP_ENDPOINT ?? '').trim();
  if (!endpoint) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(
        '[rum] VITE_OTLP_HTTP_ENDPOINT not set; OpenTelemetry RUM disabled.'
      );
    }
    return;
  }

  const serviceName = (
    import.meta.env.VITE_OTEL_SERVICE_NAME ?? 'teslasync-web'
  ).toString();
  const deployEnv = (
    import.meta.env.VITE_OTEL_DEPLOY_ENV ?? import.meta.env.MODE ?? 'unknown'
  ).toString();
  const serviceVersion = (
    import.meta.env.VITE_APP_VERSION ?? 'unknown'
  ).toString();

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment.name': deployEnv,
    }),
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint }), {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
      }),
    ],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
  });

  registerInstrumentations({
    instrumentations: [
      getWebAutoInstrumentations({
        '@opentelemetry/instrumentation-fetch': {
          // Same-origin only — never propagate trace context to third-party
          // hosts (privacy + CORS).
          propagateTraceHeaderCorsUrls: [/^\//, new RegExp(window.location.origin)],
          clearTimingResources: true,
        },
        '@opentelemetry/instrumentation-xml-http-request': {
          propagateTraceHeaderCorsUrls: [/^\//, new RegExp(window.location.origin)],
        },
      }),
    ],
  });

  // Phase 44 / Prompt 0061 — explicit instrumentation on top of the
  // auto-instrumentations: route-change spans + global error capture.
  // Each is idempotent and safe to call multiple times.
  installRouteSpanEmitter();
  installGlobalErrorRecorder();

  initialised = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 44 / Prompt 0061 — Route-change spans.
//
// React Router v6 uses `history.pushState` / `history.replaceState` under the
// hood. We monkey-patch both so we don't need to touch RouterProvider or any
// page (ADR-008 lock #6: pages must not import observability code). Spans
// are named `route.<pathname>` so Tempo can group them.
// ─────────────────────────────────────────────────────────────────────────────
export function installRouteSpanEmitter(): void {
  if (routeListenerInstalled) return;
  if (typeof window === 'undefined' || typeof history === 'undefined') return;

  const tracer = trace.getTracer('teslasync-web/route');

  const emit = (kind: 'push' | 'replace' | 'pop' | 'hash') => {
    const path = window.location.pathname || '/';
    const span = tracer.startSpan(`route.${path}`, {
      attributes: {
        'app.route.path': path,
        'app.route.search': window.location.search,
        'app.route.kind': kind,
      },
    });
    // Route changes are point-in-time events; close the span immediately so
    // the exporter ships them in the next batch.
    span.end();
  };

  const wrap = <K extends 'pushState' | 'replaceState'>(method: K, kind: 'push' | 'replace') => {
    const original = history[method].bind(history);
    history[method] = function (
      this: History,
      ...args: Parameters<History[K]>
    ): ReturnType<History[K]> {
      const result = (original as (...a: unknown[]) => unknown)(...args) as ReturnType<History[K]>;
      try {
        emit(kind);
      } catch {
        // Never let instrumentation crash the app.
      }
      return result;
    };
  };

  wrap('pushState', 'push');
  wrap('replaceState', 'replace');
  window.addEventListener('popstate', () => {
    try {
      emit('pop');
    } catch {
      /* ignore */
    }
  });
  window.addEventListener('hashchange', () => {
    try {
      emit('hash');
    } catch {
      /* ignore */
    }
  });

  routeListenerInstalled = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 44 / Prompt 0061 — Global error recorder.
//
// Listens for uncaught synchronous errors and unhandled promise rejections
// and records them on a dedicated short-lived span. Uses recordException so
// the stack trace lands in Tempo as a span event. Does NOT replace the
// existing `installGlobalErrorReporting()` plumbing — it complements it by
// putting errors in trace context so Grafana's "View trace" link from a
// metric exemplar lands on the failing request.
// ─────────────────────────────────────────────────────────────────────────────
export function installGlobalErrorRecorder(): void {
  if (errorListenerInstalled) return;
  if (typeof window === 'undefined') return;

  const tracer: Tracer = trace.getTracer('teslasync-web/error');

  const record = (
    name: string,
    err: unknown,
    extra: Record<string, string | number | boolean> = {},
  ) => {
    try {
      const span = tracer.startSpan(name, { attributes: extra });
      const e =
        err instanceof Error
          ? err
          : new Error(typeof err === 'string' ? err : JSON.stringify(err));
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      span.end();
    } catch {
      // Never let instrumentation crash the app.
    }
  };

  window.addEventListener('error', (ev: ErrorEvent) => {
    record('window.error', ev.error ?? ev.message, {
      'error.filename': ev.filename ?? '',
      'error.lineno': ev.lineno ?? 0,
      'error.colno': ev.colno ?? 0,
    });
  });

  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    record('window.unhandledrejection', ev.reason);
  });

  errorListenerInstalled = true;
}
