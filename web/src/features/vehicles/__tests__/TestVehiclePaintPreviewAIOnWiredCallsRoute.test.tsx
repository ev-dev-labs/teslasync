// Vehicle paint preview on-mode wiring test. Proves the "Preview paint color" button opens an
// SSE stream against the registered backend route POST
// /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft.
//
// `TestVehiclePaintPreviewAIOnWiredCallsRoute` is the load-bearing
// positive wiring proof. It
// mounts the AIVehiclePaintPreview component with ai_mode='cloud'
// + the per-feature toggle on, stubs global fetch with a
// deterministic SSE byte stream, clicks the action button, and
// asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/vehicles/7/paint-preview/draft` is enqueued
//      with `Content-Type: application/json`. The path MUST match
//      the registry entry verbatim — a typo here is invisible to
//      the off-mode test (which only asserts absence) and would
//      silently 404 in production.
//   2. The first `delta` event's text renders inside the gated
//      wrapper `data-testid="ai-feature-vehicle-paint-preview-root"`.
//   3. A second click while `state === 'streaming'` is a no-op —
//      the second fetch call is NOT enqueued (the double-submit
//      guard inside useAiStream + the visual `disabled` mirror
//      it from canStart). This proves W1 Rule A — the disabled
//      prop is a computed expression that reacts to state.
//   4. The off-mode invariant test
//      (`TestVehiclePaintPreviewAIOffHidesPreviewTool`) continues
//      to pass unchanged — wiring MUST NOT regress the off-mode
//      absence invariant. That assertion lives in the sibling
//      file and is exercised independently by the npm test
//      runner.
//
// HX (Helix UX) addendum compliance:
//   - The CTA is located via `getByRole('button', { name:
//     /Preview paint color/i })` — UNANCHORED regex because
//     AIFeatureCard composes the accessible name as
//     "Ask Helix · Preview paint color". An anchored regex
//     would not match.

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
import { AIVehiclePaintPreview } from '@/components/ai/AIVehiclePaintPreview';

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
  // Default fetch mock yells if a test forgets to install its own
  // — surfaces miswiring as a clear failure rather than a silent
  // timeout.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestVehiclePaintPreviewAIOnWiredCallsRoute (vehicle-paint-preview on-mode SPA wiring)', () => {
  it('TestVehiclePaintPreviewAIOnWiredCallsRoute: clicking the action button POSTs once to /api/v1/ai/vehicles/7/paint-preview/draft and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'vehicle-paint-preview': true },
      }),
    );

    // Track every fetch call so we can assert the route + body
    // exactly. The mocked fetch returns a deterministic SSE byte
    // stream containing one delta and one done frame.
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'Drafted a midnight-blue paint-preview prompt for your vehicle in a cinematic studio scene.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 24 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIVehiclePaintPreview vehicleId={7} />);

    // 1) The gated wrapper renders with the registered test ID
    // — proves the on-mode positive control path.
    const root = screen.getByTestId('ai-feature-vehicle-paint-preview-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'vehicle-paint-preview');

    // 2) The action button is enabled and computed-disabled
    // (NOT a literal disabled / disabled={true}). canStart is
    // haveInputs && state !== 'streaming', both fine here, so
    // the button is enabled. The query is by accessible name
    // with an UNANCHORED regex because AIFeatureCard composes
    // the accessible name as "Ask Helix · <buttonLabel>".
    const button = screen.getByRole('button', {
      name: /Preview paint color/i,
    });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    // 3) Click — fires the SSE stream against the registered
    // route. fireEvent.click bypasses pointer-events behaviour;
    // @testing-library/user-event is intentionally NOT a
    // dependency of this codebase (see web/package.json), so we
    // use fireEvent.click consistently across the slice tests.
    await act(async () => {
      fireEvent.click(button);
    });

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    // useAiStream prepends `${getApiBase()}/api/v1`; getApiBase
    // returns '' in the test environment, so the final URL is
    // `/api/v1/ai/vehicles/7/paint-preview/draft`.
    expect(url).toBe('/api/v1/ai/vehicles/7/paint-preview/draft');
    expect(init?.method).toBe('POST');
    // The body is JSON; for this slice the inner section sends
    // an empty object when no styleHint is passed (the vehicleID
    // travels via the URL path, not the body). The body MUST
    // still be valid JSON the handler can parse.
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({});
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 5) The first delta's text renders inside the gated
    // wrapper. waitFor accounts for the async byte-stream pump.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Drafted a midnight-blue paint-preview prompt for your vehicle in a cinematic studio scene.',
      );
    });
  });

  it('TestVehiclePaintPreviewAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'vehicle-paint-preview': true },
      }),
    );

    // Stream that never closes so the component stays in
    // `streaming` for the duration of the test. The second
    // click MUST NOT trigger another fetch.
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

    render(<AIVehiclePaintPreview vehicleId={7} />);

    const button = screen.getByRole('button', {
      name: /Preview paint color/i,
    });

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button's disabled is COMPUTED from
    // canStart && state !== 'streaming'. The hook's runningRef
    // also coalesces duplicate start() calls, so the second
    // click is a defence-in-depth no-op even if a future
    // refactor accidentally drops the visual disabled.
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

  it('TestVehiclePaintPreviewAIOnWiredCallsRoute: action button is disabled when no vehicleId is available (computed, not literal)', () => {
    // This test guards W1 Rule A from the slice prompt: the
    // primary action button's `disabled` prop MUST be a computed
    // expression (here: `!canStart || stream.state === 'streaming'`),
    // not a literal `disabled` / `disabled={true}`. We prove the
    // dynamic behaviour by rendering the component without a
    // vehicleId and confirming the button is disabled while the
    // gate is open — same code path, different prop input.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'vehicle-paint-preview': true },
      }),
    );

    render(<AIVehiclePaintPreview />);

    const button = screen.getByRole('button', {
      name: /Preview paint color/i,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });
});
