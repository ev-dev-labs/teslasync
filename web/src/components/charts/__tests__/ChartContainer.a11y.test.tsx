/**
 * ChartContainer accessibility contract.
 *
 * Asserts the figure / figcaption / table fallback wiring that lets
 * screen-reader users + Windows High Contrast users perceive a
 * Recharts SVG that would otherwise be opaque to them.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ChartContainer } from '../ChartContainer';
import { EmbeddedChart } from '../EmbeddedChart';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// `useChartExport` ultimately reaches into html2canvas-pro / FileSaver
// territory we don't need under unit tests. Mock it to a no-op that
// matches the production return shape.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

// Annotations would otherwise hit the API client. Stub the hooks the
// container imports.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

function renderChart(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ChartContainer accessibility contract', () => {
  it('keeps semantics without nested panel chrome in embedded mode', () => {
    renderChart(
      <EmbeddedChart
        title="Widget energy trend"
        ariaLabel="Widget energy trend over seven days"
        data={[{ day: 'Mon', energy: 12 }]}
        dataColumns={[
          { key: 'day', label: 'Day' },
          { key: 'energy', label: 'Energy' },
        ]}
      >
        <div data-testid="embedded-chart-body">chart</div>
      </EmbeddedChart>,
    );

    const figure = screen.getByRole('figure', { name: 'Widget energy trend' });
    expect(figure).toHaveAttribute('data-chart-variant', 'embedded');
    expect(figure).toHaveClass('border-0', 'bg-transparent', 'p-0');
    expect(figure).not.toHaveClass('rounded-panel', 'p-5', 'shadow-panel');
    expect(within(figure).getByRole('heading', { name: 'Widget energy trend' }))
      .toBeInTheDocument();
    expect(within(figure).getByRole('img', {
      name: 'Widget energy trend over seven days',
    })).toContainElement(screen.getByTestId('embedded-chart-body'));
    expect(within(figure).getByRole('table')).toBeInTheDocument();
    expect(within(figure).queryByRole('button', { name: /export chart/i }))
      .not.toBeInTheDocument();
  });

  it('renders as a <figure> labelled by its title heading', () => {
    renderChart(
      <ChartContainer title="Daily Energy" ariaLabel="Daily energy use over the last 7 days">
        <div data-testid="chart-body">chart</div>
      </ChartContainer>,
    );

    // The figure becomes a "figure" landmark only when it has an
    // accessible name — `aria-labelledby` to the heading provides one.
    const figure = screen.getByRole('figure', { name: /Daily Energy/ });
    expect(figure.tagName).toBe('FIGURE');

    // The chart body is rendered inside an inner `role="img"` wrapper
    // so a focus-stop on the chart re-states the summary.
    const img = within(figure).getByRole('img', {
      name: 'Daily energy use over the last 7 days',
    });
    expect(img).toBeInTheDocument();
    expect(within(img).getByTestId('chart-body')).toBeInTheDocument();
  });

  it('renders an optional title icon as decorative chrome', () => {
    renderChart(
      <ChartContainer
        title="Energy trend"
        icon={<svg data-testid="title-icon" />}
        ariaLabel="Energy trend over time"
      >
        <div>chart</div>
      </ChartContainer>,
    );

    expect(screen.getByTestId('title-icon').parentElement).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('wires aria-describedby to the figcaption fallback', () => {
    renderChart(
      <ChartContainer
        title="Power"
        ariaLabel="Power over time"
        ariaDescription="Battery power flow ranged -120 kW to +180 kW over the last hour."
      >
        <div>chart</div>
      </ChartContainer>,
    );

    const figure = screen.getByRole('figure', { name: /Power/ });
    const describedBy = figure.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const captionNode = describedBy
      ? document.getElementById(describedBy)
      : null;
    expect(captionNode).not.toBeNull();
    expect(captionNode?.tagName).toBe('FIGCAPTION');
    expect(captionNode?.textContent).toContain(
      'Battery power flow ranged -120 kW to +180 kW',
    );
  });

  it('renders the fallback table when data + dataColumns are supplied', () => {
    renderChart(
      <ChartContainer
        title="Daily kWh"
        ariaLabel="Energy used per day for the last 3 days"
        data={[
          { time: 'Mon', kwh: 10 },
          { time: 'Tue', kwh: 12 },
          { time: 'Wed', kwh: 8 },
        ]}
        dataColumns={[
          { key: 'time', label: 'Day' },
          { key: 'kwh', label: 'kWh', format: (v) => `${v as number} kWh` },
        ]}
      >
        <div>chart</div>
      </ChartContainer>,
    );

    // The table lives inside the figcaption — query by role.
    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Two column headers in document order.
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Day', 'kWh']);

    // Three data rows + 1 header row = 4 total.
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);

    // The formatter ran for the kWh column.
    expect(within(table).getByText('10 kWh')).toBeInTheDocument();
    expect(within(table).getByText('12 kWh')).toBeInTheDocument();
    expect(within(table).getByText('8 kWh')).toBeInTheDocument();
  });

  it('renders the empty marker for null/undefined cells', () => {
    renderChart(
      <ChartContainer
        title="Sparse"
        ariaLabel="Sparse series"
        data={[{ time: 'Mon', kwh: null }]}
        dataColumns={[
          { key: 'time', label: 'Day' },
          { key: 'kwh', label: 'kWh' },
        ]}
      >
        <div>chart</div>
      </ChartContainer>,
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('—')).toBeInTheDocument();
  });

  it('falls back to the bare summary when neither data nor description is supplied', () => {
    renderChart(
      <ChartContainer title="Bare" ariaLabel="Bare chart with no fallback table">
        <div>chart</div>
      </ChartContainer>,
    );

    // No <table> is rendered.
    expect(screen.queryByRole('table')).toBeNull();

    // The figcaption still contains the chart summary so SR users
    // hear something when they navigate to it.
    const figure = screen.getByRole('figure', { name: /Bare/ });
    const describedBy = figure.getAttribute('aria-describedby');
    const caption = describedBy ? document.getElementById(describedBy) : null;
    expect(caption?.textContent).toContain('Chart: Bare');
  });

  it('hides the chart in forced-colors mode and reveals the figcaption', () => {
    renderChart(
      <ChartContainer
        title="Forced colors"
        ariaLabel="Chart that is illegible in High Contrast mode"
        data={[{ time: 'A', kwh: 1 }]}
        dataColumns={[
          { key: 'time', label: 'Time' },
          { key: 'kwh', label: 'kWh' },
        ]}
      >
        <div data-testid="chart-body">chart</div>
      </ChartContainer>,
    );

    // The chart wrapper carries `forced-colors:hidden` so it
    // disappears in Windows High Contrast mode (testable here only
    // by inspecting the className, since jsdom doesn't honour the
    // forced-colors media query).
    const chartImg = screen.getByRole('img', {
      name: 'Chart that is illegible in High Contrast mode',
    });
    expect(chartImg.className).toContain('forced-colors:hidden');

    // The figcaption carries `forced-colors:not-sr-only` + `block`
    // so it becomes the visible content in forced-colors mode.
    const figure = screen.getByRole('figure', { name: /Forced colors/ });
    const describedBy = figure.getAttribute('aria-describedby');
    const caption = describedBy ? document.getElementById(describedBy) : null;
    expect(caption).not.toBeNull();
    expect(caption!.className).toContain('forced-colors:not-sr-only');
    expect(caption!.className).toContain('forced-colors:block');
  });

  it('always renders the figcaption (so aria-describedby resolves) even when data is omitted', () => {
    renderChart(
      <ChartContainer title="No table" ariaLabel="Chart without a tabular representation">
        <div>chart</div>
      </ChartContainer>,
    );
    const figure = screen.getByRole('figure');
    const describedBy = figure.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).not.toBeNull();
  });

  it('produces unique figure/figcaption ids per ChartContainer instance', () => {
    renderChart(
      <>
        <ChartContainer title="One" ariaLabel="One">
          <div>a</div>
        </ChartContainer>
        <ChartContainer title="Two" ariaLabel="Two">
          <div>b</div>
        </ChartContainer>
      </>,
    );

    const figures = screen.getAllByRole('figure');
    expect(figures).toHaveLength(2);
    const ids = figures.map((f) => f.getAttribute('aria-describedby'));
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('applies semantic responsive heights with explicit override support', () => {
    renderChart(
      <ChartContainer
        title="Responsive"
        ariaLabel="Responsive chart"
        size="detail"
        height={480}
        mobileHeight={320}
      >
        <div>chart</div>
      </ChartContainer>,
    );

    const figure = screen.getByRole('figure', { name: 'Responsive' });
    const chart = screen.getByRole('img', { name: 'Responsive chart' });
    expect(figure).toHaveAttribute('data-chart-size', 'detail');
    expect(chart).toHaveStyle({
      '--chart-height-mobile': '320px',
      '--chart-height-desktop': '480px',
    });
    expect(chart).toHaveClass(
      'h-[var(--chart-height-mobile)]',
      'min-h-[var(--chart-height-mobile)]',
      'max-h-[var(--chart-height-mobile)]',
      'sm:h-[var(--chart-height-desktop)]',
      'sm:min-h-[var(--chart-height-desktop)]',
      'sm:max-h-[var(--chart-height-desktop)]',
      'min-w-0',
      'max-w-full',
      'overflow-hidden',
      '[contain:layout_size]',
    );
  });

  it('uses a fixed embedded viewport when explicit heights are supplied', () => {
    renderChart(
      <EmbeddedChart
        title="Bounded widget"
        ariaLabel="Bounded embedded chart"
        height={256}
        mobileHeight={224}
      >
        <div className="h-full">chart</div>
      </EmbeddedChart>,
    );

    const figure = screen.getByRole('figure', { name: 'Bounded widget' });
    const chart = screen.getByRole('img', { name: 'Bounded embedded chart' });

    expect(figure).not.toHaveAttribute('data-chart-fluid');
    expect(figure).toHaveClass('min-w-0', 'max-w-full');
    expect(chart).toHaveStyle({
      '--chart-height-mobile': '224px',
      '--chart-height-desktop': '256px',
    });
    expect(chart).toHaveClass(
      'h-[var(--chart-height-mobile)]',
      'min-h-[var(--chart-height-mobile)]',
      'max-h-[var(--chart-height-mobile)]',
      '[contain:layout_size]',
    );
    expect(chart).not.toHaveClass('h-full');
  });

  it('keeps fluid embedded sizing bounded by the shared fallback height', () => {
    renderChart(
      <div className="h-72">
        <EmbeddedChart
          title="Fluid widget"
          ariaLabel="Fluid embedded chart"
          fluid
        >
          <div>chart</div>
        </EmbeddedChart>
      </div>,
    );

    const figure = screen.getByRole('figure', { name: 'Fluid widget' });
    const chart = screen.getByRole('img', { name: 'Fluid embedded chart' });

    expect(figure).toHaveAttribute('data-chart-fluid', 'true');
    expect(figure).toHaveClass('h-full', 'min-h-0', 'max-h-full');
    expect(chart).toHaveClass(
      'h-full',
      'min-h-[var(--chart-height-mobile)]',
      'sm:min-h-[var(--chart-height-desktop)]',
      'max-h-full',
      '[contain:layout_size]',
    );
    expect(chart).toHaveStyle({
      '--chart-height-mobile': '200px',
      '--chart-height-desktop': '240px',
    });
  });

  it('renders contextual empty copy without exposing an empty chart image', () => {
    renderChart(
      <ChartContainer
        title="No history"
        ariaLabel="History chart"
        empty
        emptyTitle="History not available"
        emptyMessage="No samples fall inside this range."
        emptyDescription="Choose a longer range after telemetry has been collected."
      >
        <div data-testid="hidden-chart">chart</div>
      </ChartContainer>,
    );

    expect(screen.getByText('History not available')).toBeInTheDocument();
    expect(screen.getByText('No samples fall inside this range.')).toBeInTheDocument();
    expect(
      screen.getByText('Choose a longer range after telemetry has been collected.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'History chart' })).toBeNull();
    expect(screen.queryByTestId('hidden-chart')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export chart' })).toBeNull();
  });

  it('keeps empty-state navigation controls outside image semantics', () => {
    renderChart(
      <ChartContainer
        title="Vehicle trend"
        ariaLabel="Vehicle trend chart"
        empty
        emptyMessage="Select a vehicle to continue."
        emptyActionTo={{ label: 'Choose a vehicle', to: '/vehicles' }}
      >
        <div data-testid="hidden-chart">chart</div>
      </ChartContainer>,
    );

    const link = screen.getByRole('link', { name: 'Choose a vehicle' });
    expect(link).toHaveAttribute('href', '/vehicles');
    expect(link.closest('[role="img"]')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Vehicle trend chart' })).toBeNull();
  });

  it('contains initial query failures and keeps retry inside the chart frame', () => {
    const onRetry = vi.fn();
    renderChart(
      <ChartContainer
        title="Unavailable"
        ariaLabel="Unavailable chart"
        error={new Error('offline')}
        onRetry={onRetry}
      >
        <div data-testid="hidden-chart">chart</div>
      </ChartContainer>,
    );

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Unavailable chart' })).toBeNull();
    expect(screen.queryByTestId('hidden-chart')).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.closest('[role="img"]')).toBeNull();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([390, 768, 1440])(
    'keeps bounded geometry and no horizontal overflow through repeated %ipx resizes',
    (width) => {
      const { rerender } = renderChart(
        <div data-testid="resize-host" style={{ width }}>
          {/* chart-a11y:no-table geometry fixture has no chart data */}
          <ChartContainer title="Geometry" ariaLabel="Geometry chart" height={360}>
            <div>chart</div>
          </ChartContainer>
        </div>,
      );
      const viewport = screen.getByRole('img', { name: 'Geometry chart' });
      const initialStyle = viewport.getAttribute('style');

      for (let iteration = 0; iteration < 20; iteration += 1) {
        rerender(
          <div data-testid="resize-host" style={{ width }}>
            {/* chart-a11y:no-table geometry fixture has no chart data */}
            <ChartContainer title="Geometry" ariaLabel="Geometry chart" height={360}>
              <div>chart</div>
            </ChartContainer>
          </div>,
        );
      }

      const stableViewport = screen.getByRole('img', { name: 'Geometry chart' });
      expect(stableViewport.getAttribute('style')).toBe(initialStyle);
      expect(stableViewport).toHaveAttribute('data-chart-viewport', 'bounded');
      expect(stableViewport).toHaveClass('min-w-0', 'max-w-full', 'overflow-hidden');
      expect(stableViewport).not.toHaveClass('h-full');
    },
  );

  it('renders the shared range/source/freshness/unit and sampling contract', () => {
    renderChart(
      // chart-a11y:no-table metadata fixture has no chart data
      <ChartContainer
        title="Telemetry"
        ariaLabel="Telemetry chart"
        metadata={{
          rangeLabel: 'Last 24 hours · vehicle time',
          sourceLabel: 'Fleet telemetry',
          freshness: 'stale',
          freshnessLabel: 'Updated 7 min ago',
          unitLabel: 'km/h',
          sampling: {
            sourceCount: 1_000,
            renderedCount: 250,
            sampled: true,
            strategy: 'stride',
          },
        }}
      >
        <div>chart</div>
      </ChartContainer>,
    );

    const figure = screen.getByRole('figure', { name: 'Telemetry' });
    expect(figure).toHaveAttribute('data-chart-state', 'ready');
    expect(figure).toHaveAttribute('data-chart-freshness', 'stale');
    expect(screen.getByText('Last 24 hours · vehicle time')).toBeInTheDocument();
    expect(screen.getByText('Fleet telemetry')).toBeInTheDocument();
    expect(screen.getByText('Updated 7 min ago')).toBeInTheDocument();
    expect(screen.getByText('km/h')).toBeInTheDocument();
    expect(screen.getByText(/Showing 250 of 1000 observations/)).toBeInTheDocument();
    expect(screen.getByText(/Visual series is sampled: 250 of 1000/)).toBeInTheDocument();
  });
});
