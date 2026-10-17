import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricPreferences } from '@/lib/metric-reference';
import { usePublicOperationalMetrics } from './usePublicOperationalMetrics';

const authenticatedHooks = vi.hoisted(() => ({
  units: vi.fn(() => { throw new Error('Public metrics must not subscribe to settings'); }),
  formatting: vi.fn(() => { throw new Error('Public metrics must not subscribe to formatting settings'); }),
}));
vi.mock('./useUnits', () => ({ useUnits: authenticatedHooks.units }));
vi.mock('./useFormatting', () => ({ useFormatting: authenticatedHooks.formatting }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string) => fallback,
}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const preferences: MetricPreferences = {
  units: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'Wh', duration: 's', power: 'W', precision: 2, locale: 'en-US' },
  currency: { kind: 'iso', value: 'EUR' },
};

describe('query-free public operational metrics', () => {
  it('formats explicit preferences without a query provider or authenticated hooks', () => {
    const { result } = renderHook(() => usePublicOperationalMetrics([
      { metricId: 'energy', rawValue: 850, display: { units: { energy: 'kWh' } } },
      { metricId: 'count', rawValue: 0, label: 'Recorded sessions' },
      { metricId: 'distance', rawValue: null, missingReason: 'Not shared' },
    ], preferences));
    expect(result.current.map(metric => metric.value)).toEqual(['0.85 kWh', '0', '—']);
    expect(result.current.map(metric => metric.rawValue)).toEqual([850, 0, null]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'value', 'missing']);
    expect(authenticatedHooks.units).not.toHaveBeenCalled();
    expect(authenticatedHooks.formatting).not.toHaveBeenCalled();
  });

  it('retains rich context, specialist validation and public navigation', () => {
    const formatter = vi.fn((raw: number) => ({ value: raw.toFixed(2), unit: 'USD' }));
    const { result } = renderHook(() => usePublicOperationalMetrics([
      { metricId: 'currency', rawValue: 0, label: 'Source cost', href: '/public/report',
        display: { formatter }, context: <span>Shared source denomination</span> },
      { metricId: 'currency', rawValue: NaN, label: 'Invalid cost', display: { formatter } },
    ], preferences));
    expect(formatter).toHaveBeenCalledTimes(1);
    expect(result.current[1].valueState).toBe('invalid');
    render(<MemoryRouter>{result.current[0].value}{result.current[0].detail}</MemoryRouter>);
    expect(screen.getByRole('link', { name: /Source cost: 0.00 USD/ }))
      .toHaveAttribute('href', '/public/report');
    expect(screen.getByText('Shared source denomination')).toBeInTheDocument();
  });
});
