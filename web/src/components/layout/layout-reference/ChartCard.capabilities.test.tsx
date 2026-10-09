import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AnnotationListParams, CreateAnnotationInput } from '@/api/hooks/useAnnotations';
import type { ChartAnnotationRow, DataAnnotation } from '@/types/annotations';
import type { request } from '@/api/client';
import { __flushQueryBroadcastForTests, __resetQueryBroadcastForTests } from '@/lib/queryBroadcast';
import type { ChartContainerRenderProps } from '../../charts/ChartContainer';
import type { ChartExportMenu } from '../../charts/ChartExportMenu';
import type { AddAnnotationPopover } from '../../charts/AddAnnotationPopover';
import { useChartHiddenSeries } from '../../charts/ChartHiddenSeriesContext';
import { Button } from '../../ui/Button';
import { CardPlacementContext } from './CardPlacementContext';
import { ChartCard, type ChartCardProps } from './ChartCard';

const canonical = vi.hoisted(() => {
  const chartRef: { current: HTMLDivElement | null } = { current: null };
  const annotations: DataAnnotation[] = [{
    id: '73', timestamp: '2026-10-05T10:00:00Z', label: 'Recorded maintenance',
    category: 'maintenance', context: 'efficiency', vehicleId: 42,
    description: 'Complete specialist annotation', createdAt: '2026-10-05T10:01:00Z',
  }];
  return {
    chartRef, annotations,
    fetchAnnotations: vi.fn<(params: AnnotationListParams) => void>(),
    createAnnotation: vi.fn<(input: CreateAnnotationInput) => Promise<void>>(async () => undefined),
    deleteAnnotation: vi.fn<(id: number) => void>(),
    exportPNG: vi.fn<() => Promise<void>>(async () => undefined),
    exportSVG: vi.fn<() => Promise<void>>(async () => undefined),
    copyToClipboard: vi.fn<() => Promise<'copied'>>(async () => 'copied'),
    objectsToCSV: vi.fn<(rows: ChartCardProps['exportData']) => string>(() => 'complete-source-csv'),
    downloadCSV: vi.fn<(filename: string, content: string) => void>(),
    realIntegration: false,
    request: vi.fn<(path: string, options?: Parameters<typeof request>[1]) => Promise<unknown>>(),
    success: vi.fn(),
    error: vi.fn(),
    broadcast: vi.fn(),
  };
});

const recordedRow: ChartAnnotationRow = {
  id: 73, vehicle_id: 42, occurred_at: '2026-10-04T00:00:00Z',
  category: 'custom', title: 'Recorded annotation', description: 'Complete original description',
  scope: ['efficiency'], created_at: '2026-10-05T10:01:00Z', updated_at: '2026-10-05T10:01:00Z',
};

function deferredSave() {
  let resolve!: (row: ChartAnnotationRow) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ChartAnnotationRow>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function mountReal(props: Partial<ChartCardProps> = {}) {
  canonical.realIntegration = true;
  const save = deferredSave();
  let rows: ChartAnnotationRow[] = [];
  canonical.request.mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') {
      const row = await save.promise;
      rows = [row];
      return row;
    }
    return rows;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const tree = (next: Partial<ChartCardProps>) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CardPlacementContext.Provider value={{ size: 'half', span: 6, width: 1280 }}>
          <ChartCard title={title} ariaLabel={ariaLabel} data={plottedData}
            dataColumns={columns} annotations={annotationConfig} {...next}>
            <span>Original plotted source</span>
          </ChartCard>
        </CardPlacementContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const mounted = render(tree(props));
  return {
    ...mounted, save, invalidate, client,
    update: (next: Partial<ChartCardProps>) => mounted.rerender(tree(next)),
  };
}

function openRealDraft() {
  const trigger = screen.getByRole('button', { name: 'Add annotation' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Add Annotation' });
  fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: '  Recorded annotation  ' } });
  fireEvent.change(within(dialog).getByLabelText('Description'), {
    target: { value: '  Complete original description  ' },
  });
  fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '2026-10-04' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Custom' }));
  return { trigger, dialog, submit: within(dialog).getByRole('button', { name: 'Add Annotation' }) };
}

function postCalls() {
  return canonical.request.mock.calls.filter(([, options]) => options?.method === 'POST');
}

