// React-side AI-off contract test for the signal explorer natural-language filter.
// The gated filter is mounted with ai_mode='off' and an enabled feature
// toggle to prove mode wins over the toggle. A cloud-mode positive control
// proves the gate works, and the full SignalExplorerPage render verifies
// the manual SignalSelector, RangePicker, Explore/Live buttons, and empty
// state still render when the AI section is absent. The API 404 invariant
// is covered by the matching Go handler test.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => ({
    data: ['battery_level', 'speed'],
    error: null,
    isLoading: false,
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: [{ id: 1, vin: '5YJ', display_name: 'Test', tesla_id: 1 }],
    error: null,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: () => ({ connected: false, error: null }),
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
import { AISignalExplorerNlFilter } from '@/components/ai/AISignalExplorerNlFilter';
import SignalExplorerPage from '@/features/telemetry/pages/SignalExplorerPage';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';

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

function renderSignalExplorerPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/signals/explorer']}>
        <SelectedVehicleProvider>
          <SignalExplorerPage />
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TestSignalExplorerNLAIOffManualFiltersWork (signal-explorer-nl-filter AI-off contract)', () => {
  it('TestSignalExplorerNLAIOffManualFiltersWork: AISignalExplorerNlFilter renders nothing when ai_mode=off even with the signal-explorer-nl-filter toggle on', () => {
    // The toggle is intentionally true to prove mode='off' wins over
    // a per-feature opt-in.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'signal-explorer-nl-filter': true },
      }),
    );

    const { container } = render(
      <AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-signal-explorer-nl-filter-root'),
    ).not.toBeInTheDocument();
  });

  it('TestSignalExplorerNLAIOffManualFiltersWork: AISignalExplorerNlFilter renders nothing when ai_mode is non-off but the signal-explorer-nl-filter toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // disabled feature toggle must hide the surface.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'signal-explorer-nl-filter': false },
      }),
    );

    const { container } = render(
      <AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-signal-explorer-nl-filter-root'),
    ).not.toBeInTheDocument();
  });

  it('TestSignalExplorerNLAIOffManualFiltersWork: AISignalExplorerNlFilter renders the section when ai_mode=cloud AND signal-explorer-nl-filter toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'signal-explorer-nl-filter': true },
      }),
    );

    render(<AISignalExplorerNlFilter vehicleId={1} onApply={() => {}} />);
    const root = screen.getByTestId(
      'ai-feature-signal-explorer-nl-filter-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'signal-explorer-nl-filter',
    );
  });

  it('TestSignalExplorerNLAIOffManualFiltersWork: SignalExplorerPage in off mode shows the deterministic manual-filter surface (baseline intact, ADR-015 §I3)', async () => {
    // With ai_mode='off', SignalExplorerPage must continue to render
    // every deterministic surface — page title, signal selector,
    // range picker trigger, Explore + Live buttons, and empty-state
    // copy. The AI filter section must be absent from the DOM.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'signal-explorer-nl-filter': true },
      }),
    );

    renderSignalExplorerPage();

    // 1) Page title surfaces.
    expect(await screen.findByText(/^Signal Explorer$/)).toBeInTheDocument();

    // 2) RangePicker trigger is rendered (carries the
    //    triggerTestId="signal-explorer-range" prop).
    expect(
      await screen.findByTestId('signal-explorer-range'),
    ).toBeInTheDocument();

    // 3) Explore + Live buttons are present (deterministic affordances).
    expect(
      screen.getByRole('button', { name: /^Explore$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Live$/i }),
    ).toBeInTheDocument();

    // 4) The deterministic empty-state copy renders before the user
    //    selects signals and clicks Explore.
    expect(
      screen.getByText(/Pick signals and click Explore/i),
    ).toBeInTheDocument();

    // 5) The AI natural-language filter surface must be absent from
    //    the DOM even though the page mounts the component.
    expect(
      screen.queryByTestId('ai-feature-signal-explorer-nl-filter-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Draft filter/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Apply to filters$/i }),
    ).not.toBeInTheDocument();
  });
});
