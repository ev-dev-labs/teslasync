// Phase-50 / 0048 — S7 State-machine debugger narrator.
// Phase-50 / W1 inline wiring (per slice prompt 0048) — on-mode
// wiring test proving the "Narrate transitions" button opens an
// SSE stream against the registered backend route
// POST /api/v1/ai/system/fsm/narrate.
//
// `TestStateMachineDebuggerNarratorAIOnWiredCallsRoute` is the
// load-bearing positive wiring proof for slice 0048's W1 inline
// addendum. It mounts the AIStateMachineDebuggerNarrator
// component with ai_mode='cloud' + the per-feature toggle on,
// stubs global fetch with a deterministic SSE byte stream,
// clicks the "Narrate transitions" button, and asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/system/fsm/narrate` is enqueued with
//      `Content-Type: application/json` and a body containing
//      the in-scope `(vehicle_id, from_unix, to_unix)` triple.
//      The path MUST match the registry entry verbatim — a
//      typo here is invisible to the off-mode test (which only
//      asserts absence) and would silently 404 in production.
//   2. The first `delta` event's text renders inside the
//      AiOutputPanel inside the gated wrapper
//      `data-testid="ai-feature-state-machine-debugger-narrator-root"`.
//   3. A second click while `state === 'streaming'` is a no-op
//      — the second fetch call is NOT enqueued (the double-
//      submit guard inside useAiStream + the visual `disabled`
//      mirror it from canStart). This proves W1 Rule A — the
//      disabled prop is a computed expression that reacts to
//      state.
//   4. The "Narrate transitions" button is `disabled` when any
//      of (vehicleId, fromUnix, toUnix) is missing OR invalid
//      (zero, negative, reversed, non-finite) — proving W1
//      Rule A's computed-expression guarantee across multiple
//      input states.
//   5. The off-mode invariant test
//      (`TestStateMachineNarratorAIOffShowsDebuggerOnly`)
//      continues to pass unchanged — wiring MUST NOT regress
//      the off-mode absence invariant. That assertion lives in
//      the sibling file and is exercised independently by the
//      npm test runner.
//
// The test name MUST stay
// `TestStateMachineDebuggerNarratorAIOnWiredCallsRoute` per the
// W1 inline addendum naming contract.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIStateMachineDebuggerNarrator } from '@/components/ai/AIStateMachineDebuggerNarrator';

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
const FROM_UNIX = 1700000000;
const TO_UNIX = 1700001800;

beforeEach(() => {
  mockUseSettings.mockReset();
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestStateMachineDebuggerNarratorAIOnWiredCallsRoute (state-machine-debugger-narrator on-mode SPA wiring)', () => {
  it('TestStateMachineDebuggerNarratorAIOnWiredCallsRoute: clicking Narrate transitions POSTs once to /api/v1/ai/system/fsm/narrate and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'state-machine-debugger-narrator': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'The vehicle FSM trace shows a steady drive cycle with no flap events. ' +
          'The DriveFSM transitioned from parked to driving once and remained in ' +
          'driving for the entire window; charging and climate state machines remained idle.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 220, out: 90 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    );

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId(
      'ai-feature-state-machine-debugger-narrator-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'state-machine-debugger-narrator',
    );

    // 2) The Narrate transitions button is initially enabled
    // (canStart requires vehicleId + valid window). Unanchored
    // regex per HX addendum — the accessible name reads
    // "Ask Helix · Narrate transitions".
    const button = screen.getByRole('button', { name: /Narrate transitions/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    // 3) Click — fires the SSE stream against the registered route.
    await act(async () => {
      fireEvent.click(button);
    });

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path. The body MUST carry the in-scope
    // (vehicle_id, from_unix, to_unix) triple so the LLM cannot
    // widen it.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/system/fsm/narrate');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({
      vehicle_id: VEHICLE_ID,
      from_unix: FROM_UNIX,
      to_unix: TO_UNIX,
    });
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 5) The first delta's text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'The vehicle FSM trace shows a steady drive cycle with no flap events.',
      );
    });
  });

  it('TestStateMachineDebuggerNarratorAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'state-machine-debugger-narrator': true },
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
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    );

    const button = screen.getByRole('button', { name: /Narrate transitions/i });

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

  it('TestStateMachineDebuggerNarratorAIOnWiredCallsRoute: Narrate transitions button is disabled when vehicleId is missing (computed, not literal)', () => {
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
        ai_features: { 'state-machine-debugger-narrator': true },
      }),
    );

    render(
      <AIStateMachineDebuggerNarrator fromUnix={FROM_UNIX} toUnix={TO_UNIX} />,
    );

    const button = screen.getByRole('button', { name: /Narrate transitions/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('TestStateMachineDebuggerNarratorAIOnWiredCallsRoute: Narrate transitions button is disabled when the window is invalid (computed, not literal)', () => {
    // Defence-in-depth: zero, negative, reversed, and non-finite
    // windows must also disable the button. The handler-side
    // parser rejects from_unix <= 0 and to_unix <= from_unix; we
    // mirror that here so the button never submits a request the
    // backend would 400.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'state-machine-debugger-narrator': true },
      }),
    );

    // Zero from_unix.
    const { rerender } = render(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={0}
        toUnix={TO_UNIX}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Narrate transitions/i }),
    ).toBeDisabled();

    // Negative from_unix.
    rerender(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={-1}
        toUnix={TO_UNIX}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Narrate transitions/i }),
    ).toBeDisabled();

    // Reversed window (to_unix <= from_unix).
    rerender(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={TO_UNIX}
        toUnix={FROM_UNIX}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Narrate transitions/i }),
    ).toBeDisabled();

    // Non-finite from_unix.
    rerender(
      <AIStateMachineDebuggerNarrator
        vehicleId={VEHICLE_ID}
        fromUnix={Number.NaN}
        toUnix={TO_UNIX}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Narrate transitions/i }),
    ).toBeDisabled();

    // Non-positive vehicleId (defence-in-depth).
    rerender(
      <AIStateMachineDebuggerNarrator
        vehicleId={0}
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Narrate transitions/i }),
    ).toBeDisabled();
  });
});