describe('ChartCard real annotation capability integration (request interception, not backend acceptance)', () => {
  it('awaits the real POST with the exact payload, blocks duplicates/dismissal, and reconciles current success', async () => {
    const mounted = mountReal();
    const { trigger, dialog, submit } = openRealDraft();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0][0]).toBe('/annotations');
    expect(postCalls()[0][1]).toEqual({
      method: 'POST',
      body: JSON.stringify({
        vehicle_id: 42, occurred_at: '2026-10-04T00:00:00Z', category: 'custom',
        title: 'Recorded annotation', description: 'Complete original description', scope: ['efficiency'],
      }),
    });
    expect(dialog.querySelector('form')).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByLabelText('Label')).toHaveValue('  Recorded annotation  ');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(within(dialog).getByLabelText('Label'), { key: 'Escape' });
    expect(dialog).toBeInTheDocument();
    expect(canonical.success).not.toHaveBeenCalled();
    expect(mounted.invalidate).not.toHaveBeenCalled();
    await act(async () => mounted.save.resolve(recordedRow));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
    expect(canonical.success).toHaveBeenCalledExactlyOnceWith('Annotation added');
    expect(canonical.error).not.toHaveBeenCalled();
    expect(mounted.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['annotations'] });
    __flushQueryBroadcastForTests();
    expect(canonical.broadcast).toHaveBeenCalledExactlyOnceWith({
      type: 'queryInvalidate', keys: [['annotations']],
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove annotation: Recorded annotation' }))
      .toBeInTheDocument());
    expect(canonical.request.mock.calls.some(([path, options]) =>
      path === '/annotations?vehicle_id=42&scope=efficiency' && options?.signal instanceof AbortSignal,
    )).toBe(true);
  });

  it('retains raw rejected draft and focus, permits edited retry, and never fakes success invalidation', async () => {
    const mounted = mountReal();
    const { dialog, submit } = openRealDraft();
    fireEvent.click(submit);
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    await act(async () => mounted.save.reject(new Error('HTTP 503: annotation store unavailable')));
    await waitFor(() => expect(within(dialog).getByText(/Failed to add annotation/)).toBeInTheDocument());
    expect(within(dialog).getByLabelText('Label')).toHaveValue('  Recorded annotation  ');
    expect(within(dialog).getByLabelText('Description')).toHaveValue('  Complete original description  ');
    expect(within(dialog).getByLabelText(/^Date/)).toHaveValue('2026-10-04');
    expect(within(dialog).getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(submit).toBeEnabled();
    expect(canonical.error).toHaveBeenCalledExactlyOnceWith(
      'Failed to add annotation', 'HTTP 503: annotation store unavailable',
    );
    expect(canonical.success).not.toHaveBeenCalled();
    expect(mounted.invalidate).not.toHaveBeenCalled();
    expect(screen.queryByText('Recorded annotation')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Edited retry' } });
    canonical.request.mockImplementation(async (_path, options) =>
      options?.method === 'POST' ? { ...recordedRow, title: 'Edited retry' } : [],
    );
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postCalls()).toHaveLength(2);
    expect(JSON.parse(postCalls()[1][1]?.body as string)).toEqual({
      vehicle_id: 42, occurred_at: '2026-10-04T00:00:00Z', category: 'custom',
      title: 'Edited retry', description: 'Complete original description', scope: ['efficiency'],
    });
    expect(canonical.success).toHaveBeenCalledOnce();
  });

  it.each(['changed', 'change-return', 'removed'] as const)(
    'retains confirmed stale success for the captured target after %s and forbids resubmission', async mode => {
      const mounted = mountReal();
      const { dialog, submit } = openRealDraft();
      fireEvent.click(submit);
      await waitFor(() => expect(postCalls()).toHaveLength(1));
      mounted.update({ annotations: mode === 'removed' ? undefined : { ...annotationConfig, vehicleId: 99 } });
      if (mode === 'change-return') mounted.update({ annotations: annotationConfig });
      expect(screen.getByRole('dialog')).toBe(dialog);
      await act(async () => mounted.save.resolve(recordedRow));
      await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent(
        `Annotation saved for ${title} — vehicle 42 — scope efficiency.`,
      ));
      expect(dialog.querySelector('form')).not.toHaveAttribute('aria-busy');
      expect(within(dialog).getByLabelText('Label')).toHaveValue('  Recorded annotation  ');
      expect(within(dialog).getByLabelText('Description')).toHaveValue('  Complete original description  ');
      expect(within(dialog).getByLabelText(/^Date/)).toHaveValue('2026-10-04');
      expect(submit).toBeDisabled();
      expect(within(dialog).getByLabelText('Label')).toBeDisabled();
      fireEvent.click(submit);
      fireEvent.submit(dialog.querySelector('form')!);
      expect(postCalls()).toHaveLength(1);
      expect(canonical.success).toHaveBeenCalledExactlyOnceWith('Annotation added');
      expect(mounted.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['annotations'] });
      fireEvent.click(within(dialog.querySelector('form')!).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).not.toBe(screen.queryByRole('button', { name: 'Add annotation' }));
    },
  );

  it('captures the actual activation clock once, not render time or a selected data point', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T23:59:59Z'));
    const mounted = mountReal();
    vi.setSystemTime(new Date('2026-10-06T00:01:00Z'));
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/^Date/)).toHaveValue('2026-10-06');
    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'));
    mounted.update({ title: 'Incidental new title', annotations: { ...annotationConfig } });
    expect(within(dialog).getByLabelText(/^Date/)).toHaveValue('2026-10-06');
    expect(postCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    expect(within(screen.getByRole('dialog')).getByLabelText(/^Date/)).toHaveValue('2026-10-07');
  });

  it('disposes local completion on unmount without closing or focusing the fresh instance', async () => {
    const old = mountReal();
    const { submit } = openRealDraft();
    fireEvent.click(submit);
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    old.unmount();
    const fresh = mountReal();
    const { dialog } = openRealDraft();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus());
    const focusedBeforeOldSettlement = document.activeElement;
    await act(async () => old.save.resolve(recordedRow));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByLabelText('Label')).toHaveValue('  Recorded annotation  ');
    expect(document.activeElement).toBe(focusedBeforeOldSettlement);
    expect(fresh.invalidate).not.toHaveBeenCalled();
    expect(old.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['annotations'] });
    expect(canonical.success).toHaveBeenCalledExactlyOnceWith('Annotation added');
  });

  it('preserves null fleet-wide create semantics and current idle cancel focus without issuing a request', async () => {
    const mounted = mountReal({ annotations: { ...annotationConfig, vehicleId: null } });
    const { dialog, trigger, submit } = openRealDraft();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(trigger).toHaveFocus();
    expect(postCalls()).toHaveLength(0);
    fireEvent.click(trigger);
    const next = screen.getByRole('dialog');
    fireEvent.change(within(next).getByLabelText('Label'), { target: { value: 'Fleet note' } });
    fireEvent.click(within(next).getByRole('button', { name: 'Add Annotation' }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(JSON.parse(postCalls()[0][1]?.body as string)).toMatchObject({
      vehicle_id: null, title: 'Fleet note', category: 'milestone', scope: ['efficiency'],
    });
    expect(submit).not.toBeInTheDocument();
    await act(async () => mounted.save.resolve({ ...recordedRow, vehicle_id: null }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | Record<string, unknown>, opts?: Record<string, unknown>) =>
      Object.entries(opts ?? {}).reduce(
        (result, [key, value]) => result.replace(`{{${key}}}`, String(value)),
        typeof fallback === 'string' ? fallback : String(fallback.defaultValue ?? _key),
      ),
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: canonical.chartRef, exportPNG: canonical.exportPNG,
    exportSVG: canonical.exportSVG, copyToClipboard: canonical.copyToClipboard, exporting: false,
  }),
}));
vi.mock('@/api/client', () => ({ request: canonical.request }));
vi.mock('@/components/feedback/Toast', () => ({
  useOptionalToast: () => ({ success: canonical.success, error: canonical.error }),
}));
vi.mock('@/lib/broadcast', () => ({ broadcast: canonical.broadcast }));
vi.mock('@/api/hooks/useAnnotations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useAnnotations')>();
  return {
  useChartAnnotationsAsData: (params: AnnotationListParams) => {
    if (canonical.realIntegration) return actual.useChartAnnotationsAsData(params);
    canonical.fetchAnnotations(params);
    return { annotations: params.enabled ? canonical.annotations : [] };
  },
  useCreateAnnotation: () => canonical.realIntegration
    ? actual.useCreateAnnotation() : { mutateAsync: canonical.createAnnotation },
  useDeleteAnnotation: () => canonical.realIntegration
    ? actual.useDeleteAnnotation() : { mutate: canonical.deleteAnnotation },
  };
});
vi.mock('@/lib/csvExport', () => ({
  objectsToCSV: canonical.objectsToCSV,
  downloadCSV: canonical.downloadCSV,
  defaultExportFilename: (name: string) => name,
}));

