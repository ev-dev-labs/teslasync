// Natural-language dashboard composer on-mode wiring test. Proves the "Draft dashboard" button
// opens an SSE stream against the registered backend route
// POST /api/v1/ai/power/dashboard/draft.
//
// `TestNlDashboardComposerAIOnWiredCallsRoute` is the
// load-bearing positive wiring proof. It mounts the AINLDashboardComposer
// component with ai_mode='cloud' + the per-feature toggle on,
// stubs global fetch with a deterministic SSE byte stream,
// types a prompt, clicks the Draft dashboard button, and
// asserts:
//
//   1. Exactly ONE POST against the registered backend route
//      `/api/v1/ai/power/dashboard/draft` is enqueued with
//      `Content-Type: application/json` and a body containing
//      `{prompt}`. The path MUST match the registry entry
//      verbatim — a typo here is invisible to the off-mode
//      test (which only asserts absence) and would silently
//      404 in production.
//   2. The first `delta` event's text renders inside the
//      AiOutputPanel inside the gated wrapper
//      `data-testid="ai-feature-nl-dashboard-composer-root"`.
//   3. A second click while `state === 'streaming'` is a
//      no-op — the second fetch call is NOT enqueued (the
//      double-submit guard inside useAiStream + the visual
//      `disabled` mirror it from canDraft). This proves W1
//      Rule A — the disabled prop is a computed expression
//      that reacts to state.
//   4. After a typed `tool_result` for
//      `draft_dashboard_layout` lands, the "Apply to editor"
//      button enables and clicking it invokes the `onApply`
//      prop with the parsed DashboardLayoutDraft. This proves
//      the propose-only contract (ADR-015 §I8): the AI hook
//      never writes editor state; the user must click Apply,
//      and the page wires it.
//   5. The off-mode invariant test
//      (`TestNLDashboardComposerAIOffManualComposerWorks`)
//      continues to pass unchanged — wiring MUST NOT regress
//      the off-mode absence invariant. That assertion lives
//      in the sibling file and is exercised independently by
//      the npm test runner.
//
// The test name MUST stay
// `TestNlDashboardComposerAIOnWiredCallsRoute` so targeted test commands keep working.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import {
  AINLDashboardComposer,
  type DashboardLayoutDraft,
} from '@/components/ai/AINLDashboardComposer';

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

