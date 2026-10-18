import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DiskForecastSummary } from './DiskForecastSummary';
import { getFormatterPreferences, setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';
import type { HypertableSize } from '@/types/admin-operator-confidence';

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
const GB = 1024 ** 3;
const MB = 1024 ** 2;
const largest: HypertableSize = {
  hypertable_name: 'complete_signal_log_history_identity', total_bytes: 3 * GB,
  uncompressed_bytes: 2 * GB, compressed_bytes: GB, growth_bytes_per_day: 100 * MB,
  chunk_count: 10, est_days_to_quota: 5, severity: 'critical',
};
const props = {
  totals: { total: 4.5 * GB, uncompressed: 3 * GB, compressed: 1.5 * GB, growth: 150 * MB },
  count: 3, largest, soonest: largest, known: true, loading: false, retained: false,
  error: null, onRetry: vi.fn(),
};
const values = () => [...screen.getByTestId('disk-forecast-summary').querySelectorAll('[data-operational-value]')]
  .map(node => node.textContent);

describe('DiskForecastSummary canonical preservation', () => {
  it('preserves binary sizes, byte/day growth, quota days, identities and precision/locale', () => {
    setGlobalPrecision(2);
    setGlobalLocale('en-US');
    render(<DiskForecastSummary {...props} />);
    expect(values()).toEqual(['4.50 GB', '3.00 GB', '1.50 GB', '150.00 MB/d', '3.00 GB', '5.00 d']);
    const strip = screen.getByTestId('disk-forecast-summary');
    expect(strip.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(strip.querySelector('[data-operational-metric="soonest-quota"]')).toHaveAttribute('data-value-state', 'value');
    // Compression basis and full identities moved from the face to the Review-details drawer.
    expect(strip).not.toHaveTextContent('Compressed chunks only; not a share of current disk usage.');
    expect(strip).toHaveTextContent('Before compression');
    expect(strip).toHaveTextContent('After compression');
    expect(strip).not.toHaveTextContent('% of total');
    expect(screen.queryByText(largest.hypertable_name)).not.toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Fleet disk summary details' });
    expect(within(drawer).getAllByText('Compressed chunks only; not a share of current disk usage.')).toHaveLength(2);
    expect(within(drawer).getAllByText(largest.hypertable_name)).toHaveLength(2);
    act(() => { setGlobalPrecision(3); setGlobalLocale('de-DE'); });
    expect(values()).toEqual(['4,500 GB', '3,000 GB', '1,500 GB', '150,000 MB/d', '3,000 GB', '5,000 d']);
    expect(largest.total_bytes).toBe(3 * GB);
    expect(largest.est_days_to_quota).toBe(5);
  });

  it('distinguishes missing evidence from measured zero, including a zero-day quota estimate', () => {
    const { rerender } = render(<DiskForecastSummary {...props} known={false} largest={null} soonest={null} />);
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog', { name: 'Fleet disk summary details' }))
      .toHaveTextContent('6 empty fields are hidden.');
    rerender(<DiskForecastSummary {...props} totals={{ total: 0, uncompressed: 0, compressed: 0, growth: 0 }}
      count={0} largest={null} soonest={null} />);
    expect(values().slice(0, 4)).toEqual(['0 B', '0 B', '0 B', '0 B/d']);
    expect(values()).toHaveLength(4);
    expect(screen.getByTestId('disk-forecast-summary').querySelector('[data-operational-metric="largest-table"]')).toBeNull();
    expect(screen.getByTestId('disk-forecast-summary').querySelector('[data-operational-metric="soonest-quota"]')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Fleet disk summary details' }))
      .toHaveTextContent('2 empty fields are hidden.');
    rerender(<DiskForecastSummary {...props} soonest={{ ...largest, est_days_to_quota: 0 }} />);
    expect(screen.getByTestId('disk-forecast-summary').querySelector('[data-operational-metric="soonest-quota"]'))
      .toHaveAttribute('data-value-state', 'value');
  });

  it('keeps source numbers on retained refresh and supplies a working fatal retry without fabricated zeros', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<DiskForecastSummary {...props} loading retained />, { wrapper: MemoryRouter });
    const strip = screen.getByTestId('disk-forecast-summary');
    expect(strip.closest('[data-retained]')).toHaveAttribute('data-retained', 'true');
    expect(strip.querySelectorAll('[data-value-state="value"]')).toHaveLength(6);
    rerender(<DiskForecastSummary {...props} known={false} largest={null} soonest={null}
      error={new Error('source failure')} onRetry={onRetry} />);
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog', { name: 'Fleet disk summary details' }))
      .toHaveTextContent('6 empty fields are hidden.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps byte thresholds, signed net growth and measured zero-day estimates numeric', () => {
    setGlobalPrecision(2);
    setGlobalLocale('en-US');
    render(<DiskForecastSummary {...props}
      totals={{ total: 1024, uncompressed: 1023, compressed: 0, growth: -86400 }}
      largest={{ ...largest, total_bytes: 0 }} soonest={{ ...largest, est_days_to_quota: 0 }} />);
    expect(values()).toEqual(['1.00 KB', '1023 B', '0 B', '-86400 B/d', '0 B', '0.00 d']);
    expect(screen.getByTestId('disk-forecast-summary').querySelectorAll('[data-value-state="value"]')).toHaveLength(6);
  });

  it('opens the actual Review details drawer with full table identities, byte/day growth and quota days', () => {
    setGlobalPrecision(2);
    setGlobalLocale('en-US');
    render(<DiskForecastSummary {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Fleet disk summary details' });
    expect(within(drawer).getByText('4.50 GB')).toBeInTheDocument();
    expect(within(drawer).getByText('150.00 MB/d')).toBeInTheDocument();
    expect(within(drawer).getByText('5.00 d')).toBeInTheDocument();
    expect(within(drawer).getAllByText(largest.hypertable_name)).toHaveLength(2);
    expect(within(drawer).getAllByText('Compressed chunks only; not a share of current disk usage.')).toHaveLength(2);
    expect(within(drawer).getByText('Before compression')).toBeInTheDocument();
    expect(within(drawer).getByText('After compression')).toBeInTheDocument();
    expect(within(drawer).queryByText(/% of total/)).not.toBeInTheDocument();
  });

  it('does not equate a missing estimate with an absent quota', () => {
    render(<DiskForecastSummary {...props} soonest={null} />);
    // The missing estimate omits the tile (never a zero-day reading)...
    expect(values()).toEqual(['4.50 GB', '3.00 GB', '1.50 GB', '150.00 MB/d', '3.00 GB']);
    const strip = screen.getByTestId('disk-forecast-summary');
    expect(strip.querySelector('[data-operational-metric="soonest-quota"]')).toBeNull();
    // ...and a missing estimate never claims the quota itself is absent.
    expect(screen.queryByText('No quota configured')).not.toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog', { name: 'Fleet disk summary details' }))
      .toHaveTextContent('1 empty fields are hidden.');
  });

  it('keeps producer before/after measurements independent of the current total', () => {
    setGlobalPrecision(2);
    setGlobalLocale('en-US');
    render(<DiskForecastSummary {...props}
      totals={{ total: 10 * MB, uncompressed: 100 * MB, compressed: 10 * MB, growth: 0 }} />);
    expect(values().slice(0, 4)).toEqual(['10.00 MB', '100.00 MB', '10.00 MB', '0 B/d']);
    // Compression basis moved from the face to the Review-details drawer.
    expect(screen.queryByText('Compressed chunks only; not a share of current disk usage.')).not.toBeInTheDocument();
    expect(screen.queryByText(/% of total/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Fleet disk summary details' });
    expect(within(drawer).getAllByText('Compressed chunks only; not a share of current disk usage.')).toHaveLength(2);
    expect(within(drawer).queryByText(/% of total/)).not.toBeInTheDocument();
  });
});
