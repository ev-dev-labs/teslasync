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

let initialised = false;

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

  initialised = true;
}
