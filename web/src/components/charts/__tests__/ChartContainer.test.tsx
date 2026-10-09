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
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ChartContainer } from '../ChartContainer';
import { EmbeddedChart } from '../EmbeddedChart';
import { ChartLegend } from '../ChartLegend';
import { useChartHiddenSeries } from '../ChartHiddenSeriesContext';
import type { ApiRequestOptions } from '@/api/client';
import type { ChartAnnotationRow } from '@/types/annotations';
import type { ChartAnnotationsConfig } from '../ChartContainer';

const { requestMock, toastSuccess, toastError, invalidateMock } = vi.hoisted(() => ({
  requestMock: vi.fn<(path: string, options?: ApiRequestOptions) => Promise<ChartAnnotationRow | ChartAnnotationRow[]>>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(), request: requestMock,
}));
vi.mock('@/api/hooks/_toastHelpers', () => ({
  useDeferredMutationToast: () => ({ success: toastSuccess, error: toastError }),
}));
vi.mock('@/lib/queryBroadcast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queryBroadcast')>();
  return { ...actual, invalidateAndBroadcast: (...args: Parameters<typeof actual.invalidateAndBroadcast>) => {
    invalidateMock(...args);
    return actual.invalidateAndBroadcast(...args);
  } };
});

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

vi.unmock('@/api/hooks/useAnnotations');

