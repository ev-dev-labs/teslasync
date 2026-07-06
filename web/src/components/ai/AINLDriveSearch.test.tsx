// Comprehensive unit + wiring coverage for AINLDriveSearch.
//
// AINLDriveSearch is the natural-language drive-search AI surface.
// `withAiFeature('nl-drive-search-replay', …)` gates its visibility per
// the ADR-015 AI-Off Contract, and the inner card wires a prompt
// Textarea + "Search with Helix" button to POST
// /api/v1/ai/drives/search through the canonical useAiStream hook.
//
// The file exports a single symbol (the wrapped component), so this
// suite exercises every branch reachable through it:
//
//   - the visibility gate (off / per-feature-off / fully-enabled),
//   - the prompt → canStart validation (empty and whitespace-only
//     prompts leave the button disabled so we never POST an empty
//     query the backend would reject),
//   - the accessible label on the prompt Textarea (a11y — the input
//     must have an accessible name, not just a placeholder),
//   - the wired SSE POST (route, method, headers, body, delta render),
//   - the prompt is trimmed into the POST body (canStart and the body
//     must agree — a padded query is sent without its padding),
//   - the double-submit guard, and
//   - the terminal-error render path.
//
// Network is stubbed with a deterministic SSE byte stream — the same
// pattern the sibling AIChargingDiagnosis / AILifetimeStatsQA wiring
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
import { AINLDriveSearch } from './AINLDriveSearch';

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
      ai_features: { 'nl-drive-search-replay': true },
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

const ROOT_TESTID = 'ai-feature-nl-drive-search-replay-root';
// The card renders the universal "Ask Helix" CTA but exposes the
// per-feature verb as the button's accessible name, so we can locate
// it by /Search with Helix/ regardless of the visible label.
const SEARCH = /Search with Helix/i;
// The prompt Textarea's accessible name (aria-label). A placeholder
// alone is NOT an accessible name; this label is the a11y contract.
const PROMPT_LABEL = /Describe the drive to find/i;

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

describe('AINLDriveSearch — ADR-015 visibility gate', () => {
  it('renders nothing when ai_mode=off even with the toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'nl-drive-search-replay': true },
      }),
    );

    const { container } = render(<AINLDriveSearch />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SEARCH })).not.toBeInTheDocument();
  });

  it('renders nothing when the per-feature toggle is off despite ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-drive-search-replay': false },
      }),
    );

    const { container } = render(<AINLDriveSearch />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders the search card (title, description, Helix badge, prompt input, Search button) when fully enabled', () => {
    enableFeature();

    render(<AINLDriveSearch />);

    const root = screen.getByTestId(ROOT_TESTID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'nl-drive-search-replay');

    expect(
      screen.getByRole('heading', { name: /Find a drive in natural language/i }),
    ).toBeInTheDocument();
    expect(root).toHaveTextContent(/only narrates your own drives/i);
    // Badge label passed as "Helix"; its visible text is exactly "Helix"
    // (the button's visible CTA is "Ask Helix", not an exact match).
    expect(screen.getByText('Helix')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: SEARCH })).toBeInTheDocument();
    // The prompt Textarea is reachable by its accessible name.
    expect(screen.getByLabelText(PROMPT_LABEL)).toBeInTheDocument();
    // The output panel is absent until a stream has run at least once.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
  });
});

describe('AINLDriveSearch — prompt → canStart validation (computed, not literal)', () => {
  it('disables Search when the prompt is empty', () => {
    enableFeature();

    render(<AINLDriveSearch />);

    const button = screen.getByRole('button', { name: SEARCH });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps Search disabled for a whitespace-only prompt (trim guard)', () => {
    enableFeature();

    render(<AINLDriveSearch />);
    const textarea = screen.getByLabelText(PROMPT_LABEL);
    fireEvent.change(textarea, { target: { value: '   \t \n  ' } });

    const button = screen.getByRole('button', { name: SEARCH });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('enables Search once a non-empty prompt is typed', () => {
    enableFeature();

    render(<AINLDriveSearch />);
    const textarea = screen.getByLabelText(PROMPT_LABEL);
    fireEvent.change(textarea, { target: { value: "last Friday's coast trip" } });

    const button = screen.getByRole('button', { name: SEARCH });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });

  it('reflects the typed value in the controlled Textarea', () => {
    enableFeature();

    render(<AINLDriveSearch />);
    const textarea = screen.getByLabelText(PROMPT_LABEL) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'trip to the mountains' } });

    expect(textarea.value).toBe('trip to the mountains');
  });
});

describe('AINLDriveSearch — wired SSE POST', () => {
  it('typing a prompt + clicking Search POSTs exactly once to /api/v1/ai/drives/search and renders the first delta', async () => {
    enableFeature();

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'Found your coast trip from last Friday: 82 km, 1h14m, ' +
          'ending at Half Moon Bay. Jump to its replay below.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 120, out: 40 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AINLDriveSearch />);

    const textarea = screen.getByLabelText(PROMPT_LABEL);
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: "last Friday's trip to the coast" },
      });
    });

    const button = screen.getByRole('button', { name: SEARCH });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    // Exactly one POST, against the registry route. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase() is '' in jsdom.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/drives/search');
    expect(init?.method).toBe('POST');
    // The handler parses the natural-language query from the body.
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({
      prompt: "last Friday's trip to the coast",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // The first delta accumulates into the shared output panel.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        'Found your coast trip from last Friday',
      );
    });
  });

  it('trims the prompt into the POST body so canStart and the payload agree', async () => {
    enableFeature();

    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(init?.body as string);
      return new Response(
        makeReadableStream([
          sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } }),
        ]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    render(<AINLDriveSearch />);

    const textarea = screen.getByLabelText(PROMPT_LABEL);
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: '   commute home   ' },
      });
    });

    const button = screen.getByRole('button', { name: SEARCH });
    // Padded-but-non-empty prompt still enables the button (canStart
    // trims first), and the padding must not reach the wire.
    expect(button).toBeEnabled();
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(JSON.parse(bodies[0])).toEqual({ prompt: 'commute home' });
  });

  it('does not fire a request while the prompt is empty, even if the disabled button is clicked', async () => {
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

    render(<AINLDriveSearch />);

    const button = screen.getByRole('button', { name: SEARCH });
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

    render(<AINLDriveSearch />);

    const textarea = screen.getByLabelText(PROMPT_LABEL);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'road trip' } });
    });

    const button = screen.getByRole('button', { name: SEARCH });

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

    render(<AINLDriveSearch />);

    const textarea = screen.getByLabelText(PROMPT_LABEL);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'weekend drive' } });
    });

    const button = screen.getByRole('button', { name: SEARCH });
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