beforeEach(() => {
  mockUseSettings.mockReset();
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestNlDashboardComposerAIOnWiredCallsRoute (nl-dashboard-composer on-mode SPA wiring)', () => {
  it('TestNlDashboardComposerAIOnWiredCallsRoute: typing a prompt + clicking Draft dashboard POSTs once to /api/v1/ai/power/dashboard/draft and renders the first delta', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-dashboard-composer': true },
      }),
    );

    const fetchCalls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sseBody =
      sseFrame('delta', {
        text: 'Drafting an overview dashboard with three panels: daily drives, current battery, and recent alerts.',
      }) +
      sseFrame('tool_result', {
        id: 'call-1',
        name: 'draft_dashboard_layout',
        ok: true,
        data: {
          draft: {
            prompt: 'give me an overview dashboard with daily drives, current battery, and recent alerts',
            dashboard: {
              title: 'Fleet overview',
              slots: [
                {
                  panel_name: 'drives_per_day_timeseries',
                  grid_pos: { x: 0, y: 0, w: 24, h: 8 },
                },
                {
                  panel_name: 'battery_soc_stat',
                  grid_pos: { x: 0, y: 8, w: 12, h: 6 },
                },
                {
                  panel_name: 'alerts_count_stat',
                  grid_pos: { x: 12, y: 8, w: 12, h: 6 },
                },
              ],
            },
            rationale:
              'stacks the daily drives time series on top and pairs current battery with recent alerts below',
            referenced_panels: [
              'drives_per_day_timeseries',
              'battery_soc_stat',
              'alerts_count_stat',
            ],
          },
          status: 'ok',
          source: 'tools.draft_dashboard_layout',
        },
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 220, out: 80 } });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(makeReadableStream([sseBody]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof globalThis.fetch;

    const onApply = vi.fn<(draft: DashboardLayoutDraft) => void>();
    render(<AINLDashboardComposer onApply={onApply} />);

    // 1) The gated wrapper renders with the registered test
    //    ID.
    const root = screen.getByTestId('ai-feature-nl-dashboard-composer-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'nl-dashboard-composer');

    // 2) Type a prompt — the Draft button only enables after
    //    a non-empty prompt.
    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value:
            'give me an overview dashboard with daily drives, current battery, and recent alerts',
        },
      });
    });

    // Use UNANCHORED regex per Helix UX addendum HX#3 — the
    // visible button text is "Ask Helix · Draft dashboard"
    // so an anchored /^Draft dashboard$/ would not match.
    const draftButton = screen.getByRole('button', { name: /Draft dashboard/i });
    expect(draftButton).not.toBeDisabled();

    // 3) Click — fires the SSE stream against the registered
    //    route.
    await act(async () => {
      fireEvent.click(draftButton);
    });

    // 4) Exactly one fetch must have been enqueued, against
    //    the registered backend path. The body carries the
    //    typed {prompt} contract.
    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    const { url, init } = fetchCalls[0];
    expect(url).toBe('/api/v1/ai/power/dashboard/draft');
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    const parsedBody = JSON.parse(init?.body as string);
    expect(parsedBody).toEqual({
      prompt:
        'give me an overview dashboard with daily drives, current battery, and recent alerts',
    });
    // Accept header must be text/event-stream — proves the
    // SSE contract is honoured by the hook.
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');

    // 5) The first delta's text renders inside the gated
    //    wrapper.
    await waitFor(() => {
      expect(root).toHaveTextContent(
        'Drafting an overview dashboard with three panels: daily drives, current battery, and recent alerts.',
      );
    });

    // 6) After the tool_result lands, the Apply button
    //    enables; clicking it copies the parsed draft into
    //    the page state via onApply (propose-only contract).
    const applyButton = await screen.findByRole('button', {
      name: /Apply to editor/i,
    });
    await waitFor(() => expect(applyButton).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(applyButton);
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      prompt:
        'give me an overview dashboard with daily drives, current battery, and recent alerts',
      dashboard: {
        title: 'Fleet overview',
        slots: [
          {
            panel_name: 'drives_per_day_timeseries',
            grid_pos: { x: 0, y: 0, w: 24, h: 8 },
          },
          {
            panel_name: 'battery_soc_stat',
            grid_pos: { x: 0, y: 8, w: 12, h: 6 },
          },
          {
            panel_name: 'alerts_count_stat',
            grid_pos: { x: 12, y: 8, w: 12, h: 6 },
          },
        ],
      },
      rationale:
        'stacks the daily drives time series on top and pairs current battery with recent alerts below',
      referenced_panels: [
        'drives_per_day_timeseries',
        'battery_soc_stat',
        'alerts_count_stat',
      ],
    });
  });

  it('TestNlDashboardComposerAIOnWiredCallsRoute: a second click while streaming is a no-op (double-submit guard)', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-dashboard-composer': true },
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

    render(<AINLDashboardComposer onApply={() => {}} />);

    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value: 'give me a charging dashboard',
        },
      });
    });

    const draftButton = screen.getByRole('button', { name: /Draft dashboard/i });

    // First click opens the stream.
    await act(async () => {
      fireEvent.click(draftButton);
    });
    await waitFor(() => expect(fetchCount).toBe(1));

    // While streaming the button's disabled is COMPUTED from
    // `canDraft = !isStreaming && hasPrompt`. The hook's
    // runningRef also coalesces duplicate start() calls, so
    // the second click is a defence-in-depth no-op even if a
    // future refactor accidentally drops the visual disabled.
    await waitFor(() => expect(draftButton).toBeDisabled());
    await act(async () => {
      fireEvent.click(draftButton);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCount).toBe(1);
  });
});
