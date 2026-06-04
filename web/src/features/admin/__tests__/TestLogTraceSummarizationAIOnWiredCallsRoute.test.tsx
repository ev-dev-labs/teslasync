// On-mode wiring test for the log/trace summarization route.
// Mounts AILogTraceSummarization with ai_mode='cloud', stubs fetch with
// a deterministic SSE stream, clicks Summarize, and verifies exactly one
// POST to /api/v1/ai/system/logs/summarize with the expected JSON body.
// It also checks streamed text rendering, double-submit protection, and
// disabled states for missing or invalid time windows. The sibling
// off-mode test continues to prove the raw-log baseline remains intact.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AILogTraceSummarization } from '@/components/ai/AILogTraceSummarization';

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

describe('TestLogTraceSummarizationAIOnWiredCallsRoute (log-trace-summarization on-mode SPA wiring)', () => {
  it('TestLogTraceSummarizationAIOnWiredCallsRoute: clicking Summarize POSTs once to /api/v1/ai/system/logs/summarize and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'log-trace-summarization': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text:
          'The 30-minute window held 142 log events (98 info, 41 warn, 3 error) and 27 trace spans. ' +
          'The dominant template was the MQTT batch-flush ack; the slowest trace operation was the ' +
          'reconciliation tick at 412ms mean. No structural anomalies surfaced.',
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
      <AILogTraceSummarization
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    );

    // 1) The gated wrapper renders with the registered test ID.
    const root = screen.getByTestId(
      'ai-feature-log-trace-summarization-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'log-trace-summarization',
    );

    // 2) The Summarize button is initially enabled (canSummarize
    // requires only a valid window; there is no question
    // textarea on this surface).
    const button = screen.getByRole('button', { name: /Summarize/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();

    // 3) Click — fires the SSE stream against the registered route.
    await act(async () => {
      fireEvent.click(button);
    });

    // 4) Exactly one fetch must have been enqueued, against the
    // registered backend path. The body MUST carry the in-scope
    // window so the LLM cannot widen it.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/system/logs/summarize');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({
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
        'The 30-minute window held 142 log events (98 info, 41 warn, 3 error)',
      );
    });
  });

  it('TestLogTraceSummarizationAIOnWiredCallsRoute: vehicle_id is included in the body when the parent supplies it', async () => {
    // Defence-in-depth assertion: when the parent narrows the
    // window to one vehicle, the body MUST carry vehicle_id so
    // the backend's per-request scope binding receives it. A
    // missing vehicle_id would silently widen the in-scope
    // window to all vehicles — exactly the prompt-injection
    // exfiltration vector the scope-binding defends against.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'log-trace-summarization': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseFrame('done', {})]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    render(
      <AILogTraceSummarization
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
        vehicleId={42}
      />,
    );

    const button = screen.getByRole('button', { name: /Summarize/i });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const parsedBody = JSON.parse(fetchCalls[0].init?.body as string);
    expect(parsedBody).toEqual({
      from_unix: FROM_UNIX,
      to_unix: TO_UNIX,
      vehicle_id: 42,
    });
  });

  it('TestLogTraceSummarizationAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'log-trace-summarization': true },
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
      <AILogTraceSummarization
        fromUnix={FROM_UNIX}
        toUnix={TO_UNIX}
      />,
    );

    const button = screen.getByRole('button', { name: /Summarize/i });

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button's disabled is COMPUTED from
    // `canSummarize = windowAcceptable && state !== 'streaming'`.
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

  it('TestLogTraceSummarizationAIOnWiredCallsRoute: Summarize button is disabled when the window is missing (computed, not literal)', () => {
    // The primary action button's `disabled` prop must be computed
    // from state (here: `!canSummarize`), not hardcoded. Rendering
    // without a window proves the same open gate can still disable
    // the action from props.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'log-trace-summarization': true },
      }),
    );

    render(<AILogTraceSummarization />);

    const button = screen.getByRole('button', { name: /Summarize/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('TestLogTraceSummarizationAIOnWiredCallsRoute: Summarize button is disabled when the window is invalid or too large (computed, not literal)', () => {
    // The handler-side parser rejects to_unix <= from_unix and
    // windows > 24h; we mirror that here so the button never
    // submits a request the backend would 400.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'log-trace-summarization': true },
      }),
    );

    // Reversed window.
    const { rerender } = render(
      <AILogTraceSummarization
        fromUnix={TO_UNIX}
        toUnix={FROM_UNIX}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Summarize/i }),
    ).toBeDisabled();

    // Equal window.
    rerender(
      <AILogTraceSummarization
        fromUnix={FROM_UNIX}
        toUnix={FROM_UNIX}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Summarize/i }),
    ).toBeDisabled();

    // Window > 24h (the 25-hour window is intentionally one
    // hour past the backend's hard cap so we stay clearly
    // outside it even if the backend cap is later relaxed).
    rerender(
      <AILogTraceSummarization
        fromUnix={FROM_UNIX}
        toUnix={FROM_UNIX + 25 * 60 * 60}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Summarize/i }),
    ).toBeDisabled();

    // Negative from_unix.
    rerender(
      <AILogTraceSummarization
        fromUnix={-1}
        toUnix={TO_UNIX}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Summarize/i }),
    ).toBeDisabled();
  });
});
