import { act, cleanup, fireEvent, render as renderWithTestingLibrary, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { settingsKeys } from '@/api/hooks/useSettings';
import type { BillVarianceReport } from '@/types/charging';
import {
  fmtNumber, getFormatterPreferences, setGlobalLocale, setGlobalPrecision,
} from '@/lib/numberFormat';
import {
  CostSummaryCards, LifetimeSummary, EnvironmentalImpact, SavingsCalculator,
  BillVarianceCard, TimeOfUseAnalysis, ChargerTypeBreakdown, ForecastDetails, CostForecastSection,
} from './index';
import {
  coreStats, lifetimeMetrics, gasComparison, bill, hourlyData, touInsights, forecastData,
} from './fixtures.test-utils';
import { DEFAULT_GAS_PRICE, DEFAULT_MPG, DEFAULT_ELECTRICITY_RATE } from '../cost-analysis/constants';

const state = vi.hoisted(() => ({
  gasUnit: 'gallon',
  symbol: '$',
  query: { data: undefined as BillVarianceReport | undefined, isLoading: false, error: null as unknown, refetch: vi.fn() },
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, arg?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const template = typeof arg === 'string' ? arg : String(arg?.defaultValue ?? key);
      const values = typeof arg === 'object' ? arg : options;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
    energy: 'Wh', duration: 'h', power: 'W' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: state.symbol }) }));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({
  settings: { gas_unit: state.gasUnit }, isMiles: true,
}) }));
vi.mock('@/api/hooks/useCharging', () => ({ useBillVariance: () => state.query }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('@/components/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui')>(),
  Tooltip: ({ content, children }: { content: ReactNode; children: ReactNode }) =>
    <span title={String(content)}>{children}</span>,
}));
vi.mock('@/components/charts', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const ChartRows = ({ children, data }: { children?: ReactNode; data?: unknown[] }) =>
    <div data-chart-rows={JSON.stringify(data ?? [])}>{children}</div>;
  const Series = ({ dataKey, connectNulls, hide, children }: {
    dataKey?: string; connectNulls?: boolean; hide?: boolean; children?: ReactNode;
  }) => <span data-series={dataKey} data-connect-nulls={String(connectNulls)} data-hide={String(hide)}>{children}</span>;
  return {
    ...actual, ...chartTestDoubles,
    ResponsiveContainer: Pass, PieChart: Pass, BarChart: ChartRows, ComposedChart: ChartRows,
    LineChart: ChartRows, Pie: ChartRows, Bar: Series, Line: Series, Area: Series,
    Cell: () => null, Tooltip: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null,
  };
});
const period = { kind: 'unknown', label: 'Synthetic selected query bounds',
  reason: 'Returned selected rows, up to 1000; not complete lifetime data' } as const;
const initial = getFormatterPreferences();
let queryClient: QueryClient;
function render(ui: ReactElement) {
  // Exercise real error navigation and useChartPalette -> API useSettings.
  // Seed settings locally; never issue network requests from this fixture.
  return renderWithTestingLibrary(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={['/cost-analysis']}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    ),
  });
}
beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(settingsKeys.settings, { chart_palette: 'cb_safe' });
  state.symbol = '$'; state.gasUnit = 'gallon';
  state.query.data = bill; state.query.error = null; state.query.isLoading = false;
  state.query.refetch.mockClear();
  setGlobalPrecision(2); setGlobalLocale('en-US');
});
afterEach(() => {
  cleanup(); queryClient.clear();
  setGlobalPrecision(initial.precision); setGlobalLocale(initial.locale);
});
function tile(container: HTMLElement, label: string): Element {
  const found = Array.from(container.querySelectorAll('[data-stat], [data-operational-metric]'))
    .find(item => item.querySelector('[data-stat-label], :scope > div:first-child > div:first-child')?.textContent === label);
  expect(found, `preserved stat label: ${label}`).toBeDefined();
  return found!;
}
function value(container: HTMLElement, label: string): string | null | undefined {
  return tile(container, label).querySelector('[data-stat-value], [data-operational-value]')?.textContent;
}
const summaryProps = { coreStats, gasPrice: 3.5, distanceUnit: 'mi', isMiles: true, period };
const savingsProps = {
  gasComparison, gasPrice: 3.5, mpg: 30, electricityRate: 0.13, distanceUnit: 'mi', period,
  onGasPriceChange: vi.fn(), onMpgChange: vi.fn(), onElectricityRateChange: vi.fn(),
};

