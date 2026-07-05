// Co-located unit + wiring test for AITripPostcardShareCardImageGeneration.
//
// The module exports a single symbol: the
// `withAiFeature('trip-postcard-share-card-image-generation', InnerSection)`
// gated component. This suite covers every observable facet of that
// surface — not a smoke render:
//
//   1. AI-off render gate (ADR-015): the section is absent when
//      ai_mode='off', when the per-feature toggle is off, when the
//      ai_features map is missing, and when Settings have not
//      resolved yet. A positive control proves the negative
//      assertions are not trivially true.
//
//   2. canStart contract: the "Generate share card" button's
//      disabled state is a COMPUTED mirror of the handler-side
//      `trip_id > 0` validation. An unresolved trip (undefined), a
//      placeholder 0/negative id, and a non-finite id (NaN) all keep
//      the button disabled and surface the empty-state hint; a valid
//      id enables it and hides the hint. The `Number.isFinite`
//      branch and the `> 0` branch are exercised independently.
//
//   3. On-mode SSE wiring: clicking POSTs exactly once to the
//      registered route `/api/v1/ai/share-cards/trip-image/draft`
//      with the SI-agnostic `{ trip_id }` body + SSE headers,
//      renders the first delta, and re-enables the button once the
//      stream closes. The optional `styleHint` is trimmed into
//      `style_hint` when meaningful and omitted when blank/whitespace.
//      A double-submit while streaming is coalesced, and a non-2xx
//      response surfaces the Helix error affordance.
//
// Network is stubbed at the `fetch` boundary — the same pattern the
// sibling wiring tests use; no real request is ever made.
// @testing-library/user-event is intentionally NOT a dependency of
// this codebase (see web/package.json), so interactions use
// fireEvent.click consistently with the rest of the AI slice tests.

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
import { AITripPostcardShareCardImageGeneration } from '@/components/ai/AITripPostcardShareCardImageGeneration';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test overrides flip ai_mode + ai_features to exercise
// the gate's off (negative) and on (positive) paths.
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

// enabled() returns the fully-on settings shape (mode + toggle) so the
// on-mode tests read one intent-revealing helper instead of repeating
// the two-field override.
function enabled(overrides: Partial<AppSettings> = {}) {
  return settingsPayload({
    ai_mode: 'cloud',
    ai_features: { 'trip-postcard-share-card-image-generation': true },
    ...overrides,
  });
}

// makeReadableStream constructs a ReadableStream<Uint8Array> from
// arbitrarily-sized text chunks, matching the helper used by the
// useAiStream + sibling wiring tests so the SSE parser receives
// byte-for-byte equivalent input.
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
// internal/ai/stream/writer.go emits it.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type FetchCall = { url: string; init: RequestInit | undefined };

// installStreamingFetch stubs global fetch with a deterministic SSE
// byte stream and records every call so tests can assert the route +
// body exactly.
function installStreamingFetch(sseBody: string): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(makeReadableStream([sseBody]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

const ROOT_TESTID = 'ai-feature-trip-postcard-share-card-image-generation-root';
const FEATURE_ID = 'trip-postcard-share-card-image-generation';
const ROUTE = '/api/v1/ai/share-cards/trip-image/draft';
const BUTTON_NAME = /Generate share card/i;
const EMPTY_HINT = /pick a trip from the list above/i;

beforeEach(() => {
  mockUseSettings.mockReset();
  // Loud default so a test that forgets to install its own fetch mock
  // fails clearly instead of silently timing out.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AITripPostcardShareCardImageGeneration — AI-off render gate', () => {
  it('renders nothing when ai_mode=off even with the feature toggle on', () => {
    // The toggle is intentionally on to defeat the "hidden because the
    // flag is off" shortcut — mode=off MUST trump the toggle.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { [FEATURE_ID]: true },
      }),
    );

    const { container } = render(
      <AITripPostcardShareCardImageGeneration tripId={101} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: BUTTON_NAME }),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when the per-feature toggle is off even with ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { [FEATURE_ID]: false },
      }),
    );

    const { container } = render(
      <AITripPostcardShareCardImageGeneration tripId={101} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders nothing when the ai_features map is absent', () => {
    // useAiEnabled fails closed when the flags map is undefined.
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'cloud' }));

    const { container } = render(
      <AITripPostcardShareCardImageGeneration tripId={101} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders nothing while Settings have not resolved yet', () => {
    // A pending Settings query yields settings === undefined; the gate
    // must fail closed (no AI surface flashes before load completes).
    mockUseSettings.mockReturnValue({ settings: undefined });

    const { container } = render(
      <AITripPostcardShareCardImageGeneration tripId={101} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders the gated section (positive control) when ai_mode=cloud AND the toggle is on', () => {
    mockUseSettings.mockReturnValue(enabled());

    render(<AITripPostcardShareCardImageGeneration tripId={101} />);

    const root = screen.getByTestId(ROOT_TESTID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', FEATURE_ID);
    // Title + button prove the InnerSection body actually mounted
    // (not just the gate wrapper).
    expect(
      screen.getByText('Draft a Helix share-card image'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: BUTTON_NAME }),
    ).toBeInTheDocument();
  });
});

