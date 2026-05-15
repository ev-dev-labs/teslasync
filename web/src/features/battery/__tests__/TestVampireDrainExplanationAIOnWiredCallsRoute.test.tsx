// Phase-50 / 0030 — C5 Vampire-drain explanation.
// Phase-50 / W1 inline wiring (per slice prompt 0030) — on-mode
// wiring test proving the Narrate button opens an SSE stream
// against the registered backend route POST
// /api/v1/ai/charging/vampire-drain/explain.
//
// `TestVampireDrainExplanationAIOnWiredCallsRoute` is the
// load-bearing positive wiring proof for slice 0030's W1 inline
// addendum. It mounts the AIVampireDrainExplanation component
// with ai_mode='cloud' + the per-feature toggle on, stubs global
// fetch with a deterministic SSE byte stream, clicks the Narrate
// button, and asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `${getApiBase()}/api/v1/ai/charging/vampire-drain/explain`
//      is enqueued with `Content-Type: application/json` and a
//      body containing the in-scope vehicle_id. The path MUST
//      match the registry entry verbatim — a typo here is
//      invisible to the off-mode test (which only asserts
//      absence) and would silently 404 in production.
//   2. The first `delta` event's text renders inside the
//      AiOutputPanel inside the gated wrapper
//      `data-testid="ai-feature-vampire-drain-explanation-root"`.
//   3. A second click while `state === 'streaming'` is a no-op —
//      the second fetch call is NOT enqueued (the double-submit
//      guard inside useAiStream + the visual `disabled` mirror it
//      from canGenerate). This proves W1 Rule A — the disabled
//      prop is a computed expression that reacts to state.
//   4. The off-mode invariant test
//      (`TestVampireDrainExplanationAIOffShowsMetricsOnly`)
//      continues to pass unchanged — wiring MUST NOT regress the
//      off-mode absence invariant. That assertion lives in the
//      sibling file and is exercised independently by the npm
//      test runner.
//
// The test name MUST stay
// `TestVampireDrainExplanationAIOnWiredCallsRoute` per the W1
// inline addendum naming contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIVampireDrainExplanation } from '@/components/ai/AIVampireDrainExplanation';

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

describe('TestVampireDrainExplanationAIOnWiredCallsRoute (vampire-drain-explanation on-mode SPA wiring)', () => {
  it('TestVampireDrainExplanationAIOnWiredCallsRoute: clicking Narrate POSTs once to /api/v1/ai/charging/vampire-drain/explain and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'vampire-drain-explanation': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'Vehicle Roadie shows an idle drain rate around the typical fleet baseline.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIVampireDrainExplanation vehicleId={42} />);

    // 1) The gated wrapper renders with the registered test ID —
    // proves the on-mode positive control path.
    const root = screen.getByTestId('ai-feature-vampire-drain-explanation-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'vampire-drain-explanation');

    // 2) The Narrate button is enabled and computed-disabled
    // (NOT a literal disabled / disabled={true}). canGenerate is
    // !haveInputs || streaming, both false here, so the button
    // is enabled. The query is by accessible name so a future
    // i18n string change does not silently break the test.
    const button = screen.getByRole('button', { name: /Narrate drain/i });
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
    // `/api/v1/ai/charging/vampire-drain/explain`.
    expect(url).toBe('/api/v1/ai/charging/vampire-drain/explain');
    expect(init?.method).toBe('POST');
    // The body must contain the in-scope vehicle_id — proves the
    // component is feeding the handler-side parser the same shape
    // the Go test exercises. The lookback_days field is omitted
    // from the body when the parent does NOT pass an explicit
    // window (the backend defaults to 30).
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({ vehicle_id: 42 });
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 5) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Vehicle Roadie shows an idle drain rate around the typical fleet baseline.',
      );
    });
  });

  it('TestVampireDrainExplanationAIOnWiredCallsRoute: lookbackDays prop is forwarded in the request body when provided', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'vampire-drain-explanation': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody = sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIVampireDrainExplanation vehicleId={42} lookbackDays={60} />);
    const button = screen.getByRole('button', { name: /Narrate drain/i });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const parsedBody = JSON.parse(fetchCalls[0].init?.body as string);
    expect(parsedBody).toEqual({ vehicle_id: 42, lookback_days: 60 });
  });

  it('TestVampireDrainExplanationAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'vampire-drain-explanation': true },
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

    render(<AIVampireDrainExplanation vehicleId={42} />);

    const button = screen.getByRole('button', { name: /Narrate drain/i });

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

  it('TestVampireDrainExplanationAIOnWiredCallsRoute: Narrate button is disabled when no vehicleId is available (computed, not literal)', () => {
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
        ai_features: { 'vampire-drain-explanation': true },
      }),
    );

    render(<AIVampireDrainExplanation />);

    const button = screen.getByRole('button', { name: /Narrate drain/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });
});