describe('live cost stats preserve every original numeric/text/fact/action contract', () => {
  it('keeps six summary metrics and all six secondary facts with exact original explicit units', () => {
    const before = JSON.stringify(coreStats);
    const { container, rerender } = render(<CostSummaryCards {...summaryProps} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(value(container, 'Total Cost')).toBe(`$${fmtNumber(coreStats.totalCost)}`);
    expect(tile(container, 'Total Cost')).toHaveTextContent('7 sessions');
    expect(value(container, 'Avg $/kWh')).toBe(`$${fmtNumber(coreStats.avgCostPerKwh)}`);
    expect(tile(container, 'Avg $/kWh')).toHaveTextContent('blended rate');
    expect(value(container, 'Cost Per Mile')).toBe(`$${fmtNumber(coreStats.costPerDist)}`);
    expect(tile(container, 'Cost Per Mile')).toHaveTextContent('per mi');
    expect(value(container, 'Total Energy')).toBe(`${fmtNumber(coreStats.totalEnergy)} kWh`);
    expect(tile(container, 'Total Energy')).toHaveTextContent('kWh');
    expect(tile(container, 'Total Energy')).toHaveTextContent(`${fmtNumber(coreStats.gallonsEquiv)} gal equiv`);
    expect(tile(container, 'Gas Savings $')).toHaveTextContent(`vs $${fmtNumber(3.5)}/gal`);
    expect(value(container, 'Savings %')).toBe(`${fmtNumber(coreStats.savingsPercent)}%`);
    expect(tile(container, 'Savings %')).toHaveTextContent('vs gasoline');
    state.gasUnit = 'liter'; state.symbol = '€';
    rerender(<CostSummaryCards {...summaryProps} isMiles={false} distanceUnit="km" />);
    expect(value(container, 'Cost Per km')).toBe(`€${fmtNumber(coreStats.costPerDist)}`);
    expect(tile(container, 'Gas Savings $')).toHaveTextContent(`vs €${fmtNumber(3.5)}/L`);
    expect(JSON.stringify(coreStats)).toBe(before);
  });
  it('keeps summary skeleton count, real empty/reset action and cached readings on an actionable refresh error', () => {
    const reset = vi.fn(); const retry = vi.fn();
    const { container, rerender } = render(<CostSummaryCards {...summaryProps} coreStats={null} isLoading />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<CostSummaryCards {...summaryProps} coreStats={null} onResetRange={reset} />);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Reset date range' }));
    expect(reset).toHaveBeenCalledOnce();
    rerender(<CostSummaryCards {...summaryProps} error={new Error('Synthetic refresh error')} onRetry={retry} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(value(container, 'Total Cost')).toBe(`$${fmtNumber(coreStats.totalCost)}`);
    expect(screen.getByText('Retained source measurements')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<CostSummaryCards {...summaryProps} coreStats={null} error={new Error('Synthetic initial error')} onRetry={retry} />);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset date range' })).not.toBeInTheDocument();
  });
  it('exposes invalid/missing leaves and meaningful zero without rewriting upstream raw fields', () => {
    const malformed = Object.freeze({ ...coreStats, totalCost: NaN, totalEnergy: 0,
      savingsPercent: undefined as unknown as number });
    const { container } = render(<CostSummaryCards {...summaryProps} coreStats={malformed} />);
    expect(tile(container, 'Total Cost')).toHaveAttribute('data-value-state', 'invalid');
    expect(tile(container, 'Savings %')).toHaveAttribute('data-value-state', 'missing');
    expect(tile(container, 'Total Energy')).toHaveAttribute('data-value-state', 'value');
    expect(value(container, 'Total Energy')).toBe('0.00 kWh');
    expect(screen.getByText('Expected a finite numeric measurement')).toBeInTheDocument();
    expect(screen.getByText('No measurement supplied')).toBeInTheDocument();
    expect(Number.isNaN(malformed.totalCost)).toBe(true);
  });
  it('keeps all seven lifetime metrics, free-energy fact, numeric minutes and unknown bounded lifetime scope', () => {
    const { container } = render(<LifetimeSummary lifetimeMetrics={lifetimeMetrics} coreStats={coreStats} period={period} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(7);
    expect(container.querySelector('[data-operational-brief] [role="list"]')).toHaveClass('sm:grid-cols-2', 'md:grid-cols-3');
    expect(value(container, 'Total Spent')).toBe(`$${fmtNumber(coreStats.totalCost)}`);
    expect(value(container, 'Total Sessions')).toBe('7');
    expect(value(container, 'Avg Session Cost')).toBe(`$${fmtNumber(lifetimeMetrics.avgSessionCost)}`);
    expect(value(container, 'Avg Energy / Session')).toBe(`${fmtNumber(lifetimeMetrics.avgSessionEnergy)} kWh`);
    expect(value(container, 'Avg Duration')).toBe(`${fmtNumber(lifetimeMetrics.avgDuration)} min`);
    expect(tile(container, 'Avg Duration')).toHaveTextContent('min');
    expect(tile(container, 'Free Sessions')).toHaveTextContent(`(${fmtNumber(lifetimeMetrics.freeEnergy)} kWh)`);
    expect(screen.getAllByText(period.reason).length).toBeGreaterThan(0);
    expect(container.querySelector('[data-period-kind="alltime"]')).toBeNull();
  });
  it('keeps five impact metrics and the full repeated kg/tree explanation, without adding a currency prefix', () => {
    const { container } = render(<EnvironmentalImpact coreStats={coreStats} period={period} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    expect(value(container, 'kg CO₂ saved')).toBe(fmtNumber(coreStats.co2SavedKg));
    expect(value(container, 'tree-years equivalent')).toBe(fmtNumber(coreStats.treeEquiv));
    expect(value(container, 'gallons avoided')).toBe(fmtNumber(coreStats.gallonsEquiv));
    expect(value(container, 'metric tons CO₂')).toBe(fmtNumber(coreStats.co2SavedKg / 1000));
    expect(value(container, '$ saved total')).toBe(fmtNumber(coreStats.savings));
    expect(value(container, '$ saved total')).not.toContain('$');
    // Text contains nested numeric spans: getByText's own-text exact matcher
    // cannot identify one isolated prose fragment. Assert the ENTIRE sentence.
    const explanation = screen.getByText(
      /^By driving electric instead of a gas car, you have avoided the equivalent of/,
      { selector: 'span' },
    );
    expect(explanation.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `By driving electric instead of a gas car, you have avoided the equivalent of ${fmtNumber(coreStats.co2SavedKg)} kg of CO₂ emissions. That's the same as ${fmtNumber(coreStats.treeEquiv)} trees absorbing carbon for a full year.`,
    );
    expect(within(explanation).getByText(`${fmtNumber(coreStats.co2SavedKg)} kg`)).toBeInTheDocument();
    expect(within(explanation).getByText(fmtNumber(coreStats.treeEquiv))).toBeInTheDocument();
  });
  it('keeps calculator inputs/guards/reset callbacks, four metrics and all four comparison facts', () => {
    const price = vi.fn(); const mpg = vi.fn(); const rate = vi.fn();
    const { container, rerender } = render(<SavingsCalculator {...savingsProps}
      onGasPriceChange={price} onMpgChange={mpg} onElectricityRateChange={rate} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(value(container, 'Gas Cost (equivalent)')).toBe(`$${fmtNumber(gasComparison.gasCost)}`);
    expect(value(container, 'EV Cost (actual)')).toBe(`$${fmtNumber(gasComparison.actualCost)}`);
    expect(value(container, 'Total Savings')).toBe(`$${fmtNumber(gasComparison.savings)}`);
    expect(value(container, 'Monthly Savings')).toBe(`$${fmtNumber(gasComparison.monthlySavings)}`);
    expect(tile(container, 'Gas Cost (equivalent)')).toHaveTextContent(`$${fmtNumber(gasComparison.costPerMileGas)}/mi`);
    expect(tile(container, 'EV Cost (actual)')).toHaveTextContent(`$${fmtNumber(gasComparison.costPerMileEV)}/mi`);
    expect(tile(container, 'Monthly Savings')).toHaveTextContent(`~$${fmtNumber(gasComparison.yearlySavings)} / year`);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Gas Price ($/gal)' }), { target: { value: '4.25' } });
    expect(price).toHaveBeenLastCalledWith(4.25);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Defaults' }));
    expect(price).toHaveBeenLastCalledWith(DEFAULT_GAS_PRICE);
    expect(mpg).toHaveBeenLastCalledWith(DEFAULT_MPG);
    expect(rate).toHaveBeenLastCalledWith(DEFAULT_ELECTRICITY_RATE);
    rerender(<SavingsCalculator {...savingsProps} gasComparison={null}
      gasPrice={NaN} mpg={Infinity} electricityRate={-Infinity} isLoading />);
    expect(screen.getByRole('spinbutton', { name: 'Gas Price ($/gal)' })).toHaveValue(DEFAULT_GAS_PRICE);
    expect(screen.getByRole('spinbutton', { name: 'Gas Car MPG' })).toHaveValue(DEFAULT_MPG);
    expect(screen.getByRole('spinbutton', { name: 'Electricity Rate ($/kWh)' })).toHaveValue(DEFAULT_ELECTRICITY_RATE);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
  });
  it('keeps ToU text hours, numeric per-session costs, busiest count, percentage and hourly chart rows', () => {
    const { container } = render(<TimeOfUseAnalysis hourlyData={hourlyData} touInsights={touInsights} period={period} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(value(container, 'Cheapest Hour')).toBe('02:00');
    expect(tile(container, 'Cheapest Hour')).toHaveTextContent(`avg ${fmtNumber(touInsights.cheapest.avgCost)} / session`);
    expect(value(container, 'Priciest Hour')).toBe('16:00');
    expect(tile(container, 'Busiest Hour')).toHaveTextContent('3 sessions');
    expect(value(container, 'Off-Peak Charging')).toBe('75.00%');
    expect(screen.getByText('of sessions between 10 PM–6 AM')).toBeInTheDocument();
    expect(JSON.parse(container.querySelector('[data-chart-rows]')?.getAttribute('data-chart-rows') ?? '[]')).toEqual(hourlyData);
  });
  it('retries an empty savings comparison without resetting assumptions or inventing costs', () => {
    const retry = vi.fn();
    const price = vi.fn(); const mpg = vi.fn(); const rate = vi.fn();
    const { container } = render(<SavingsCalculator {...savingsProps} gasComparison={null}
      onRetry={retry} onGasPriceChange={price} onMpgChange={mpg} onElectricityRateChange={rate} />);
    expect(screen.getByText('Not enough data for comparison')).toBeInTheDocument();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Reset Defaults' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(price).not.toHaveBeenCalled();
    expect(mpg).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
  });
  it('retries empty hourly history and missing insights without dropping the loaded distribution', () => {
    const retry = vi.fn();
    const { container, rerender } = render(<TimeOfUseAnalysis hourlyData={[]}
      touInsights={null} onRetry={retry} period={period} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByText('Not enough data')).toBeInTheDocument();
    rerender(<TimeOfUseAnalysis hourlyData={hourlyData} touInsights={null} onRetry={retry} period={period} />);
    expect(screen.getByText('No insights available')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(JSON.parse(container.querySelector('[data-chart-rows]')?.getAttribute('data-chart-rows') ?? '[]')).toEqual(hourlyData);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(2);
  });
  it('keeps five category facts, true unclamped share and the original visual clamp/accessible chart', () => {
    const entry = Object.freeze({ name: 'Synthetic home', cost: 20, energy: 40, sessions: 2, color: '#123456' });
    const { container } = render(<ChargerTypeBreakdown data={[entry]} totalCost={10} period={period} />);
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(5);
    expect(value(container, 'Cost')).toBe('$20.00');
    expect(value(container, 'sessions')).toBe('2');
    expect(value(container, 'Energy (kWh)')).toBe('40.00');
    expect(value(container, 'Cost per kWh')).toBe('$0.50');
    expect(value(container, 'Share (%)')).toBe('200.00');
    expect(container.querySelector('[style*="width: 100%"]')).not.toBeNull();
    expect(entry.cost).toBe(20);
  });
  it('keeps signed bill operands/percentages, verdict/counts/explanation and independent unknown scope on refresh failure', () => {
    state.query.error = new Error('Synthetic bill refresh failure');
    const { container } = render(<BillVarianceCard vehicleId={7} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(value(container, 'Energy Δ')).toBe('-2.00 kWh');
    expect(tile(container, 'Energy Δ')).toHaveTextContent(`(${fmtNumber(bill.energy_delta_pct)}%)`);
    expect(value(container, 'Cost Δ')).toBe('$-1.25');
    expect(tile(container, 'Cost Δ')).toHaveTextContent(`(${fmtNumber(bill.cost_delta_pct)}%)`);
    expect(value(container, 'Cabinet loss')).toBe(`${fmtNumber(bill.cabinet_loss_pct)}%`);
    expect(value(container, 'Invoiced total')).toBe(`$${fmtNumber(bill.invoiced_cost)}`);
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(screen.getByText('3 measured · 2 invoiced DC sessions')).toBeInTheDocument();
    expect(screen.getByText(bill.explanation)).toBeInTheDocument();
    expect(screen.getAllByText(/Reconciliation is independent of the selected date range/).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(state.query.refetch).toHaveBeenCalledOnce();
  });
  it('keeps eight forecast detail metrics, both shares/rates, annual/lifetime/modelled operands and all valid insights', () => {
    const { container } = render(<ForecastDetails forecastData={forecastData} period={period} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(8);
    expect(value(container, 'Home')).toBe(`$${fmtNumber(forecastData.breakdown.home.avg_cost_per_kwh)}`);
    expect(value(container, 'Supercharger')).toBe(`$${fmtNumber(forecastData.breakdown.supercharger.avg_cost_per_kwh)}`);
    expect(value(container, 'Monthly Savings')).toBe(`$${fmtNumber(forecastData.gas_comparison.monthly_savings)}`);
    expect(value(container, 'Annual')).toBe(`$${fmtNumber(forecastData.gas_comparison.annual_savings)}`);
    expect(value(container, 'Lifetime')).toBe(`$${fmtNumber(forecastData.gas_comparison.lifetime_savings)}`);
    expect(value(container, 'Gas cost/mo')).toBe(`$${fmtNumber(forecastData.gas_comparison.gas_cost_per_month)}`);
    expect(value(container, 'EV cost/mo')).toBe(`$${fmtNumber(forecastData.gas_comparison.ev_cost_per_month)}`);
    expect(value(container, 'Avg km/mo')).toBe(`${fmtNumber(forecastData.gas_comparison.avg_km_per_month)} km`);
    expect(tile(container, 'Avg km/mo')).toHaveTextContent('km');
    expect(screen.getByText('Synthetic retained insight')).toBeInTheDocument();
    const shares = JSON.parse(container.querySelector('[data-chart-rows]')?.getAttribute('data-chart-rows') ?? '[]');
    expect(shares).toEqual([{ name: 'Home', value: 65 }, { name: 'Supercharger', value: 35 }]);
  });
  it('keeps partial forecast envelopes independent and missing monthly savings missing, not synthetic zero', () => {
    const partial = { ...forecastData, breakdown: undefined, insights: [],
      gas_comparison: { ...forecastData.gas_comparison, monthly_savings: undefined } } as unknown as typeof forecastData;
    const { container } = render(<ForecastDetails forecastData={partial} period={period} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(tile(container, 'Monthly Savings')).toHaveAttribute('data-value-state', 'missing');
    expect(value(container, 'Monthly Savings')).toBe('—');
    expect(screen.getByText('Breakdown will appear once charging data is available.')).toBeInTheDocument();
    expect(screen.getByText('Insights will appear as more data is collected.')).toBeInTheDocument();
  });
  it('keeps forecast history/projected bands, gaps, keys and independent scope while preserving cached slices on failure', () => {
    const retry = vi.fn();
    const { container } = render(<CostForecastSection forecastData={forecastData}
      error={new Error('Synthetic forecast refresh failure')} onRetry={retry} />);
    const chart = container.querySelector('[data-chart-rows]');
    const rows = JSON.parse(chart?.getAttribute('data-chart-rows') ?? '[]');
    expect(rows.slice(0, 3)).toEqual(forecastData.historical.map(h => ({ month: h.month, actual: h.cost })));
    expect(rows[3]).toEqual({ month: '2026-04', forecast: 16, ci_low: 12, ci_band: 8, ci_high: 20 });
    expect(rows[4]).toEqual({ month: '2026-05', forecast: 18 });
    expect(container.querySelector('[data-series="ci_band"]')).toHaveAttribute('data-connect-nulls', 'false');
    expect(container.querySelector('[data-series="actual"]')).toHaveAttribute('data-connect-nulls', 'false');
    expect(container.querySelector('[data-series="forecast"]')).toHaveAttribute('data-connect-nulls', 'false');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(8);
    expect(screen.getAllByText(/Forecast is independent of the selected date range/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('alert')).toHaveLength(5);
    const retries = screen.getAllByRole('button', { name: /Retry/i });
    expect(retries).toHaveLength(5);
    fireEvent.click(retries[0]);
    expect(retry).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(settingsKeys.settings)).toEqual({ chart_palette: 'cb_safe' });
    expect(queryClient.getQueryState(settingsKeys.settings)).toMatchObject({
      status: 'success', fetchStatus: 'idle',
    });
  });
  it('reacts to mounted precision/locale updates with the same engine and keeps explicit kWh/min contracts', () => {
    const { container } = render(<><CostSummaryCards {...summaryProps} />
      <LifetimeSummary lifetimeMetrics={lifetimeMetrics} coreStats={coreStats} period={period} /></>);
    act(() => { setGlobalPrecision(5); setGlobalLocale('fr-FR'); });
    expect(value(container, 'Total Cost')).toBe(`$${fmtNumber(coreStats.totalCost, 5, 'fr-FR')}`);
    expect(value(container, 'Avg Duration')).toBe(`${fmtNumber(lifetimeMetrics.avgDuration, 5, 'fr-FR')} min`);
    expect(tile(container, 'Avg Duration')).toHaveTextContent('min');
    expect(tile(container, 'Total Energy')).toHaveTextContent('kWh');
  });
});