describe('AITripPostcardShareCardImageGeneration — canStart mirrors the trip_id > 0 contract', () => {
  it('disables the button and shows the empty-state hint when no tripId is available', () => {
    mockUseSettings.mockReturnValue(enabled());

    render(<AITripPostcardShareCardImageGeneration />);

    const button = screen.getByRole('button', { name: BUTTON_NAME });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument();
  });

  it('disables the button when tripId is 0 — the invalid-id regression guard', () => {
    // A placeholder 0 is finite but fails `> 0`; the handler rejects
    // trip_id <= 0, so the button must stay disabled.
    mockUseSettings.mockReturnValue(enabled());

    render(<AITripPostcardShareCardImageGeneration tripId={0} />);

    const button = screen.getByRole('button', { name: BUTTON_NAME });
    expect(button).toBeDisabled();
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument();
  });

  it('disables the button when tripId is negative', () => {
    mockUseSettings.mockReturnValue(enabled());

    render(<AITripPostcardShareCardImageGeneration tripId={-5} />);

    const button = screen.getByRole('button', { name: BUTTON_NAME });
    expect(button).toBeDisabled();
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument();
  });

  it('disables the button when tripId is not finite (NaN) — Number.isFinite guard', () => {
    // A parent computing Number(someString) can yield NaN; the guard
    // coerces it to 0 so the button stays disabled rather than firing
    // a request with trip_id: NaN.
    mockUseSettings.mockReturnValue(enabled());

    render(<AITripPostcardShareCardImageGeneration tripId={Number.NaN} />);

    const button = screen.getByRole('button', { name: BUTTON_NAME });
    expect(button).toBeDisabled();
    expect(screen.getByText(EMPTY_HINT)).toBeInTheDocument();
  });

  it('enables the button and omits the empty-state hint for a valid tripId', () => {
    mockUseSettings.mockReturnValue(enabled());

    render(<AITripPostcardShareCardImageGeneration tripId={7} />);

    const button = screen.getByRole('button', { name: BUTTON_NAME });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText(EMPTY_HINT)).not.toBeInTheDocument();
  });
});

