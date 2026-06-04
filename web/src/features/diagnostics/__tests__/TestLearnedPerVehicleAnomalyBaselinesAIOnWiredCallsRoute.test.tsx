// Learned per-vehicle anomaly baselines on-mode wiring test proving the Train baseline button opens an SSE
// stream against the registered backend route POST
// /api/v1/ai/ml/anomaly-baselines/train.

// `TestLearnedPerVehicleAnomalyBaselinesAIOnWiredCallsRoute` proves
// the positive wiring contract. It mounts the AILearnedAnomalyBaselines
// component with ai_mode='cloud' + the per-feature toggle on,
// stubs global fetch with a deterministic SSE byte stream, clicks
// the Train baseline button, and asserts:

// 1. Exactly ONE POST against the registered backend route
// `${getApiBase()}/api/v1/ai/ml/anomaly-baselines/train` is
// enqueued with `Content-Type: application/json` and a body
// containing the in-scope vehicle_id + the default
// learning-window days. The path MUST match the registry
// entry verbatim — a typo here is invisible to the off-mode
// test (which only asserts absence) and would silently 404
// in production.
// 2. The first `delta` event's text renders inside the gated
// wrapper
// `data-testid="ai-feature-learned-per-vehicle-anomaly-baselines-root"`.
// 3. A second click while `state === 'streaming'` is a no-op —
// the second fetch call is NOT enqueued (the double-submit
// guard inside useAiStream + the visual `disabled` mirror it
// from canGenerate). This proves the disabled prop is computed
// from stream state rather than hardcoded.
// 4. The off-mode invariant test
// (`TestLearnedAnomalyBaselineAIOffUsesSafeRangesOnly`)
// continues to pass unchanged — wiring MUST NOT regress the
// off-mode absence invariant. That assertion lives in the
// sibling file and is exercised independently by the npm
// test runner.

// The test name MUST stay
// `TestLearnedPerVehicleAnomalyBaselinesAIOnWiredCallsRoute` per
// the inline addendum naming contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AILearnedAnomalyBaselines } from '@/components/ai/AILearnedAnomalyBaselines';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. The on-mode tests below override ai_mode +
// ai_features to flip the feature on.
const baseSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
};

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } };
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// arbitrarily-sized text chunks. Mirrors the helper used by
// useAiStream.test.ts so the parser receives byte-for-byte
// equivalent input.
function makeReadableStream(chunks: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

// sseFrame formats a single SSE event the way
// internal/ai/stream/writer.go emits it
// (`event: <name>\ndata: <json>\n\n`).
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

beforeEach(() => {
  mockUseSettings.mockReset();
  // Default fetch mock yells if a test forgets to install its
  // own — surfaces miswiring as a clear failure rather than a
  // silent timeout.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestLearnedPerVehicleAnomalyBaselinesAIOnWiredCallsRoute (learned-per-vehicle-anomaly-baselines on-mode SPA wiring)', () => {
  it('TestLearnedPerVehicleAnomalyBaselinesAIOnWiredCallsRoute: clicking Train baseline POSTs once to /api/v1/ai/ml/anomaly-baselines/train and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'learned-per-vehicle-anomaly-baselines': true },
      }),
    );

    // Track every fetch call so we can assert the route + body
    // exactly. The mocked fetch returns a deterministic SSE byte
    // stream containing one delta and one done frame.
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'Battery voltage learned envelope p5/p95 sits inside the static safe range; no fallback needed.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AILearnedAnomalyBaselines vehicleId={42} />);

    // 1) The gated wrapper renders with the registered test ID —
    // proves the on-mode positive control path.
    const root = screen.getByTestId('ai-feature-learned-per-vehicle-anomaly-baselines-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'learned-per-vehicle-anomaly-baselines');

    // 2) The Train baseline button is enabled and computed-disabled
    // (NOT a literal disabled / disabled={true}). canGenerate is
    // vehicleId != null && state !== 'streaming', both true here,
    // so the button is enabled. The query is by accessible name
    // so a future i18n string change does not silently break the
    // test.
    const button = screen.getByRole('button', { name: /Train baseline/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    // 3) Click — fires the SSE stream against the registered
    // route. fireEvent.click bypasses pointer-events behaviour;
    // @testing-library/user-event is intentionally NOT a
    // dependency of this codebase (see web/package.json), so we
    // use fireEvent.click consistently across these wiring tests.
    await act(async () => {
      fireEvent.click(button);
    });

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    // useAiStream prepends `${getApiBase()}/api/v1`; getApiBase
    // returns '' in the test environment, so the final URL is
    // `/api/v1/ai/ml/anomaly-baselines/train`.
    expect(url).toBe('/api/v1/ai/ml/anomaly-baselines/train');
    expect(init?.method).toBe('POST');
    // The body must contain the in-scope vehicle_id + the
    // component's default learning window days=14 — proves the
    // component is feeding the handler-side parser the same shape
    // the Go test exercises.
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({ vehicle_id: 42, days: 14 });
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 5) The first delta's text renders inside the gated wrapper.
    // waitFor accounts for the async byte-stream pump.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Battery voltage learned envelope p5/p95 sits inside the static safe range; no fallback needed.',
      );
    });
  });

  it('TestLearnedPerVehicleAnomalyBaselinesAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'learned-per-vehicle-anomaly-baselines': true },
      }),
    );

    // Stream that never closes so the component stays in
    // `streaming` for the duration of the test. The second click
    // MUST NOT trigger another fetch.
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close — keeps state='streaming'.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    render(<AILearnedAnomalyBaselines vehicleId={42} />);

    const button = screen.getByRole('button', { name: /Train baseline/i });

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button's disabled is COMPUTED from
    // `canGenerate = vehicleId != null && state !== 'streaming'`.
    // The hook's `runningRef` also coalesces duplicate start()
    // calls, so the second click is a defence-in-depth no-op even
    // if a future refactor accidentally drops the visual disabled.
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      // fireEvent.click bypasses the disabled attribute, which
      // lets us exercise the runningRef coalescer in useAiStream
      // directly (defence in depth: even if the visual disabled
      // breaks, the hook still refuses to double-submit).
      fireEvent.click(button);
    });

    // Give any rogue fetch a microtask to land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('TestLearnedPerVehicleAnomalyBaselinesAIOnWiredCallsRoute: Train baseline button is disabled when no vehicleId is available (computed, not literal)', () => {
    // This test guards the contract that the
    // primary action button's `disabled` prop MUST be a computed
    // expression (here: `!canGenerate`), not a literal
    // `disabled` / `disabled={true}`. We prove the dynamic
    // behaviour by rendering the component without a vehicleId
    // and confirming the button is disabled while the gate is
    // open — same code path, different prop input.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'learned-per-vehicle-anomaly-baselines': true },
      }),
    );

    render(<AILearnedAnomalyBaselines />);

    const button = screen.getByRole('button', { name: /Train baseline/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });
});
