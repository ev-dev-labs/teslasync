// Comprehensive unit + wiring coverage for AIRouteEfficiencySuggestions.
//
// AIRouteEfficiencySuggestions is the route-efficiency AI surface on the
// RouteEfficiencyPage. `withAiFeature('route-efficiency-suggestions', …)`
// gates its visibility per the ADR-015 AI-Off Contract, and the inner card
// wires a "Generate suggestions" button to POST
// /api/v1/ai/routes/{routeID}/efficiency/suggest via useAiStream.
//
// The file exports a single symbol (the wrapped component), so this suite
// exercises every branch reachable through it:
//
//   - the visibility gate (off / per-feature-off / fully-enabled),
//   - the vehicleId → routeID canStart validation that mirrors the backend
//     parseRouteEfficiencySuggestionsURL contract (positive-integer routeID
//     only — zero, negative, decimal, non-numeric, whitespace-only, and empty
//     are rejected so the button never fires a request the handler 400s),
//   - the empty-state hint shown while no valid vehicle is selected,
//   - vehicleId normalization (leading-zero + surrounding whitespace) into a
//     clean routeID in the request URL,
//   - the wired SSE POST (route, method, headers, empty JSON body, delta
//     render),
//   - the disabled-button no-op (an invalid vehicleId never opens a stream),
//   - the double-submit guard, the streaming aria-busy affordance, and
//   - the terminal-error render path.
//
// Network is stubbed with a deterministic SSE byte stream — the same pattern
// the sibling AISmartChargeScheduleSuggestion wiring test uses.
// `@testing-library/user-event` is not a dependency of this codebase
// (web/package.json), so interactions go through fireEvent, consistent with
// the other AI SSE-wiring suites.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIRouteEfficiencySuggestions } from './AIRouteEfficiencySuggestions';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// A complete AppSettings with realistic non-AI defaults. Per-test overrides
// flip ai_mode + the per-feature toggle to walk the gate.
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

// enableFeature turns the gate fully on so the inner card renders.
function enableFeature() {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'route-efficiency-suggestions': true },
    }),
  );
}

// makeReadableStream turns text chunks into the byte-stream shape
// useAiStream's reader consumes.
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

// sseFrame formats one SSE event exactly like internal/ai/stream/writer.go.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// installFetch records every call and replies with the given SSE body.
function installFetch(sseBody: string) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(makeReadableStream([sseBody]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

const DONE = sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } });

const ROOT_TESTID = 'ai-feature-route-efficiency-suggestions-root';
// The card renders the universal "Ask Helix" CTA but exposes the per-feature
// verb as the button's accessible name, so we locate it by /Generate
// suggestions/ regardless of the visible label.
const GENERATE = /Generate suggestions/i;
const EMPTY_HINT = /Select a vehicle to generate route-efficiency suggestions/i;

function routeFor(id: number | string): string {
  return `/api/v1/ai/routes/${id}/efficiency/suggest`;
}

beforeEach(() => {
  mockUseSettings.mockReset();
  // Default fetch mock complains if a test forgets to install its own,
  // turning miswiring into a clear failure instead of a silent hang.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AIRouteEfficiencySuggestions — ADR-015 visibility gate', () => {
  it('renders nothing when ai_mode=off even with the toggle on and a valid vehicle', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'route-efficiency-suggestions': true },
      }),
    );

    const { container } = render(<AIRouteEfficiencySuggestions vehicleId="42" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: GENERATE })).not.toBeInTheDocument();
  });

  it('renders nothing when the per-feature toggle is off despite ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'route-efficiency-suggestions': false },
      }),
    );

    const { container } = render(<AIRouteEfficiencySuggestions vehicleId="42" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders the suggestion card (title, description, Helix badge, Generate button) when fully enabled', () => {
    enableFeature();

    render(<AIRouteEfficiencySuggestions vehicleId="42" />);

    const root = screen.getByTestId(ROOT_TESTID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'route-efficiency-suggestions');

    expect(
      screen.getByRole('heading', { name: /Route-efficiency suggestions/i }),
    ).toBeInTheDocument();
    expect(root).toHaveTextContent(/lower-consumption habits and route choices/i);
    // Badge label is exactly "Helix" (the button's visible CTA is "Ask
    // Helix", so it is not an exact-text match).
    expect(screen.getByText('Helix')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeInTheDocument();
    // The output panel is absent until a stream has run at least once.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
  });
});

