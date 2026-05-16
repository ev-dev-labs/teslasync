// Phase-50 / 0059 — PU3 Natural-language dashboard composer.
//
// `TestNLDashboardComposerAIOffManualComposerWorks` is the
// slice's load-bearing AI-OFF contract proof on the React
// side. It mounts the AINLDashboardComposer component with
// ai_mode='off' (plus the per-feature toggle on, to defeat
// the obvious "off because nothing is enabled" path) and
// asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND nl-dashboard-composer=true,
//      the section IS present + carries the expected test ID.
//      This is the positive control that proves the gate
//      actually works (otherwise the "absent in off mode"
//      assertion is trivially true).
//   4. The mode='cloud' path with toggle=false also hides the
//      section — per-feature opt-in (ADR-015 §I7).
//
// In addition, this file mounts the FULL DashboardsPage in
// off mode and asserts the deterministic manual JSON
// composer + curated panel catalog + Copy-to-clipboard
// button still render — proving the AI surface's absence
// does NOT regress the canonical baseline (ADR-015 §I3 +
// the prompt's explicit "baseline behaviour still works"
// gate). The rendered page MUST show:
//
//   - The page title (Dashboard Composer).
//   - The manual JSON editor textarea + Copy + Clear buttons.
//   - The curated panel catalog (all six curated panels).
//
// The HTTP POST /api/v1/ai/power/dashboard/draft
// 404-in-off-mode invariant is proven by the Go-side
// TestNLDashboardComposerAIOffManualComposerWorks in
// internal/api/ai_nl_dashboard_composer_handler_test.go —
// the network layer does not exist in the React unit-test
// scope.
//
// File name MUST stay
// `TestNLDashboardComposerAIOffManualComposerWorks.test.tsx`
// — the slice prompt's verification command runs
// `vitest --run TestNLDashboardComposerAIOffManualComposerWorks`,
// where the positional pattern is matched against the file
// PATH.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

// Keep framer-motion deterministic in jsdom — eager render
// with no IntersectionObserver dance.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        (props: Record<string, unknown>) => {
          const { children, ...rest } = props as { children?: React.ReactNode };
          return (
            <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>
              {children}
            </div>
          );
        },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

import { useSettings } from '@/hooks/useSettings';
import { AINLDashboardComposer } from '@/components/ai/AINLDashboardComposer';
import DashboardsPage from '@/features/power-user/pages/DashboardsPage';

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
  // Clear any persisted JSON between tests.
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('ai.dashboardComposer.draft');
    } catch {
      /* ignore */
    }
  }
});

function renderDashboardsPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/power/dashboards']}>
        <DashboardsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TestNLDashboardComposerAIOffManualComposerWorks (nl-dashboard-composer AI-off contract)', () => {
  it('TestNLDashboardComposerAIOffManualComposerWorks: AINLDashboardComposer renders nothing when ai_mode=off even with the nl-dashboard-composer toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature
    // flag is off". The mode='off' check MUST trump the
    // per-feature toggle (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'nl-dashboard-composer': true },
      }),
    );

    const { container } = render(
      <AINLDashboardComposer onApply={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-nl-dashboard-composer-root'),
    ).not.toBeInTheDocument();
  });

  it('TestNLDashboardComposerAIOffManualComposerWorks: AINLDashboardComposer renders nothing when ai_mode is non-off but the nl-dashboard-composer toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-dashboard-composer': false },
      }),
    );

    const { container } = render(
      <AINLDashboardComposer onApply={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-nl-dashboard-composer-root'),
    ).not.toBeInTheDocument();
  });

  it('TestNLDashboardComposerAIOffManualComposerWorks: AINLDashboardComposer renders the section when ai_mode=cloud AND nl-dashboard-composer toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above
    // are trivially true (they would pass even if the section
    // were permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-dashboard-composer': true },
      }),
    );

    render(<AINLDashboardComposer onApply={() => {}} />);
    const root = screen.getByTestId('ai-feature-nl-dashboard-composer-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'nl-dashboard-composer');
  });

  it('TestNLDashboardComposerAIOffManualComposerWorks: DashboardsPage in off mode shows the deterministic manual JSON composer + curated catalog (baseline intact, ADR-015 §I3)', async () => {
    // The slice's load-bearing baseline-coexistence proof:
    // with ai_mode='off', the canonical DashboardsPage MUST
    // continue to render every deterministic surface — page
    // title, manual JSON editor, Copy + Clear buttons,
    // curated catalog — exactly as it would without the AI
    // feature ever existing. The AI drafter section MUST be
    // absent from the DOM (ADR-015 §I5 + §I6).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'nl-dashboard-composer': true },
      }),
    );

    renderDashboardsPage();

    // 1) Page surfaces (the page-root marker is always
    //    present).
    expect(
      await screen.findByTestId('power-dashboards-composer-root'),
    ).toBeInTheDocument();

    // 2) Manual JSON editor textarea is rendered.
    expect(
      await screen.findByLabelText(/Dashboard JSON editor/i),
    ).toBeInTheDocument();

    // 3) Copy + Clear buttons are present (deterministic
    //    affordances). Use unanchored regex per Helix UX
    //    addendum HX#3.
    expect(
      screen.getByRole('button', { name: /Copy to clipboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument();

    // 4) The curated panel catalog renders all six canonical
    //    panel names so the user can compose a dashboard
    //    deterministically without consulting external docs.
    for (const panelName of [
      'drives_per_day_timeseries',
      'battery_soc_stat',
      'charging_sessions_table',
      'alerts_count_stat',
      'vehicles_table',
      'energy_used_per_day_barchart',
    ]) {
      expect(screen.getByText(panelName)).toBeInTheDocument();
    }

    // 5) The AI natural-language drafter surface MUST be
    //    absent from the DOM (ADR-015 §I5). This is the
    //    load-bearing baseline-intact assertion: even though
    //    the AI component is mounted by the page, the
    //    off-mode gate MUST hide it.
    expect(
      screen.queryByTestId('ai-feature-nl-dashboard-composer-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Draft dashboard/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Apply to editor/i }),
    ).not.toBeInTheDocument();
  });
});
