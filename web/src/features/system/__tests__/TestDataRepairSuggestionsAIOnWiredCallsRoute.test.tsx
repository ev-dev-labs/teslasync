// Data repair suggestions.
// Verifies that the "Draft repair plan" button opens an SSE stream
// against POST /api/v1/ai/system/data-repair/draft.
// This is the positive wiring proof for AIDataRepairSuggestions: it mounts the component with
// ai_mode='cloud' + the per-feature toggle on, stubs global fetch
// with a deterministic SSE byte stream, clicks the Draft repair
// plan button, and asserts:
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/system/data-repair/draft` is enqueued with
//      `Content-Type: application/json` and a body containing
//      `{}`. The path MUST match the registry entry verbatim — a
//      typo here is invisible to the off-mode test (which only
//      asserts absence) and would silently 404 in production.
//   2. The first `delta` event's text renders inside the
//      AiOutputPanel inside the gated wrapper
//      `data-testid="ai-feature-data-repair-suggestions-root"`.
//   3. A second click while `state === 'streaming'` is a no-op —
//      the second fetch call is NOT enqueued (the double-submit
//      guard inside useAiStream + the visual `disabled` mirror it
//      from canDraft). This proves W1 Rule A — the disabled prop
//      is a computed expression that reacts to state.
//   4. The off-mode invariant test
//      (`TestDataRepairSuggestionsAIOffManualRunbookWorks`)
//      continues to pass unchanged — wiring MUST NOT regress the
//      off-mode absence invariant. That assertion lives in the
//      sibling file and is exercised independently by the npm
//      test runner.
// The test name MUST stay
// `TestDataRepairSuggestionsAIOnWiredCallsRoute` per the W1
// inline addendum naming contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIDataRepairSuggestions } from '@/components/ai/AIDataRepairSuggestions';

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

describe('TestDataRepairSuggestionsAIOnWiredCallsRoute (data-repair-suggestions on-mode SPA wiring)', () => {
  it('TestDataRepairSuggestionsAIOnWiredCallsRoute: clicking Draft repair plan POSTs once to /api/v1/ai/system/data-repair/draft and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'data-repair-suggestions': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'Charging session 42 has been open for 25 hours. Propose: close it now and accept the auto-derived ended_at timestamp. Click Close on the matching baseline form to apply.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 200, out: 60 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIDataRepairSuggestions />);

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId(
      'ai-feature-data-repair-suggestions-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'data-repair-suggestions',
    );

    // 2) The Draft button is initially enabled (canDraft requires
    // only that no stream is open).
    const button = screen.getByRole('button', { name: /Draft repair plan/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    // 3) Click — fires the SSE stream against the registered route.
    await act(async () => {
      fireEvent.click(button);
    });

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path. The handler reads the in-scope
    // stale-session inventory itself; the SPA does not pass any
    // URL params or path segments.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/system/data-repair/draft');
    expect(init?.method).toBe('POST');
    // The body is intentionally `{}` — the backend reads the
    // inventory itself; the body is unused but the POST body must
    // still be valid JSON.
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({});
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 5) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Charging session 42 has been open for 25 hours.',
      );
    });
  });

  it('TestDataRepairSuggestionsAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'data-repair-suggestions': true },
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

    render(<AIDataRepairSuggestions />);

    const button = screen.getByRole('button', { name: /Draft repair plan/i });

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button's disabled is COMPUTED from
    // `canDraft = state !== 'streaming'`. The hook's `runningRef`
    // also coalesces duplicate start() calls, so the second click
    // is a defence-in-depth no-op even if a future refactor
    // accidentally drops the visual disabled.
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('sends the selected vehicle scope with the repair-plan request', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'data-repair-suggestions': true },
      }),
    );

    const fetchCalls: Array<{ init: RequestInit | undefined }> = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ init });
      return new Response(makeReadableStream([sseFrame('done', { finish_reason: 'stop' })]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIDataRepairSuggestions vehicleId={7} />);
    fireEvent.click(screen.getByRole('button', { name: /Draft repair plan/i }));

    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({ vehicle_id: 7 });
  });
});
