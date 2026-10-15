import type { ComponentProps, PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bar, ComposedChart, Line } from '@/components/charts';
import type { ModeTheme } from '@/components/ui/ThemeProvider';
import { themePresets } from '@/components/ui/themePresets';
import { ToastProvider } from '@/components/feedback';
import { CHART_COLORS_CB_SAFE, CHART_COLORS_NEON } from '@/lib/colors';
import type { MonthlyRecoveryChartRow } from '../regen-efficiency';

const h = vi.hoisted(() => ({
  settings: Object.freeze<{ chart_palette: string }>({ chart_palette: 'cb_safe' }),
  mode: null as ModeTheme | null,
  chart: undefined as ComponentProps<typeof ComposedChart> | undefined,
  bar: undefined as ComponentProps<typeof Bar> | undefined,
  line: undefined as ComponentProps<typeof Line> | undefined,
}));

vi.mock('@/api/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useSettings')>(),
  useSettings: () => ({ data: h.settings }),
}));
vi.mock('@/components/ui/ThemeProvider', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui/ThemeProvider')>();
  return {
    ...actual,
    useTheme: () => {
      // Bare renders have no ThemeProvider; fall back to the default dark Signal Blue theme.
      let context: ReturnType<typeof actual.useTheme>;
      try {
        context = actual.useTheme();
      } catch {
        context = {
          theme: { id: 'neon-cyan', name: 'Signal Blue', primary: '#3b82f6', primaryRGB: '59, 130, 246', accent: '#06b6d4', accentRGB: '6, 182, 212' },
          mode: { id: 'dark', name: 'Dark', colorScheme: 'dark' },
        } as unknown as ReturnType<typeof actual.useTheme>;
      }
      return { ...context, mode: h.mode ?? context.mode };
    },
  };
});
// jsdom has no chart layout; keep the real frame, palette and URL visibility owner.
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: PropsWithChildren) => <>{children}</>,
  ComposedChart: (props: ComponentProps<typeof ComposedChart>) => {
    h.chart = props;
    return <>{props.children}</>;
  },
  Bar: (props: ComponentProps<typeof Bar>) => { h.bar = props; return null; },
  Line: (props: ComponentProps<typeof Line>) => { h.line = props; return null; },
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ChartLegend: () => null,
}));
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null }, exporting: false,
    exportPNG: vi.fn(), exportSVG: vi.fn(), copyToClipboard: vi.fn(),
  }),
}));

import { MonthlyRecoveryChart } from './MonthlyRecoveryChart';

const rows: MonthlyRecoveryChartRow[] = [
  { month: '2026-01', recoveredEnergy: 2, driveEnergy: 8, recoveryRatio: 25, eligible: 2, returned: 3 },
  { month: '2026-02', recoveredEnergy: null, driveEnergy: null, recoveryRatio: null, eligible: 0, returned: 1 },
  { month: '2026-03', recoveredEnergy: 0, driveEnergy: 4, recoveryRatio: 0, eligible: 1, returned: 1 },
];
const props: ComponentProps<typeof MonthlyRecoveryChart> = {
  rows, hasData: true,
  state: { isLoading: false, isResolved: true, error: null, onRetry: vi.fn() },
  energySeries: 'Measured recovered energy', ratioSeries: 'Energy-weighted recovery share',
  energyUnit: 'kWh', isEnergyHidden: false, isRatioHidden: false,
};
const savedSearch = '?hidden_monthly-recovery=recoveredEnergy&hidden_regen-monthly-recovery=recoveryRatio';

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function mount(overrides: Partial<typeof props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}><ToastProvider>
      <MemoryRouter initialEntries={[`/driving/regen${savedSearch}`]}>
        {children}<LocationProbe />
      </MemoryRouter>
    </ToastProvider></QueryClientProvider>;
  }
  return render(<MonthlyRecoveryChart {...props} {...overrides} />, { wrapper: Wrapper });
}

beforeEach(() => {
  h.settings = Object.freeze({ chart_palette: 'cb_safe' });
  h.mode = themePresets.find(mode => mode.id === 'dark') ?? null;
  h.chart = undefined;
  h.bar = undefined;
  h.line = undefined;
});

describe('monthly recovery palette adoption', () => {
  it('reacts to saved palette and light-mode changes without rewriting preferences or identities', () => {
    const view = mount({ isRatioHidden: true });
    expect(h.bar?.fill).toBe(CHART_COLORS_CB_SAFE[1]);
    expect(h.line?.stroke).toBe(CHART_COLORS_CB_SAFE[5]);
    h.settings = Object.freeze({ chart_palette: 'neon' });
    view.rerender(<MonthlyRecoveryChart {...props} isRatioHidden />);
    expect(h.bar?.fill).toBe(CHART_COLORS_NEON[1]);
    expect(h.line?.stroke).toBe(CHART_COLORS_NEON[5]);

    h.mode = themePresets.find(mode => mode.id === 'solarized-light') ?? null;
    expect(h.mode).not.toBeNull();
    view.rerender(<MonthlyRecoveryChart {...props} isRatioHidden
      energySeries="Recovered energy translated" ratioSeries="Recovery share translated" />);
    expect(h.bar?.fill).not.toBe(CHART_COLORS_NEON[1]);
    expect(h.line?.stroke).not.toBe(CHART_COLORS_NEON[5]);
    expect(h.bar?.dataKey).toBe('recoveredEnergy');
    expect(h.line?.dataKey).toBe('recoveryRatio');
    expect(h.bar?.hide).toBe(true);
    expect(h.line?.hide).toBe(true);
    expect(h.chart?.data).toBe(rows);
    expect(screen.getByTestId('location')).toHaveTextContent(savedSearch);
    expect(h.settings).toEqual({ chart_palette: 'neon' });
  });

  it('preserves populated buckets, zero values, missing gaps and accessible unit formatting', () => {
    const view = mount();
    expect(h.chart?.data).toBe(rows);
    expect(h.line?.connectNulls).toBe(false);
    expect(h.line?.hide).toBe(false);
    expect(screen.getByText('2.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();
    for (const row of rows) expect(screen.getByText(row.month)).toBeInTheDocument();
    const converted = rows.map(row => ({
      ...row, recoveredEnergy: row.recoveredEnergy == null ? null : row.recoveredEnergy * 1_000,
    }));
    view.rerender(<MonthlyRecoveryChart {...props} rows={converted} energyUnit="Wh" />);
    expect(h.chart?.data).toBe(converted);
    expect(screen.getByText('2,000.00 Wh')).toBeInTheDocument();
    expect(h.bar?.dataKey).toBe('recoveredEnergy');
    expect(screen.getByTestId('location')).toHaveTextContent(savedSearch);
  });
});
