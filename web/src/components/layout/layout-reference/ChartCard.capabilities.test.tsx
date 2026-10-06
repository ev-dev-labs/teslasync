import type { ComponentProps, ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AnnotationListParams, CreateAnnotationInput } from '@/api/hooks/useAnnotations';
import type { DataAnnotation } from '@/types/annotations';
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
    createAnnotation: vi.fn<(input: CreateAnnotationInput) => void>(),
    deleteAnnotation: vi.fn<(id: number) => void>(),
    exportPNG: vi.fn<() => Promise<void>>(async () => undefined),
    exportSVG: vi.fn<() => Promise<void>>(async () => undefined),
    copyToClipboard: vi.fn<() => Promise<'copied'>>(async () => 'copied'),
    objectsToCSV: vi.fn<(rows: ChartCardProps['exportData']) => string>(() => 'complete-source-csv'),
    downloadCSV: vi.fn<(filename: string, content: string) => void>(),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      Object.entries(opts ?? {}).reduce(
        (result, [key, value]) => result.replace(`{{${key}}}`, String(value)), fallback,
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
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: (params: AnnotationListParams) => {
    canonical.fetchAnnotations(params);
    return { annotations: params.enabled ? canonical.annotations : [] };
  },
  useCreateAnnotation: () => ({ mutate: canonical.createAnnotation }),
  useDeleteAnnotation: () => ({ mutate: canonical.deleteAnnotation }),
}));
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
vi.mock('../../charts/AddAnnotationPopover', () => ({
  AddAnnotationPopover: (props: ComponentProps<typeof AddAnnotationPopover>) => props.open ? (
    <div data-testid="canonical-annotation-popover">
      <Button onClick={() => props.onAdd(
        'Recorded annotation', 'custom', 'Complete original description', '2026-10-04T00:00:00Z',
      )}>Add annotation</Button>
      <Button onClick={props.onCancel}>Cancel</Button>
    </div>
  ) : null,
}));

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
  window.localStorage.removeItem('teslasync-annotations-hidden:capabilities-source');
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true, value: requestFullscreen,
  });
});
afterEach(() => {
  cleanup();
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

  it('passes annotations and URL hidden-series through the original render-prop/controller flow', () => {
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
    expect(child.mock.calls.at(-1)?.[0].annotations).toBe(canonical.annotations);
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
    expect(child.mock.calls.at(-1)?.[0].annotations).toBe(canonical.annotations);
    expect(screen.getByTestId('render-state')).toHaveAttribute('data-hidden', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }));
    fireEvent.click(within(screen.getByTestId('canonical-annotation-popover'))
      .getByRole('button', { name: 'Add annotation' }));
    expect(canonical.createAnnotation).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 42, occurred_at: '2026-10-04T00:00:00Z', category: 'custom',
      title: 'Recorded annotation', description: 'Complete original description', scope: ['efficiency'],
    });
    expect(screen.queryByTestId('canonical-annotation-popover')).toBeNull();
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