describe('AITripPostcardShareCardImageGeneration — on-mode SSE wiring', () => {
  it('POSTs once to the registered route with { trip_id } and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(enabled());

    const sseBody =
      sseFrame('delta', {
        text: 'Drafted a vintage-postcard share card prompt for your weekend trip.',
      }) + sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 24 } });
    const fetchCalls = installStreamingFetch(sseBody);

    render(<AITripPostcardShareCardImageGeneration tripId={101} />);

    const root = screen.getByTestId(ROOT_TESTID);
    const button = screen.getByRole('button', { name: BUTTON_NAME });
    expect(button).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    // Exactly one POST against the registered backend route. useAiStream
    // prepends `${getApiBase()}/api/v1`; getApiBase() is '' in tests, so
    // the final URL is the bare route (no double /api/v1 prefix).
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe(ROUTE);
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({ trip_id: 101 });

    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // The accumulated delta text renders inside the gated wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Drafted a vintage-postcard share card prompt for your weekend trip.',
      );
    });

    // Once the stream closes (done) the button returns to enabled so the
    // user can re-draft — proves the lifecycle is not stuck in streaming.
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('trims a meaningful styleHint into the request body as style_hint', async () => {
    mockUseSettings.mockReturnValue(enabled());

    const sseBody = sseFrame('done', {
      finish_reason: 'stop',
      usage: { in: 12, out: 0 },
    });
    const fetchCalls = installStreamingFetch(sseBody);

    render(
      <AITripPostcardShareCardImageGeneration
        tripId={55}
        styleHint="  vintage  "
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }));
    });

    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const parsedBody = JSON.parse(fetchCalls[0].init?.body as string);
    expect(parsedBody).toEqual({ trip_id: 55, style_hint: 'vintage' });
  });

  it('omits style_hint entirely when the styleHint is whitespace-only', async () => {
    mockUseSettings.mockReturnValue(enabled());

    const sseBody = sseFrame('done', {
      finish_reason: 'stop',
      usage: { in: 12, out: 0 },
    });
    const fetchCalls = installStreamingFetch(sseBody);

    render(
      <AITripPostcardShareCardImageGeneration tripId={55} styleHint="   " />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }));
    });

    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const parsedBody = JSON.parse(fetchCalls[0].init?.body as string);
    expect(parsedBody).toEqual({ trip_id: 55 });
    expect('style_hint' in parsedBody).toBe(false);
  });

  it('coalesces a second click while streaming into a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(enabled());

    // A stream that never closes keeps state === 'streaming' for the
    // whole test, so the button stays disabled and the hook's runningRef
    // refuses a second start().
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // Never enqueue, never close.
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    render(<AITripPostcardShareCardImageGeneration tripId={101} />);

    const button = screen.getByRole('button', { name: BUTTON_NAME });
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button is computed-disabled.
    await waitFor(() => expect(button).toBeDisabled());
    await act(async () => {
      // fireEvent bypasses the disabled attribute, exercising the hook's
      // runningRef coalescer directly (defence in depth).
      fireEvent.click(button);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('surfaces the stream error when the backend returns a non-2xx status', async () => {
    mockUseSettings.mockReturnValue(enabled());

    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof globalThis.fetch;

    render(<AITripPostcardShareCardImageGeneration tripId={101} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: BUTTON_NAME }));
    });

    // useAiStream maps a non-ok response to `stream_http_<status>` and
    // flips to state='error'; AiOutputPanel renders the Helix error
    // affordance (role=alert) rather than any narration text.
    const panel = await screen.findByTestId('ai-output-panel');
    expect(panel).toHaveTextContent(/Helix error/i);
    expect(panel).toHaveTextContent('stream_http_404');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('AITripPostcardShareCardImageGeneration — presentation & accessibility', () => {
  it('renders the Helix badge, propose-only privacy description, and an accessible CTA', () => {
    mockUseSettings.mockReturnValue(enabled());

    render(<AITripPostcardShareCardImageGeneration tripId={101} />);

    expect(screen.getByText('Helix')).toBeInTheDocument();
    // The privacy contract copy must be present verbatim (redacted
    // context only, propose-only guarantee).
    expect(
      screen.getByText(/propose-only image prompt and preview spec/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/never raw coordinates or street addresses/i),
    ).toBeInTheDocument();

    // The icon-only Helix CTA still exposes the per-feature verb via its
    // accessible name ("Ask Helix · Generate share card").
    const button = screen.getByRole('button', { name: BUTTON_NAME });
    expect(button).toHaveAttribute('title', 'Generate share card');
  });

  it('does not render the output panel before any stream has started', () => {
    mockUseSettings.mockReturnValue(enabled());

    render(<AITripPostcardShareCardImageGeneration tripId={101} />);

    // Idle + empty → AiOutputPanel returns null; no blank panel leaks.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
  });
});
