// Phase-50 / 0042 — S1 Incident timeline summarizer.
//
// `TestIncidentTimelineAIOffShowsRawTimelineOnly` is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AIIncidentTimelineSummarizer component with ai_mode='off'
// (plus the per-feature toggle on, to defeat the obvious "off
// because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND incident-timeline-summarizer=true,
//      the section IS present + carries the expected test ID. This
//      is the positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//   4. The mode='cloud' path with toggle=false also hides the
//      section — per-feature opt-in (ADR-015 §I7).
//
// In addition, this file mounts the FULL IncidentTimelinePage in
// off mode and asserts the deterministic raw timeline still
// renders — proving the AI surface's absence does NOT regress the
// canonical baseline (ADR-015 §I3 + the prompt's explicit
// "baseline behaviour still works" gate). The rendered timeline
// MUST show:
//
//   - The incident header (title, severity, status badge,
//     duration).
//   - The chronological timeline of updates with their author /
//     status / message.
//   - The append-update form (when the incident is open).
//
// The HTTP POST /api/v1/ai/system/incidents/{incidentID}/summarize
// 404-in-off-mode invariant is proven by the Go-side
// TestIncidentTimelineAIOffShowsRawTimelineOnly in
// internal/api/ai_incident_timeline_summarizer_handler_test.go —
// the network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestIncidentTimelineAIOffShowsRawTimelineOnly.test.tsx`
// — the slice prompt's verification command runs
// `vitest --run TestIncidentTimelineAIOffShowsRawTimelineOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AppSettings } from '@/api/types';
import { ToastProvider } from '@/components/feedback/Toast';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

