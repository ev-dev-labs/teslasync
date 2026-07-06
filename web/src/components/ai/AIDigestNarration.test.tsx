// Comprehensive unit + wiring coverage for AIDigestNarration.
//
// AIDigestNarration is the weekly-digest AI narration surface.
// `withAiFeature('digest-narration', …)` gates its visibility per the
// ADR-015 AI-Off Contract, and the inner card wires a "Generate
// narration" button to POST /api/v1/ai/digests/weekly/narrate via
// useAiStream.
//
// The file exports a single symbol (the wrapped component), so this
// suite exercises every branch reachable through it:
//
//   - the visibility gate (off / per-feature-off / fully-enabled),
//   - the vehicleId → canStart validation that mirrors the backend
//     `narrationRequest` contract (vehicle_id must be > 0 — zero,
//     negative, and NaN are rejected so the button never fires a
//     request the handler 400s; this is the regression net for the
//     pre-hardening `vehicleId != null` guard which wrongly enabled
//     0 / -5 / NaN),
//   - the empty-state hint shown while no vehicle is in scope,
//   - the wired SSE POST (route, method, headers, body, delta render),
//   - the "no request when disabled" invariant,
//   - the double-submit guard, and
//   - the terminal-error render path.
//
// Network is stubbed with a deterministic SSE byte stream — the same
// pattern the sibling AIChargingDiagnosis / AICostForecastNarration
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
import { AIDigestNarration } from './AIDigestNarration';

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
      ai_features: { 'digest-narration': true },
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

const ROOT_TESTID = 'ai-feature-digest-narration-root';
// The card renders the universal "Ask Helix" CTA but exposes the
// per-feature verb as the button's accessible name, so we can locate
// it by /Generate narration/ regardless of the visible label.
const GENERATE = /Generate narration/i;
const EMPTY_HINT = /Pick a vehicle to enable Helix narration/i;

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

describe('AIDigestNarration — ADR-015 visibility gate', () => {
  it('renders nothing when ai_mode=off even with the toggle on and a valid vehicleId', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'digest-narration': true },
      }),
    );

    const { container } = render(<AIDigestNarration vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: GENERATE })).not.toBeInTheDocument();
  });

  it('renders nothing when the per-feature toggle is off despite ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'digest-narration': false },
      }),
    );

    const { container } = render(<AIDigestNarration vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders the narration card (title, description, Helix badge, Generate button) when fully enabled', () => {
    enableFeature();

    render(<AIDigestNarration vehicleId={42} />);

    const root = screen.getByTestId(ROOT_TESTID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'digest-narration');

    expect(
      screen.getByRole('heading', { name: /Helix narration/i }),
    ).toBeInTheDocument();
    expect(root).toHaveTextContent(/short, Helix-written recap of your week/i);
    // Badge label passed as "Helix"; its visible text is exactly "Helix"
    // (the button's visible CTA is "Ask Helix", not an exact match).
    expect(screen.getByText('Helix')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeInTheDocument();
    // The output panel is absent until a stream has run at least once.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
  });
});

describe('AIDigestNarration — vehicleId validation (mirrors backend vehicle_id > 0)', () => {
  // Every value the backend's narrationRequest validator would reject
  // with a 400 must leave the Generate button disabled so the SPA never
  // fires a doomed request. `vehicleId != null` (the pre-hardening
  // guard) wrongly enabled 0, -5, and NaN — these cases are the
  // regression net for that fix.
  const disabledCases: Array<[string, number | undefined]> = [
    ['undefined (context not yet resolved)', undefined],
    ['zero', 0],
    ['a negative id', -5],
    ['NaN', Number.NaN],
  ];

  it.each(disabledCases)(
    'disables Generate when vehicleId is %s',
    (_label, vehicleId) => {
      enableFeature();

      render(<AIDigestNarration vehicleId={vehicleId} />);

      const button = screen.getByRole('button', { name: GENERATE });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-disabled', 'true');
    },
  );

  it('enables Generate for a positive integer vehicleId', () => {
    enableFeature();

    render(<AIDigestNarration vehicleId={42} />);

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });
});

describe('AIDigestNarration — empty-state hint', () => {
  it('shows the "pick a vehicle" hint while no vehicle is in scope', () => {
    enableFeature();

    render(<AIDigestNarration vehicleId={undefined} />);

    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument();
  });

  it('hides the hint once a valid vehicle enables the feature', () => {
    enableFeature();

    render(<AIDigestNarration vehicleId={42} />);

    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument();
  });
});

describe('AIDigestNarration — wired SSE POST', () => {
  it('clicking Generate POSTs exactly once to /api/v1/ai/digests/weekly/narrate and renders the first delta', async () => {
    enableFeature();

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'This week you drove 214 km across 6 trips and added 41 kWh, ' +
          'keeping your rolling efficiency steady near 191 Wh/km.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 160, out: 64 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIDigestNarration vehicleId={7} />);

    const button = screen.getByRole('button', { name: GENERATE });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    // Exactly one POST, against the registry route. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase() is '' in jsdom.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/digests/weekly/narrate');
    expect(init?.method).toBe('POST');
    // The body carries the numeric vehicle id and the (default) week
    // offset. snake_case keys match the Go `narrationRequest` JSON tags.
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({
      vehicle_id: 7,
      week_offset_weeks: 0,
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // The first delta accumulates into the shared output panel.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        'This week you drove 214 km',
      );
    });
  });

  it('does not fire a request when vehicleId is invalid, even if the disabled button is clicked', async () => {
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

    // 0 is truthy-adjacent (the pre-hardening `vehicleId != null` guard
    // would have enabled the button and POSTed vehicle_id=0 — which the
    // backend rejects with HTTP 400).
    render(<AIDigestNarration vehicleId={0} />);

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

    render(<AIDigestNarration vehicleId={42} />);

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

    render(<AIDigestNarration vehicleId={42} />);

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
