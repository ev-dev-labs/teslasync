// Comprehensive unit + wiring coverage for AIRAGHelp.
//
// AIRAGHelp is the RAG-backed in-app help AI surface.
// `withAiFeature('rag-help', …)` gates its visibility per the ADR-015
// AI-Off Contract, and the inner card wires a prompt Textarea + "Ask the
// assistant" button to POST /api/v1/ai/help/query through the canonical
// useAiStream hook.
//
// The file exports a single symbol (the wrapped component), so this suite
// exercises every branch reachable through it:
//
//   - the visibility gate (off / per-feature-off / fully-enabled),
//   - the prompt → canStart validation (empty and whitespace-only prompts
//     leave the button disabled so we never POST an empty question the
//     backend would reject),
//   - the accessible label on the prompt Textarea (a11y — the input must
//     have an accessible name, not just a placeholder),
//   - the wired SSE POST (route, method, headers, body, delta render),
//   - the prompt is trimmed into the POST body (canStart and the body must
//     agree — a padded question is sent without its padding),
//   - the "no request when disabled" invariant,
//   - the double-submit guard, and
//   - the terminal-error render path.
//
// Network is stubbed with a deterministic SSE byte stream — the same
// pattern the sibling AINLDriveSearch / AIPeriodCompareNarration wiring
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
import { AIRAGHelp } from './AIRAGHelp';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

const ROOT_TESTID = 'ai-feature-rag-help-root';
const HELP_ROUTE = '/api/v1/ai/help/query';
// The card renders the universal "Ask Helix" CTA but exposes the
// per-feature verb ("Ask the assistant") as the button's accessible name,
// so we can locate it regardless of the visible label (idle or streaming).
const ASK = /Ask the assistant/i;
// The prompt Textarea's accessible name (aria-label). A placeholder alone
// is NOT an accessible name; this label is the a11y contract.
const PROMPT_LABEL = /Ask a question about the app/i;

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

function settingsPayload(overrides: Partial<AppSettings>): { settings: AppSettings } {
  return { settings: { ...baseSettings, ...overrides } };
}

// enableFeature turns the gate fully on so the inner card renders.
function enableFeature(): void {
  mockUseSettings.mockReturnValue(
    settingsPayload({
      ai_mode: 'cloud',
      ai_features: { 'rag-help': true },
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

// installFetchCapture stubs global fetch with a deterministic SSE body and
// records every call so the route + body can be asserted.
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

describe('AIRAGHelp — ADR-015 visibility gate', () => {
  it('renders nothing when ai_mode=off even with the toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'rag-help': true },
      }),
    );

    const { container } = render(<AIRAGHelp />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ASK })).not.toBeInTheDocument();
  });

  it('renders nothing when the per-feature toggle is off despite ai_mode=cloud', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'rag-help': false },
      }),
    );

    const { container } = render(<AIRAGHelp />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders nothing when settings have not resolved yet (fail-closed)', () => {
    mockUseSettings.mockReturnValue({ settings: undefined });

    const { container } = render(<AIRAGHelp />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument();
  });

  it('renders the help card (title, description, Helix badge, prompt input, Ask button) when fully enabled', () => {
    enableFeature();

    render(<AIRAGHelp />);

    const root = screen.getByTestId(ROOT_TESTID);
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'rag-help');

    expect(
      screen.getByRole('heading', { name: /Ask the help assistant/i }),
    ).toBeInTheDocument();
    expect(root).toHaveTextContent(/documentation, runbooks, and i18n strings/i);
    // Badge label passed as "Helix"; its visible text is exactly "Helix"
    // (the button's visible CTA is "Ask Helix", not an exact match).
    expect(screen.getByText('Helix')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: ASK })).toBeInTheDocument();
    // The prompt Textarea is reachable by its accessible name (a11y).
    expect(screen.getByLabelText(PROMPT_LABEL)).toBeInTheDocument();
    // The output panel is absent until a stream has run at least once.
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
  });
});