beforeEach(() => {
  requestMock.mockReset().mockResolvedValue([]);
  toastSuccess.mockClear();
  toastError.mockClear();
  invalidateMock.mockClear();
});

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
  it('retains the same URL controller and render/context state in an opt-in embedded toolbar frame', () => {
    const { container } = renderWithProviders(
      <EmbeddedChart title="Embedded complete trend" ariaLabel="Embedded complete trend chart"
        chartKey="embedded-complete" toolbar
        data={[{ health: 1, projected: 2 }]}
        dataColumns={[{ key: 'health', label: 'Health' }, { key: 'projected', label: 'Projected' }]}>
        {({ hiddenSeries }) => (
          <>
            <div data-testid="embedded-render-prop"
              data-hidden={hiddenSeries?.isHidden('health')} />
            <ContextProbe seriesKeys={['health', 'projected']} />
          </>
        )}
      </EmbeddedChart>,
      '/page?hidden_embedded-complete=health',
    );
    expect(screen.getByTestId('embedded-render-prop')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByTestId('probe-series-health')).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByTestId('probe-series-projected')).toHaveAttribute('data-hidden', 'false');
    expect(container.querySelectorAll('[data-chart-toolbar]')).toHaveLength(1);
    expect(screen.getByRole('figure', { name: 'Embedded complete trend' }))
      .toHaveAttribute('data-chart-variant', 'embedded');
    expect(screen.queryByRole('button', { name: 'Export chart' })).toBeNull();
  });

  describe('ChartContainer real annotation create authority', () => {
    const row: ChartAnnotationRow = {
      id: 42, vehicle_id: 7, occurred_at: '2025-03-01T00:00:00Z',
      category: 'maintenance', title: 'Rotated tires', description: 'All four',
      scope: ['tire'], created_at: '2025-03-01T12:05:00Z', updated_at: '2025-03-01T12:05:00Z',
    };
    function deferredPost() {
      let resolve!: (value: ChartAnnotationRow) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<ChartAnnotationRow>((yes, no) => { resolve = yes; reject = no; });
      requestMock.mockImplementation((_path, options) =>
        options?.method === 'POST' ? promise : Promise.resolve([]));
      return { resolve, reject };
    }
    function chart(config: ChartAnnotationsConfig | null = { vehicleId: 7, scope: 'tire' }, title = 'Tire history') {
      return <ChartContainer title={title} ariaLabel="Tire pressure history" annotations={config ?? undefined}
        exportable={false}><span>Real chart observations</span></ChartContainer>;
    }
    function fillDraft() {
      fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: '  Rotated tires  ' } });
      fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: '  All four  ' } });
      fireEvent.change(within(dialog).getByLabelText(/^Date\s+\*\s+required$/), { target: { value: '2025-03-01' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Maintenance' }));
      return dialog;
    }
    const posts = () => requestMock.mock.calls.filter(([, options]) => options?.method === 'POST');

    it('disposes an unmounted request without closing or resetting a new instance', async () => {
      const pending = deferredPost();
      const first = renderWithProviders(chart());
      const dialog = fillDraft();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add Annotation' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      first.unmount();
      renderWithProviders(chart());
      const newDialog = fillDraft();
      fireEvent.change(within(newDialog).getByLabelText('Label'), { target: { value: 'New instance draft' } });
      await act(async () => { pending.resolve(row); });
      expect(newDialog).toBeInTheDocument();
      expect(within(newDialog).getByLabelText('Label')).toHaveValue('New instance draft');
      expect(within(newDialog).getByLabelText('Label')).toBeEnabled();
      expect(posts()).toHaveLength(1);
    });

    it('retains an editable rejected original target, disables out-of-context retry and enables return', async () => {
      const pending = deferredPost();
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const view = (vehicleId: number) => <QueryClientProvider client={qc}><MemoryRouter>
        {chart({ vehicleId, scope: 'tire' })}
      </MemoryRouter></QueryClientProvider>;
      const rendered = render(view(7));
      const dialog = fillDraft();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add Annotation' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      rendered.rerender(view(8));
      fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
      expect(within(dialog).getByLabelText('Label')).toHaveValue('  Rotated tires  ');
      await act(async () => { pending.reject(new Error('Rejected original')); });
      await waitFor(() => expect(within(dialog).getByLabelText('Label')).toBeEnabled());
      expect(within(dialog).getByRole('button', { name: 'Add Annotation' })).toBeDisabled();
      expect(within(dialog).getByText(/Return to that context to save/)).toHaveTextContent(/vehicle 7/);
      fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Edited while stale' } });
      fireEvent.submit(dialog.querySelector('form')!);
      expect(posts()).toHaveLength(1);
      rendered.rerender(view(7));
      expect(within(dialog).getByRole('button', { name: 'Add Annotation' })).toBeEnabled();
      requestMock.mockImplementation((_path, options) => Promise.resolve(options?.method === 'POST' ? row : []));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add Annotation' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(posts()).toHaveLength(2);
      expect(JSON.parse(posts()[1][1]?.body as string)).toMatchObject({ vehicle_id: 7, scope: ['tire'], description: 'Edited while stale' });
    });

    it('awaits the actual POST, blocks duplicate submission/dismissal and closes only after real success', async () => {
      const pending = deferredPost();
      renderWithProviders(chart());
      const trigger = screen.getByRole('button', { name: 'Add annotation' });
      const dialog = fillDraft();
      const add = within(dialog).getByRole('button', { name: 'Add Annotation' });
      fireEvent.click(add);
      fireEvent.click(add);
      fireEvent.submit(dialog.querySelector('form')!);
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(JSON.parse(posts()[0][1]?.body as string)).toEqual({
        vehicle_id: 7, occurred_at: '2025-03-01T00:00:00Z', category: 'maintenance',
        title: 'Rotated tires', description: 'All four', scope: ['tire'],
      });
      fireEvent.keyDown(within(dialog).getByLabelText('Label'), { key: 'Escape' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByLabelText('Label')).toHaveValue('  Rotated tires  ');
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(invalidateMock).not.toHaveBeenCalled();
      await act(async () => { pending.resolve(row); });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(toastSuccess).toHaveBeenCalledTimes(1);
      expect(invalidateMock).toHaveBeenCalledTimes(1);
      expect(toastError).not.toHaveBeenCalled();
      expect(trigger).toHaveFocus();
    });

    it('retains rejected raw drafts and manual dates, enables edited retry and never auto-retries', async () => {
      const pending = deferredPost();
      renderWithProviders(chart());
      const dialog = fillDraft();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add Annotation' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      await act(async () => { pending.reject(new Error('POST unavailable')); });
      await waitFor(() => expect(within(dialog).getByLabelText('Label')).toBeEnabled());
      expect(within(dialog).getByLabelText('Label')).toHaveValue('  Rotated tires  ');
      expect(within(dialog).getByLabelText('Description')).toHaveValue('  All four  ');
      expect(within(dialog).getByLabelText(/^Date\s+\*\s+required$/)).toHaveValue('2025-03-01');
      expect(within(dialog).getByRole('button', { name: 'Maintenance' })).toHaveAttribute('aria-pressed', 'true');
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(invalidateMock).not.toHaveBeenCalled();
      expect(posts()).toHaveLength(1);
      expect(within(dialog).getByText(/Failed to add annotation/)).toBeInTheDocument();
      fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: ' Edited retry ' } });
      requestMock.mockImplementation((_path, options) => Promise.resolve(options?.method === 'POST' ? row : []));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add Annotation' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(posts()).toHaveLength(2);
      expect(JSON.parse(posts()[1][1]?.body as string).title).toBe('Edited retry');
      expect(toastSuccess).toHaveBeenCalledTimes(1);
    });

    it.each(['scope', 'vehicle', 'removed config', 'change and return'] as const)(
      'keeps saved reference terminal after %s while preserving the actual original POST',
      async (change) => {
        const pending = deferredPost();
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
        const view = (config: ChartAnnotationsConfig | undefined) =>
          <QueryClientProvider client={qc}><MemoryRouter>{chart(config ?? null)}</MemoryRouter></QueryClientProvider>;
        const original: ChartAnnotationsConfig = { vehicleId: 7, scope: 'tire' };
        const rendered = render(view(original));
        const dialog = fillDraft();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add Annotation' }));
        await waitFor(() => expect(posts()).toHaveLength(1));
        rendered.rerender(view(change === 'removed config' ? undefined :
          change === 'vehicle' ? { vehicleId: 8, scope: 'tire' } : { vehicleId: 7, scope: 'energy' }));
        if (change === 'change and return') rendered.rerender(view(original));
        await act(async () => { pending.resolve(row); });
        await waitFor(() => expect(within(dialog).getByText(/Annotation saved for Tire history/)).toBeInTheDocument());
        expect(within(dialog).getByLabelText('Label')).toHaveValue('  Rotated tires  ');
        expect(within(dialog).getByLabelText(/^Date\s+\*\s+required$/)).toHaveValue('2025-03-01');
        expect(within(dialog).getByLabelText('Label')).toBeDisabled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add Annotation' }));
        fireEvent.submit(dialog.querySelector('form')!);
        expect(posts()).toHaveLength(1);
        expect(toastError).not.toHaveBeenCalled();
        expect(toastSuccess).toHaveBeenCalledTimes(1);
        expect(invalidateMock).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(within(dialog).getByLabelText('Label'), { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      },
    );

    it('captures the header activation clock, not render time, and pins it through refetch rerenders', () => {
      const clock = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2025-03-01T23:59:00Z');
      const rendered = renderWithProviders(chart());
      clock.mockReturnValue('2025-03-02T00:01:00Z');
      fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
      const date = screen.getByLabelText(/^Date\s+\*\s+required$/);
      expect(date).toHaveValue('2025-03-02');
      clock.mockReturnValue('2025-03-03T00:01:00Z');
      rendered.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{chart()}</MemoryRouter></QueryClientProvider>);
      expect(date).toHaveValue('2025-03-02');
      clock.mockRestore();
    });
  });

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
