/**
 * FleetCostKpis — fleet-total KPI band for the Vehicle Ingest Cost page.
 *
 * The band renders four backend totals plus two page-derived KPIs and owns its
 * own loading / error affordance. These tests pin the contract:
 *   - every KPI renders with its label, value, and subtitle;
 *   - integer counts (rows, DLQ failures, vehicles, avg) are formatted with
 *     `fmtInt` so they NEVER inherit the user's fractional display precision —
 *     regression guard for the "1,234,567.00" bug this file fixed (counts used
 *     to flow through `fmtNumber`, which honours the global 2-dp setting);
 *   - the DLQ card flips cyan → red only when failures > 0;
 *   - the loading branch shows six skeletons (role=status) and no data;
 *   - a background refetch (loading + cached totals) keeps showing data;
 *   - the error branch renders QueryError inside a panel, wires Retry, and
 *     takes precedence over loading — the section is never left blank;
 *   - undefined / individually-nullish totals coerce to 0 without hiding the
 *     region (avoids a divide-by-zero on the derived average, too).
 *
 * `react-i18next` is mocked to echo English fallbacks (with `{{days}}`
 * interpolation) and `useOnlineStatus` is pinned online so QueryError's copy is
 * deterministic (mirrors XRayBucketChart.test / LiveSectionState.test).
 * QueryError pulls in `useNavigate`, so renders are wrapped in a MemoryRouter.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { FleetCostKpis } from './FleetCostKpis';
import { ApiError } from '@/lib/resilience';
import { getGlobalPrecision, setGlobalPrecision } from '@/lib/numberFormat';
import type { VehicleCostTotals } from '@/types/admin-operator-confidence';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Keep QueryError's network branch deterministic: always "online" so a 5xx
// lands on the "Server error" copy rather than the offline variant.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

const TOTALS: VehicleCostTotals = {
  total_rows: 1234567,
  total_bytes_est: 2048,
  total_rate_per_minute_24h: 12.34,
  total_failures_24h: 0,
};

type Props = React.ComponentProps<typeof FleetCostKpis>;

function renderKpis(overrides: Partial<Props> = {}) {
  const props: Props = {
    totals: TOTALS,
    vehicleCount: 8,
    windowDays: 30,
    loading: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <FleetCostKpis {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

// Pin a *fractional* global precision so the tests prove integer counts are
// formatted with `fmtInt` (0 dp) regardless of the user's display setting.
let savedPrecision = 2;
beforeEach(() => {
  savedPrecision = getGlobalPrecision();
  setGlobalPrecision(3);
});
afterEach(() => {
  setGlobalPrecision(savedPrecision);
});

describe('FleetCostKpis', () => {
  describe('ready branch', () => {
    it('renders all six KPIs with labels, subtitles, and derived values', () => {
      renderKpis();

      // The band is an accessibly-named landmark region.
      expect(
        screen.getByRole('region', { name: 'Fleet ingest totals' }),
      ).toBeInTheDocument();

      // All six labels present.
      expect(screen.getByText('Total rows')).toBeInTheDocument();
      expect(screen.getByText('Total bytes (est.)')).toBeInTheDocument();
      expect(screen.getByText('Rate (rows/min, 24h)')).toBeInTheDocument();
      expect(screen.getByText('DLQ failures (24h)')).toBeInTheDocument();
      expect(screen.getByText('Vehicles tracked')).toBeInTheDocument();
      expect(screen.getByText('Avg rows / vehicle')).toBeInTheDocument();

      // Bytes formatted at the display boundary; rate keeps one decimal.
      expect(screen.getByText('2.0 KB')).toBeInTheDocument();
      expect(screen.getByText('12.3')).toBeInTheDocument();

      // Derived: avgRowsPerVehicle(1_234_567, 8) = 154_320.875 → "154,321".
      expect(screen.getByText('154,321')).toBeInTheDocument();

      // Vehicles-tracked comes straight from the prop.
      expect(screen.getByText('8')).toBeInTheDocument();

      // The window subtitle interpolates the day count.
      expect(screen.getByText('Window: 30d')).toBeInTheDocument();
    });

    it('formats integer counts with fmtInt, ignoring the fractional global precision', () => {
      // Global precision is 3 (set in beforeEach). Row + failure counts must
      // still render as bare integers — proving they use `fmtInt`, not the
      // precision-honouring `fmtNumber`.
      renderKpis({ totals: { ...TOTALS, total_failures_24h: 42 } });

      expect(screen.getByText('1,234,567')).toBeInTheDocument();
      expect(screen.queryByText('1,234,567.000')).not.toBeInTheDocument();

      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.queryByText('42.000')).not.toBeInTheDocument();
    });
  });

  describe('DLQ failure semantics', () => {
    it('paints the DLQ card red when failures > 0', () => {
      const { container } = renderKpis({ totals: { ...TOTALS, total_failures_24h: 3 } });

      expect(screen.getByText('3')).toBeInTheDocument();
      // Only the failures card resolves to the red semantic tone, so its
      // presence proves the `failures > 0 ? 'red' : 'green'` branch fired.
      expect(container.querySelector('[data-role="metric-icon"][data-color="red"]')).not.toBeNull();
    });

    it('keeps the DLQ card non-red when there are zero failures', () => {
      const { container } = renderKpis({ totals: { ...TOTALS, total_failures_24h: 0 } });

      expect(container.querySelector('[data-role="metric-icon"][data-color="red"]')).toBeNull();
    });
  });

  describe('loading branch', () => {
    it('renders six skeletons (role=status, aria-busy) and no KPI data before first load', () => {
      const { container } = renderKpis({ loading: true, totals: undefined });

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-busy', 'true');
      expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);

      // No data + no region while the first load is in flight.
      expect(screen.queryByText('Total rows')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Fleet ingest totals' }),
      ).not.toBeInTheDocument();
    });

    it('keeps showing cached data (not skeletons) during a background refetch', () => {
      const { container } = renderKpis({ loading: true, totals: TOTALS });

      // loading && totals → the band shows stale data instead of blanking.
      expect(container.querySelector('.animate-pulse')).toBeNull();
      expect(screen.getByText('Total rows')).toBeInTheDocument();
      expect(screen.getByText('1,234,567')).toBeInTheDocument();
    });
  });

  describe('error branch', () => {
    it('renders QueryError inside a panel and wires Retry to onRetry', () => {
      const onRetry = vi.fn();
      renderKpis({ error: new ApiError('boom', 500), onRetry });

      expect(screen.getByText('Server error')).toBeInTheDocument();

      // The KPI region is replaced by the error affordance (never both).
      expect(
        screen.queryByRole('region', { name: 'Fleet ingest totals' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Total rows')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows the error affordance ahead of the loading skeletons (error precedence)', () => {
      const { container } = renderKpis({
        error: new ApiError('boom', 500),
        loading: true,
        totals: undefined,
      });

      // Error is checked before loading — no skeletons, a real message instead.
      expect(container.querySelector('.animate-pulse')).toBeNull();
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });

  describe('null-safety', () => {
    it('coerces undefined totals to zeros without hiding the region', () => {
      renderKpis({ totals: undefined, vehicleCount: 0 });

      // Region still renders — never a blank panel.
      expect(
        screen.getByRole('region', { name: 'Fleet ingest totals' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Total rows')).toBeInTheDocument();

      // rows/failures/vehicles/avg → "0"; bytes → "0 B"; rate → "0.0".
      // Several cards read "0", so assert at least one plus the shaped values.
      expect(screen.getAllByText('0').length).toBeGreaterThan(0);
      expect(screen.getByText('0 B')).toBeInTheDocument();
      expect(screen.getByText('0.0')).toBeInTheDocument();
    });

    it('coerces individually-nullish total fields to 0', () => {
      const partial = {
        total_rows: null,
        total_bytes_est: null,
        total_rate_per_minute_24h: null,
        total_failures_24h: null,
      } as unknown as VehicleCostTotals;

      renderKpis({ totals: partial, vehicleCount: 4 });

      expect(screen.getByText('0 B')).toBeInTheDocument();
      expect(screen.getByText('0.0')).toBeInTheDocument();
      // avgRowsPerVehicle(0, 4) = 0; vehicles prop passes through verbatim.
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });
});
