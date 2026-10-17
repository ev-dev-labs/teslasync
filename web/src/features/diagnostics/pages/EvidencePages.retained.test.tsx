import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { analyzeRootCause, presentRootCause, type RootCauseAnalysisResult } from '../lib/rootCauseIntelligence';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { deriveDataState } from '@/api/dataState';
import { fmtNumber, getFormatterPreferences } from '@/lib/numberFormat';
import type { UnitPref } from '@/lib/unitConversion';
import type { SignalHistoryResponse } from '@/types/telemetry';
import RootCauseIntelligencePage from './RootCauseIntelligencePage';
import ServiceEvidencePackPage from './ServiceEvidencePackPage';

const sources = vi.hoisted(() => ({ workspace: vi.fn(), updates: vi.fn() }));
const display = vi.hoisted((): { units: UnitPref } => ({
  units: {
    distance: 'km', speed: 'km/h', temperature: 'C', pressure: 'bar',
    energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US', precision: 2,
  },
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: display.units }) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

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
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7, vehicle: { display_name: 'Evidence vehicle' } }),
}));
vi.mock('../hooks/useRootCauseWorkspace', () => ({
  ROOT_CAUSE_WINDOW_HOUR_PRESETS: [24, 72, 168, 720],
  useRootCauseWorkspace: () => sources.workspace(),
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useSoftwareUpdates: () => sources.updates(),
}));
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

const points = Array.from({ length: 48 }, (_, index) => ({
  ts: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  kind: 'ValueKindDouble',
  value: index < 24 ? 20 : 80,
  ingest_origin: null,
  source_emitted_at: null,
  received_at: null,
  normalization_version: null,
})) satisfies SignalHistoryResponse['data'];
const analysis = analyzeRootCause({
  focalSignal: 'Soc',
  catalog: ['Soc'],
  focalPoints: points,
  relatedSeries: [],
});

function query<T>(data: T, error: Error | null = null) {
  return {
    data, error, isError: error != null, isLoading: false, isFetching: false,
    isSuccess: error == null && data !== undefined, isPending: false, fetchStatus: 'idle' as const,
    dataUpdatedAt: Date.now(), refetch: vi.fn(),
  };
}

function getByDirectText(container: HTMLElement, text: string) {
  return within(container).getByText((_, element) =>
    Array.from(element?.childNodes ?? []).some(node =>
      node.nodeType === Node.TEXT_NODE && node.textContent === text,
    ),
  );
}

function socHistory(): SignalHistoryResponse {
  return {
    vehicleId: 7, signal: 'Soc', from: points[0]!.ts, to: points[points.length - 1]!.ts,
    count: points.length, data: points,
  };
}

function workspace(evidenceError: Error | null = null, catalogError: Error | null = null) {
  const response = socHistory();
  const bundle = query([{ signal: 'Soc', response }], evidenceError);
  return {
    catalog: ['Soc'],
    signalsQuery: query(['Soc'], catalogError),
    focalSignal: 'Soc',
    setFocalSignal: vi.fn(),
    windowHours: 72,
    setWindowHours: vi.fn(),
    relatedCandidates: [],
    evidenceBundle: {
      ...bundle,
      sources: [{
        signal: 'Soc',
        state: deriveDataState(
          { data: response, error: evidenceError, isError: evidenceError != null, refetch: bundle.refetch },
          { provenance: 'historical' },
        ),
      }],
    },
    analysis,
    isDefensible: false,
    hasChosenSignal: true,
  };
}

function renderPage(page: 'analysis' | 'pack') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {page === 'analysis' ? <RootCauseIntelligencePage /> : <ServiceEvidencePackPage />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  const preferences = getFormatterPreferences();
  display.units = { ...display.units, locale: preferences.locale, precision: preferences.precision };
  sources.workspace.mockReturnValue(workspace());
  sources.updates.mockReturnValue(query([]));
});

