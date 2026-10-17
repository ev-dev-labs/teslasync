import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { StatMetric } from '@/components/data-display';
import { AdminSummary } from './AdminSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match),
  }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: {
    locale: 'en-US', decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', currency_symbol: '$',
  }, settingsUnavailable: false }),
}));

const props = {
  eyebrow: 'Backup & restore', title: 'Backup overview', testId: 'summary',
  description: 'Counts use the returned run list, not a server-wide total.',
  scope: 'Independent configuration and run snapshots; bounds are not supplied.',
  sourceStatus: 'ready',
};
afterEach(cleanup);

describe('admin operational summary bridge', () => {
  it('retains measured zero, missing and invalid counts as distinct typed states', () => {
    const metrics: StatMetric[] = [
      { metricId: 'count', occurrenceId: 'zero', rawValue: 0, label: 'Backups' },
      { metricId: 'count', occurrenceId: 'missing', rawValue: undefined, label: 'Configs' },
      { metricId: 'count', occurrenceId: 'invalid', rawValue: Number.NaN, label: 'Failures' },
    ];
    const { container } = render(<MemoryRouter><AdminSummary {...props} metrics={metrics} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="zero"] [data-operational-value]')).toHaveTextContent('0');
    expect(container.querySelector('[data-operational-metric="missing"]')).toHaveAttribute('data-value-state', 'missing');
    expect(container.querySelector('[data-operational-metric="invalid"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(metrics[0].rawValue).toBe(0);
    expect(metrics[2].rawValue).toBeNaN();
  });

  it('uses canonical seconds and fixed millisecond display without changing the operand', () => {
    const metrics: StatMetric[] = [{
      metricId: 'latency', occurrenceId: 'latency', rawValue: 1.499,
      label: 'Avg latency', display: { precision: 0, latencyStyle: 'milliseconds' },
      context: 'Saved browser request history only',
    }];
    const { container } = render(<MemoryRouter><AdminSummary {...props} metrics={metrics} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-value]')).toHaveTextContent('1,499 ms');
    expect(screen.getByText('Saved browser request history only')).toBeInTheDocument();
    expect(metrics[0].rawValue).toBe(1.499);
  });

  it('preserves specialist byte denomination and executes its callback only for a finite measurement', () => {
    const formatter = vi.fn((raw: number) => ({ value: `${raw / 1024} KiB`, unit: '' }));
    const metrics: StatMetric[] = [
      { metricId: 'bytes', occurrenceId: 'size', rawValue: 2048, label: 'Size', display: { formatter } },
      { metricId: 'bytes', occurrenceId: 'missing', rawValue: undefined, label: 'Unavailable size', display: { formatter } },
    ];
    const { container } = render(<MemoryRouter><AdminSummary {...props} metrics={metrics} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="size"] [data-operational-value]')).toHaveTextContent('2 KiB');
    expect(formatter).toHaveBeenCalledTimes(1);
    expect(formatter.mock.calls[0][0]).toBe(2048);
    expect(metrics[0].rawValue).toBe(2048);
  });

  it('keeps all labelled shells while loading and retains measured values after refresh failure', () => {
    const metrics: StatMetric[] = [{ metricId: 'count', occurrenceId: 'configs', rawValue: 3, label: 'Configs' }];
    const { container, rerender } = render(<MemoryRouter><AdminSummary {...props} metrics={metrics} loading /></MemoryRouter>);
    expect(screen.getByTestId('summary')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Configs')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    rerender(<MemoryRouter><AdminSummary {...props} metrics={metrics} sourceStatus="stale" /></MemoryRouter>);
    expect(screen.getByTestId('summary')).toHaveTextContent('Retained measurements');
    expect(container.querySelector('[data-operational-value]')).toHaveTextContent('3');
  });

  it('opens the real review drawer with scope, provenance and full metric context preserved', () => {
    const metrics: StatMetric[] = [{
      metricId: 'count', occurrenceId: 'total', rawValue: 2, label: 'Backups',
      description: 'Returned backup runs', context: 'Not the complete server archive',
    }];
    render(<MemoryRouter><AdminSummary {...props} metrics={metrics} /></MemoryRouter>);
    expect(screen.getByTestId('summary')).toHaveAttribute('data-operational-brief');
    expect(screen.getByText(props.scope)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Not the complete server archive');
    expect(screen.getByRole('dialog')).toHaveTextContent(props.description);
    expect(screen.getByTestId('summary')).toBeInTheDocument();
  });
});
