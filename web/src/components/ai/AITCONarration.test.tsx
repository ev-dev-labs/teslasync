// Comprehensive unit + wiring coverage for AITCONarration.
//
// AITCONarration is the Total-Cost-of-Ownership AI narration surface
// rendered above the deterministic charts on TrueCostPage (/tco and the
// alias /analytics/tco). `withAiFeature('tco-narration', …)` gates its
// visibility per the ADR-015 AI-Off Contract, and the inner card wires an
// "Explain ownership cost" button to POST /api/v1/ai/analytics/tco/narrate
// via useAiStream.
//
// The file exports a single symbol (the wrapped component), so this suite
// exercises every branch reachable through it:
//
//   - the visibility gate (off / per-feature-off / fully-enabled),
//   - the vehicleId → canStart validation that mirrors the backend
//     `vehicle_id > 0` contract (undefined, zero, negative, NaN, Infinity,
//     and a stray non-number are all rejected so the button never fires a
//     request the handler would 400),
//   - the request body shape (exactly { vehicle_id }),
//   - the empty-state hint shown while no vehicle is in scope,
//   - the accessible name / tooltip the shared card composes,
//   - the wired SSE POST (route, method, headers, body, delta render),
//   - the "no request when disabled" invariant,
//   - the double-submit guard, and
//   - the terminal-error render path.
//
// Network is stubbed with a deterministic SSE byte stream — the same
// pattern the sibling AIPeriodCompareNarration / AIDigestNarration wiring
// tests use. `@testing-library/user-event` is not a dependency of this
// codebase (web/package.json), so interactions go through fireEvent,
// consistent with the other AI SSE-wiring suites.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AITCONarration } from './AITCONarration';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

const ROOT_TESTID = 'ai-feature-tco-narration-root';
const NARRATE_ROUTE = '/api/v1/ai/analytics/tco/narrate';
// The card renders the universal "Ask Helix" CTA but exposes the
// per-feature verb ("Explain ownership cost") as the button's accessible
// name, so we can locate it regardless of the visible label.
const EXPLAIN = /Explain ownership cost/i;
const EMPTY_HINT = /Pick a vehicle above to enable Helix/i;

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

function settingsPayload(overrides: Partial<AppSettings>): { settings: AppSettings } {
  return { settings: { ...baseSettings, ...overrides } };
}

// enableFeature turns the gate fully on so the inner card renders.
function enableFeature(): void {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'tco-narration': true },
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

// installFetchCapture stubs global fetch with a deterministic SSE body
// and records every call so the route + body can be asserted.
function installFetchCapture(
  sseBody: string,
): Array<{ url: string; init: RequestInit | undefined }> {
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

const DONE_ONLY = sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } });

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

describe('AITCONarration — ADR-015 visibility gate', () => {
  it('renders nothing when ai_mode=off even with the toggle on and a valid vehicleId', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'tco-narration': true },
      }),
    );

    const { container } = render(<AITCONarration vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EXPLAIN })).not.toBeInTheDocument();
  });

  it('renders nothing when the per-feature toggle is off despite ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'tco-narration': false },
      }),
    );

    const { container } = render(<AITCONarration vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders nothing when ai_features is undefined (fail-closed) despite ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud' }));

    const { container } = render(<AITCONarration vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders the narration card (title, description, Helix badge, Explain button) when fully enabled', () => {
    enableFeature();

    render(<AITCONarration vehicleId={42} />);

    const root = screen.getByTestId(ROOT_TESTID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'tco-narration');

    expect(
      screen.getByRole('heading', { name: /Explain my lifetime operating cost/i }),
    ).toBeInTheDocument();
    expect(root).toHaveTextContent(/deterministic operating-cost evidence/i);
    // Badge label passed as "Helix"; its visible text is exactly "Helix"
    // (the button's visible CTA is "Ask Helix", not an exact match).
    expect(screen.getByText('Helix')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: EXPLAIN });
    expect(button).toBeInTheDocument();
    // The output panel is absent until a stream has run at least once.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
  });
});

