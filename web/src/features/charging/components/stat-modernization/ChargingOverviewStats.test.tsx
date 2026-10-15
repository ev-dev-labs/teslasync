import { act, cleanup, fireEvent, render as renderWithTestingLibrary, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Button } from '@/components/ui';
import { fmtCompact, fmtNumber, getFormatterPreferences, setGlobalPrecision } from '@/lib/numberFormat';
import { formatDurationMinutes } from '@/lib/dateFormat';
import { ChargingOverviewStats } from './ChargingOverviewStats';
import { chargingStats, priorChargingStats } from './fixtures.test-utils';

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useUnits', async () => {
  const { useSyncExternalStore } = await import('react');
  const { getFormatterPreferences, subscribeFormatterPreferences } = await import('@/lib/numberFormat');
  return { useUnits: () => {
    const { locale, precision } = useSyncExternalStore(subscribeFormatterPreferences, getFormatterPreferences);
    return { unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: 'Wh', duration: 'h', power: 'W', locale, precision } };
  } };
});
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/components/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui')>(),
  Tooltip: ({ content, children }: { content: ReactNode; children: ReactNode }) =>
    <span title={String(content)}>{children}</span>,
}));
const initial = getFormatterPreferences().precision;
const period = {
  kind: 'analysis', label: 'Synthetic selected local range', start: '2026-01-01T00:00:00Z',
  endExclusive: '2026-02-01T00:00:00Z', timezone: 'UTC', completeness: 'unknown',
  provenance: 'Only up to 500 returned sessions; no complete-window claim',
} as const;
const props = {
  stats: chargingStats, priorStats: priorChargingStats, priorHasData: true, hasRecordedCosts: true,
  period, priorLabel: 'vs prior returned source', secondary: '2 home · 0 SC · 1 DC; 1 free; grade A; start 02:00',
  footer: null, loading: false, retained: false,
};
function render(ui: ReactElement) {
  // Keep the real StatusAwareError and its navigation/retry behavior.
  return renderWithTestingLibrary(ui, {
    wrapper: ({ children }) => <MemoryRouter initialEntries={['/charging']}>{children}</MemoryRouter>,
  });
}
function tile(container: HTMLElement, id: string) {
  const result = container.querySelector(`[data-operational-metric^="${id}:"]`);
  expect(result).not.toBeNull();
  return result!;
}
beforeEach(() => { setGlobalPrecision(2); });
afterEach(() => { cleanup(); setGlobalPrecision(initial); });

