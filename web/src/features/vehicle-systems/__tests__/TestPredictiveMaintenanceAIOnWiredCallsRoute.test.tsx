// Phase-50 / 0049 — M1 Predictive maintenance.
// Phase-50 / W1 inline wiring (per slice prompt 0049) — on-mode
// wiring test proving the "Predict maintenance" button opens an
// SSE stream against the registered backend route
// POST /api/v1/ai/maintenance/predict.
//
// `TestPredictiveMaintenanceAIOnWiredCallsRoute` is the
// load-bearing positive wiring proof for slice 0049's W1 inline
// addendum. It mounts the AIPredictiveMaintenance component with
// ai_mode='cloud' + the per-feature toggle on, stubs global fetch
// with a deterministic SSE byte stream, clicks the "Predict
// maintenance" button, and asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/maintenance/predict` is enqueued with
//      `Content-Type: application/json` and a body containing
//      the in-scope `vehicle_id`. The path MUST match the
//      registry entry verbatim — a typo here is invisible to
//      the off-mode test (which only asserts absence) and would
//      silently 404 in production.
//   2. The first `delta` event's text renders inside the
//      AiOutputPanel inside the gated wrapper
//      `data-testid="ai-feature-predictive-maintenance-root"`.
//   3. A second click while `state === 'streaming'` is a no-op
//      — the second fetch call is NOT enqueued (the double-
//      submit guard inside useAiStream + the visual `disabled`
//      mirror it from canStart). This proves W1 Rule A — the
//      disabled prop is a computed expression that reacts to
//      state.
//   4. The "Predict maintenance" button is `disabled` when the
//      vehicleId is missing OR invalid (zero, negative,
//      non-finite) — proving W1 Rule A's computed-expression
//      guarantee across multiple input states.
//   5. The off-mode invariant test
//      (`TestPredictiveMaintenanceAIOffShowsThresholdReminders`)
//      continues to pass unchanged — wiring MUST NOT regress
//      the off-mode absence invariant. That assertion lives in
//      the sibling file and is exercised independently by the
//      npm test runner.
//
// The test name MUST stay
// `TestPredictiveMaintenanceAIOnWiredCallsRoute` per the W1
// inline addendum naming contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIPredictiveMaintenance } from '@/components/ai/AIPredictiveMaintenance';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

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

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const VEHICLE_ID = 42;

beforeEach(() => {
  mockUseSettings.mockReset();
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestPredictiveMaintenanceAIOnWiredCallsRoute (predictive-maintenance on-mode SPA wiring)', () => {
  it('TestPredictiveMaintenanceAIOnWiredCallsRoute: clicking Predict maintenance POSTs once to /api/v1/ai/maintenance/predict and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'predictive-maintenance': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'The vehicle has one overdue tire rotation and two scheduled items coming due. ' +
          'Tire rotation was last completed at 18,000 mi; the deterministic 7,500 mi interval ' +
          'places it 2,500 mi overdue based on the current 28,000 mi odometer reading.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 240, out: 110 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIPredictiveMaintenance vehicleId={VEHICLE_ID} />);

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId('ai-feature-predictive-maintenance-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'predictive-maintenance');

    // 2) The Predict maintenance button is initially enabled
    // (canStart requires vehicleId > 0). Unanchored regex per HX
    // addendum — the accessible name reads
    // "Ask Helix · Predict maintenance".
    const button = screen.getByRole('button', { name: /Predict maintenance/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    // 3) Click — fires the SSE stream against the registered route.
    await act(async () => {
      fireEvent.click(button);
    });

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path. The body MUST carry the in-scope
    // vehicle_id so the LLM cannot widen it.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/maintenance/predict');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({ vehicle_id: VEHICLE_ID });
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 5) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'The vehicle has one overdue tire rotation and two scheduled items coming due.',
      );
    });
  });

  it('TestPredictiveMaintenanceAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'predictive-maintenance': true },
      }),
    );

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

    render(<AIPredictiveMaintenance vehicleId={VEHICLE_ID} />);

    const button = screen.getByRole('button', { name: /Predict maintenance/i });

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button's disabled is COMPUTED from
    // `canStart && state !== 'streaming'` inside AIFeatureCard.
    // The hook's `runningRef` also coalesces duplicate start()
    // calls, so the second click is a defence-in-depth no-op
    // even if a future refactor accidentally drops the visual
    // disabled.
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('TestPredictiveMaintenanceAIOnWiredCallsRoute: Predict maintenance button is disabled when vehicleId is missing (computed, not literal)', () => {
    // This test guards W1 Rule A from the slice prompt: the
    // primary action button's `disabled` prop MUST be a computed
    // expression (here: `!canStart`), not a literal `disabled` /
    // `disabled={true}`. We prove the dynamic behaviour by
    // rendering the component without a vehicleId and confirming
    // the button is disabled while the gate is open — same code
    // path, different prop input.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'predictive-maintenance': true },
      }),
    );

    render(<AIPredictiveMaintenance />);

    const button = screen.getByRole('button', { name: /Predict maintenance/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('TestPredictiveMaintenanceAIOnWiredCallsRoute: Predict maintenance button is disabled when vehicleId is invalid (computed, not literal)', () => {
    // Defence-in-depth: zero, negative, and non-finite vehicle
    // ids must also disable the button. The handler-side parser
    // rejects vehicle_id <= 0; we mirror that here so the button
    // never submits a request the backend would 400.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'predictive-maintenance': true },
      }),
    );

    // Zero vehicleId.
    const { rerender } = render(<AIPredictiveMaintenance vehicleId={0} />);
    expect(
      screen.getByRole('button', { name: /Predict maintenance/i }),
    ).toBeDisabled();

    // Negative vehicleId.
    rerender(<AIPredictiveMaintenance vehicleId={-1} />);
    expect(
      screen.getByRole('button', { name: /Predict maintenance/i }),
    ).toBeDisabled();

    // Non-finite vehicleId.
    rerender(<AIPredictiveMaintenance vehicleId={Number.NaN} />);
    expect(
      screen.getByRole('button', { name: /Predict maintenance/i }),
    ).toBeDisabled();
  });
});
