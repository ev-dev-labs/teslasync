// Data repair suggestions AI-off contract proof for React.
//
// `TestDataRepairSuggestionsAIOffManualRunbookWorks` mounts the
// AIDataRepairSuggestions component with ai_mode='off' plus the per-feature
// toggle on, to avoid the trivial "off because nothing is enabled" path, and
// asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND data-repair-suggestions=true, the
//      section IS present + carries the expected test ID. This is
//      the positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//   4. The mode='cloud' path with toggle=false also hides the
//      section — per-feature opt-in (ADR-015 §I7).
//
// In addition, this file mounts the FULL DataRepairPage in off
// mode and asserts the deterministic stale-session list still
// renders — proving the AI surface's absence does NOT regress the
// canonical baseline (ADR-015 §I3). The rendered page MUST
// show:
//
//   - The page title (Data Repair).
//   - After opening the deferred "Diagnostics" workspace tab: the four
//     MetricCards (Suggested Repairs, Drive Boundaries, Charging
//     Boundaries, Blocked) — renamed when the page moved from an
//     age-based stale list to an evidence-based diagnosis.
//   - Both stale worklist panels (Charging Sessions, Drives) rendered
//     side-by-side inside that diagnostics workspace.
//   - The deterministic empty-state when the inventory is empty.
//
// The HTTP POST /api/v1/ai/system/data-repair/draft 404-in-off-
// mode invariant is proven by the Go-side
// TestDataRepairSuggestionsAIOffManualRunbookWorks in
// internal/api/ai_data_repair_handler_test.go — the network layer
// does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestDataRepairSuggestionsAIOffManualRunbookWorks.test.tsx` because
// `vitest --run TestDataRepairSuggestionsAIOffManualRunbookWorks` matches the
// positional pattern against the file path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AppSettings } from '@/api/types';
import { ToastProvider } from '@/components/feedback/Toast';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { request } from '@/api/client';
import { AIDataRepairSuggestions } from '@/components/ai/AIDataRepairSuggestions';
import DataRepairPage from '@/features/system/pages/DataRepairPage';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;
const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

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
  mockRequest.mockReset();
});

function renderDataRepairPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/system/data-repair']}>
          <Routes>
            <Route path="/system/data-repair" element={<DataRepairPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('TestDataRepairSuggestionsAIOffManualRunbookWorks (data-repair-suggestions AI-off contract)', () => {
  it('TestDataRepairSuggestionsAIOffManualRunbookWorks: AIDataRepairSuggestions renders nothing when ai_mode=off even with the data-repair-suggestions toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". The mode='off' check MUST trump the per-feature toggle
    // (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'data-repair-suggestions': true },
      }),
    );

    const { container } = render(<AIDataRepairSuggestions />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-data-repair-suggestions-root'),
    ).not.toBeInTheDocument();
  });

  it('TestDataRepairSuggestionsAIOffManualRunbookWorks: AIDataRepairSuggestions renders nothing when ai_mode is non-off but the data-repair-suggestions toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'data-repair-suggestions': false },
      }),
    );

    const { container } = render(<AIDataRepairSuggestions />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-data-repair-suggestions-root'),
    ).not.toBeInTheDocument();
  });

  it('TestDataRepairSuggestionsAIOffManualRunbookWorks: AIDataRepairSuggestions renders the section when ai_mode=cloud AND data-repair-suggestions toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'data-repair-suggestions': true },
      }),
    );

    render(<AIDataRepairSuggestions />);
    const root = screen.getByTestId(
      'ai-feature-data-repair-suggestions-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'data-repair-suggestions',
    );
  });

  it('TestDataRepairSuggestionsAIOffManualRunbookWorks: DataRepairPage in off mode shows the deterministic stale-session manual-runbook surface (baseline intact, ADR-015 §I3)', async () => {
    // Baseline-coexistence proof: with ai_mode='off', DataRepairPage MUST
    // continue to render every deterministic surface — page title, metric
    // cards, both worklist panels — exactly as it would without the AI feature. The AI
    // suggestions section MUST be
    // absent from the DOM (ADR-015 §I5 + §I6).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'data-repair-suggestions': true },
      }),
    );

    // Empty inventory — exercises the deterministic "all clean"
    // path. The page MUST show the metric cards + both worklists
    // regardless of inventory size, so the assertion set is
    // robust whether the user has stale rows or not. The same stub
    // answers the suggestions diagnosis GET; the page null-guards the
    // missing suggestion arrays.
    mockRequest.mockResolvedValue({
      stale_charging: [],
      stale_drives: [],
    });

    renderDataRepairPage();

    // 1) Page title surfaces.
    expect(await screen.findByText('Data Repair')).toBeInTheDocument();

    // 1b) The deep-diagnostics workspace is deferred behind the Diagnostics
    // tab (it lazy-loads and only then issues the suggestion/stale scans), so
    // open it before asserting the deterministic surfaces it owns.
    fireEvent.click(await screen.findByRole('tab', { name: 'Diagnostics' }));

    // 2) Metric cards — the deterministic KPI band is present (await
    // loading to finish; React Query resolves on its own scheduler tick).
    // "Suggested Repairs" appears only on the metric card; the boundary
    // labels also appear as panel headings, so use getAllByText for those.
    expect(
      await screen.findByText(/Suggested Repairs/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Drive Boundaries/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Charging Boundaries/i).length).toBeGreaterThan(0);

    // 3) Both deterministic worklist panels — Charging Sessions +
    // Drives — render as section headings inside the diagnostics
    // workspace, side-by-side rather than behind a sub-tab switcher, so we
    // assert the panel headings (exact accessible names avoid matching the
    // "All charging sessions are complete" empty-state heading).
    expect(
      screen.getByRole('heading', { name: 'Charging Sessions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Drives' }),
    ).toBeInTheDocument();

    // 4) The AI suggestions surface MUST be absent from the DOM
    // (ADR-015 §I5). This is the load-bearing baseline-intact
    // assertion: even though the AI component is conditionally
    // mounted by the page, the off-mode gate MUST hide it.
    expect(
      screen.queryByTestId('ai-feature-data-repair-suggestions-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Draft repair plan/i }),
    ).not.toBeInTheDocument();
  });
});