describe('AITCONarration — vehicleId validation (mirrors backend vehicle_id > 0)', () => {
  // Every value the backend's parser would reject with a 400 must leave
  // the Explain button disabled so the SPA never fires a doomed request.
  const disabledCases: Array<[string, number | undefined]> = [
    ['undefined (context not yet resolved)', undefined],
    ['zero', 0],
    ['a negative id', -5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
  ];

  it.each(disabledCases)('disables Explain when vehicleId is %s', (_label, vehicleId) => {
    enableFeature();

    render(<AITCONarration vehicleId={vehicleId} />);

    const button = screen.getByRole('button', { name: EXPLAIN });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  const enabledCases: Array<[string, number]> = [
    ['a positive integer', 42],
    ['another positive integer', 7],
  ];

  it.each(enabledCases)('enables Explain for %s vehicleId', (_label, vehicleId) => {
    enableFeature();

    render(<AITCONarration vehicleId={vehicleId} />);

    const button = screen.getByRole('button', { name: EXPLAIN });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });

  it('treats a stray non-number vehicleId (defensive) as no vehicle and stays disabled', () => {
    enableFeature();
    // The prop is typed `number | undefined`; the component still defends
    // against a runtime non-number via its `typeof === 'number'` guard.
    const props = { vehicleId: 'not-a-number' } as unknown as { vehicleId?: number };

    render(<AITCONarration {...props} />);

    const button = screen.getByRole('button', { name: EXPLAIN });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('AITCONarration — empty-state hint', () => {
  it('shows the "pick a vehicle" hint while no vehicle is in scope', () => {
    enableFeature();

    render(<AITCONarration />);

    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument();
  });

  it('hides the hint once a valid vehicle enables the feature', () => {
    enableFeature();

    render(<AITCONarration vehicleId={42} />);

    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument();
  });
});

describe('AITCONarration — accessibility', () => {
  it('exposes the per-feature verb as the button accessible name and its tooltip', () => {
    enableFeature();

    render(<AITCONarration vehicleId={42} />);

    // The shared card composes the accessible name as
    // "Ask Helix · Explain ownership cost" (aria-label) and uses the
    // per-feature verb as the hover tooltip.
    const button = screen.getByRole('button', {
      name: /Ask Helix · Explain ownership cost/i,
    });
    expect(button).toHaveAttribute('title', 'Explain ownership cost');
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });
});

describe('AITCONarration — wired SSE POST + request body shape', () => {
  it('clicking Explain POSTs exactly once to the registry route and renders the first delta', async () => {
    enableFeature();

    const narrative =
      'Your Model 3 spends about $38/month on charging versus $150/month of equivalent gas — roughly $112 saved each month.';
    const calls = installFetchCapture(
      sseFrame('delta', { text: narrative }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 50, out: 10 } }),
    );

    render(<AITCONarration vehicleId={42} />);

    const button = screen.getByRole('button', { name: EXPLAIN });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    // Exactly one POST, against the registry route. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase() is '' in jsdom.
    await waitFor(() => expect(calls).toHaveLength(1));
    const { url, init } = calls[0];
    expect(url).toBe(NARRATE_ROUTE);
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({ vehicle_id: 42 });
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // The first delta accumulates into the shared output panel.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(narrative);
    });
  });

  it('POSTs a body carrying exactly { vehicle_id } and no stray fields', async () => {
    enableFeature();

    const calls = installFetchCapture(DONE_ONLY);

    render(<AITCONarration vehicleId={7} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: EXPLAIN }));
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    const parsed = JSON.parse(calls[0].init?.body as string);
    expect(parsed).toEqual({ vehicle_id: 7 });
    expect(Object.keys(parsed)).toEqual(['vehicle_id']);
  });
});

describe('AITCONarration — guardrails', () => {
  it('does not fire a request when vehicleId is invalid, even if the disabled button is clicked', async () => {
    enableFeature();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(makeReadableStream([DONE_ONLY]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    // 0 is the trap value: a `vehicleId != null` guard would have enabled
    // the button and POSTed vehicle_id=0 — which the backend rejects with
    // HTTP 400.
    render(<AITCONarration vehicleId={0} />);

    const button = screen.getByRole('button', { name: EXPLAIN });
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

    render(<AITCONarration vehicleId={42} />);

    const button = screen.getByRole('button', { name: EXPLAIN });

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

    render(<AITCONarration vehicleId={42} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: EXPLAIN }));
    });

    await waitFor(() => {
      const panel = screen.getByTestId('ai-output-panel');
      expect(panel).toHaveTextContent(/Helix error/i);
      expect(panel).toHaveTextContent('stream_http_400');
    });
  });
});