describe('AIRouteEfficiencySuggestions — canStart validation (mirrors backend parseRouteEfficiencySuggestionsURL)', () => {
  // Every vehicleId the backend's parseRouteEfficiencySuggestionsURL would
  // reject with a 400 (routeID must be a positive integer) must leave the
  // Generate button disabled so the SPA never fires a doomed request.
  // `!!vehicleId` (the pre-hardening guard) wrongly enabled "0", "-5", "abc",
  // "42.5", and whitespace — these cases are the regression net for that fix.
  const disabledVehicleIds: Array<[string, string | undefined]> = [
    ['undefined (no vehicle selected yet)', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['string zero', '0'],
    ['a negative id', '-5'],
    ['a non-numeric id', 'abc'],
    ['a decimal id', '42.5'],
  ];

  it.each(disabledVehicleIds)(
    'disables Generate and shows the empty hint when vehicleId is %s',
    (_label, vehicleId) => {
      enableFeature();

      render(<AIRouteEfficiencySuggestions vehicleId={vehicleId} />);

      const button = screen.getByRole('button', { name: GENERATE });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
      // The empty-state hint replaces the disabled button's silence.
      expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument();
    },
  );

  const enabledVehicleIds: Array<[string, string]> = [
    ['a plain positive integer', '42'],
    ['a leading-zero integer', '007'],
    ['a whitespace-padded integer', '  42  '],
  ];

  it.each(enabledVehicleIds)(
    'enables Generate and hides the empty hint when vehicleId is %s',
    (_label, vehicleId) => {
      enableFeature();

      render(<AIRouteEfficiencySuggestions vehicleId={vehicleId} />);

      const button = screen.getByRole('button', { name: GENERATE });
      expect(button).toBeEnabled();
      expect(button).toHaveAttribute('aria-disabled', 'false');
      // Idle (non-streaming) button must not announce aria-busy.
      expect(button).not.toHaveAttribute('aria-busy');
      expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument();
    },
  );
});

describe('AIRouteEfficiencySuggestions — wired SSE POST', () => {
  it('clicking Generate POSTs exactly once to the route with an empty JSON body and renders the delta', async () => {
    enableFeature();

    const sseBody =
      sseFrame('delta', {
        text: 'Your dominant commute route runs ~18% above your fleet-best kWh/100mi.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 120, out: 44 } });
    const calls = installFetch(sseBody);

    render(<AIRouteEfficiencySuggestions vehicleId="42" />);

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    // Exactly one POST, against the registry route. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase() is '' in jsdom.
    await waitFor(() => expect(calls).toHaveLength(1));
    const { url, init } = calls[0];
    expect(url).toBe(routeFor(42));
    expect(init?.method).toBe('POST');

    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // Body is intentionally empty — the endpoint takes its only input from the
    // routeID URL param.
    expect(init?.body).toBe('{}');
    expect(JSON.parse(init?.body as string)).toEqual({});

    // The delta accumulates into the shared output panel.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        /dominant commute route/i,
      );
    });
  });

  it('normalizes a leading-zero vehicleId into a clean positive-integer routeID in the URL', async () => {
    enableFeature();

    const calls = installFetch(DONE);

    render(<AIRouteEfficiencySuggestions vehicleId="007" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: GENERATE }));
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    // "007" → 7: the URL never carries the raw padded string.
    expect(calls[0].url).toBe(routeFor(7));
    expect(calls[0].url).not.toContain('007');
  });

  it('does not fire a request when the vehicleId is invalid, even if the disabled button is clicked', async () => {
    enableFeature();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(makeReadableStream([DONE]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    // "0" is truthy as a string, so the pre-hardening `!!vehicleId` guard
    // would have enabled the button and POSTed routeID 0 — which the backend
    // rejects with 400.
    render(<AIRouteEfficiencySuggestions vehicleId="0" />);

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeDisabled();
    await act(async () => {
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchCount).toBe(0);
  });

  it('a second click while streaming does not open a second stream (double-submit guard) and marks the button aria-busy', async () => {
    enableFeature();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      // Never enqueue, never close — keeps state === 'streaming'.
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIRouteEfficiencySuggestions vehicleId="42" />);

    const button = screen.getByRole('button', { name: GENERATE });

    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // Streaming disables the button (computed from stream.state) and marks it
    // busy for assistive tech; useAiStream's runningRef coalesces duplicate
    // start() calls.
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('surfaces a terminal Helix error in the output panel when the stream responds non-2xx', async () => {
    enableFeature();

    globalThis.fetch = vi.fn(async () =>
      new Response('bad request', { status: 400 }),
    ) as unknown as typeof globalThis.fetch;

    render(<AIRouteEfficiencySuggestions vehicleId="42" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: GENERATE }));
    });

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel');
      expect(panel).toHaveTextContent(/Helix error/i);
      expect(panel).toHaveTextContent('stream_http_400');
    });
  });
});
