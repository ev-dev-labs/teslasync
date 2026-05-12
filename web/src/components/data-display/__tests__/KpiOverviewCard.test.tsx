import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import '@/i18n';
import { KpiOverviewCard } from '../KpiOverviewCard';
import { MetricCard } from '../MetricCard';
import { InlineCallout } from '@/components/feedback/InlineCallout';

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('KpiOverviewCard', () => {
  it('renders header, KPI children, secondary line, and footer', () => {
    renderWithClient(
      <KpiOverviewCard
        header={{ title: 'Overview', currentLabel: 'Last 30 days', comparisonLabel: 'vs prior 30 days' }}
        kpis={
          <>
            <MetricCard label="Drives" value={4} />
            <MetricCard label="Distance" value="46.1 mi" />
          </>
        }
        secondary="Top speed 152 mph · Longest 29.1 mi"
        footer={<InlineCallout variant="warning">1 anomaly →</InlineCallout>}
        testId="overview"
      />,
    );

    expect(screen.getByRole('heading', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByText(/last 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/vs prior 30 days/i)).toBeInTheDocument();
    expect(screen.getByText('Drives')).toBeInTheDocument();
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.getByText(/top speed 152 mph/i)).toBeInTheDocument();
    expect(screen.getByText(/1 anomaly/i)).toBeInTheDocument();
    expect(screen.getByTestId('overview-kpis')).toBeInTheDocument();
  });

  it('renders without secondary or footer when omitted', () => {
    renderWithClient(
      <KpiOverviewCard
        header={{ title: 'x', currentLabel: 'y' }}
        kpis={<MetricCard label="A" value={1} />}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('respects custom gridClassName', () => {
    renderWithClient(
      <KpiOverviewCard
        header={{ title: 'x', currentLabel: 'y' }}
        kpis={<MetricCard label="A" value={1} />}
        gridClassName="grid-cols-1 my-custom-class"
        testId="overview"
      />,
    );
    expect(screen.getByTestId('overview-kpis').className).toMatch(/my-custom-class/);
  });

  it('exposes id for IntersectionObserver targeting', () => {
    renderWithClient(
      <KpiOverviewCard
        id="hero-target"
        header={{ title: 'x', currentLabel: 'y' }}
        kpis={<MetricCard label="A" value={1} />}
        testId="overview"
      />,
    );
    expect(screen.getByTestId('overview').id).toBe('hero-target');
  });
});
