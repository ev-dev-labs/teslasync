import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOperationalMetrics } from './useOperationalMetrics';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string) => fallback,
}) }));
vi.mock('./useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'Wh', duration: 's', power: 'W', precision: 2, locale: 'en-US' },
}) }));
vi.mock('./useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
afterEach(cleanup);

describe('OperationalBrief source metrics', () => {
  it('retains raw zero, missing source, units and specialist formatting', () => {
    const { result } = renderHook(() => useOperationalMetrics([
      { metricId: 'count', rawValue: 0, label: 'Calls' },
      { metricId: 'bytes', rawValue: null, label: 'Bytes', missingReason: 'Source unavailable' },
      { metricId: 'multiplier', rawValue: 100, label: 'Burn rate' },
      { metricId: 'number', rawValue: 400, label: 'Voltage',
        display: { formatter: raw => ({ value: raw.toFixed(2), unit: 'V' }) } },
    ]));
    expect(result.current.map(metric => metric.value)).toEqual(['0', '—', '100.00×', '400.00 V']);
    expect(result.current.map(metric => metric.rawValue)).toEqual([0, null, 100, 400]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'missing', 'value', 'value']);
    render(<div>{result.current[1].detail}</div>);
    expect(screen.getByText('Source unavailable')).toBeInTheDocument();
  });
  it('preserves full source context, comparison reasons and navigation', () => {
    const { result } = renderHook(() => useOperationalMetrics([{
      metricId: 'energy', rawValue: 850, label: 'Delivered energy', href: '/charging',
      display: { units: { energy: 'kWh' } }, context: <span>2 recorded sessions</span>,
      comparisonContent: <span>Incomplete prior source</span>,
      comparison: { metricId: 'percent', rawValue: NaN, label: 'Prior comparison',
        period: { kind: 'unknown', label: 'Prior window', reason: 'Prior bounds unverified' } },
    }]));
    render(<MemoryRouter>{result.current[0].value}{result.current[0].detail}</MemoryRouter>);
    expect(screen.getByRole('link', { name: /Delivered energy: 0.85 kWh/ })).toHaveAttribute('href', '/charging');
    expect(screen.getByText('2 recorded sessions')).toBeInTheDocument();
    expect(screen.getByText('Incomplete prior source')).toBeInTheDocument();
    expect(screen.getByText(/Prior bounds unverified/)).toBeInTheDocument();
  });
});
