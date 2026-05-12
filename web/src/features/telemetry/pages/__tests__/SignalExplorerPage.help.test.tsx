/**
 * Phase-45 / 09 — HelpTooltip adoption guard.
 *
 * Shallow-renders {@link SignalExplorerPage} to assert that the technical
 * "Signals" header and Live-mode toggle each surface a `<HelpTooltip>` —
 * the page is one of nine deeply-technical surfaces audited by
 * `web/scripts/audit-help-tooltip-coverage.mjs`. The deep tooltip
 * behaviour (focus, ARIA wiring, dismiss) is already exercised by
 * `HelpTooltip.test.tsx`; here we only enforce adoption.
 *
 * Heavy hooks are mocked so the page renders the controls in its initial
 * (no-data) state — `useQuery` is gated behind `enabled: exploreKey !==
 * null`, so no real fetch is triggered until "Explore" is clicked.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import '../../../../i18n';

import SignalExplorerPage from '../SignalExplorerPage';

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => ({ data: ['battery_level', 'speed'], error: null, isLoading: false }),
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

// Stub framer-motion so FadeIn renders eagerly (no IntersectionObserver
// dance in jsdom).
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const { children, ...rest } = props as { children?: React.ReactNode };
        return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/telemetry/signal-explorer']}>
        <SelectedVehicleProvider>
          <SignalExplorerPage />
        </SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SignalExplorerPage — HelpTooltip adoption', () => {
  it('renders a HelpTooltip explaining signal layers (L1/L2/log)', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /signal layers \(L1, L2, log\)/i }),
    ).toBeInTheDocument();
  });

  it('renders a HelpTooltip explaining live signal streaming', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /live signal streaming/i }),
    ).toBeInTheDocument();
  });

  it('exposes at least two HelpTooltip triggers in total', () => {
    renderPage();
    // All HelpTooltip triggers fall back to the "More info" aria-label
    // pattern (custom or default), which we match permissively here.
    const triggers = screen.getAllByRole('button', { name: /more info/i });
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });
});
