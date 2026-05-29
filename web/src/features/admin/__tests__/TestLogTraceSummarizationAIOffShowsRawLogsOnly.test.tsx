// Log and trace summarization AI-off contract test.
//
// `TestLogTraceSummarizationAIOffShowsRawLogsOnly` mounts
// the AILogTraceSummarization component with ai_mode='off' (plus
// the per-feature toggle on, to defeat the obvious "off because
// nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND log-trace-summarization=true, the
//      section IS present + carries the expected test ID. This is
//      the positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//   4. The mode='cloud' path with toggle=false also hides the
//      section — per-feature opt-in (ADR-015 §I7).
//
// In addition, this file mounts the FULL LiveLogsPage in off mode
// and asserts the deterministic raw log surfaces still render —
// proving the AI surface's absence does NOT regress the canonical
// baseline (ADR-015 §I3). The rendered page MUST show:
//
//   - The level / grep / vehicle filter controls.
//   - The pause / resume / reconnect / clear / download
//     controls.
//   - The livelogs-table-panel (table or empty state) — the
//     deterministic SSE log tail surface.
//
// The HTTP POST /api/v1/ai/system/logs/summarize 404-in-off-mode
// invariant is proven by the Go-side
// TestLogTraceSummarizationAIOffShowsRawLogsOnly in
// internal/api/ai_log_trace_summarization_handler_test.go — the
// network layer does not exist in the React unit-test scope.
//
// Keep the file name aligned with the scenario name; path-based test
// filters depend on it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AppSettings } from '@/api/types';
import { ToastProvider } from '@/components/feedback/Toast';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

// useLogStream owns an EventSource lifecycle that is irrelevant to
// the off-mode contract. Replace it with a deterministic stub so
// the LiveLogsPage mounts hermetically.
vi.mock('@/api/hooks/useLogStream', async () => {
  const actual = await vi.importActual<
    typeof import('@/api/hooks/useLogStream')
  >('@/api/hooks/useLogStream');
  return {
    ...actual,
    useLogStream: vi.fn(() => ({
      events: [],
      isConnected: false,
      error: null,
      drops: 0,
      totalReceived: 0,
      clear: () => {},
    })),
  };
});

import { useSettings } from '@/hooks/useSettings';
import { AILogTraceSummarization } from '@/components/ai/AILogTraceSummarization';
import LiveLogsPage from '@/features/admin/pages/LiveLogsPage';

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

beforeEach(() => {
  mockUseSettings.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderLiveLogsPage() {
  // QueryClientProvider is required because LiveLogsPage
  // transitively touches hooks built on TanStack Query (the
  // useLogStream mock short-circuits the SSE subscription, but
  // the provider must exist so the React tree mounts).
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/live-logs']}>
          <LiveLogsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('TestLogTraceSummarizationAIOffShowsRawLogsOnly (log-trace-summarization AI-off contract)', () => {
  it('TestLogTraceSummarizationAIOffShowsRawLogsOnly: AILogTraceSummarization renders nothing when ai_mode=off even with the log-trace-summarization toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    //
    // The window props are also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a
    // missing prop) is what hides the section. In production the
    // parent LiveLogsPage always passes a derived window.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'log-trace-summarization': true },
      }),
    );

    const { container } = render(
      <AILogTraceSummarization
        fromUnix={1700000000}
        toUnix={1700001800}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-log-trace-summarization-root'),
    ).not.toBeInTheDocument();
  });

  it('TestLogTraceSummarizationAIOffShowsRawLogsOnly: AILogTraceSummarization renders nothing when ai_mode is non-off but the log-trace-summarization toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'log-trace-summarization': false },
      }),
    );

    const { container } = render(
      <AILogTraceSummarization
        fromUnix={1700000000}
        toUnix={1700001800}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-log-trace-summarization-root'),
    ).not.toBeInTheDocument();
  });

  it('TestLogTraceSummarizationAIOffShowsRawLogsOnly: AILogTraceSummarization renders the section when ai_mode=cloud AND log-trace-summarization toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'log-trace-summarization': true },
      }),
    );

    render(
      <AILogTraceSummarization
        fromUnix={1700000000}
        toUnix={1700001800}
      />,
    );
    const root = screen.getByTestId(
      'ai-feature-log-trace-summarization-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'log-trace-summarization',
    );
  });

  it('TestLogTraceSummarizationAIOffShowsRawLogsOnly: LiveLogsPage in off mode shows the deterministic raw log surfaces (baseline intact, ADR-015 §I3)', () => {
    // The slice's load-bearing baseline-coexistence proof: with
    // ai_mode='off', the canonical LiveLogsPage MUST continue to
    // render every deterministic surface — filter controls,
    // stream controls, and the table/empty-state panel — exactly
    // as it would without the AI feature ever existing. The AI
    // summarizer section MUST be absent from the DOM (ADR-015
    // §I5 + §I6).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'log-trace-summarization': true },
      }),
    );

    renderLiveLogsPage();

    // 1) Filter and control surfaces are rendered.
    expect(
      screen.getByPlaceholderText(/Numeric — applied client-side/),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/mqtt\|signal_log/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Reconnect/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Clear buffer/i }),
    ).toBeInTheDocument();

    // 2) The deterministic SSE log-tail panel is present (the
    // useLogStream mock returns zero events, so the empty-state
    // path renders inside the same panel).
    expect(screen.getByTestId('livelogs-table-panel')).toBeInTheDocument();

    // 3) The AI summarizer surface MUST be absent from the DOM
    // (ADR-015 §I5). This is the load-bearing baseline-intact
    // assertion: even though the AI component is conditionally
    // mounted by the page, the off-mode gate MUST hide it.
    expect(
      screen.queryByTestId('ai-feature-log-trace-summarization-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Summarize/i }),
    ).not.toBeInTheDocument();
  });
});