// Keep the real card, embedded frame, annotation list, fullscreen primitive and
// hidden-series controller. Only canonical menu/popover UI and external hooks
// are seams here; these tests do not claim browser capture or geometry proof.
vi.mock('../../charts/ChartExportMenu', () => ({
  ChartExportMenu: (props: ComponentProps<typeof ChartExportMenu>) => (
    <div data-testid="canonical-export-menu">
      <Button onClick={() => { void props.onExportPNG(); }} disabled={props.busy}>Save as PNG</Button>
      <Button onClick={() => { void props.onExportSVG(); }} disabled={props.busy}>Save as SVG</Button>
      <Button onClick={() => { void props.onCopyImage(); }} disabled={props.busy}>Copy image to clipboard</Button>
      {props.onExportCsv && (
        <Button onClick={() => { void props.onExportCsv?.(); }}>Download data as CSV</Button>
      )}
    </div>
  ),
}));
vi.mock('../../charts/AddAnnotationPopover', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../charts/AddAnnotationPopover')>();
  return {
  AddAnnotationPopover: (props: ComponentProps<typeof AddAnnotationPopover>) => canonical.realIntegration
    ? <actual.AddAnnotationPopover {...props} /> : props.open ? (
    <div data-testid="canonical-annotation-popover">
      <Button onClick={async () => {
        await props.onAdd(
          'Recorded annotation', 'custom', 'Complete original description', '2026-10-04T00:00:00Z',
        );
        if (props.createAuthority?.getSettlementAuthority() === 'current') props.onAdded?.();
      }}>Add annotation</Button>
      <Button onClick={props.onCancel}>Cancel</Button>
    </div>
  ) : null,
  };
});

