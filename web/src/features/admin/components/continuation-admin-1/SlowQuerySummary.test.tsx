import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { SlowQuerySummary } from './SlowQuerySummary';
import { getFormatterPreferences, setGlobalPrecision, setGlobalLocale, fmtCompact } from '@/lib/numberFormat';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(options?.[key] ?? `{{${key}}}`)),
  i18n: { language: 'en' },
}) }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { ...getFormatterPreferences(), duration: 'h',
    distance: 'mi', speed: 'mph', energy: 'kWh', power: 'kW', temperature: '°F', pressure: 'psi' },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
const original = getFormatterPreferences();
afterEach(() => { cleanup(); setGlobalPrecision(original.precision); setGlobalLocale(original.locale); });
const props = {
  count: 3, totals: { calls: 1255, totalMs: 7000, maxMean: 40, maxPeak: 1500, cacheRatio: 76.6666666667 },
  limit: 25, metricLabel: 'Mean time', known: true, loading: false,
  error: null, onRetry: vi.fn(),
};
const values = () => [...screen.getByTestId('slow-queries-summary').querySelectorAll('[data-operational-value]')]
  .map(node => node.textContent);

describe('SlowQuerySummary canonical preservation', () => {
  it('retains numeric durations, ms/s promotion and source preferences without changing raw totals', () => {
    setGlobalPrecision(2);
    setGlobalLocale('en-US');
    render(<SlowQuerySummary {...props} />);
    expect(values()).toEqual(['3', '1,255', '7.00 s', '40.00 ms', '1.50 s', '76.67%']);
    expect(screen.getByTestId('slow-queries-summary').querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    act(() => { setGlobalPrecision(3); setGlobalLocale('de-DE'); });
    expect(values()).toEqual(['3', '1.255', '7,000 s', '40,000 ms', '1,500 s', '76,667%']);
    expect(props.totals.totalMs).toBe(7000);
    expect(props.totals.maxMean).toBe(40);
  });

  it('keeps unknown source values missing but measured-empty counts and times zero', () => {
    setGlobalPrecision(2);
    setGlobalLocale('en-US');
    const { rerender } = render(<SlowQuerySummary {...props} known={false} />);
    expect(screen.getByTestId('slow-queries-summary').querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    rerender(<SlowQuerySummary {...props} count={0}
      totals={{ calls: 0, totalMs: 0, maxMean: 0, maxPeak: 0, cacheRatio: null }} />);
    expect(values()).toEqual(['0', '0', '0.00 ms', '0.00 ms', '0.00 ms', '—']);
  });

  it('preserves the exact one-second promotion boundary and source count compactness', () => {
    setGlobalPrecision(2);
    setGlobalLocale('en-US');
    render(<SlowQuerySummary {...props}
      totals={{ calls: 12500, totalMs: 999, maxMean: 1000, maxPeak: 1001, cacheRatio: 0 }} />);
    expect(values().slice(2)).toEqual(['999.00 ms', '1.00 s', '1.00 s', '0.00%']);
    expect(screen.getByTestId('slow-queries-summary').querySelector('[data-operational-metric="cache-hit-ratio"]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(values()[1]).toBe(fmtCompact(12500));
  });

  it('opens the actual Review details drawer with every scalar and source caption retained', () => {
    setGlobalPrecision(2);
    setGlobalLocale('en-US');
    render(<SlowQuerySummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Query performance summary details' });
    expect(within(drawer).getByText('Queries analyzed')).toBeInTheDocument();
    expect(within(drawer).getByText('7.00 s')).toBeInTheDocument();
    expect(within(drawer).getByText('40.00 ms')).toBeInTheDocument();
    expect(within(drawer).getByText('1.50 s')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Shared-buffer hits').length).toBeGreaterThan(0);
  });
});
