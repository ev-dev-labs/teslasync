// PII redaction in shared exports.
// Verifies that the "Suggest redactions" button opens an SSE stream
// against POST /api/v1/ai/exports/redaction/draft.
// This is the positive wiring proof for AIPiiRedactionSharedExports: it mounts the component
// with ai_mode='cloud' + the per-feature toggle on, stubs global
// fetch with a deterministic SSE byte stream, picks an export
// type, clicks the action button, and asserts:
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/exports/redaction/draft` is enqueued with
//      `Content-Type: application/json` and a body containing
//      the in-scope export_type. The path MUST match the registry
//      entry verbatim — a typo here is invisible to the off-mode
//      test (which only asserts absence) and would silently 404
//      in production.
//   2. The first `delta` event's text renders inside the gated
//      wrapper
//      `data-testid="ai-feature-pii-redaction-shared-exports-root"`.
//   3. A second click while `state === 'streaming'` is a no-op —
//      the second fetch call is NOT enqueued (the double-submit
//      guard inside useAiStream + the visual `disabled` mirror it
//      from canStart). This proves W1 Rule A — the disabled prop
//      is a computed expression that reacts to state.
//   4. The off-mode invariant test
//      (`TestSharedExportRedactionAIOffManualExportWorks`)
//      continues to pass unchanged — wiring MUST NOT regress the
//      off-mode absence invariant. That assertion lives in the
//      sibling file and is exercised independently by the npm
//      test runner.
// HX (Helix UX) addendum compliance:
//   - The CTA is located via `getByRole('button', { name:
//     /Suggest redactions/i })` — UNANCHORED regex because
//     AIFeatureCard composes the accessible name as
//     "Ask Helix · Suggest redactions". An anchored regex would
//     not match.

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
import { AIPiiRedactionSharedExports } from '@/components/ai/AIPiiRedactionSharedExports';

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

// makeReadableStream constructs a ReadableStream<Uint8Array>
// from arbitrarily-sized text chunks. Mirrors the helper used by
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
  // Default fetch mock yells if a test forgets to install its
  // own — surfaces miswiring as a clear failure rather than a
  // silent timeout.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestPiiRedactionSharedExportsAIOnWiredCallsRoute (pii-redaction-shared-exports on-mode SPA wiring)', () => {
  it('TestPiiRedactionSharedExportsAIOnWiredCallsRoute: clicking the action button POSTs once to /api/v1/ai/exports/redaction/draft and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    );

    // Track every fetch call so we can assert the route + body
    // exactly. The mocked fetch returns a deterministic SSE
    // byte stream containing one delta and one done frame.
    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'For the account export, redact email and phone (highly recommended) and consider redacting display_name if you do not want it shared.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 90, out: 28 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(<AIPiiRedactionSharedExports />);

    // 1) The gated wrapper renders with the registered test ID
    // — proves the on-mode positive control path.
    const root = screen.getByTestId(
      'ai-feature-pii-redaction-shared-exports-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'pii-redaction-shared-exports',
    );

    // 2) Before picking an export_type the action button MUST be
    // disabled (canStart=false because exportType==='').
    const button = screen.getByRole('button', {
      name: /Suggest redactions/i,
    });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();

    // 3) Pick an export_type via the inputSlot Select. Use
    // fireEvent.change with the canonical slug 'account' so the
    // body the handler-side parser receives matches the Go test
    // exercises.
    const select = screen.getByRole('combobox', { name: /Export type/i });
    await act(async () => {
      fireEvent.change(select, { target: { value: 'account' } });
    });
    await waitFor(() => expect(button).not.toBeDisabled());

    // 4) Click — fires the SSE stream against the registered
    // route. fireEvent.click bypasses pointer-events behaviour;
    // @testing-library/user-event is intentionally NOT a
    // dependency of this codebase (see web/package.json), so
    // we use fireEvent.click consistently across these
    // wiring tests.
    await act(async () => {
      fireEvent.click(button);
    });

    // 5) Exactly one fetch must have been enqueued, against
    // the registered backend path.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    // useAiStream prepends `${getApiBase()}/api/v1`;
    // getApiBase returns '' in the test environment, so the
    // final URL is `/api/v1/ai/exports/redaction/draft`.
    expect(url).toBe('/api/v1/ai/exports/redaction/draft');
    expect(init?.method).toBe('POST');
    // The body must contain the in-scope export_type — proves
    // the component is feeding the handler-side parser the
    // same shape the Go test exercises.
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({ export_type: 'account' });
    // Accept header must be text/event-stream — proves the SSE
    // contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 6) The first delta's text renders inside the gated
    // wrapper. waitFor accounts for the async byte-stream
    // pump.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'For the account export, redact email and phone (highly recommended) and consider redacting display_name if you do not want it shared.',
      );
    });
  });

  it('TestPiiRedactionSharedExportsAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': true },
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

    render(<AIPiiRedactionSharedExports />);

    const select = screen.getByRole('combobox', { name: /Export type/i });
    await act(async () => {
      fireEvent.change(select, { target: { value: 'drives' } });
    });

    const button = screen.getByRole('button', {
      name: /Suggest redactions/i,
    });
    await waitFor(() => expect(button).not.toBeDisabled());

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
      // lets us exercise the runningRef coalescer in
      // useAiStream directly (defence in depth: even if the
      // visual disabled breaks, the hook still refuses to
      // double-submit).
      fireEvent.click(button);
    });

    // Give any rogue fetch a microtask to land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });

  it('TestPiiRedactionSharedExportsAIOnWiredCallsRoute: action button is disabled when no export_type has been picked (computed, not literal)', () => {
    // Guard the routing contract: the
    // primary action button's `disabled` prop MUST be a
    // computed expression (here: `!canStart || stream.state
    // === 'streaming'`), not a literal `disabled` /
    // `disabled={true}`. We prove the dynamic behaviour by
    // rendering the component without picking an export_type
    // and confirming the button is disabled while the gate is
    // open — same code path, different prop input.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    );

    render(<AIPiiRedactionSharedExports />);

    const button = screen.getByRole('button', {
      name: /Suggest redactions/i,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('retires completed guidance when the catalog type changes without automatically requesting new guidance', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(makeReadableStream([
        sseFrame('delta', { text: 'Account catalog guidance.' }),
        sseFrame('done', { finish_reason: 'stop', usage: { in: 90, out: 28 } }),
      ]), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    const { rerender } = render(<AIPiiRedactionSharedExports />);
    const select = screen.getByRole('combobox', { name: /Export type/i });
    const button = screen.getByRole('button', { name: /Suggest redactions/i });
    fireEvent.change(select, { target: { value: 'account' } });
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent('Account catalog guidance.');
      expect(button).not.toBeDisabled();
    });

    rerender(<AIPiiRedactionSharedExports />);
    fireEvent.change(select, { target: { value: 'account' } });
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent('Account catalog guidance.');

    fireEvent.change(select, { target: { value: 'drives' } });
    expect(select).toHaveValue('drives');
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();
    fireEvent.change(select, { target: { value: 'account' } });
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts old-type streaming guidance and ignores late frames after explicitly starting the new type', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    );
    let oldController!: ReadableStreamDefaultController<Uint8Array>;
    let newController!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          oldController = controller;
          controller.enqueue(encoder.encode(sseFrame('delta', { text: 'Account partial guidance.' })));
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          newController = controller;
        },
      }), { status: 200 }));
    globalThis.fetch = fetchMock;

    render(<AIPiiRedactionSharedExports />);
    const select = screen.getByRole('combobox', { name: /Export type/i });
    const button = screen.getByRole('button', { name: /Suggest redactions/i });
    fireEvent.change(select, { target: { value: 'account' } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('ai-output-panel')).toHaveTextContent('Account partial guidance.'));
    expect(button).toBeDisabled();
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    expect(oldSignal?.aborted).toBe(false);

    fireEvent.change(select, { target: { value: 'drives' } });
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/v1/ai/exports/redaction/draft');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ export_type: 'drives' }));
    await act(async () => {
      oldController.enqueue(encoder.encode(
        sseFrame('delta', { text: 'Late account guidance.' }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 90, out: 28 } }),
      ));
      oldController.close();
    });
    expect(screen.getByTestId('ai-output-panel')).not.toHaveTextContent(/Account|Late account/);
    expect(button).toBeDisabled();
    expect(init?.signal?.aborted).toBe(false);

    await act(async () => {
      newController.enqueue(encoder.encode(
        sseFrame('delta', { text: 'Drives catalog guidance.' }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 80, out: 20 } }),
      ));
      newController.close();
    });
    await waitFor(() => {
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent('Drives catalog guidance.');
      expect(button).not.toBeDisabled();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a delayed old-type response after clearing the selection', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    );
    let resolveResponse!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveResponse = resolve; }),
    );
    globalThis.fetch = fetchMock;

    render(<AIPiiRedactionSharedExports />);
    const select = screen.getByRole('combobox', { name: /Export type/i });
    const button = screen.getByRole('button', { name: /Suggest redactions/i });
    fireEvent.change(select, { target: { value: 'account' } });
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(select, { target: { value: '' } });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(button).toBeDisabled();
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();

    await act(async () => {
      resolveResponse(new Response(makeReadableStream([
        sseFrame('delta', { text: 'Delayed account guidance.' }),
        sseFrame('done', { finish_reason: 'stop', usage: { in: 90, out: 28 } }),
      ]), { status: 200 }));
    });
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'drives' } });
    expect(button).not.toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains partial guidance with its error for the same type and retires both on a type change', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(makeReadableStream([
        sseFrame('delta', { text: 'Account incomplete guidance.' }),
      ]), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    const { rerender } = render(<AIPiiRedactionSharedExports />);
    const select = screen.getByRole('combobox', { name: /Export type/i });
    const button = screen.getByRole('button', { name: /Suggest redactions/i });
    fireEvent.change(select, { target: { value: 'account' } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('stream_incomplete'));
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent('Account incomplete guidance.');
    expect(button).not.toBeDisabled();

    rerender(<AIPiiRedactionSharedExports />);
    expect(screen.getByRole('alert')).toHaveTextContent('stream_incomplete');
    expect(screen.getByTestId('ai-output-panel')).toHaveTextContent('Account incomplete guidance.');
    fireEvent.change(select, { target: { value: 'drives' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
