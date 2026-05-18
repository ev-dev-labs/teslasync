/**
 * Phase 44 / Prompt 0061 — RUM instrumentation tests.
 *
 * Uses InMemorySpanExporter so we can assert on what would have been sent to
 * the OTel collector without touching the network. Each test runs the
 * `installRouteSpanEmitter` / `installGlobalErrorRecorder` helpers in
 * isolation and inspects the emitted spans.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';

let exporter: InMemorySpanExporter;
let provider: BasicTracerProvider;

beforeEach(() => {
  // Fresh provider per test so spans don't leak across cases.
  exporter = new InMemorySpanExporter();
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  // Reset the global tracer so installRoute/Error use OUR provider.
  trace.disable();
  trace.setGlobalTracerProvider(provider);

  // Reset the modules' internal "installed" flags by re-importing the file.
  // Vitest's vi.resetModules() achieves this; the tests below import lazily.
  vi.resetModules();

  // Replace history methods between tests so the patch logic re-executes
  // cleanly. jsdom gives us a fresh location/history each test file but not
  // each test, so we have to reach for the originals manually.
  history.pushState = History.prototype.pushState;
  history.replaceState = History.prototype.replaceState;
});

afterEach(async () => {
  await provider.shutdown();
  exporter.reset();
});

describe('installRouteSpanEmitter', () => {
  it('emits a span with name `route.<path>` on pushState', async () => {
    const mod = await import('./rum');
    mod.installRouteSpanEmitter();

    history.pushState({}, '', '/dashboard');

    const spans = exporter.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const last = spans[spans.length - 1];
    expect(last.name).toBe('route./dashboard');
    expect(last.attributes['app.route.kind']).toBe('push');
    expect(last.attributes['app.route.path']).toBe('/dashboard');
  });

  it('emits on replaceState too', async () => {
    const mod = await import('./rum');
    mod.installRouteSpanEmitter();

    history.replaceState({}, '', '/vehicles/1');

    const spans = exporter.getFinishedSpans();
    const last = spans[spans.length - 1];
    expect(last.name).toBe('route./vehicles/1');
    expect(last.attributes['app.route.kind']).toBe('replace');
  });

  it('is idempotent — calling twice only patches history once', async () => {
    const mod = await import('./rum');
    mod.installRouteSpanEmitter();
    mod.installRouteSpanEmitter();

    history.pushState({}, '', '/charging');

    const spans = exporter.getFinishedSpans();
    const matching = spans.filter((s) => s.name === 'route./charging');
    expect(matching.length).toBe(1);
  });
});

describe('installGlobalErrorRecorder', () => {
  it('records `window.error` events as ERROR spans', async () => {
    const mod = await import('./rum');
    mod.installGlobalErrorRecorder();

    const ev = new ErrorEvent('error', {
      message: 'boom',
      error: new Error('boom'),
      filename: 'app.js',
      lineno: 42,
      colno: 7,
    });
    window.dispatchEvent(ev);

    const spans = exporter.getFinishedSpans();
    const errSpan = spans.find((s) => s.name === 'window.error');
    expect(errSpan).toBeDefined();
    expect(errSpan!.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(errSpan!.attributes['error.filename']).toBe('app.js');
    expect(errSpan!.attributes['error.lineno']).toBe(42);
    expect(errSpan!.events.length).toBeGreaterThan(0);
  });

  it('records unhandled promise rejections', async () => {
    const mod = await import('./rum');
    mod.installGlobalErrorRecorder();

    const promise = Promise.reject(new Error('async-boom'));
    // jsdom does not fire unhandledrejection automatically; dispatch manually.
    const ev = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(ev, 'reason', { value: new Error('async-boom') });
    Object.defineProperty(ev, 'promise', { value: promise });
    window.dispatchEvent(ev);
    // Swallow the rejection so it doesn't leak into the test runner.
    await promise.catch(() => {});

    const spans = exporter.getFinishedSpans();
    const rejSpan = spans.find((s) => s.name === 'window.unhandledrejection');
    expect(rejSpan).toBeDefined();
    expect(rejSpan!.status.code).toBe(2);
  });
});
