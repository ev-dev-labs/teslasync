// Phase-50 / 0031 — T1 Preheat and precool recommender.
// Phase-50 / W1 inline wiring (per slice prompt 0031) — on-mode
// wiring test proving the Draft button opens an SSE stream
// against the registered backend route POST
// /api/v1/ai/climate/schedule/draft.
//
// `TestPreheatPrecoolRecommenderAIOnWiredCallsRoute` is the
// load-bearing positive wiring proof for slice 0031's W1 inline
// addendum. It mounts the AIPreheatPrecoolRecommender component
// with ai_mode='cloud' + the per-feature toggle on, stubs global
// fetch with a deterministic SSE byte stream, clicks the Draft
// button, and asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `${getApiBase()}/api/v1/ai/climate/schedule/draft` is
//      enqueued with `Content-Type: application/json` and a
//      body containing the in-scope vehicle_id, depart_by,
//      cabin/outside temperatures, and target temperature. The
//      path MUST match the registry entry verbatim — a typo here
//      is invisible to the off-mode test (which only asserts
//      absence) and would silently 404 in production.
//   2. The first `delta` event's text renders inside the
//      AiOutputPanel inside the gated wrapper
//      `data-testid="ai-feature-preheat-precool-recommender-root"`.
//   3. A second click while `state === 'streaming'` is a no-op —
//      the second fetch call is NOT enqueued (the double-submit
//      guard inside useAiStream + the visual `disabled` mirror
//      it from canGenerate). This proves W1 Rule A — the
//      disabled prop is a computed expression that reacts to
//      state.
//   4. The off-mode invariant test
//      (`TestPreheatPrecoolAIOffManualClimateWorks`) continues
//      to pass unchanged — wiring MUST NOT regress the off-mode
//      absence invariant. That assertion lives in the sibling
//      file and is exercised independently by the npm test
//      runner.
//
// The test name MUST stay
// `TestPreheatPrecoolRecommenderAIOnWiredCallsRoute` per the W1
// inline addendum naming contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIPreheatPrecoolRecommender } from '@/components/ai/AIPreheatPrecoolRecommender';

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

describe('TestPreheatPrecoolRecommenderAIOnWiredCallsRoute (preheat-precool-recommender on-mode SPA wiring)', () => {
  it('TestPreheatPrecoolRecommenderAIOnWiredCallsRoute: clicking Draft POSTs once to /api/v1/ai/climate/schedule/draft and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'preheat-precool-recommender': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> =
      [];
    const sseBody =
      sseFrame('delta', {
        text:
          'Proposed preheat for vehicle Roadie: a 30-minute warm-up window targeting 21°C ahead of your 7:30am departure.',
      }) +
      sseFrame('done', {
        finish_reason: 'stop',
        usage: { in: 50, out: 10 },
      });
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    ) as unknown as typeof globalThis.fetch;

    render(
      <AIPreheatPrecoolRecommender
        vehicleId={42}
        currentCabinTempC={4}
        outsideTempC={-2}
        targetCabinTempC={21}
        departBy="2099-01-02T07:30:00Z"
      />,
    );

    // 1) The gated wrapper renders with the registered test ID —
    // proves the on-mode positive control path.
    const root = screen.getByTestId(
      'ai-feature-preheat-precool-recommender-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'preheat-precool-recommender',
    );

    // 2) The Draft button is enabled and computed-disabled
    // (NOT a literal disabled / disabled={true}). canGenerate is
    // !haveInputs || streaming, both false here, so the button
    // is enabled. The query is by accessible name so a future
    // i18n string change does not silently break the test.
    const button = screen.getByRole('button', { name: /Draft schedule/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    // 3) Click — fires the SSE stream against the registered route.
    await act(async () => {
      fireEvent.click(button);
    });

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    // useAiStream prepends `${getApiBase()}/api/v1`; getApiBase
    // returns '' in the test environment, so the final URL is
    // `/api/v1/ai/climate/schedule/draft`.
    expect(url).toBe('/api/v1/ai/climate/schedule/draft');
    expect(init?.method).toBe('POST');
    // The body must contain the in-scope vehicle_id and the
    // climate inputs — proves the component is feeding the
    // handler-side parser the same shape the Go test exercises.
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({
      vehicle_id: 42,
      depart_by: '2099-01-02T07:30:00Z',
      current_cabin_temp_c: 4,
      outside_temp_c: -2,
      target_cabin_temp_c: 21,
    });
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 5) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Proposed preheat for vehicle Roadie: a 30-minute warm-up window targeting 21°C ahead of your 7:30am departure.',
      );
    });
  });

  it('TestPreheatPrecoolRecommenderAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'preheat-precool-recommender': true },
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

    render(
      <AIPreheatPrecoolRecommender
        vehicleId={42}
        currentCabinTempC={4}
        outsideTempC={-2}
        targetCabinTempC={21}
        departBy="2099-01-02T07:30:00Z"
      />,
    );

    const button = screen.getByRole('button', { name: /Draft schedule/i });

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button's disabled is COMPUTED from
    // `canGenerate = haveInputs && state !== 'streaming'`. The
    // hook's `runningRef` also coalesces duplicate start() calls,
    // so the second click is a defence-in-depth no-op even if a
    // future refactor accidentally drops the visual disabled.
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      fireEvent.click(button);
    });

    // Give any rogue fetch a microtask to land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('TestPreheatPrecoolRecommenderAIOnWiredCallsRoute: Draft button is disabled when no vehicleId is available (computed, not literal)', () => {
    // This test guards W1 Rule A from the slice prompt: the
    // primary action button's `disabled` prop MUST be a computed
    // expression (here: `!canGenerate`), not a literal
    // `disabled` / `disabled={true}`. We prove the dynamic
    // behaviour by rendering the component without a vehicleId
    // and confirming the button is disabled while the gate is
    // open — same code path, different prop input.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'preheat-precool-recommender': true },
      }),
    );

    render(
      <AIPreheatPrecoolRecommender
        currentCabinTempC={4}
        outsideTempC={-2}
        targetCabinTempC={21}
        departBy="2099-01-02T07:30:00Z"
      />,
    );

    const button = screen.getByRole('button', { name: /Draft schedule/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('TestPreheatPrecoolRecommenderAIOnWiredCallsRoute: Draft button is disabled when departBy is missing (computed, not literal)', () => {
    // Mirror of the no-vehicleId test for the depart_by precondition:
    // the button MUST be disabled when the parent has not yet
    // resolved a departure timestamp. The backend handler-side
    // parser also rejects an empty depart_by; this test proves the
    // SPA gates that path before issuing the request.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'preheat-precool-recommender': true },
      }),
    );

    render(
      <AIPreheatPrecoolRecommender
        vehicleId={42}
        currentCabinTempC={4}
        outsideTempC={-2}
        targetCabinTempC={21}
      />,
    );

    const button = screen.getByRole('button', { name: /Draft schedule/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });
});