const title = 'Complete capability source chart';
const ariaLabel = 'Complete source measurements in the selected range';
const annotationConfig: NonNullable<ChartCardProps['annotations']> = {
  vehicleId: 42, scope: 'efficiency', chartId: 'capabilities-source',
};
const plottedData = Object.freeze([Object.freeze({ time: '10:00', value: 0 })]);
const exportData = Object.freeze([
  Object.freeze({ time: '10:00', value: 0, specialist: 'unabridged' }),
  Object.freeze({ time: '10:01', value: -35, specialist: null }),
  Object.freeze({ time: '10:02', value: 125, specialist: 'unsampled' }),
]);
const columns = [{ key: 'time', label: 'Recorded time' }, { key: 'value', label: 'Source reading' }];

function mount(props: Partial<ChartCardProps> = {}, route = '/source') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <CardPlacementContext.Provider value={{ size: 'half', span: 6, width: 1280 }}>
        <ChartCard title={title} ariaLabel={ariaLabel} data={plottedData} dataColumns={columns} {...props}>
          {props.children ?? <span>Original plotted source</span>}
        </ChartCard>
      </CardPlacementContext.Provider>
    </MemoryRouter>,
  );
}

function SeriesProbe() {
  const state = useChartHiddenSeries();
  return <span data-testid="context-series" data-hidden={state?.isHidden('secondary')} />;
}

const originalFullscreenEnabled = Object.getOwnPropertyDescriptor(document, 'fullscreenEnabled');
const originalRequestFullscreen = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen');
const requestFullscreen = vi.fn<() => Promise<void>>(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  canonical.realIntegration = false;
  __resetQueryBroadcastForTests();
  window.localStorage.removeItem('teslasync-annotations-hidden:capabilities-source');
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true, value: requestFullscreen,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetQueryBroadcastForTests();
  window.localStorage.removeItem('teslasync-annotations-hidden:capabilities-source');
  if (originalFullscreenEnabled) {
    Object.defineProperty(document, 'fullscreenEnabled', originalFullscreenEnabled);
  } else {
    Reflect.deleteProperty(document, 'fullscreenEnabled');
  }
  if (originalRequestFullscreen) {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', originalRequestFullscreen);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  }
});

