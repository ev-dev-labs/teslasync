import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { deriveDataState } from '@/api/dataState';
import type { StatMetric } from '@/components/data-display';
import { CurveSourceSection } from './CurveSourceSection';
import { CurveSummary } from './CurveSummary';

vi.mock('@/components/layout', () => ({
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) =>
    <section aria-label={title}>{children}</section>,
  useCardPlacement: () => ({ className: 'col-span-2' }),
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
  QueryError: ({ error }: { error: Error }) => <p role="alert">{error.message}</p>,
  Skeleton: () => <div data-testid="skeleton" />,
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ precision: 2, locale: 'en-US' }),
}));
vi.mock('../operationalbrief-all/ChargingSummaryBrief', () => ({
  ChargingSummaryBrief: ({ metrics, retained }: { metrics: StatMetric[]; retained: boolean }) =>
    <div data-testid="summary" data-retained={retained}>
      {metrics.map(metric => <div key={metric.occurrenceId} data-testid={metric.occurrenceId}>
        {metric.rawValue === null ? 'unknown' : metric.rawValue}
      </div>)}
    </div>,
}));

afterEach(cleanup);

describe('charging curve category exports', () => {
  it.each(['CurveSourceSection.tsx', 'CurveSummary.tsx'])(
    '%s uses existing category boundaries without deep shared imports',
    file => {
      // Filesystem paths rather than Vite's transformed import.meta.url (see
      // ChargingDetailPage.source-contract.test.ts prior art).
      const dir = resolve(process.cwd(), existsSync(resolve(process.cwd(), 'src')) ? 'src' : 'web/src',
        'features/charging/components/charging-curve-modernization');
      const source = readFileSync(resolve(dir, file), 'utf8');
      const imports = [...source.matchAll(/from ['"](@\/components\/[^'"]+)['"]/g)]
        .map(match => match[1]);
      expect(imports).toContain('@/components/layout');
      expect(imports.every(path => /^@\/components\/[^/]+$/.test(path))).toBe(true);
      if (file === 'CurveSummary.tsx') expect(imports).toContain('@/components/data-display');
    },
  );

  it('preserves populated specialist children and their grid placement during refresh failure', () => {
    const state = deriveDataState({ data: [1], error: new Error('Refresh failed') });
    const { container } = render(
      <CurveSourceSection title="Charging curve" state={state} vehicleSelected hasSessions
        height={300} onResetRange={vi.fn()} onRetry={vi.fn()}>
        <p>Recorded charging curve</p>
      </CurveSourceSection>,
    );
    expect(screen.getByText('Recorded charging curve')).toBeInTheDocument();
    expect(container.querySelector('[data-curve-specialist]')).toHaveClass('col-span-2', 'min-w-0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
  });

  it('preserves all six populated summary operands and retained status', () => {
    render(<CurveSummary
      stats={{ totalEnergy: 80, avgRate: 80.5, peakRate: 150, avgDuration: 200, totalCost: 16.75, totalSessions: 2 }}
      availability={{ count: 2, energy: 2, power: 2, duration: 2, cost: 2 }}
      state={deriveDataState({ data: [1, 2], error: new Error('Refresh failed') })}
      initialLoading={false} onRetry={vi.fn()}
    />);
    for (const [id, value] of [
      ['totalSessions', '2'], ['totalEnergy', '80000'], ['avgRate', '80500'],
      ['peakRate', '150000'], ['avgDuration', '12000'], ['totalCost', '16.75'],
    ]) expect(screen.getByTestId(id)).toHaveTextContent(value);
    expect(screen.getByTestId('summary')).toHaveAttribute('data-retained', 'true');
  });
});