describe('diagnostic evidence source preservation', () => {
  it.each(['analysis', 'pack'] as const)('uses the real %s Brief and review drawer with retained source context and no invented confidence', (page) => {
    sources.workspace.mockReturnValue(workspace(new Error('history refresh')));
    renderPage(page);
    const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(page === 'analysis' ? 5 : 4);
    assertOperationalBriefDisclosure(brief, 'Showing retained measurements');
    assertOperationalBriefDisclosure(brief, 'Soc · 72h requested history window');
    assertOperationalBriefDisclosure(brief, 'Per-signal source states shown above');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(getByDirectText(drawer, 'Soc · 72h requested history window')).toBeInTheDocument();
    expect(getByDirectText(drawer, 'Per-signal source states shown above')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('not a diagnosis or proof of causation');
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('Evidence-ranked analysis of retrieved signal histories');
    expect(drawer).toHaveTextContent(analysis.summary);
    for (const limitation of analysis.limitations) expect(drawer).toHaveTextContent(limitation);
    if (page === 'analysis') {
      expect(drawer).toHaveTextContent('Overall score');
      expect(drawer).toHaveTextContent('of 1.00');
      expect(drawer).toHaveTextContent('72h window');
      expect(drawer).toHaveTextContent('candidates considered');
      expect(drawer).toHaveTextContent('Combines focal sample coverage, corroborating-candidate ratio, and analysis window length');
      expect(drawer).toHaveTextContent('not a probability or causal confidence');
    } else {
      expect(drawer).toHaveTextContent('corroborating');
      expect(drawer).toHaveTextContent('Evidence-ranked, not diagnostic');
      expect(drawer).toHaveTextContent('Drives the export gate below');
      expect(drawer).toHaveTextContent('Needs stronger evidence first');
    }
  });

  it.each(['analysis', 'pack'] as const)('preserves a measured-zero report narrative and limitations in the real %s details', (page) => {
    const input = workspace();
    const history: SignalHistoryResponse = {
      vehicleId: 7, signal: 'Soc', from: points[0]!.ts,
      to: points[points.length - 1]!.ts, count: points.length,
      data: points.map((point) => ({ ...point, value: 0 })),
    };
    const report: RootCauseAnalysisResult = analyzeRootCause({
      focalSignal: history.signal, catalog: ['Soc'],
      focalPoints: history.data, relatedSeries: [],
    });
    sources.workspace.mockReturnValue({
      ...input,
      analysis: report,
      evidenceBundle: {
        ...input.evidenceBundle, data: [{ signal: history.signal, response: history }],
        sources: [{ signal: history.signal, state: deriveDataState({ data: history }, { provenance: 'historical' }) }],
      },
    });
    renderPage(page);
    const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
    assertOperationalBriefDisclosure(brief, 'Signal evidence available');
    const hypotheses = brief.querySelector(`[data-operational-metric="${page === 'analysis' ? 'root-cause-hypotheses' : 'service-evidence-hypotheses'}"]`);
    expect(hypotheses).toHaveAttribute('data-value-state', 'value');
    expect(hypotheses?.querySelector('[data-operational-value]')).toHaveTextContent(/^0$/);
    if (page === 'pack') expect(screen.getByRole('button', { name: 'Generate pack' })).toBeDisabled();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    const narrative = within(drawer).getByTestId('operational-narrative');
    expect(narrative).toHaveTextContent(report.summary);
    expect(narrative).not.toHaveTextContent(analysis.summary);
    expect(report.limitations.length).toBeGreaterThan(0);
    const expectedLimitations = page === 'analysis'
      ? presentRootCause(report, [{ signal: history.signal, points: history.data }]).limitations
      : report.limitations;
    for (const limitation of expectedLimitations) expect(narrative).toHaveTextContent(limitation);
    expect(within(narrative).getByText('Not scored')).toBeInTheDocument();
    expect(within(narrative).queryByText('No additional limitations were supplied.')).toBeNull();
  });

  describe.each(['analysis', 'pack'] as const)('%s narrative source guard', (page) => {
    it.each(['pending', 'failed', 'empty'] as const)('withholds an unsupported focal conclusion when its source is %s but a neighbor is ready', (outcome) => {
      const input = workspace();
      const neighbor: SignalHistoryResponse = {
        vehicleId: 7, signal: 'PackVoltage', from: '', to: '',
        count: points.length, data: points,
      };
      const focalState = outcome === 'pending'
        ? deriveDataState<SignalHistoryResponse>({ isPending: true })
        : outcome === 'failed'
          ? deriveDataState<SignalHistoryResponse>({ error: new Error('focal history unavailable') })
          : deriveDataState({
            data: { ...neighbor, signal: 'Soc', count: 0, data: [] },
          }, { provenance: 'historical', unavailable: true });
      sources.workspace.mockReturnValue({
        ...input,
        evidenceBundle: {
          ...input.evidenceBundle, data: [{ signal: neighbor.signal, response: neighbor }],
          sources: [
            { signal: 'Soc', state: focalState },
            { signal: neighbor.signal, state: deriveDataState({ data: neighbor }, { provenance: 'historical' }) },
          ],
          isLoading: outcome === 'pending',
          isError: outcome === 'failed',
          error: outcome === 'failed' ? new Error('focal history unavailable') : null,
        },
      });
      renderPage(page);
      const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
      assertOperationalBriefDisclosure(brief, 'Partial signal evidence');
      assertOperationalMetricUnavailable(brief, 'Ranked hypotheses');
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      const narrative = within(drawer).getByTestId('operational-narrative');
      expect(narrative).not.toHaveTextContent(input.analysis.summary);
      expect(narrative).toHaveTextContent(page === 'analysis'
        ? 'Focal history unavailable; no shift conclusion can be drawn.'
        : 'A canonical, offline-verifiable JSON export of this evidence-ranked analysis');
      const expectedLimitations = page === 'analysis'
        ? presentRootCause(input.analysis, [{ signal: neighbor.signal, points: neighbor.data }]).limitations
        : input.analysis.limitations;
      for (const limitation of expectedLimitations) expect(narrative).toHaveTextContent(limitation);
      expect(within(narrative).getByText('Not scored')).toBeInTheDocument();
      expect(within(drawer).getByText('Partial signal evidence')).toBeInTheDocument();
    });
  });

  it.each(['analysis', 'pack'] as const)('does not publish a stale report narrative before a focal signal is chosen on the %s page', (page) => {
    const input = workspace();
    const emptyAnalysis = analyzeRootCause({ focalSignal: '', catalog: ['Soc'], focalPoints: [], relatedSeries: [] });
    if (page === 'analysis') {
      sources.workspace.mockReturnValue({
        ...input, focalSignal: '', hasChosenSignal: false, analysis: emptyAnalysis,
        evidenceBundle: { ...query([]), sources: [] },
      });
    } else {
      sources.workspace.mockReturnValue({ ...input, focalSignal: '', hasChosenSignal: false });
    }
    renderPage(page);
    const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
    assertOperationalBriefDisclosure(brief, 'Choose a focal signal');
    assertOperationalBriefDisclosure(brief, 'No focal signal · 72h requested history window');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    const narrative = within(drawer).getByTestId('operational-narrative');
    if (page === 'analysis') {
      const emptyPresentation = presentRootCause(emptyAnalysis, []);
      expect(narrative).toHaveTextContent(emptyPresentation.summary);
      expect(narrative).not.toHaveTextContent(input.analysis.summary);
      for (const limitation of emptyPresentation.limitations) expect(narrative).toHaveTextContent(limitation);
    } else {
      expect(narrative).not.toHaveTextContent(input.analysis.summary);
      for (const limitation of input.analysis.limitations) expect(narrative).toHaveTextContent(limitation);
    }
    expect(within(drawer).getByText('Choose a focal signal')).toBeInTheDocument();
  });

  it.each(['analysis', 'pack'] as const)('updates the real %s drawer from a retained report to newly published source narrative', (page) => {
    const retained = workspace(new Error('history refresh'));
    sources.workspace.mockReturnValue(retained);
    const view = renderPage(page);
    const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const initialNarrative = within(screen.getByRole('dialog')).getByTestId('operational-narrative');
    expect(initialNarrative).toHaveTextContent(retained.analysis.summary);
    expect(within(screen.getByRole('dialog')).getByText('Showing retained measurements')).toBeInTheDocument();

    const history: SignalHistoryResponse = {
      vehicleId: 7, signal: 'Soc', from: '', to: '', count: points.length,
      data: points.map((point) => ({ ...point, value: 20 })),
    };
    const published: RootCauseAnalysisResult = analyzeRootCause({
      focalSignal: history.signal, catalog: ['Soc'],
      focalPoints: history.data, relatedSeries: [],
    });
    sources.workspace.mockReturnValue({
      ...retained,
      analysis: published,
      evidenceBundle: {
        ...query([{ signal: history.signal, response: history }]),
        sources: [{ signal: history.signal, state: deriveDataState({ data: history }, { provenance: 'historical' }) }],
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          {page === 'analysis' ? <RootCauseIntelligencePage /> : <ServiceEvidencePackPage />}
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const drawer = screen.getByRole('dialog');
    const narrative = within(drawer).getByTestId('operational-narrative');
    expect(narrative).toHaveTextContent(published.summary);
    expect(narrative).not.toHaveTextContent(retained.analysis.summary);
    const expectedLimitations = page === 'analysis'
      ? presentRootCause(published, [{ signal: history.signal, points: history.data }]).limitations
      : published.limitations;
    for (const limitation of expectedLimitations) expect(narrative).toHaveTextContent(limitation);
    expect(within(drawer).getByText('Signal evidence available')).toBeInTheDocument();
    expect(within(drawer).queryByText('Showing retained measurements')).toBeNull();
  });

  it.each(['analysis', 'pack'] as const)('does not turn initially missing %s histories into numeric zeroes or hide its controls', (page) => {
    const input = workspace();
    sources.workspace.mockReturnValue({
      ...input,
      evidenceBundle: { ...query([]), isLoading: true, sources: [] },
    });
    renderPage(page);
    const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(page === 'analysis' ? 5 : 3);
    expect(screen.getByLabelText('Focal signal')).toHaveValue('Soc');
    if (page === 'analysis') {
      assertOperationalBriefDisclosure(brief, 'Soc · 72h requested history window');
    } else {
      expect(screen.getByLabelText('Analysis window')).toHaveValue('72');
    }
    if (page === 'pack') {
      expect(screen.getByRole('heading', { name: 'Privacy manifest' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Integrity & export' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate pack' })).toBeDisabled();
    }
  });

  it.each(['analysis', 'pack'] as const)('keeps the %s Brief placeholders and independent controls after an initial history failure', (page) => {
    const input = workspace();
    sources.workspace.mockReturnValue({
      ...input,
      evidenceBundle: {
        ...query([], new Error('initial history failure')),
        sources: [{
          signal: 'Soc',
          state: deriveDataState(
            { error: new Error('initial history failure'), isError: true, refetch: vi.fn() },
            { provenance: 'historical' },
          ),
        }],
      },
    });
    renderPage(page);
    const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
    assertOperationalBriefDisclosure(brief, 'Failed to load data');
    expect(brief).not.toHaveAttribute('aria-busy');
    if (page === 'analysis') {
      expect(brief).toHaveTextContent('No metric values are available yet.');
      for (const label of ['Evidence quality', 'Overall evidence score', 'Focal shift effect size', 'Ranked hypotheses', 'Focal samples']) {
        assertOperationalMetricUnavailable(brief, label);
      }
      assertOperationalBriefDisclosure(brief, 'Soc · 72h requested history window');
    } else {
      for (const label of ['Evidence quality', 'Signals in pack', 'Ranked hypotheses']) {
        assertOperationalMetricUnavailable(brief, label);
      }
      expect(brief.querySelector('[data-operational-metric="service-evidence-pack-status"] [data-operational-value]'))
        .toHaveTextContent('Not ready');
      expect(screen.getByLabelText('Analysis window')).toHaveValue('72');
    }
    expect(screen.getByLabelText('Focal signal')).toHaveValue('Soc');
    if (page === 'pack') {
      expect(screen.getByRole('heading', { name: 'Privacy manifest' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Integrity & export' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Pack preview' })).toBeInTheDocument();
    } else {
      expect(screen.getByRole('heading', { name: 'Interpretation & limits' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Ranked hypotheses' })).toBeInTheDocument();
    }
  });

  it.each(['analysis', 'pack'] as const)('labels source-local offline history as retained in the %s Brief without replacing its readings', (page) => {
    const input = workspace();
    const ready: SignalHistoryResponse = { vehicleId: 7, signal: 'Soc', from: '', to: '', count: points.length, data: points };
    sources.workspace.mockReturnValue({
      ...input,
      evidenceBundle: {
        ...input.evidenceBundle,
        sources: [{ signal: 'Soc', state: deriveDataState({ data: ready, fetchStatus: 'paused' }, { provenance: 'historical' }) }],
      },
    });
    renderPage(page);
    const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
    assertOperationalBriefDisclosure(brief, 'Showing retained measurements');
    assertOperationalBriefDisclosure(brief, 'Per-signal source states shown above');
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(page === 'analysis' ? 5 : 4);
    expect(screen.getByLabelText('Focal signal')).toHaveValue('Soc');
    if (page === 'analysis') {
      assertOperationalBriefDisclosure(brief, 'Soc · 72h requested history window');
    } else {
      expect(screen.getByLabelText('Analysis window')).toHaveValue('72');
    }
  });

  it('retains typed zero hypothesis counts while preserving the existing evidence score and shift operands', () => {
    renderPage('analysis');
    const brief = screen.getByTestId('root-cause-summary');
    const hypotheses = brief.querySelector('[data-operational-metric="root-cause-hypotheses"]');
    const samples = brief.querySelector('[data-operational-metric="root-cause-focal-samples"]');
    const effect = brief.querySelector('[data-operational-metric="root-cause-effect"]');
    const score = brief.querySelector('[data-operational-metric="root-cause-overall-score"]');
    expect(hypotheses).toHaveAttribute('data-value-state', 'value');
    expect(hypotheses?.querySelector('[data-operational-value]')).toHaveTextContent(/^0$/);
    expect(samples).toHaveAttribute('data-value-state', 'value');
    expect(samples?.querySelector('[data-operational-value]')).toHaveTextContent(/^48$/);
    expect(effect).toHaveAttribute('data-value-state', 'value');
    expect(effect?.querySelector('[data-operational-value]')).toHaveTextContent(fmtNumber(50));
    expect(score).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    const effectGroup = within(drawer).getByRole('group', { name: 'Focal shift effect size' });
    expect(effectGroup).toHaveTextContent(`${fmtNumber(20)} → ${fmtNumber(80)}`);
    const scoreGroup = within(drawer).getByRole('group', { name: 'Overall evidence score' });
    expect(scoreGroup).toHaveTextContent('not a probability or causal confidence');
    expect(analysis.quality.focalSampleCount).toBe(48);
    expect(analysis.hypotheses).toHaveLength(0);
  });

  it('formats raw dimensionless model values using the saved locale and precision without percent coercion', () => {
    const input = workspace();
    display.units = { ...display.units, locale: 'de-DE', precision: 3 };
    sources.workspace.mockReturnValue({
      ...input,
      analysis: {
        ...input.analysis,
        quality: { ...input.analysis.quality, overallScore: 0.12345 },
        focalShift: input.analysis.focalShift && { ...input.analysis.focalShift, effectSize: 2.3456 },
      },
    });
    renderPage('analysis');
    const brief = screen.getByTestId('root-cause-summary');
    expect(brief.querySelector('[data-operational-metric="root-cause-overall-score"] [data-operational-value]'))
      .toHaveTextContent(/^0,123$/);
    expect(brief.querySelector('[data-operational-metric="root-cause-effect"] [data-operational-value]'))
      .toHaveTextContent(/^2,346$/);
    expect(brief.querySelector('[data-operational-metric="root-cause-overall-score"] [data-operational-value]'))
      .not.toHaveTextContent('%');
    expect(input.analysis.quality.overallScore).toBe(analysis.quality.overallScore);
  });

  it('lets the real raw bridge reject invalid numeric measurements instead of treating them as status text or zero', () => {
    const input = workspace();
    sources.workspace.mockReturnValue({
      ...input,
      analysis: {
        ...input.analysis,
        quality: { ...input.analysis.quality, focalSampleCount: Number.NaN, overallScore: Number.POSITIVE_INFINITY },
      },
    });
    renderPage('analysis');
    const brief = screen.getByTestId('root-cause-summary');
    assertOperationalMetricUnavailable(brief, 'Focal samples');
    assertOperationalMetricUnavailable(brief, 'Overall evidence score');
    assertOperationalMetricUnavailable(brief, 'Evidence quality');
    expect(brief).not.toHaveTextContent('NaN');
    expect(brief).not.toHaveTextContent('Infinity');
  });

  it.each(['analysis', 'pack'] as const)('does not present a pending focal history as zero samples in the %s page', (page) => {
    const input = workspace();
    const neighbor: SignalHistoryResponse = { vehicleId: 7, signal: 'PackVoltage', from: '', to: '', count: points.length, data: points };
    sources.workspace.mockReturnValue({
      ...input,
      analysis: analyzeRootCause({
        focalSignal: 'Soc', catalog: ['Soc', 'PackVoltage'], focalPoints: [],
        relatedSeries: [{ signal: 'PackVoltage', points }],
      }),
      evidenceBundle: {
        ...input.evidenceBundle, data: [{ signal: 'PackVoltage', response: neighbor }],
        sources: [
          { signal: 'Soc', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
          { signal: 'PackVoltage', state: deriveDataState({ data: neighbor }, { provenance: 'historical' }) },
        ],
        isLoading: true,
      },
    });
    renderPage(page);
    const brief = screen.getByTestId(page === 'analysis' ? 'root-cause-summary' : 'service-evidence-summary');
    assertOperationalBriefDisclosure(brief, 'Partial signal evidence');
    assertOperationalMetricUnavailable(brief, 'Ranked hypotheses');
    if (page === 'analysis') {
      assertOperationalMetricUnavailable(brief, 'Focal samples');
      assertOperationalMetricUnavailable(brief, 'Focal shift effect size');
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      expect(within(drawer).getByTestId('operational-narrative'))
        .toHaveTextContent('Focal history unavailable; no shift conclusion can be drawn.');
      fireEvent.keyDown(drawer, { key: 'Escape' });
      const hypothesesPanel = screen.getByRole('heading', { name: 'Ranked hypotheses' }).closest('[data-print-card]');
      const interpretationPanel = screen.getByRole('heading', { name: 'Interpretation & limits' }).closest('[data-print-card]');
      expect(hypothesesPanel).not.toBeNull();
      expect(interpretationPanel).not.toBeNull();
      const hypotheses = within(hypothesesPanel as HTMLElement);
      const interpretation = within(interpretationPanel as HTMLElement);
      expect(interpretation.getByText(/— focal samples/)).toBeInTheDocument();
      expect(interpretation.queryByText(/· 0 focal samples/)).toBeNull();
      expect(hypotheses.getByText('Not enough history yet for this signal and window.')).toBeInTheDocument();
      expect(hypotheses.queryByText('No robust shift was found for this signal in the analyzed window, so no hypotheses are offered.')).toBeNull();
      expect(hypotheses.queryByText('This signal shows a shift, but no other analyzed signal showed a comparable, well-timed shift.')).toBeNull();
    } else {
      const row = screen.getByRole('cell', { name: 'Soc' }).closest('tr') as HTMLElement;
      expect(within(row).getByText('—')).toBeInTheDocument();
      expect(within(row).getByText('Unknown')).toBeInTheDocument();
      expect(within(row).queryByText('0')).toBeNull();
      expect(within(row).queryByText('No')).toBeNull();
      expect(screen.getByRole('button', { name: 'Generate pack' })).toBeDisabled();
    }
    expect(screen.getByRole('status', { name: 'Loading Soc' })).toBeInTheDocument();
  });

  it.each(['analysis', 'pack'] as const)('wires complete source-local outcomes into the actual %s page without replacing ready evidence', (page) => {
    const input = workspace();
    const ready: SignalHistoryResponse = { vehicleId: 7, signal: 'Soc', from: '', to: '', count: points.length, data: points };
    const retry = vi.fn();
    const sourcesForPage = [
      { signal: 'Soc', state: deriveDataState({ data: ready, dataUpdatedAt: 123456 }, { provenance: 'historical' }) },
      { signal: 'PendingNeighbor', state: deriveDataState<SignalHistoryResponse>({ isPending: true }) },
      { signal: 'FailedNeighbor', state: deriveDataState<SignalHistoryResponse>({ error: new Error('neighbor failed'), refetch: retry }) },
      { signal: 'EmptyNeighbor', state: deriveDataState({ data: { ...ready, signal: 'EmptyNeighbor', data: [], count: 0 } }, { unavailable: true }) },
    ];
    sources.workspace.mockReturnValue({
      ...input,
      evidenceBundle: { ...input.evidenceBundle, sources: sourcesForPage, isLoading: true, isError: true, error: new Error('neighbor failed') },
    });
    const { container } = renderPage(page);
    expect(Array.from(container.querySelectorAll('[data-signal-source]'), element => element.getAttribute('data-signal-source')))
      .toEqual(['Soc', 'PendingNeighbor', 'FailedNeighbor', 'EmptyNeighbor']);
    const pending = screen.getByText('PendingNeighbor').closest('[data-signal-source]') as HTMLElement;
    expect(within(pending).getByText('Pending')).toBeInTheDocument();
    expect(within(pending).queryByText(/sample\(s\)/)).toBeNull();
    const failed = screen.getByText('FailedNeighbor').closest('[data-signal-source]') as HTMLElement;
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(input.evidenceBundle.refetch).not.toHaveBeenCalled();
    expect(input.signalsQuery.refetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Focal signal')).toHaveValue('Soc');
    expect(screen.getByRole('heading', { name: page === 'analysis' ? 'Normalized signal timeline' : 'Evidence inventory' })).toBeInTheDocument();
    expect(screen.queryByText('Signal histories are combined for this analysis. This source does not provide per-signal freshness or individual failure details.')).toBeNull();
    if (page === 'pack') {
      expect(screen.getByRole('heading', { name: 'Privacy manifest' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Integrity & export' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate pack' })).toBeDisabled();
    }
  });

  it('retains the picker and all six analysis sections after evidence/catalog refresh failures', () => {
    sources.workspace.mockReturnValue(workspace(new Error('history refresh'), new Error('catalog refresh')));
    renderPage('analysis');
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByLabelText('Focal signal')).toHaveValue('Soc');
    const brief = screen.getByTestId('root-cause-summary');
    assertOperationalBriefDisclosure(brief, 'Soc · 72h requested history window');
    expect(screen.getByRole('region', { name: 'Root-cause evidence metrics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Normalized signal timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence graph' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ranked hypotheses' })).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Ranked hypotheses' }))
      .getByRole('button', { name: 'More info about how hypotheses are ranked' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Interpretation & limits' })).toBeInTheDocument();
    expect(screen.getByText('Focal samples')).toBeInTheDocument();
    expect(screen.getByText(String(analysis.quality.focalSampleCount))).toBeInTheDocument();
    const socSource = document.querySelector('[data-signal-source="Soc"]') as HTMLElement;
    expect(socSource).not.toBeNull();
    expect(within(socSource).getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(within(socSource).getByText('48 sample(s)')).toBeInTheDocument();
    expect(screen.queryByText('Signal histories are combined for this analysis. This source does not provide per-signal freshness or individual failure details.')).toBeNull();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });

  it('keeps inventory, privacy, integrity and preview independent of software-update failure', () => {
    sources.workspace.mockReturnValue(workspace(new Error('history refresh')));
    sources.updates.mockReturnValue(query(undefined, new Error('software updates unavailable')));
    renderPage('pack');
    expect(screen.getByRole('heading', { name: 'Evidence inventory' })).toBeInTheDocument();
    const inventory = screen.getByRole('heading', { name: 'Evidence inventory' }).closest('[data-print-card]');
    expect(inventory).not.toBeNull();
    expect(within(inventory as HTMLElement).getByText('Soc')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Integrity & export' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy manifest' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pack preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate pack' })).toBeDisabled();
    expect(screen.getByText('Generate a pack above to preview the exact JSON document that will be downloaded.')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });

  it('retries retained history independently of the catalog source and preserves the selected signal/window', () => {
    const retained = workspace(new Error('history refresh'), new Error('catalog refresh'));
    sources.workspace.mockReturnValue(retained);
    renderPage('analysis');
    const socSource = document.querySelector('[data-signal-source="Soc"]') as HTMLElement;
    expect(socSource).not.toBeNull();
    fireEvent.click(within(socSource).getByRole('button', { name: 'Retry' }));
    expect(retained.evidenceBundle.refetch).toHaveBeenCalledTimes(1);
    expect(retained.signalsQuery.refetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Focal signal')).toHaveValue('Soc');
    const brief = screen.getByTestId('root-cause-summary');
    assertOperationalBriefDisclosure(brief, 'Soc · 72h requested history window');
    expect(screen.getByRole('heading', { name: 'Interpretation & limits' })).toBeInTheDocument();
  });

  it('does not rewrite the existing defensibility gate because an optional software source failed', () => {
    const defensible = { ...workspace(new Error('history refresh')), isDefensible: true };
    sources.workspace.mockReturnValue(defensible);
    sources.updates.mockReturnValue(query(undefined, new Error('software updates unavailable')));
    renderPage('pack');
    expect(screen.getByRole('button', { name: 'Generate pack' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Evidence inventory' })).toBeInTheDocument();
    const socSource = document.querySelector('[data-signal-source="Soc"]') as HTMLElement;
    expect(socSource).not.toBeNull();
    expect(within(socSource).getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(screen.queryByText('Signal histories are combined for this analysis. This source does not provide per-signal freshness or individual failure details.')).toBeNull();
  });
});