describe('AIRAGHelp — prompt → canStart validation (computed, not literal)', () => {
  it('disables Ask when the prompt is empty', () => {
    enableFeature();

    render(<AIRAGHelp />);

    const button = screen.getByRole('button', { name: ASK });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps Ask disabled for a whitespace-only prompt (trim guard)', () => {
    enableFeature();

    render(<AIRAGHelp />);
    const textarea = screen.getByLabelText(PROMPT_LABEL);
    fireEvent.change(textarea, { target: { value: '   \t \n  ' } });

    const button = screen.getByRole('button', { name: ASK });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('enables Ask once a non-empty prompt is typed', () => {
    enableFeature();

    render(<AIRAGHelp />);
    const textarea = screen.getByLabelText(PROMPT_LABEL);
    fireEvent.change(textarea, {
      target: { value: 'How do I enable energy cost forecasting?' },
    });

    const button = screen.getByRole('button', { name: ASK });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'false');
  });

  it('reflects the typed value in the controlled Textarea', () => {
    enableFeature();

    render(<AIRAGHelp />);
    const textarea = screen.getByLabelText(PROMPT_LABEL) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'where are my exports?' } });

    expect(textarea.value).toBe('where are my exports?');
  });
});

describe('AIRAGHelp — wired SSE POST', () => {
  it('typing a prompt + clicking Ask POSTs exactly once to /api/v1/ai/help/query and renders the first delta', async () => {
    enableFeature();

    const answer =
      'Open Settings → Energy and toggle "Cost forecasting". ' +
      'See the Energy docs [1] for the per-kWh rate configuration.';
    const calls = installFetchCapture(
      sseFrame('delta', { text: answer }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 120, out: 40 } }),
    );

    render(<AIRAGHelp />);

    const textarea = screen.getByLabelText(PROMPT_LABEL);
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: 'How do I enable energy cost forecasting?' },
      });
    });

    const button = screen.getByRole('button', { name: ASK });
    expect(button).toBeEnabled();

    await act(async () => {
      fireEvent.click(button);
    });

    // Exactly one POST, against the registry route. useAiStream prepends
    // `${getApiBase()}/api/v1`; getApiBase() is '' in jsdom.
    await waitFor(() => expect(calls).toHaveLength(1));
    const { url, init } = calls[0];
    expect(url).toBe(HELP_ROUTE);
    expect(init?.method).toBe('POST');
    // The handler parses the natural-language question from the body.
    expect(typeof init?.body).toBe('string');
    expect(JSON.parse(init?.body as string)).toEqual({
      prompt: 'How do I enable energy cost forecasting?',
    });
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // The first delta accumulates into the shared output panel.
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent(
        'Open Settings',
      );
    });
  });

  it('trims the prompt into the POST body so canStart and the payload agree', async () => {
    enableFeature();

    const calls = installFetchCapture(DONE_ONLY);

    render(<AIRAGHelp />);

    const textarea = screen.getByLabelText(PROMPT_LABEL);
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: '   how do I export a drive?   ' },
      });
    });

    const button = screen.getByRole('button', { name: ASK });
    // Padded-but-non-empty prompt still enables the button (canStart trims
    // first), and the padding must not reach the wire.
    expect(button).toBeEnabled();
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      prompt: 'how do I export a drive?',
    });
  });

  it('does not fire a request while the prompt is empty, even if the disabled button is clicked', async () => {
    enableFeature();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response(makeReadableStream([DONE_ONLY]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIRAGHelp />);

    const button = screen.getByRole('button', { name: ASK });
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

    render(<AIRAGHelp />);

    const textarea = screen.getByLabelText(PROMPT_LABEL);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'what is a geofence?' } });
    });

    const button = screen.getByRole('button', { name: ASK });

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

    render(<AIRAGHelp />);

    const textarea = screen.getByLabelText(PROMPT_LABEL);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'why did my alert fire?' } });
    });

    const button = screen.getByRole('button', { name: ASK });
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
