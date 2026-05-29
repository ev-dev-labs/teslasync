// Natural-language Grafana panel.
//
// `TestNLGrafanaPanelAIOffManualEditorWorks` is the React-side AI-OFF
// contract proof. It mounts the
// AINLGrafanaPanel component with ai_mode='off' (plus the per-
// feature toggle on, to defeat the obvious "off because nothing
// is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND nl-grafana-panel=true, the
//      section IS present + carries the expected test ID. This is
//      the positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//   4. The mode='cloud' path with toggle=false also hides the
//      section — per-feature opt-in (ADR-015 §I7).
//
// In addition, this file mounts the FULL GrafanaPanelPage in
// off mode and asserts the deterministic manual JSON editor +
// curated catalog + Copy-to-clipboard button still render —
// proving the AI surface's absence does NOT regress the canonical
// baseline (ADR-015 §I3 + the prompt's explicit "baseline
// behaviour still works" gate). The rendered page MUST show:
//
//   - The page title (Grafana Panel Builder).
//   - The manual JSON editor textarea + Copy + Clear buttons.
//   - The curated panel-types catalog (timeseries, stat, ...).
//   - The curated datasource-types catalog (postgres,
//     prometheus).
//   - The curated table catalog (drives, charging_sessions,
//     vehicles, alerts, signal_log_view).
//
// The HTTP POST /api/v1/ai/power/grafana-panel/draft 404-in-off-mode
// invariant is proven by the Go-side
// TestNLGrafanaPanelAIOffManualEditorWorks in
// internal/api/ai_nl_grafana_panel_handler_test.go — the
// network layer does not exist in the React unit-test scope.
//
// File name MUST stay `TestNLGrafanaPanelAIOffManualEditorWorks.test.tsx`
// because `vitest --run TestNLGrafanaPanelAIOffManualEditorWorks`
// matches the positional pattern against the file path.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

// Keep framer-motion deterministic in jsdom — eager render with no
// IntersectionObserver dance.
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
import { AINLGrafanaPanel } from '@/components/ai/AINLGrafanaPanel';
import GrafanaPanelPage from '@/features/power-user/pages/GrafanaPanelPage';

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
      window.localStorage.removeItem('ai.grafanaPanel.draft');
    } catch {
      /* ignore */
    }
  }
});

function renderGrafanaPanelPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/power/grafana']}>
        <GrafanaPanelPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TestNLGrafanaPanelAIOffManualEditorWorks (nl-grafana-panel AI-off contract)', () => {
  it('TestNLGrafanaPanelAIOffManualEditorWorks: AINLGrafanaPanel renders nothing when ai_mode=off even with the nl-grafana-panel toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". The mode='off' check MUST trump the per-feature toggle
    // (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'nl-grafana-panel': true },
      }),
    );

    const { container } = render(
      <AINLGrafanaPanel onApply={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-nl-grafana-panel-root'),
    ).not.toBeInTheDocument();
  });

  it('TestNLGrafanaPanelAIOffManualEditorWorks: AINLGrafanaPanel renders nothing when ai_mode is non-off but the nl-grafana-panel toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-grafana-panel': false },
      }),
    );

    const { container } = render(
      <AINLGrafanaPanel onApply={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-nl-grafana-panel-root'),
    ).not.toBeInTheDocument();
  });

  it('TestNLGrafanaPanelAIOffManualEditorWorks: AINLGrafanaPanel renders the section when ai_mode=cloud AND nl-grafana-panel toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-grafana-panel': true },
      }),
    );

    render(<AINLGrafanaPanel onApply={() => {}} />);
    const root = screen.getByTestId('ai-feature-nl-grafana-panel-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'nl-grafana-panel');
  });

  it('TestNLGrafanaPanelAIOffManualEditorWorks: GrafanaPanelPage in off mode shows the deterministic manual JSON editor + curated catalog (baseline intact, ADR-015 §I3)', async () => {
    // The slice's load-bearing baseline-coexistence proof: with
    // ai_mode='off', the canonical GrafanaPanelPage MUST continue
    // to render every deterministic surface — page title, manual
    // JSON editor, Copy + Clear buttons, curated catalog tables —
    // exactly as it would without the AI feature ever existing.
    // The AI drafter section MUST be absent from the DOM
    // (ADR-015 §I5 + §I6).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'nl-grafana-panel': true },
      }),
    );

    renderGrafanaPanelPage();

    // 1) Page surfaces (the page-root marker is always present).
    expect(
      await screen.findByTestId('power-grafana-panel-builder-root'),
    ).toBeInTheDocument();

    // 2) Manual JSON editor textarea is rendered.
    expect(
      await screen.findByLabelText(/Grafana panel JSON editor/i),
    ).toBeInTheDocument();

    // 3) Copy + Clear buttons are present (deterministic
    //    affordances). Use unanchored regex per Helix UX
    //    addendum HX#3.
    expect(
      screen.getByRole('button', { name: /Copy to clipboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument();

    // 4) The curated panel-types catalog renders the canonical
    //    panel type names so the user can build a panel
    //    deterministically without consulting external docs.
    for (const panelType of [
      'timeseries',
      'stat',
      'gauge',
      'table',
      'barchart',
      'heatmap',
      'piechart',
      'logs',
    ]) {
      expect(screen.getByText(panelType)).toBeInTheDocument();
    }

    // 5) The curated datasource-types catalog renders the
    //    canonical UIDs for both whitelisted datasources.
    expect(screen.getByText(/uid=tesla-postgres/i)).toBeInTheDocument();
    expect(screen.getByText(/uid=tesla-prometheus/i)).toBeInTheDocument();

    // 6) The curated table catalog renders the same five tables
    //    nl-sql-playground exposes (single-source-of-truth).
    for (const tableName of [
      'drives',
      'charging_sessions',
      'vehicles',
      'alerts',
      'signal_log_view',
    ]) {
      expect(screen.getByText(tableName)).toBeInTheDocument();
    }

    // 7) The AI natural-language drafter surface MUST be absent
    //    from the DOM (ADR-015 §I5). This is the load-bearing
    //    baseline-intact assertion: even though the AI component
    //    is mounted by the page, the off-mode gate MUST hide it.
    expect(
      screen.queryByTestId('ai-feature-nl-grafana-panel-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Draft panel/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Apply to editor/i }),
    ).not.toBeInTheDocument();
  });
});