describe('ChartCard canonical capability opt-ins', () => {
  it('retains the lightweight default, one host heading and placement geometry', () => {
    const { container } = mount({ exportData });
    expect(container.querySelector('[data-chart-toolbar]')).toBeNull();
    expect(screen.queryByTestId('canonical-export-menu')).toBeNull();
    expect(screen.queryByTestId('fullscreen-button')).toBeNull();
    const figure = screen.getByRole('figure', { name: title });
    const cardHeader = container.querySelector('header');
    expect(cardHeader).not.toBeNull();
    expect(screen.getAllByRole('heading', { name: title })).toHaveLength(2);
    expect(within(figure).getByRole('heading', { name: title })).toBeInTheDocument();
    expect(cardHeader ? within(cardHeader).getByRole('heading', { name: title }) : null).toBeVisible();
    expect(figure).toHaveClass('border-0', 'bg-transparent', 'p-0');
    expect(screen.getByRole('img', { name: ariaLabel })).toHaveStyle({
      '--chart-height-desktop': '280px', '--chart-height-mobile': '280px',
    });
    expect(canonical.fetchAnnotations).toHaveBeenLastCalledWith({
      enabled: false, scope: undefined, vehicleId: undefined,
    });
  });

  it('mounts canonical controls inside one embedded frame with one host heading and no second surface', () => {
    const action = vi.fn();
    const { container } = mount({
      toolbar: true, exportable: true, fullscreen: true, annotations: annotationConfig,
      icon: <svg data-testid="source-icon" />,
      action: <Button onClick={action}>Original chart action</Button>,
      metadata: {
        rangeLabel: 'Original full range', sourceLabel: 'Original measurement source',
        freshnessLabel: 'Original freshness detail', unitLabel: 'Original display unit',
      },
    });
    const figure = screen.getByRole('figure', { name: title });
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    expect(container.querySelectorAll('figure')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: title })).toHaveLength(1);
    const strip = figure.querySelector('[data-chart-toolbar]');
    expect(strip).toHaveAttribute('data-html2canvas-ignore', 'true');
    expect(strip).toContainElement(screen.getByTestId('canonical-export-menu'));
    expect(strip).toContainElement(screen.getByTestId('fullscreen-button'));
    expect(strip).toContainElement(screen.getByRole('button', { name: 'Original chart action' }));
    expect(screen.getByTestId('source-icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(figure).not.toHaveClass('rounded-panel', 'shadow-panel', 'p-5');
    expect(within(figure).getByText('Original full range')).toBeInTheDocument();
    expect(within(figure).getByText('Original measurement source')).toBeInTheDocument();
    expect(within(figure).getByText('Original freshness detail')).toBeInTheDocument();
    expect(within(figure).getByText('Original display unit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Original chart action' }));
    expect(action).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('fullscreen-button'));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen.mock.contexts[0]).toBe(figure);
    expect(canonical.chartRef.current).toBe(figure);
  });

  it.each([
    ['export', { exportable: true }],
    ['fullscreen', { fullscreen: true }],
    ['annotations', { annotations: annotationConfig }],
    ['action', { action: <Button>Original independent action</Button> }],
    ['icon', { icon: <svg /> }],
    ['toolbar', { toolbar: true }],
  ] satisfies ReadonlyArray<[string, Partial<ChartCardProps>]>)(
    'mounts the %s opt-in strip without enabling unrelated export actions', (_name, props) => {
    const { container } = mount(props);
    expect(container.querySelector('[data-chart-toolbar]')).not.toBeNull();
    expect(screen.queryByTestId('canonical-export-menu') != null).toBe('exportable' in props);
    expect(screen.getAllByRole('heading', { name: title })).toHaveLength(1);
    },
  );

  it('honors explicit no-toolbar even when capabilities are supplied without losing chart/table content', () => {
    const { container } = mount({
      toolbar: false, exportable: true, fullscreen: true, annotations: annotationConfig,
      action: <Button>Suppressed source action</Button>, exportData,
    });
    expect(container.querySelector('[data-chart-toolbar]')).toBeNull();
    expect(screen.queryByTestId('canonical-export-menu')).toBeNull();
    expect(screen.queryByTestId('fullscreen-button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suppressed source action' })).toBeNull();
    expect(screen.getByText('Original plotted source')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('exports the full caller payload unchanged, never the plotted/fallback sample', () => {
    mount({ exportable: true, exportData, exportFilename: 'original-complete-export' });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).queryByText('-35')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download data as CSV' }));
    expect(canonical.objectsToCSV).toHaveBeenCalledExactlyOnceWith(exportData);
    expect(canonical.objectsToCSV.mock.calls[0][0]).toBe(exportData);
    expect(canonical.downloadCSV).toHaveBeenCalledExactlyOnceWith(
      'original-complete-export', 'complete-source-csv',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save as PNG' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as SVG' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy image to clipboard' }));
    expect(canonical.exportPNG).toHaveBeenCalledOnce();
    expect(canonical.exportSVG).toHaveBeenCalledOnce();
    expect(canonical.copyToClipboard).toHaveBeenCalledOnce();
    expect(exportData[1]).toEqual({ time: '10:01', value: -35, specialist: null });
  });

  it('does not invent a CSV export from fallback rows when exportData is absent', () => {
    mount({ exportable: true });
    expect(screen.getByTestId('canonical-export-menu')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download data as CSV' })).toBeNull();
    expect(canonical.objectsToCSV).not.toHaveBeenCalled();
  });

  it('passes annotations and URL hidden-series through the original render-prop/controller flow', async () => {
    const child = vi.fn((ctx: ChartContainerRenderProps) => (
      <>
        <span data-testid="render-state" data-hidden={ctx.hidden} data-count={ctx.annotations.length}
          data-series-hidden={ctx.hiddenSeries?.isHidden('secondary')} />
        <Button onClick={() => ctx.hiddenSeries?.toggle('secondary')}>Toggle original series</Button>
        <SeriesProbe />
      </>
    ));
    mount({ annotations: annotationConfig, chartKey: 'complete-source', children: child },
      '/source?hidden_complete-source=secondary');
    expect(canonical.fetchAnnotations).toHaveBeenLastCalledWith({
      vehicleId: 42, scope: 'efficiency', enabled: true,
    });
    expect(child.mock.calls[child.mock.calls.length - 1]?.[0].annotations).toBe(canonical.annotations);
    expect(screen.getByTestId('render-state')).toHaveAttribute('data-series-hidden', 'true');
    expect(screen.getByTestId('context-series')).toHaveAttribute('data-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle original series' }));
    expect(screen.getByTestId('render-state')).toHaveAttribute('data-series-hidden', 'false');
    expect(screen.getByTestId('context-series')).toHaveAttribute('data-hidden', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Hide annotations' }));
    expect(screen.getByTestId('render-state')).toHaveAttribute('data-count', '0');
    expect(screen.getByTestId('render-state')).toHaveAttribute('data-hidden', 'true');
    expect(window.localStorage.getItem('teslasync-annotations-hidden:capabilities-source')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Show annotations' }));
    expect(child.mock.calls[child.mock.calls.length - 1]?.[0].annotations).toBe(canonical.annotations);
    expect(screen.getByTestId('render-state')).toHaveAttribute('data-hidden', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    fireEvent.click(within(screen.getByTestId('canonical-annotation-popover'))
      .getByRole('button', { name: 'Add annotation' }));
    expect(canonical.createAnnotation).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 42, occurred_at: '2026-10-04T00:00:00Z', category: 'custom',
      title: 'Recorded annotation', description: 'Complete original description', scope: ['efficiency'],
    });
    await waitFor(() => expect(screen.queryByTestId('canonical-annotation-popover')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Remove annotation: Recorded maintenance' }));
    expect(canonical.deleteAnnotation).toHaveBeenCalledExactlyOnceWith(73);
  });

  it.each([{ loading: true }, { empty: true }, { error: new Error('Source failure') }])(
    'keeps the shell and disables capture/annotation controls for %o', state => {
      mount({ ...state, exportable: true, fullscreen: true, annotations: annotationConfig, exportData });
      expect(screen.getByRole('figure', { name: title })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { name: title })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Add annotation' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Hide annotations' })).toBeDisabled();
      expect(screen.queryByTestId('canonical-export-menu')).toBeNull();
      expect(screen.queryByTestId('fullscreen-button')).toBeNull();
      expect(screen.queryByText('Original plotted source')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
      expect(screen.queryByTestId('canonical-annotation-popover')).toBeNull();
      expect(canonical.objectsToCSV).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ height: 480, mobileHeight: 320 }, '480px', '320px', false],
    [{ height: 460 }, '460px', '200px', false],
    [{ mobileHeight: 180 }, '240px', '180px', false],
    [{ size: 'detail' }, '360px', '300px', false],
    [{ size: 'hero', height: 500, mobileHeight: 350, fluid: true }, '500px', '350px', true],
    [{ fluid: true }, '280px', '280px', true],
  ] satisfies ReadonlyArray<[Partial<ChartCardProps>, string, string, boolean]>)(
    'honors explicit sizing %o through canonical height resolution', (props, desktop, mobile, fluid) => {
      mount(props);
      expect(screen.getByRole('img', { name: ariaLabel })).toHaveStyle({
        '--chart-height-desktop': desktop, '--chart-height-mobile': mobile,
      });
      const figure = screen.getByRole('figure', { name: title });
      if (fluid) expect(figure).toHaveAttribute('data-chart-fluid', 'true');
      else expect(figure).not.toHaveAttribute('data-chart-fluid');
    },
  );
});
