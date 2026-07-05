// Comprehensive unit + wiring coverage for AIChargingDiagnosis.
//
// AIChargingDiagnosis is a thin per-session charging-diagnosis AI
// surface. `withAiFeature('charging-diagnosis', …)` gates its
// visibility per the ADR-015 AI-Off Contract, and the inner card wires
// a "Generate diagnosis" button to POST
// /api/v1/ai/charging/{sessionID}/diagnose via useAiStream.
//
// The file exports a single symbol (the wrapped component), so this
// suite exercises every branch reachable through it:
//
//   - the visibility gate (off / per-feature-off / fully-enabled),
//   - the sessionId → canStart validation that mirrors the backend
//     `parseChargingDiagnosisURL` contract (positive integer only —
//     zero, negative, decimal, non-numeric, and whitespace are
//     rejected so the button never fires a request the handler 400s),
//   - the wired SSE POST (route, method, headers, body, delta render),
//   - route-path normalization of the id,
//   - the double-submit guard, and
//   - the terminal-error render path.
//
// Network is stubbed with a deterministic SSE byte stream — the same
// pattern the sibling AICostForecastNarration / AIFeedbackQueueTriage
// wiring tests use. `@testing-library/user-event` is not a dependency
// of this codebase (web/package.json), so interactions go through
// fireEvent, consistent with the other AI SSE-wiring suites.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIChargingDiagnosis } from './AIChargingDiagnosis';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// A complete AppSettings with realistic non-AI defaults. Per-test
// overrides flip ai_mode + the per-feature toggle to walk the gate.
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
      ai_features: { 'charging-diagnosis': true },
    }),
  );
}

// makeReadableStream turns text chunks into the byte stream shape
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

const ROOT_TESTID = 'ai-feature-charging-diagnosis-root';
// The card renders the universal "Ask Helix" CTA but exposes the
// per-feature verb as the button's accessible name, so we can locate
// it by /Generate diagnosis/ regardless of the visible label.
const GENERATE = /Generate diagnosis/i;

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

describe('AIChargingDiagnosis — ADR-015 visibility gate', () => {
  it('renders nothing when ai_mode=off even with the toggle on and a valid sessionId', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'charging-diagnosis': true },
      }),
    );

    const { container } = render(<AIChargingDiagnosis sessionId="42" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: GENERATE })).not.toBeInTheDocument();
  });

  it('renders nothing when the per-feature toggle is off despite ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'charging-diagnosis': false },
      }),
    );

    const { container } = render(<AIChargingDiagnosis sessionId="42" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders the diagnosis card (title, description, Helix badge, Generate button) when fully enabled', () => {
    enableFeature();

    render(<AIChargingDiagnosis sessionId="42" />);

    const root = screen.getByTestId(ROOT_TESTID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'charging-diagnosis');

    expect(
      screen.getByRole('heading', { name: /Charging diagnosis/i }),
    ).toBeInTheDocument();
    expect(root).toHaveTextContent(/plain-language explanation of any flags/i);
    // Badge label passed as "Helix"; its visible text is exactly "Helix"
    // (the button's visible CTA is "Ask Helix", not an exact match).
    expect(screen.getByText('Helix')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeInTheDocument();
    // The output panel is absent until a stream has run at least once.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
  });
});

describe('AIChargingDiagnosis — sessionId validation (mirrors backend parseChargingDiagnosisURL)', () => {
  // Every value the backend's parseChargingDiagnosisURL would reject
  // with a 400 must leave the Generate button disabled so the SPA never
  // fires a doomed request. `!!sessionId` (the pre-hardening guard)
  // wrongly enabled "0", "-5", "abc", "42.5", and whitespace — these
  // cases are the regression net for that fix.
  const disabledCases: Array<[string, string | undefined]> = [
    ['undefined (route not yet resolved)', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['zero', '0'],
    ['a negative id', '-5'],
    ['a non-numeric id', 'abc'],
    ['a decimal id', '42.5'],
  ];

  it.each(disabledCases)(
    'disables Generate when sessionId is %s',
    (_label, sessionId) => {
      enableFeature();

      render(<AIChargingDiagnosis sessionId={sessionId} />);

      const button = screen.getByRole('button', { name: GENERATE });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
    },
  );

  it('enables Generate for a positive integer sessionId', () => {
    enableFeature();

    render(<AIChargingDiagnosis sessionId="42" />);

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });
});

describe('AIChargingDiagnosis — wired SSE POST', () => {
  it('clicking Generate POSTs exactly once to /api/v1/ai/charging/42/diagnose and renders the first delta', async () => {
    enableFeature();

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'Trickle flag raised: the session averaged 1.4 kW over 6.2 hours, ' +
          'consistent with a 120 V outlet rather than a fault.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 180, out: 70 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIChargingDiagnosis sessionId="42" />);

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    // Exactly one POST, against the registry route. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase() is '' in jsdom.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/charging/42/diagnose');
    expect(init?.method).toBe('POST');
    // The handler ignores the body (sessionID is the URL param), so the
    // component ships an empty object.
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({});
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // The first delta accumulates into the shared output panel.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        'Trickle flag raised',
      );
    });
  });

  it('normalizes the sessionId into the route path (trims whitespace, drops leading zeros)', async () => {
    enableFeature();

    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        makeReadableStream([
          sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    render(<AIChargingDiagnosis sessionId="  007  " />);

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeEnabled();
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0]).toBe('/api/v1/ai/charging/7/diagnose');
  });

  it('does not fire a request when sessionId is invalid, even if the disabled button is clicked', async () => {
    enableFeature();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(
        makeReadableStream([
          sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    // "0" is truthy as a string, so the pre-hardening `!!sessionId`
    // guard would have enabled the button and POSTed to
    // /api/v1/ai/charging/0/diagnose — which the backend rejects.
    render(<AIChargingDiagnosis sessionId="0" />);

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeDisabled();
    await act(async () => {
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchCount).toBe(0);
  });

  it('a second click while streaming does not open a second stream (double-submit guard)', async () => {
    enableFeature();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(
        // Never enqueue, never close — keeps state === 'streaming'.
        new ReadableStream<Uint8Array>({ start() {} }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    render(<AIChargingDiagnosis sessionId="42" />);

    const button = screen.getByRole('button', { name: GENERATE });

    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // Streaming disables the button (computed from stream.state), and
    // useAiStream's runningRef coalesces duplicate start() calls.
    await waitFor(() => expect(button).toBeDisabled());
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

    render(<AIChargingDiagnosis sessionId="42" />);

    const button = screen.getByRole('button', { name: GENERATE });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel');
      expect(panel).toHaveTextContent(/Helix error/i);
      expect(panel).toHaveTextContent('stream_http_400');
    });
  });
});
