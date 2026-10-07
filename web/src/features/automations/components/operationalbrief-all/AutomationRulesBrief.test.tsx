import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { AutomationRulesBrief } from './AutomationRulesBrief';
import '../../../../i18n';

const source = vi.hoisted(() => ({
  metrics: [] as readonly StatMetric[],
  locale: 'en-US',
  precision: 2,
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', locale: source.locale, decimal_precision: source.precision, currency_symbol: '$' } }),
}));
vi.mock('@/hooks/useOperationalMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return {
    useOperationalMetrics: (...args: Parameters<typeof actual.useOperationalMetrics>) => {
      source.metrics = args[0];
      return actual.useOperationalMetrics(...args);
    },
  };
});

const stats = { total: 1234, active: 1200, disabled: 30, autoDisabled: 4,
  totalRuns: 2345, totalFailures: 0 };

describe('AutomationRulesBrief raw source and real drawer', () => {
  beforeEach(() => {
    source.metrics = [];
    source.locale = 'en-US';
    source.precision = 2;
  });

  it('bridges all six original numeric counts without parsing formatted strings', () => {
    render(<MemoryRouter><AutomationRulesBrief bulk stats={stats} hasData loading={false} retained={false} /></MemoryRouter>);
    expect(source.metrics.map(({ occurrenceId, metricId, rawValue }) => ({ occurrenceId, metricId, rawValue }))).toEqual([
      { occurrenceId: 'total', metricId: 'count', rawValue: 1234 },
      { occurrenceId: 'active', metricId: 'count', rawValue: 1200 },
      { occurrenceId: 'disabled', metricId: 'count', rawValue: 30 },
      { occurrenceId: 'autoDisabled', metricId: 'count', rawValue: 4 },
      { occurrenceId: 'runs', metricId: 'count', rawValue: 2345 },
      { occurrenceId: 'failures', metricId: 'count', rawValue: 0 },
    ]);
    const brief = screen.getByTestId('automation-rules-brief');
    expect(brief.querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('1,234');
    expect(brief.querySelector('[data-operational-metric="failures"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Rule inventory details' });
    expect(within(drawer).getByText('2,345')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Cumulative counters on loaded rules; their start time is not supplied.').length).toBeGreaterThan(0);
  });

  it('keeps unavailable source counts missing even when the local fallback stats are zero', () => {
    render(<MemoryRouter><AutomationRulesBrief bulk stats={{ total: 0, active: 0, disabled: 0,
      autoDisabled: 0, totalRuns: 0, totalFailures: 0 }} hasData={false} loading={false} retained={false} /></MemoryRouter>);
    expect(source.metrics.every((metric) => metric.rawValue === null)).toBe(true);
    const brief = screen.getByTestId('automation-rules-brief');
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    expect(within(brief).getByText('Rules unavailable')).toBeInTheDocument();
  });

  it('uses the real loading shell without publishing fabricated values', () => {
    render(<MemoryRouter><AutomationRulesBrief stats={stats} hasData={false} loading retained={false} /></MemoryRouter>);
    const brief = screen.getByTestId('automations-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(source.metrics.every((metric) => metric.rawValue === null)).toBe(true);
  });

  it('honors saved locale and retains all counts and source warnings on refresh failure', () => {
    source.locale = 'de-DE';
    source.precision = 3;
    render(<MemoryRouter><AutomationRulesBrief bulk stats={stats} hasData loading={false} retained /></MemoryRouter>);
    const brief = screen.getByTestId('automation-rules-brief');
    expect(brief.querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('1.234');
    expect(within(brief).getByText('Retained rules')).toBeInTheDocument();
    expect(brief).toHaveTextContent('Rule response; not a live execution stream');
    expect(source.metrics[4].rawValue).toBe(2345);
  });
});
