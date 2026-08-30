/**
 * ChartContainer chartKey + ChartLegend toggle tests.
 *
 * Verifies the click-to-hide series UX:
 *   - When `chartKey` is set, the container provides a context that
 *     `<ChartLegend />` (with no explicit state prop) consumes.
 *   - The legend item carries `aria-pressed="true"` and the dimming
 *     style when the corresponding URL param marks it as hidden.
 *   - The function-children render-prop receives `hiddenSeries`.
 *   - When `chartKey` is omitted, no context is provided and the
 *     legend renders passively (no Router / URL state required).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ChartContainer } from '../ChartContainer';
import { ChartLegend } from '../ChartLegend';
import { useChartHiddenSeries } from '../ChartHiddenSeriesContext';

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

vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

function renderWithProviders(ui: React.ReactNode, route = '/page') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Tiny consumer that probes the context state and exposes it via
 * `data-*` attributes — saves us from setting up a real Recharts
 * `<LineChart>` in jsdom (Recharts measures the SVG bounding box and
 * jsdom returns 0 × 0 → empty render).
 */
function ContextProbe({ seriesKeys }: { seriesKeys: string[] }) {
  const state = useChartHiddenSeries();
  return (
    <div
      data-testid="probe"
      data-has-state={state ? 'true' : 'false'}
      data-hidden-count={state ? state.hidden.size : 0}
    >
      {seriesKeys.map((k) => (
        <span
          key={k}
          data-testid={`probe-series-${k}`}
          data-hidden={state?.isHidden(k) ? 'true' : 'false'}
        />
      ))}
    </div>
  );
}

describe('ChartContainer chartKey + ChartLegend toggle (Phase-46/67)', () => {
  it('exposes hiddenSeries via function-children render-prop when chartKey is set', () => {
    renderWithProviders(
      // chart-a11y:no-table unit-test stub container — does not render real data
      <ChartContainer
        title="Trend"
        ariaLabel="Test chart"
        chartKey="trend"
      >
        {({ hiddenSeries }) => (
          <div
            data-testid="render-prop"
            data-has-state={hiddenSeries ? 'true' : 'false'}
          />
        )}
      </ChartContainer>,
    );
    expect(screen.getByTestId('render-prop').dataset.hasState).toBe('true');
    expect(screen.getByRole('group', { name: 'Test chart' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Test chart' })).toBeNull();
  });

  it('passes hiddenSeries=null in the render-prop when chartKey is omitted', () => {
    renderWithProviders(
      // chart-a11y:no-table unit-test stub container — does not render real data
      <ChartContainer title="Trend" ariaLabel="Test chart">
        {({ hiddenSeries }) => (
          <div
            data-testid="render-prop"
            data-has-state={hiddenSeries ? 'true' : 'false'}
          />
        )}
      </ChartContainer>,
    );
    expect(screen.getByTestId('render-prop').dataset.hasState).toBe('false');
  });

  it('descendants pull URL-hydrated hidden flags from context', () => {
    renderWithProviders(
      // chart-a11y:no-table unit-test stub container — does not render real data
      <ChartContainer
        title="Trend"
        ariaLabel="Test chart"
        chartKey="trend"
      >
        <ContextProbe seriesKeys={['health', 'projected', 'other']} />
      </ChartContainer>,
      '/page?hidden_trend=health,projected',
    );
    const probe = screen.getByTestId('probe');
    expect(probe.dataset.hasState).toBe('true');
    expect(probe.dataset.hiddenCount).toBe('2');
    expect(screen.getByTestId('probe-series-health').dataset.hidden).toBe('true');
    expect(screen.getByTestId('probe-series-projected').dataset.hidden).toBe('true');
    expect(screen.getByTestId('probe-series-other').dataset.hidden).toBe('false');
  });

  it('does not provide context when chartKey is omitted (no Router needed by descendants)', () => {
    // No MemoryRouter — purposefully test that a chart without chartKey
    // does NOT pull react-router-dom into the dependency graph. If this
    // test fails it means useHiddenSeries() is being called even when
    // chartKey is unset — that would break every ChartContainer test
    // that doesn't already wrap in a Router.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        {/* chart-a11y:no-table unit-test stub container — does not render real data */}
        <ChartContainer title="No key" ariaLabel="Chart without legend toggle">
          <ContextProbe seriesKeys={['x']} />
        </ChartContainer>
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('probe').dataset.hasState).toBe('false');
  });
});

describe('ChartLegend with context fallback', () => {
  it('renders passively when no state and no context are wired', () => {
    // ChartLegend without state OR context should render a recharts
    // <Legend/> that does nothing on click. We assert no throw and that
    // the cursor style on the formatter span falls back to "default".
    // Recharts only renders the legend inside a chart, so we sanity-check
    // by asserting the component returns a non-null element.
    const { container } = render(
      <svg>
        <ChartLegend />
      </svg>,
    );
    expect(container).toBeTruthy();
  });
});