describe('live charging overview source preservation', () => {
  it('renders all six old aggregates, distinct rate/mean-power labels, precisions and secondary facts', () => {
    const before = JSON.stringify(chargingStats);
    const { container } = render(<ChargingOverviewStats {...props} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(tile(container, 'charge.sessions').querySelector('[data-operational-value]')).toHaveTextContent(fmtCompact(chargingStats.count));
    expect(tile(container, 'charge.energyAdded').querySelector('[data-operational-value]')).toHaveTextContent(fmtCompact(chargingStats.totalEnergyWh / 1000, 10000));
    expect(tile(container, 'charge.recordedCost').querySelector('[data-operational-value]')).toHaveTextContent(`$${fmtNumber(chargingStats.totalCost)}`);
    expect(tile(container, 'charge.overallRate').querySelector('[data-operational-value]')).toHaveTextContent(fmtNumber(chargingStats.avgRateKw));
    expect(tile(container, 'charge.meanSessionPower').querySelector('[data-operational-value]')).toHaveTextContent(fmtNumber(chargingStats.avgPowerW / 1000));
    expect(tile(container, 'charge.avgDuration').querySelector('[data-operational-value]')).toHaveTextContent(formatDurationMinutes(chargingStats.avgDurationMin));
    expect(screen.getByText('Overall charging rate')).toBeInTheDocument();
    expect(screen.getByText('Mean session power')).toBeInTheDocument();
    expect(screen.getByText('Avg rate (kW)')).toBeInTheDocument();
    expect(screen.getByText('Avg power (kW)')).toBeInTheDocument();
    expect(screen.getByText(props.secondary)).toBeInTheDocument();
    expect(JSON.stringify(chargingStats)).toBe(before);
    expect(container.querySelector('[data-testid="charging-overview"] [role="list"]')).toHaveClass('sm:grid-cols-2', 'md:grid-cols-3');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = within(screen.getByRole('dialog', { name: 'Overview details' }));
    const limitations = details.getByText('Limitations').parentElement!;
    expect(within(limitations).getByText(period.provenance)).toBeInTheDocument();
  });
  it('composes the original Delta operands/precision/direction and prior tooltip without computing a new delta', () => {
    const { container } = render(<ChargingOverviewStats {...props} />);
    expect(tile(container, 'charge.sessions').querySelector('[title]')).toHaveTextContent('50.00%');
    expect(tile(container, 'charge.overallRate').querySelector('[title]')).toHaveTextContent('21.25%');
    expect(tile(container, 'charge.overallRate')).toHaveTextContent('Aggregate');
    expect(tile(container, 'charge.meanSessionPower').querySelector('[title]')).toHaveTextContent('8.13%');
    expect(tile(container, 'charge.overallRate').querySelector('[title]'))
      .toHaveAttribute('title', `${fmtNumber(chargingStats.avgRateKw)} vs ${fmtNumber(priorChargingStats.avgRateKw)}`);
    expect(tile(container, 'charge.overallRate').querySelector('[title]')?.className)
      .toContain('text-[var(--text-secondary)]');
  });
  it('keeps the original previous-zero percent em dash rather than fabricating Infinity or absolute change', () => {
    const priorZero = { ...priorChargingStats, count: 0, totalEnergyWh: 0, totalCost: 0,
      avgRateKw: 0, avgDurationMin: 0, avgPowerW: 0 };
    const { container } = render(<ChargingOverviewStats {...props} priorStats={priorZero} />);
    for (const item of container.querySelectorAll('[data-operational-metric] [title]')) {
      expect(item).toHaveTextContent('—');
      expect(item).not.toHaveTextContent(/Infinity|NaN/);
    }
  });
  it('omits unavailable prior comparisons, exposes missing/invalid values, never calls unknown costs free', () => {
    const { container } = render(<ChargingOverviewStats {...props} priorHasData={false}
      priorLabel="Prior range is outside the returned source"
      hasRecordedCosts={false} stats={{ ...chargingStats, avgRateKw: NaN, avgPowerW: null, avgDurationMin: null }} />);
    expect(container.querySelectorAll('[data-operational-metric] [title]')).toHaveLength(0);
    expect(tile(container, 'charge.overallRate')).toHaveAttribute('data-value-state', 'invalid');
    expect(tile(container, 'charge.meanSessionPower')).toHaveAttribute('data-value-state', 'missing');
    expect(tile(container, 'charge.recordedCost')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('No recorded session costs in the selected returned sessions.')).toBeInTheDocument();
    expect(screen.getByText('Prior range is outside the returned source')).toBeInTheDocument();
  });
  it('keeps meaningful zero cost, cached values on refresh, original ID and the anomaly action', () => {
    const action = vi.fn();
    const { container, rerender } = render(<ChargingOverviewStats {...props}
      stats={{ ...chargingStats, totalCost: 0 }} loading retained
      footer={<Button onClick={action}>Review anomalies</Button>} />);
    expect(tile(container, 'charge.recordedCost')).toHaveAttribute('data-value-state', 'value');
    expect(tile(container, 'charge.recordedCost').querySelector('[data-operational-value]')).toHaveTextContent('$0.00');
    expect(container.querySelector('#charging-overview')).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Review anomalies' }));
    expect(action).toHaveBeenCalledOnce();
    rerender(<ChargingOverviewStats {...props} loading />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });
  it('renders a real empty shell and updates selected numeric precision without changing compact/minute contracts', () => {
    const { container, rerender } = render(<ChargingOverviewStats {...props} />);
    act(() => { setGlobalPrecision(5); });
    expect(tile(container, 'charge.overallRate').querySelector('[data-operational-value]')).toHaveTextContent(fmtNumber(chargingStats.avgRateKw, 5));
    expect(tile(container, 'charge.avgDuration').querySelector('[data-operational-value]')).toHaveTextContent(formatDurationMinutes(chargingStats.avgDurationMin));
    rerender(<ChargingOverviewStats {...props} stats={{ ...chargingStats, count: 0 }} />);
    expect(container.querySelector('#charging-overview')).not.toBeNull();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(screen.getByText('No charging sessions in this range')).toBeInTheDocument();
  });
  it('keeps initial source failure actionable rather than labeling it a successful empty result', () => {
    const retry = vi.fn();
    const { container } = render(<ChargingOverviewStats {...props} stats={{ ...chargingStats, count: 0 }}
      error={new Error('Synthetic initial source failure')} onRetry={retry} />);
    expect(container.querySelector('#charging-overview')).not.toBeNull();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(screen.queryByText('No charging sessions in this range')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('retries a successful empty range without dropping secondary facts or inventing metrics', () => {
    const retry = vi.fn();
    const { container } = render(<ChargingOverviewStats {...props}
      stats={{ ...chargingStats, count: 0 }} onRetry={retry} />);
    expect(screen.getByText('No charging sessions in this range')).toBeInTheDocument();
    expect(screen.getByText(props.secondary)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