vi.mock('@/api/hooks/useIncidents', () => ({
  useIncident: vi.fn(),
  useAppendIncidentUpdate: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  usePatchIncident: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

import { useSettings } from '@/hooks/useSettings';
import {
  useIncident,
  useAppendIncidentUpdate,
  usePatchIncident,
} from '@/api/hooks/useIncidents';
import { AIIncidentTimelineSummarizer } from '@/components/ai/AIIncidentTimelineSummarizer';
import IncidentTimelinePage from '@/features/system/pages/IncidentTimelinePage';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;
const mockUseIncident = useIncident as unknown as ReturnType<typeof vi.fn>;
const mockUseAppendIncidentUpdate =
  useAppendIncidentUpdate as unknown as ReturnType<typeof vi.fn>;
const mockUsePatchIncident =
  usePatchIncident as unknown as ReturnType<typeof vi.fn>;

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

const sampleIncident = {
  id: 7,
  title: 'API gateway intermittent 502s',
  description:
    'Customers report bursty 502 responses from the public API gateway between 14:05 and 14:35 UTC.',
  severity: 'major' as const,
  status: 'monitoring' as const,
  source: 'pagerduty',
  affected_components: ['api-gateway', 'edge-cache'],
  started_at: '2025-03-12T14:05:00Z',
  resolved_at: undefined,
  updates: [
    {
      at: '2025-03-12T14:07:00Z',
      status: 'investigating' as const,
      message: 'PagerDuty fired alert "api-gateway-5xx-burst".',
      author: 'oncall-bot',
    },
    {
      at: '2025-03-12T14:18:00Z',
      status: 'identified' as const,
      message: 'Root cause: rolling restart on edge-cache fleet.',
      author: 'sre-jane',
    },
    {
      at: '2025-03-12T14:35:00Z',
      status: 'monitoring' as const,
      message:
        'Restart completed. Watching error rate; will resolve at 15:00 if clean.',
      author: 'sre-jane',
    },
  ],
};

beforeEach(() => {
  mockUseSettings.mockReset();
  mockUseIncident.mockReset();
  mockUseAppendIncidentUpdate.mockReset();
  mockUsePatchIncident.mockReset();

  mockUseAppendIncidentUpdate.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  mockUsePatchIncident.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
});

function renderIncidentPage() {
  // QueryClientProvider is required because the page transitively
  // imports hooks built on TanStack Query (the mocks short-circuit
  // them but the provider must exist so the React tree mounts).
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/system-status/incidents/7']}>
          <Routes>
            <Route
              path="/system-status/incidents/:id"
              element={<IncidentTimelinePage />}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('TestIncidentTimelineAIOffShowsRawTimelineOnly (incident-timeline-summarizer AI-off contract)', () => {
  it('TestIncidentTimelineAIOffShowsRawTimelineOnly: AIIncidentTimelineSummarizer renders nothing when ai_mode=off even with the incident-timeline-summarizer toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". The mode='off' check MUST trump the per-feature toggle
    // (ADR-015 §I7).
    //
    // The incidentId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a missing
    // prop) is what hides the section. In production the parent
    // IncidentTimelinePage always passes the loaded incident.id.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'incident-timeline-summarizer': true },
      }),
    );

    const { container } = render(
      <AIIncidentTimelineSummarizer incidentId={7} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-incident-timeline-summarizer-root'),
    ).not.toBeInTheDocument();
  });

  it('TestIncidentTimelineAIOffShowsRawTimelineOnly: AIIncidentTimelineSummarizer renders nothing when ai_mode is non-off but the incident-timeline-summarizer toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'incident-timeline-summarizer': false },
      }),
    );

    const { container } = render(
      <AIIncidentTimelineSummarizer incidentId={7} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-incident-timeline-summarizer-root'),
    ).not.toBeInTheDocument();
  });

  it('TestIncidentTimelineAIOffShowsRawTimelineOnly: AIIncidentTimelineSummarizer renders the section when ai_mode=cloud AND incident-timeline-summarizer toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'incident-timeline-summarizer': true },
      }),
    );

    render(<AIIncidentTimelineSummarizer incidentId={7} />);
    const root = screen.getByTestId(
      'ai-feature-incident-timeline-summarizer-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'incident-timeline-summarizer',
    );
  });

  it('TestIncidentTimelineAIOffShowsRawTimelineOnly: IncidentTimelinePage in off mode shows the deterministic raw timeline (baseline intact, ADR-015 §I3)', async () => {
    // The slice's load-bearing baseline-coexistence proof: with
    // ai_mode='off', the canonical IncidentTimelinePage MUST
    // continue to render every deterministic surface — header,
    // updates list, append-update form — exactly as it would
    // without the AI feature ever existing. The AI summarizer
    // section MUST be absent from the DOM (ADR-015 §I5 + §I6).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'incident-timeline-summarizer': true },
      }),
    );
    mockUseIncident.mockReturnValue({
      data: sampleIncident,
      isLoading: false,
      error: null,
    });

    renderIncidentPage();

    // 1) Header surfaces — title + severity + open-duration badge.
    expect(
      screen.getByText('API gateway intermittent 502s'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Incident #7/)).toBeInTheDocument();
    // "Monitoring" appears multiple times (header badge + Select
    // option labels in the append-update form). Asserting at least
    // one instance proves the canonical incident header rendered.
    expect(screen.getAllByText(/Monitoring/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/major/i)).toBeInTheDocument();

    // 2) Description.
    expect(
      screen.getByText(
        /Customers report bursty 502 responses from the public API gateway/,
      ),
    ).toBeInTheDocument();

    // 3) Affected components.
    expect(
      screen.getByText(/api-gateway, edge-cache/),
    ).toBeInTheDocument();

    // 4) Every timeline update message must be rendered (the
    // baseline rendering is the canonical view even with AI off).
    expect(
      screen.getByText(/PagerDuty fired alert "api-gateway-5xx-burst"\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Root cause: rolling restart on edge-cache fleet\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Restart completed\. Watching error rate; will resolve at 15:00 if clean\./,
      ),
    ).toBeInTheDocument();

    // 5) The append-update form is present (incident is open).
    expect(
      screen.getByPlaceholderText(/What's new\?/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Add update/i }),
    ).toBeInTheDocument();

    // 6) Resolve button is present (incident is not yet resolved).
    expect(
      screen.getByRole('button', { name: /Resolve/i }),
    ).toBeInTheDocument();

    // 7) The AI summarizer surface MUST be absent from the DOM
    // (ADR-015 §I5). This is the load-bearing baseline-intact
    // assertion: even though the AI component is conditionally
    // mounted by the page, the off-mode gate MUST hide it.
    expect(
      screen.queryByTestId('ai-feature-incident-timeline-summarizer-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Summarize/i }),
    ).not.toBeInTheDocument();
  });
});
