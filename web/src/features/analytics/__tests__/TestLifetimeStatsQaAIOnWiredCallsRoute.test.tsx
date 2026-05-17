// Phase-50 / 0041 — X2 Lifetime stats Q&A.
// Phase-50 / W1 inline wiring (per slice prompt 0041) — on-mode
// wiring test proving the Ask button opens an SSE stream against
// the registered backend route POST /api/v1/ai/analytics/lifetime/qa.
//
// `TestLifetimeStatsQaAIOnWiredCallsRoute` is the load-bearing
// positive wiring proof for slice 0041's W1 inline addendum. It
// mounts the AILifetimeStatsQA component with ai_mode='cloud' +
// the per-feature toggle on, stubs global fetch with a
// deterministic SSE byte stream, types a question, clicks the
// Ask button, and asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/analytics/lifetime/qa` is enqueued with
//      `Content-Type: application/json` and a body containing the
//      in-scope vehicle_id + question. The path MUST match the
//      registry entry verbatim — a typo here is invisible to the
//      off-mode test (which only asserts absence) and would
//      silently 404 in production.
//   2. The first `delta` event's text renders inside the
//      AiOutputPanel inside the gated wrapper
//      `data-testid="ai-feature-lifetime-stats-qa-root"`.
//   3. A second click while `state === 'streaming'` is a no-op —
//      the second fetch call is NOT enqueued (the double-submit
//      guard inside useAiStream + the visual `disabled` mirror it
//      from canAsk). This proves W1 Rule A — the disabled prop is
//      a computed expression that reacts to state.
//   4. The off-mode invariant test
//      (`TestLifetimeStatsQAAIOffHidesQuestionBox`) continues
//      to pass unchanged — wiring MUST NOT regress the off-mode
//      absence invariant. That assertion lives in the sibling file
//      and is exercised independently by the npm test runner.
//
// The test name MUST stay
// `TestLifetimeStatsQaAIOnWiredCallsRoute` per the W1 inline
// addendum naming contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AILifetimeStatsQA } from '@/components/ai/AILifetimeStatsQA';

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
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestLifetimeStatsQaAIOnWiredCallsRoute (lifetime-stats-qa on-mode SPA wiring)', () => {
  it('TestLifetimeStatsQaAIOnWiredCallsRoute: typing a question + clicking Ask POSTs once to /api/v1/ai/analytics/lifetime/qa and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'lifetime-stats-qa': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          "You've driven a total of 12,345 km across 234 drives — that is 0.31x around the Earth.",
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 20 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AILifetimeStatsQA vehicleId={42} />);

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId('ai-feature-lifetime-stats-qa-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'lifetime-stats-qa');

    // 2) The Ask button is initially disabled (canAsk is false
    // because question is empty).
    const button = screen.getByRole('button', { name: /Ask/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();

    // 3) Type a question into the textarea.
    const textarea = screen.getByLabelText(/Your question/i);
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: 'How far have I driven in total?' },
      });
    });

    // 4) The button should now be enabled (computed disabled
    // reacts to question + vehicleId presence).
    expect(button).not.toBeDisabled();

    // 5) Click — fires the SSE stream against the registered route.
    await act(async () => {
      fireEvent.click(button);
    });

    // 6) Exactly one fetch must have been enqueued, against the
    // registered backend path.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/analytics/lifetime/qa');
    expect(init?.method).toBe('POST');
    // The body must contain the in-scope vehicle_id + the
    // question — proves the component is feeding the handler-side
    // parser the same shape the Go test exercises.
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({
      vehicle_id: 42,
      question: 'How far have I driven in total?',
    });
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 7) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        "You've driven a total of 12,345 km across 234 drives — that is 0.31x around the Earth.",
      );
    });
  });

  it('TestLifetimeStatsQaAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'lifetime-stats-qa': true },
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

    render(<AILifetimeStatsQA vehicleId={42} />);

    const textarea = screen.getByLabelText(/Your question/i);
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: 'How many drives?' },
      });
    });

    const button = screen.getByRole('button', { name: /Ask/i });

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button's disabled is COMPUTED from
    // `canAsk = haveVehicle && haveQuestion && state !== 'streaming'`.
    // The hook's `runningRef` also coalesces duplicate start()
    // calls, so the second click is a defence-in-depth no-op even
    // if a future refactor accidentally drops the visual disabled.
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('TestLifetimeStatsQaAIOnWiredCallsRoute: Ask button is disabled when no vehicleId is available (computed, not literal)', () => {
    // This test guards W1 Rule A from the slice prompt: the
    // primary action button's `disabled` prop MUST be a computed
    // expression (here: `!canAsk`), not a literal
    // `disabled` / `disabled={true}`. We prove the dynamic
    // behaviour by rendering the component without a vehicleId
    // and confirming the button is disabled while the gate is
    // open — same code path, different prop input.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'lifetime-stats-qa': true },
      }),
    );

    render(<AILifetimeStatsQA />);

    const button = screen.getByRole('button', { name: /Ask/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('TestLifetimeStatsQaAIOnWiredCallsRoute: Ask button is disabled when the question is empty (computed, not literal)', () => {
    // Even with a valid vehicleId, the button MUST stay disabled
    // until the user types a question — the backend handler's
    // parser would 400 on an empty question, so we must never
    // submit one.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'lifetime-stats-qa': true },
      }),
    );

    render(<AILifetimeStatsQA vehicleId={42} />);
    const button = screen.getByRole('button', { name: /Ask/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('TestLifetimeStatsQaAIOnWiredCallsRoute: a whitespace-only question keeps the Ask button disabled', () => {
    // The component trims the question before forwarding to the
    // backend. A whitespace-only string would send an empty body
    // through trim() and trigger a 400 — the button MUST stay
    // disabled in that state.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'lifetime-stats-qa': true },
      }),
    );

    render(<AILifetimeStatsQA vehicleId={42} />);
    const textarea = screen.getByLabelText(/Your question/i);
    fireEvent.change(textarea, { target: { value: '   \t \n  ' } });
    const button = screen.getByRole('button', { name: /Ask/i });
    expect(button).toBeDisabled();
  });
});
