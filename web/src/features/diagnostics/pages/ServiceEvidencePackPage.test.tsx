import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { formatDateTime } from '@/lib/dateFormat';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { analyzeRootCause } from '../lib/rootCauseIntelligence';
import {
  buildServiceEvidencePack,
  buildServiceEvidencePackCore,
  CryptoUnavailableError,
  toPrettyJson,
  type ServiceEvidencePackDocument,
} from '../lib/serviceEvidencePack';
import ServiceEvidencePackPage from './ServiceEvidencePackPage';
import { RootCauseEvidenceGraph } from '../components/RootCauseEvidenceGraph';
import { RootCauseSignalTimelineChart } from '../components/RootCauseSignalTimelineChart';
import type { EvidenceGraph } from '../lib/rootCauseIntelligence';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  workspace: vi.fn(),
  updates: vi.fn(),
  selected: { vehicleId: 4, vehicle: { display_name: 'DRILL evidence vehicle' } },
  palette: ['var(--series-a)', 'var(--series-b)'] as readonly string[],
  line: vi.fn(),
  legend: vi.fn(),
  datePreferences: { locale: 'en-US', tz: 'America/Los_Angeles' },
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string | Date | null | undefined) => formatDateTime(value, mocks.datePreferences),
  }),
}));

vi.mock('@/hooks/useChartPalette', () => ({ useChartPalette: () => mocks.palette }));
vi.mock('@/components/charts', async (importActual) => ({
  ...await importActual<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  LineChart: ({ children }: { children: ReactNode }) => <>{children}</>,
  Line: (props: unknown) => { mocks.line(props); return null; },
  ChartLegend: (props: unknown) => { mocks.legend(props); return null; },
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => mocks.selected }));
vi.mock('../hooks/useRootCauseWorkspace', () => ({
  ROOT_CAUSE_WINDOW_HOUR_PRESETS: [24, 72, 168, 720],
  useRootCauseWorkspace: () => mocks.workspace(),
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({ useSoftwareUpdates: () => mocks.updates() }));
vi.mock('../lib/serviceEvidencePack', async (importActual) => ({
  ...await importActual<typeof import('../lib/serviceEvidencePack')>(),
  buildServiceEvidencePack: vi.fn(),
}));
vi.mock('react-i18next', async (importActual) => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string'
        ? fallback
        : typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));

const points: SignalHistoryResponse['data'] = Array.from({ length: 48 }, (_, index) => ({
  ts: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  kind: 'ValueKindDouble',
  value: index < 24 ? 20 : 80,
  ingest_origin: null,
  source_emitted_at: null,
  received_at: null,
  normalization_version: null,
}));
const history: SignalHistoryResponse = {
  vehicleId: 4, signal: 'Soc', from: points[0]!.ts,
  to: points[47]!.ts, count: points.length, data: points,
};
const analysis = analyzeRootCause({
  focalSignal: 'Soc', catalog: ['Soc'], focalPoints: points, relatedSeries: [],
});

function query<T>(data: T, error: Error | null = null) {
  return {
    data, error, isError: error != null, isLoading: false, isFetching: false,
    isSuccess: error == null, fetchStatus: 'idle' as const, refetch: vi.fn(),
  };
}

function workspace() {
  return {
    catalog: ['Soc', 'PackVoltage'], signalsQuery: query(['Soc', 'PackVoltage']),
    focalSignal: 'Soc', setFocalSignal: vi.fn(), windowHours: 72,
    setWindowHours: vi.fn(), relatedCandidates: [], analysis,
    evidenceBundle: {
      ...query([{ signal: 'Soc', response: history }]),
      sources: [{ signal: 'Soc', state: deriveDataState({ data: history }, { provenance: 'historical' }) }],
    },
    hasChosenSignal: true, isDefensible: true,
  };
}

function documentFor(input = workspace()): ServiceEvidencePackDocument {
  return {
    ...buildServiceEvidencePackCore({
      vehicle: { id: mocks.selected.vehicleId, displayName: mocks.selected.vehicle.display_name },
      analysis: input.analysis, windowHours: input.windowHours,
      now: () => '2026-01-01T01:00:00Z',
    }),
    integrity: {
      algorithm: 'SHA-256', digestHex: 'a'.repeat(64),
      canonicalizationNote: 'Canonical JSON without integrity', isSignature: false,
    },
  };
}

function deferred() {
  let resolve!: (value: ServiceEvidencePackDocument) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ServiceEvidencePackDocument>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter><ServiceEvidencePackPage /></MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(content());
  return { ...view, refresh: () => view.rerender(content()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.palette = ['var(--series-a)', 'var(--series-b)'];
  mocks.datePreferences = { locale: 'en-US', tz: 'America/Los_Angeles' };
  mocks.selected.vehicleId = 4;
  mocks.workspace.mockReturnValue(workspace());
  mocks.updates.mockReturnValue(query([]));
  vi.mocked(buildServiceEvidencePack).mockReset();
});

describe('root-cause chart preference adoption', () => {
  it('updates graph nodes, edges and legend swatches without changing identities or relation encodings', () => {
    const graph: EvidenceGraph = {
      nodes: [
        { id: 'Soc', kind: 'focal', domains: [], sampleCount: 48, hasEvidence: true },
        ...['PackVoltage', 'PackCurrent', 'BatteryTemp', 'UnknownSignal'].map((id, index) => ({
          id, kind: 'candidate' as const, domains: [], sampleCount: 48, hasEvidence: index < 3,
        })),
      ],
      edges: [
        { source: 'Soc', target: 'PackVoltage', relation: 'leads', strength: 0.8 },
        { source: 'Soc', target: 'PackCurrent', relation: 'lags', strength: 0.6 },
        { source: 'Soc', target: 'BatteryTemp', relation: 'concurrent', strength: 0.4 },
      ],
    };
    const content = <RootCauseEvidenceGraph graph={graph} hasChosenSignal isLoading={false} isError={false} />;
    const view = render(content);
    const assertGraph = () => {
      const diagram = view.container.querySelector('svg[viewBox]')!;
      const circles = diagram.querySelectorAll('circle');
      const edges = diagram.querySelectorAll('line');
      const legend = screen.getAllByRole('listitem');
      expect(legend.map((item) => item.querySelector('span')?.textContent))
        .toEqual(['Soc', 'PackVoltage', 'PackCurrent', 'BatteryTemp', 'UnknownSignal']);
      for (let index = 0; index < 4; index++) {
        const color = mocks.palette[index % mocks.palette.length]!;
        expect(circles[index]).toHaveAttribute('stroke', color);
        expect(circles[index]).toHaveAttribute('fill', index < 3 ? color : 'none');
        expect(legend[index + 1]!.querySelector('circle')).toHaveAttribute('stroke', color);
        expect(legend[index + 1]!.querySelector('circle')).toHaveAttribute('fill', index < 3 ? color : 'none');
        if (index < 3) expect(edges[index]).toHaveAttribute('stroke', color);
      }
      expect(edges[0]).not.toHaveAttribute('stroke-dasharray');
      expect(edges[1]).toHaveAttribute('stroke-dasharray', '7 5');
      expect(edges[2]).toHaveAttribute('stroke-dasharray', '2 4');
      expect(circles[4]).toHaveAttribute('fill', 'var(--theme-primary)');
    };
    assertGraph();
    mocks.palette = ['var(--series-c)', 'var(--series-d)', 'var(--series-e)'];
    view.rerender(<RootCauseEvidenceGraph graph={graph} hasChosenSignal isLoading={false} isError={false} />);
    assertGraph();
  });

  it('updates timeline colors while retaining data order, focal emphasis and URL-backed hidden-series identity', () => {
    const timeline = [
      { ms: 0, time: points[0]!.ts, Soc: 0, PackVoltage: null, PackCurrent: 1 },
      { ms: 1, time: points[1]!.ts, Soc: 1, PackVoltage: 0.5, PackCurrent: 0 },
    ];
    const seriesNames = ['Soc', 'PackVoltage', 'PackCurrent'];
    const content = () => (
      <MemoryRouter initialEntries={['/?hidden_diagnostics-root-cause-timeline=PackVoltage']}>
        <RootCauseSignalTimelineChart timeline={timeline} seriesNames={seriesNames}
          focalSignal="Soc" hasChosenSignal isLoading={false} isError={false} />
      </MemoryRouter>
    );
    const view = render(content());
    const assertTimeline = () => {
      expect(mocks.line.mock.calls.slice(-3).map(([props]) => props)).toEqual(
        seriesNames.map((name, index) => expect.objectContaining({
          dataKey: name, name, stroke: mocks.palette[index % mocks.palette.length],
          strokeWidth: name === 'Soc' ? 2.5 : 1.5,
          hide: name === 'PackVoltage', dot: false, connectNulls: false,
        })),
      );
      expect(view.container.querySelector('[data-chart-key="diagnostics-root-cause-timeline"]')).not.toBeNull();
      expect(mocks.legend).toHaveBeenLastCalledWith(expect.objectContaining({
        state: expect.objectContaining({ hidden: new Set(['PackVoltage']) }),
      }));
    };
    assertTimeline();
    mocks.palette = ['var(--series-c)', 'var(--series-d)', 'var(--series-e)'];
    view.rerender(content());
    assertTimeline();
    expect(timeline[0]!.PackVoltage).toBeNull();
  });
});

describe('ServiceEvidencePackPage snapshot integrity', () => {
  it('updates visible timestamps with locale and timezone preferences without rewriting the snapshot or digest', async () => {
    const input = workspace();
    const updatedAt = Date.parse('2026-01-01T00:30:00Z');
    input.evidenceBundle.sources[0]!.state = deriveDataState({
      data: history, dataUpdatedAt: updatedAt,
    }, { provenance: 'historical' });
    const doc = {
      ...documentFor(input),
      ...buildServiceEvidencePackCore({
        vehicle: { id: 4, displayName: mocks.selected.vehicle.display_name },
        analysis: input.analysis, windowHours: input.windowHours,
        now: () => '2026-01-01T01:00:00Z',
        sources: { histories: input.evidenceBundle.sources },
      }),
    };
    const rawJson = toPrettyJson(doc);
    const digest = doc.integrity.digestHex;
    mocks.workspace.mockReturnValue(input);
    vi.mocked(buildServiceEvidencePack).mockResolvedValueOnce(doc);
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    await screen.findByRole('button', { name: 'Download JSON' });

    for (const preferences of [
      { locale: 'en-US', tz: 'America/Los_Angeles' },
      { locale: 'de-DE', tz: 'Europe/Berlin' },
    ]) {
      mocks.datePreferences = preferences;
      view.refresh();
      expect(screen.getByText(`Schema ${doc.schemaVersion} · generated ${formatDateTime(doc.generatedAt, preferences)}`))
        .toBeInTheDocument();
      expect(screen.getByText(`Last updated: ${formatDateTime(new Date(updatedAt), preferences)}`))
        .toBeInTheDocument();
      expect(screen.getByText(digest)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Pack preview' }).querySelector('code')?.textContent).toBe(rawJson);
      expect(doc.generatedAt).toBe('2026-01-01T01:00:00Z');
      expect(doc.snapshot?.sources.find((source) => source.kind === 'history')?.trust.updatedAt).toBe(updatedAt);
      expect(input.evidenceBundle.sources[0]!.state.updatedAt).toBe(updatedAt);
      expect(toPrettyJson(doc)).toBe(rawJson);
    }
    expect(buildServiceEvidencePack).toHaveBeenCalledOnce();
  });

  it('previews the exact generated document and preserves the raw generation input', async () => {
    const input = workspace();
    const doc = documentFor(input);
    mocks.workspace.mockReturnValue(input);
    vi.mocked(buildServiceEvidencePack).mockResolvedValueOnce(doc);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    const preview = await screen.findByRole('group', { name: 'Pack preview' });
    expect(preview.querySelector('code')?.textContent).toBe(toPrettyJson(doc));
    expect(buildServiceEvidencePack).toHaveBeenCalledWith({
      vehicle: { id: 4, displayName: 'DRILL evidence vehicle' },
      windowHours: 72, analysis: input.analysis, softwareUpdates: [],
    });
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
    expect(doc.integrity.isSignature).toBe(false);
    expect(doc.focalShift?.before.median).toBe(20);
    expect(doc.focalShift?.after.median).toBe(80);
    expect(doc.limitations).toEqual(analysis.limitations);
  });

  it.each(['vehicle', 'signal', 'window'] as const)('discards a late digest after the %s scope changes', async (scope) => {
    const pending = deferred();
    const doc = documentFor();
    vi.mocked(buildServiceEvidencePack).mockReturnValueOnce(pending.promise);
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    expect(screen.getByRole('button', { name: 'Generate pack' })).toHaveAttribute('aria-busy', 'true');
    const next = workspace();
    if (scope === 'vehicle') mocks.selected.vehicleId = 3;
    if (scope === 'signal') next.focalSignal = 'PackVoltage';
    if (scope === 'window') next.windowHours = 168;
    mocks.workspace.mockReturnValue(next);
    view.refresh();
    await act(async () => { pending.resolve(doc); await pending.promise; });
    expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Pack preview' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate pack' })).toBeEnabled();
  });

  it('keeps a newer generation busy when an obsolete generation rejects', async () => {
    const old = deferred();
    const current = deferred();
    vi.mocked(buildServiceEvidencePack)
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    mocks.workspace.mockReturnValue({ ...workspace(), windowHours: 168 });
    view.refresh();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    await act(async () => { old.reject(new CryptoUnavailableError()); await old.promise.catch(() => {}); });
    expect(screen.getByRole('button', { name: 'Generate pack' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/This session cannot compute a SHA-256/)).toBeNull();
    const doc = documentFor({ ...workspace(), windowHours: 168 });
    await act(async () => { current.resolve(doc); await current.promise; });
    expect((await screen.findByRole('group', { name: 'Pack preview' })).querySelector('code')?.textContent)
      .toBe(toPrettyJson(doc));
  });

  it('does not accept an old scope after changing away and returning', async () => {
    const pending = deferred();
    const doc = documentFor();
    vi.mocked(buildServiceEvidencePack).mockReturnValueOnce(pending.promise);
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    mocks.workspace.mockReturnValue({ ...workspace(), windowHours: 24 });
    view.refresh();
    mocks.workspace.mockReturnValue(workspace());
    view.refresh();
    await act(async () => { pending.resolve(doc); await pending.promise; });
    expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate pack' })).toBeEnabled();
  });

  it('disposes an unmounted generation without publishing into a new page instance', async () => {
    const pending = deferred();
    const doc = documentFor();
    vi.mocked(buildServiceEvidencePack).mockReturnValueOnce(pending.promise);
    const old = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    old.unmount();
    renderPage();
    await act(async () => { pending.resolve(doc); await pending.promise; });
    expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Generate pack' })).toBeEnabled();
  });

  it('retains secure-context error guidance and allows a successful explicit retry', async () => {
    vi.mocked(buildServiceEvidencePack).mockRejectedValueOnce(new CryptoUnavailableError())
      .mockResolvedValueOnce(documentFor());
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    expect(await screen.findByText(/This session cannot compute a SHA-256/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    expect(await screen.findByRole('button', { name: 'Download JSON' })).toBeEnabled();
    expect(screen.queryByText(/This session cannot compute a SHA-256/)).toBeNull();
  });
});

describe('ServiceEvidencePackPage missing versus measured evidence', () => {
  it.each(['pending', 'failed', 'empty', 'paused', 'refreshing'] as const)(
    'derives the brief from a complete %s neighbor without hiding populated evidence',
    (outcome) => {
      const input = workspace();
      const retryNeighbor = vi.fn();
      const empty = { ...history, signal: 'PackVoltage', count: 0, data: [] };
      const neighbor = deriveDataState({
        data: outcome === 'empty' ? empty
          : outcome === 'paused' || outcome === 'refreshing' ? history : undefined,
        error: outcome === 'failed' ? new Error('Neighbor history failed') : null,
        isFetching: outcome === 'refreshing',
        fetchStatus: outcome === 'paused' ? 'paused' : 'idle',
        refetch: retryNeighbor,
      }, { provenance: 'historical', unavailable: outcome === 'empty' });
      mocks.workspace.mockReturnValue({
        ...input,
        evidenceBundle: {
          ...input.evidenceBundle,
          sources: [...input.evidenceBundle.sources, { signal: 'PackVoltage', state: neighbor }],
        },
      });
      const { container } = renderPage();
      const brief = screen.getByTestId('service-evidence-summary');
      expect(brief).toHaveTextContent(outcome === 'paused' ? 'Showing retained measurements'
        : outcome === 'refreshing' ? 'Refreshing signal evidence' : 'Partial signal evidence');
      expect(brief.querySelector('[data-operational-metric="service-evidence-hypotheses"]'))
        .toHaveAttribute('data-value-state', 'value');
      expect(screen.getByRole('table')).toHaveTextContent('Soc');
      expect(screen.getByRole('button', { name: 'Generate pack' })).toBeEnabled();
      const source = container.querySelector('[data-signal-source="PackVoltage"]') as HTMLElement;
      expect(source).toHaveAttribute('data-source-status', neighbor.status);
      if (outcome === 'failed' || outcome === 'paused' || outcome === 'empty') {
        fireEvent.click(within(source).getByRole('button', { name: 'Retry' }));
        expect(retryNeighbor).toHaveBeenCalledOnce();
        expect(input.evidenceBundle.refetch).not.toHaveBeenCalled();
        expect(input.signalsQuery.refetch).not.toHaveBeenCalled();
      }
    },
  );

  it('withholds quality and corroboration for resolved empty histories without removing sections or source identities', () => {
    const input = workspace();
    const empty = { ...history, count: 0, data: [] };
    mocks.workspace.mockReturnValue({
      ...input, isDefensible: false,
      analysis: analyzeRootCause({ focalSignal: 'Soc', catalog: ['Soc'], focalPoints: [], relatedSeries: [] }),
      evidenceBundle: {
        ...input.evidenceBundle, data: [{ signal: 'Soc', response: empty }],
        sources: [{ signal: 'Soc', state: deriveDataState({ data: empty }, { provenance: 'historical', unavailable: true }) }],
      },
    });
    const { container } = renderPage();
    const brief = screen.getByTestId('service-evidence-summary');
    for (const id of ['quality', 'signals', 'hypotheses']) {
      expect(brief.querySelector(`[data-operational-metric="service-evidence-${id}"]`))
        .toHaveAttribute('data-value-state', 'missing');
    }
    expect(brief).toHaveTextContent('— corroborating');
    expect(brief).not.toHaveTextContent('Insufficient evidence');
    expect(container.querySelector('[data-signal-source="Soc"]')).not.toBeNull();
    for (const title of ['Choose a signal to investigate', 'Evidence inventory', 'Privacy manifest', 'Integrity & export', 'Pack preview']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Generate pack' })).toBeDisabled();
  });

  it('retains measured zero history, source warnings and the exact statistical limitations', () => {
    const input = workspace();
    const zero = { ...history, data: points.map((point) => ({ ...point, value: 0 })) };
    const report = analyzeRootCause({ focalSignal: 'Soc', catalog: ['Soc'], focalPoints: zero.data, relatedSeries: [] });
    mocks.workspace.mockReturnValue({
      ...input, analysis: report, isDefensible: false,
      evidenceBundle: {
        ...query([{ signal: 'Soc', response: zero }], new Error('refresh failed')),
        sources: [{ signal: 'Soc', state: deriveDataState({
          data: zero, error: new Error('refresh failed'), refetch: vi.fn(),
        }, { provenance: 'historical' }) }],
      },
    });
    renderPage();
    const brief = screen.getByTestId('service-evidence-summary');
    expect(within(brief).getByText('Showing retained measurements')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="service-evidence-hypotheses"]'))
      .toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="service-evidence-hypotheses"] [data-operational-value]'))
      .toHaveTextContent(/^0$/);
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const narrative = within(screen.getByRole('dialog')).getByTestId('operational-narrative');
    expect(narrative).toHaveTextContent(report.summary);
    for (const limitation of report.limitations) expect(narrative).toHaveTextContent(limitation);
    expect(within(narrative).getByText('Not scored')).toBeInTheDocument();
  });
});
