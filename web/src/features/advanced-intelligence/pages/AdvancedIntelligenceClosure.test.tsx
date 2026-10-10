import type { ComponentType, ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type {
  AdvancedPage, CausalExperiment, ChargingForensicsPage as ForensicsResponse,
  ChargingSiteTwinResponse, ComponentSurvival, FederatedRoundResult,
  FederatedStatusPage, FirmwareCanary, HazardPage, JourneyAssuranceResponse,
  ResiliencePlanResponse, SentinelPage, TCOOptimizerResponse, TwinLabResponse,
} from '@/types/advancedIntelligence';
import type { StormguardEvent, StormguardStatus } from '@/api/hooks/useStormguard';
import { ToastProvider } from '@/components/feedback';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import { EvidencePanel, InsightPanel, StormGuardPanel } from '../components';
import BehavioralSentinelPage from './BehavioralSentinelPage';
import CausalExperimentationPage from './CausalExperimentationPage';
import ChargingForensicsPage from './ChargingForensicsPage';
import ChargingSiteTwinPage from './ChargingSiteTwinPage';
import ComponentSurvivalPage from './ComponentSurvivalPage';
import EmergencyResiliencePage from './EmergencyResiliencePage';
import FederatedLearningStudioPage from './FederatedLearningStudioPage';
import FirmwareCanaryPage from './FirmwareCanaryPage';
import JourneyAssurancePage from './JourneyAssurancePage';
import RoadHazardMeshPage from './RoadHazardMeshPage';
import TCOOptimizerPage from './TCOOptimizerPage';
import TwinLabPage from './TwinLabPage';
import * as fixtures from './advancedIntelligenceClosure.fixtures';

// Only source and download boundaries are replaced. LayoutCard, SourceContent,
// DataTable, chart frames, Recharts, inputs and confirmation dialogs are real.
const state = vi.hoisted(() => {
  function simulation<T>() {
    const result: { data?: T; error: Error | null; isPending: boolean; mutate: ReturnType<typeof vi.fn> } = {
      data: undefined, error: null, isPending: false, mutate: vi.fn(),
    };
    return result;
  }
  const reads: {
    firmware: DataStateSource<AdvancedPage<FirmwareCanary>>;
    survival: DataStateSource<AdvancedPage<ComponentSurvival>>;
    hazards: DataStateSource<HazardPage>;
    sentinel: DataStateSource<SentinelPage>;
    forensics: DataStateSource<ForensicsResponse>;
    federated: DataStateSource<FederatedStatusPage>;
    causal: DataStateSource<AdvancedPage<CausalExperiment>>;
    storm: DataStateSource<StormguardStatus>;
    events: DataStateSource<StormguardEvent[]>;
  } = {
    firmware: {}, survival: {}, hazards: {}, sentinel: {}, forensics: {},
    federated: {}, causal: {}, storm: {}, events: {},
  };
  return {
    reads,
    vehicleId: 7 as number | null,
    twin: simulation<TwinLabResponse>(),
    journey: simulation<JourneyAssuranceResponse>(),
    site: simulation<ChargingSiteTwinResponse>(),
    resilience: simulation<ResiliencePlanResponse>(),
    tco: simulation<TCOOptimizerResponse>(),
    causal: simulation<CausalExperiment>(),
    federated: simulation<FederatedRoundResult>(),
    stormSave: { mutate: vi.fn(), isPending: false, isError: false, error: null },
    fetchAll: vi.fn(),
    retry: vi.fn(),
    readCalls: {
      firmware: vi.fn(), survival: vi.fn(), hazards: vi.fn(), sentinel: vi.fn(),
      forensics: vi.fn(), federated: vi.fn(), causal: vi.fn(),
    },
  };
});

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useFirmwareCanary: (...args: unknown[]) => { state.readCalls.firmware(...args); return state.reads.firmware; },
  useComponentSurvival: (...args: unknown[]) => { state.readCalls.survival(...args); return state.reads.survival; },
  useRoadHazards: (...args: unknown[]) => { state.readCalls.hazards(...args); return state.reads.hazards; },
  useBehavioralSentinel: (...args: unknown[]) => { state.readCalls.sentinel(...args); return state.reads.sentinel; },
  useChargingForensics: (...args: unknown[]) => { state.readCalls.forensics(...args); return state.reads.forensics; },
  useFederatedModelCards: (...args: unknown[]) => { state.readCalls.federated(...args); return state.reads.federated; },
  useCausalExperiments: (...args: unknown[]) => { state.readCalls.causal(...args); return state.reads.causal; },
  fetchAllChargingForensics: (...args: unknown[]) => state.fetchAll(...args),
  useRunTwinLab: () => state.twin,
  useRunJourneyAssurance: () => state.journey,
  useRunChargingSiteTwin: () => state.site,
  useCreateResiliencePlan: () => state.resilience,
  useRunTCOOptimizer: () => state.tco,
  useCreateCausalExperiment: () => state.causal,
  useStartFederatedRound: () => state.federated,
}));
vi.mock('@/api/hooks/useStormguard', () => ({
  useStormguardStatus: () => state.reads.storm,
  useStormguardEvents: () => state.reads.events,
  useSaveStormguardConfig: () => state.stormSave,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}));

function renderSubject(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
    </QueryClientProvider>;
  }
  return render(element, { wrapper: Providers });
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest<HTMLElement>('[data-operational-brief], [data-card]');
  if (!element) throw new Error(`Missing actual card: ${title}`);
  return element;
}

function article(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('article');
  if (!element) throw new Error(`Missing actual article: ${title}`);
  return element;
}

function field(label: string | RegExp) {
  return screen.getByLabelText(typeof label === 'string'
    ? text => text === label || text === `${label} * required`
    : label);
}

function change(label: string | RegExp, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

function expectBefore(first: HTMLElement, second: HTMLElement) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
  state.vehicleId = 7;
  Object.keys(state.reads).forEach(key => {
    Object.assign(state.reads[key as keyof typeof state.reads], {
      data: undefined, error: null, isError: false, isLoading: false,
      isFetching: false, fetchStatus: 'idle', refetch: state.retry,
    });
  });
  [state.twin, state.journey, state.site, state.resilience, state.tco, state.causal, state.federated]
    .forEach(result => Object.assign(result, { data: undefined, error: null, isPending: false }));
  Object.assign(state.stormSave, { isPending: false, isError: false, error: null });
  state.fetchAll.mockReset().mockResolvedValue([]);
  window.localStorage.clear();
  // Deterministic allocation for real chart/table mounting, not visual proof.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1024, bottom: 300,
    width: 1024, height: 300, toJSON: () => ({}),
  });
});

afterEach(() => vi.restoreAllMocks());

describe('source-local observation and modeled evidence closure', () => {
  it('keeps actual retained children and retry while a sibling source fails its initial load', () => {
    const retained = { data: { value: 0 }, error: new Error('refresh failed'), refetch: state.retry };
    renderSubject(<>
      <InsightPanel title="Observed source" query={retained}><span>Observed zero</span></InsightPanel>
      <InsightPanel title="Modeled source" query={{ error: new Error('not calculated') }}><span>Invented result</span></InsightPanel>
    </>);
    expect(within(card('Observed source')).getByText('Observed zero')).toBeInTheDocument();
    expect(within(card('Observed source')).getByTestId('stale-refresh-warning')).toHaveTextContent('The refresh failed; the most recently loaded evidence remains visible.');
    fireEvent.click(within(within(card('Observed source')).getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
    expect(within(card('Modeled source')).getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('Invented result')).not.toBeInTheDocument();
  });

  it('retains a resolved empty answer and its stale notice without confusing it with unresolved or pending evidence', () => {
    renderSubject(<InsightPanel title="Resolved empty" query={{ data: [], error: new Error('refresh') }}
      empty emptyMessage="Authoritative empty observation"><span>Not an observation</span></InsightPanel>);
    expect(screen.getByText('Authoritative empty observation')).toBeInTheDocument();
    expect(screen.getByText('The refresh failed; the most recently loaded evidence remains visible.')).toBeInTheDocument();
    expect(screen.queryByText('Evidence availability has not resolved yet.')).not.toBeInTheDocument();
  });

  it('does not let initial loading erase a populated source when fetch flags overlap', () => {
    renderSubject(<InsightPanel title="Observed source" query={{ data: { value: 0 }, isLoading: true, isFetching: true }}>
      <span>Previously observed zero</span>
    </InsightPanel>);
    expect(screen.getByText('Previously observed zero')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading Observed source' })).not.toBeInTheDocument();
  });

  it('keeps quality zero, unknown coverage, exact observation window, ordered references and explicit limitations separate', () => {
    renderSubject(<EvidencePanel quality={fixtures.quality}
      evidence={[fixtures.observation, { ...fixtures.observation, source: 'second-source', sample_count: null }]}
      limitations={['Modeled range is not measured range.']} unsupported={['No vehicle actuation']} />);
    const quality = screen.getByRole('region', { name: 'Data quality' });
    expect(within(quality).getByText('0')).toBeInTheDocument();
    expect(within(quality).getByText('—')).toBeInTheDocument();
    expect(within(quality).getByText(/2026/)).toBeInTheDocument();
    expect(within(quality).getByText(/No meter coverage; do not infer a measured loss/)).toBeInTheDocument();
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    expectBefore(within(sources).getByText(fixtures.observation.source), within(sources).getByText('second-source'));
    expect(within(sources).getByText(/0 samples/)).toBeInTheDocument();
    expect(screen.getByText(/Modeled range is not measured range/)).toBeInTheDocument();
    expect(screen.getByText('Explicitly unsupported')).toBeInTheDocument();
    expect(screen.getByText(/No vehicle actuation/)).toBeInTheDocument();
  });
});

describe('returned history, details and caller-owned pagination', () => {
  const cases: Array<{
    name: string; Page: ComponentType; source: keyof typeof state.readCalls;
    size: number; populate: () => void; firstTitle: string;
  }> = [
    { name: 'firmware', Page: FirmwareCanaryPage, source: 'firmware', size: 10,
      populate: () => { state.reads.firmware.data = { items: [fixtures.firmware], total: 20, limit: 10, offset: 0 }; },
      firstTitle: '2026.20' },
    { name: 'survival', Page: ComponentSurvivalPage, source: 'survival', size: 12,
      populate: () => { state.reads.survival.data = { items: [fixtures.survival], total: 24, limit: 12, offset: 0 }; },
      firstTitle: 'front-bearing' },
    { name: 'hazards', Page: RoadHazardMeshPage, source: 'hazards', size: 18,
      populate: () => { state.reads.hazards.data = fixtures.hazards; },
      firstTitle: 'rough-surface' },
    { name: 'sentinel', Page: BehavioralSentinelPage, source: 'sentinel', size: 20,
      populate: () => { state.reads.sentinel.data = fixtures.sentinel; },
      firstTitle: 'command-observation' },
    { name: 'causal', Page: CausalExperimentationPage, source: 'causal', size: 10,
      populate: () => { state.reads.causal.data = { items: [fixtures.causal], total: 20, limit: 10, offset: 0 }; },
      firstTitle: 'observed-charging-window' },
    { name: 'federated', Page: FederatedLearningStudioPage, source: 'federated', size: 12,
      populate: () => { state.reads.federated.data = {
        items: [fixtures.modelCard], total: 24, limit: 12, offset: 0, vehicle_id: 7,
        total_epsilon_budget: 2, total_epsilon_spent: 1.5, privacy_statement: 'Local evidence only.',
        data_quality: fixtures.quality, evidence: [fixtures.observation], generated_at: '2026-08-03T00:00:00Z',
      }; },
      firstTitle: 'local-observation-model' },
  ];

  it.each(cases)('keeps $name details and exact server offsets during retained refresh failure', ({ Page, source, size, populate, firstTitle }) => {
    populate();
    const view = renderSubject(<Page />);
    expect(state.readCalls[source]).toHaveBeenLastCalledWith(7, size, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.readCalls[source]).toHaveBeenLastCalledWith(7, size, size);
    state.reads[source].error = new Error('refresh failed');
    view.rerender(<Page />);
    expect(screen.getByRole('heading', { name: firstTitle })).toBeInTheDocument();
    expect(screen.getAllByText(source === 'federated'
      ? 'Previously loaded data remains visible while affected sources recover.'
      : 'The refresh failed; the most recently loaded evidence remains visible.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(state.readCalls[source]).toHaveBeenLastCalledWith(7, size, 0);
  });

  it('keeps matched real-zero target regression distinct from unsupported peers and matched excess', () => {
    state.reads.firmware.data = { items: [fixtures.firmware], total: 1, limit: 10, offset: 0 };
    renderSubject(<FirmwareCanaryPage />);
    const decision = article('2026.20');
    expect(within(decision).getByText('0.00%')).toBeInTheDocument();
    expect(within(decision).getAllByText('—')).toHaveLength(2);
    expect(within(decision).getByText('insufficient')).toBeInTheDocument();
    expect(within(decision).getByText(/do not contain enough supported observations/)).toBeInTheDocument();
    expect(screen.getByText(/does not install, hold, or roll back firmware/)).toBeInTheDocument();
  });

  it('keeps every survival horizon, zero risk, unsupported risk and modeled intervention explanation', () => {
    state.reads.survival.data = { items: [fixtures.survival], total: 1, limit: 12, offset: 0 };
    renderSubject(<ComponentSurvivalPage />);
    const component = article('front-bearing');
    ['Survival probability', 'P10 horizon', 'P50 horizon', 'P90 horizon', 'Competing risks', 'Intervention sensitivity']
      .forEach(label => expect(within(component).getByText(label)).toBeInTheDocument());
    expect(within(component).getByText('0.00 h')).toBeInTheDocument();
    expect(within(component).getByText('2.00 h')).toBeInTheDocument();
    expect(within(component).getByText(/observed-wear.*0 evidence/)).toBeInTheDocument();
    expect(within(component).getByText(/unmeasured-corrosion.*0 evidence/)).toBeInTheDocument();
    expect(within(component).getByText('Unsupported')).toBeInTheDocument();
    expect(within(component).getByText(/modeled service only.*adjusted P50 —/)).toBeInTheDocument();
  });

  it('preserves coarse-cell evidence and all matrix details without inventing map coordinates', () => {
    state.reads.hazards.data = fixtures.hazards;
    renderSubject(<RoadHazardMeshPage />);
    const table = within(article('rough-surface')).getByRole('table', { name: 'Road hazard mesh' });
    expect(within(table).getAllByRole('rowheader').map(cell => cell.textContent))
      .toEqual(['Coarse cell', 'Confidence', 'Observations', 'Last seen']);
    expect(within(table).getByText('coarse-cell-only')).toBeInTheDocument();
    expect(within(table).getByText('0.00%')).toBeInTheDocument();
    expect(within(table).getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /map/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Cells are identifiers, not map pins/)).toBeInTheDocument();
  });
});

describe('full reconciliation table controls and canonical exports', () => {
  function populateForensics() {
    state.reads.forensics.data = {
      items: [fixtures.forensicsItem, fixtures.unsupportedForensicsItem],
      total: 30, limit: 15, offset: 0, data_quality: fixtures.quality, generated_at: '2026-08-03T00:00:00Z',
    };
  }

  it('keeps loaded rows, full-result scope, search, keyboard resize/density and column controls during refresh recovery', async () => {
    populateForensics();
    const view = renderSubject(<ChargingForensicsPage />);
    const table = screen.getByRole('table', { name: 'advanced-intelligence:charging-forensics' });
    expect(within(table).getByText('#44')).toBeInTheDocument();
    expect(within(table).getByText('12.00 kWh')).toBeInTheDocument();
    expect(within(table).getByText('3.00 kWh (2.00 kWh–4.00 kWh)')).toBeInTheDocument();
    expect(within(table).getByText('$4.50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'List density' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: 'List density' }), { key: 'ArrowLeft' });
    const resizer = within(table).getByRole('separator', { name: 'Resize column Session' });
    const initialWidth = Number(resizer.getAttribute('aria-valuenow'));
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(resizer).toHaveAttribute('aria-valuenow', String(initialWidth + 8));
    fireEvent.click(screen.getByRole('button', { name: 'Reorder or hide columns' }));
    const menu = screen.getByRole('menu', { name: 'Reorder or hide columns' });
    fireEvent.click(within(menu).getByRole('button', { name: 'Move Started up' }));
    expect(within(table).getAllByRole('columnheader')[0]).toHaveAttribute('aria-label', 'Started');
    fireEvent.click(within(menu).getByRole('button', { name: 'Reset' }));
    expect(within(table).getAllByRole('columnheader')[0]).toHaveAttribute('aria-label', 'Session');
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Show or hide Meter energy' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(table).queryByRole('columnheader', { name: 'Meter energy' })).not.toBeInTheDocument();
    state.reads.forensics.error = new Error('refresh failed');
    view.rerender(<ChargingForensicsPage />);
    expect(within(table).getByText('#45')).toBeInTheDocument();
    expect(within(table).getByRole('separator', { name: 'Resize column Session' }))
      .toHaveAttribute('aria-valuenow', String(initialWidth + 8));
    expect(screen.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Exports include the full reconciliation result/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.readCalls.forensics).toHaveBeenLastCalledWith(7, 15, 15);
    expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '#45' } });
    expect(screen.getByRole('searchbox')).toHaveValue('#45');
    await waitFor(() => expect(within(table).queryByText('#44')).not.toBeInTheDocument());
    expect(within(table).getByText('#45')).toBeInTheDocument();
    expect(state.reads.forensics.data?.items).toHaveLength(2);
    expect(state.fetchAll).not.toHaveBeenCalled();
  });

  it.each(['json', 'csv'] as const)('exports every returned row and original raw field as %s even when a display column is hidden', async format => {
    populateForensics();
    const offPage = { ...fixtures.forensicsItem, session_id: 99 };
    state.fetchAll.mockResolvedValue([fixtures.forensicsItem, fixtures.unsupportedForensicsItem, offPage]);
    renderSubject(<ChargingForensicsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Reorder or hide columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show or hide Vehicle energy' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: format === 'json' ? 'Download as JSON' : 'Download as CSV' }));
    await waitFor(() => expect(format === 'json' ? downloadJSON : downloadCSV).toHaveBeenCalledOnce());
    expect(state.fetchAll).toHaveBeenCalledExactlyOnceWith(7);
    expect(screen.queryByText('#99')).not.toBeInTheDocument();
    if (format === 'json') {
      expect(downloadJSON).toHaveBeenCalledWith('charging-forensics', [
        {
          session_id: 44, started_at: fixtures.forensicsItem.started_at,
          vehicle_energy_wh: 12000, meter_energy_wh: 15000, estimated_loss_wh: 3000,
          estimated_loss_low_wh: 2000, estimated_loss_high_wh: 4000,
          recorded_cost_minor: 450, expected_cost_minor: 420, cost_discrepancy_minor: 30,
          currency: 'USD', status: 'reconciled',
        },
        {
          session_id: 45, started_at: fixtures.forensicsItem.started_at,
          vehicle_energy_wh: 0, meter_energy_wh: '', estimated_loss_wh: '',
          estimated_loss_low_wh: '', estimated_loss_high_wh: '',
          recorded_cost_minor: 0, expected_cost_minor: '', cost_discrepancy_minor: '',
          currency: 'USD', status: 'partial',
        },
        expect.objectContaining({ session_id: 99, estimated_loss_high_wh: 4000, currency: 'USD' }),
      ]);
    } else {
      const csv = vi.mocked(downloadCSV).mock.calls[0]?.[1];
      expect(csv).toContain('session_id,started_at,vehicle_energy_wh,meter_energy_wh,estimated_loss_wh,estimated_loss_low_wh,estimated_loss_high_wh,recorded_cost_minor,expected_cost_minor,cost_discrepancy_minor,currency,status');
      expect(csv).toContain('12000,15000,3000,2000,4000,450,420,30,USD,reconciled');
      expect(csv).toContain('99,');
      expect(csv?.trim().split('\n')).toHaveLength(4);
    }
  });

  it('announces a failed full-result export without deleting rows and allows the same control to recover', async () => {
    populateForensics();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.fetchAll.mockRejectedValueOnce(new Error('full-result source unavailable'))
      .mockResolvedValueOnce([fixtures.forensicsItem]);
    renderSubject(<ChargingForensicsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(downloadJSON).not.toHaveBeenCalled();
    expect(screen.getByText('#44')).toBeInTheDocument();
    expect(screen.getByText('#45')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    expect(state.fetchAll).toHaveBeenCalledTimes(2);
  });
});

describe('modeled analysis outputs and complete chart alternatives', () => {
  it.each([
    { Page: TwinLabPage, id: 'advanced-intelligence-twin-brief', metricCount: 4 },
    { Page: JourneyAssurancePage, id: 'advanced-intelligence-journey-brief', metricCount: 4 },
    { Page: ChargingSiteTwinPage, id: 'advanced-intelligence-site-brief', metricCount: 6 },
    { Page: EmergencyResiliencePage, id: 'advanced-intelligence-resilience-brief', metricCount: 2 },
    { Page: FederatedLearningStudioPage, id: 'advanced-intelligence-federated-brief', metricCount: 3 },
  ])('keeps $id mounted with unknown rather than zero metrics before its source returns', ({ Page, id, metricCount }) => {
    renderSubject(<Page />);
    const brief = screen.getByTestId(id);
    expect(brief).toHaveAttribute('data-operational-brief');
    const metrics = brief.querySelectorAll('[data-operational-metric]');
    expect(metrics).toHaveLength(metricCount);
    metrics.forEach(metric => {
      expect(metric).toHaveAttribute('data-value-state', 'missing');
      expect(metric.querySelector('[data-operational-value]')).toHaveTextContent('—');
    });
    expect(within(brief).getByRole('button', { name: 'Review details' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
  });

  it('opens the real Twin brief drawer with calibration evidence, source windows, model limitations and raw-aware metric captions', async () => {
    state.twin.data = structuredClone(fixtures.twin);
    renderSubject(<TwinLabPage />);
    const brief = screen.getByTestId('advanced-intelligence-twin-brief');
    expect(brief.querySelector('[data-operational-metric="usable-battery"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="efficiency"]')).toHaveAttribute('data-value-state', 'missing');
    expect(within(brief).getByText('Limited evidence')).toBeInTheDocument();
    expect(within(brief).getByText(/Observation window:/)).toBeInTheDocument();
    expect(within(brief).getByText(/Result generated:/)).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Calibrated baseline details' });
    expect(within(drawer).getByText(/Observed vehicle energy, not a simulated outcome.*0 samples/)).toBeInTheDocument();
    expect(within(drawer).getAllByText(/Modeled range is not an observed route/)).toHaveLength(2);
    expect(within(drawer).getByText(/recorded-session-ledger/)).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(within(drawer).getByText(/No meter coverage; do not infer a measured loss/)).toBeInTheDocument();
    expect(within(drawer).getByText('calibrated-not-guaranteed')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Range-effect uncertainty comparison' })).toBeInTheDocument();
    expect(state.twin.mutate).not.toHaveBeenCalled();
  });

  it('marks initial modeled summaries busy without hiding scenario forms or inventing values', () => {
    state.site.isPending = true;
    renderSubject(<ChargingSiteTwinPage />);
    const brief = screen.getByTestId('advanced-intelligence-site-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Run confirmed site simulation' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Site scenario' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ranked mitigations and assumptions' })).toBeInTheDocument();
  });

  it('does not relabel a source-projected unstable queue or non-finite queue bound as a healthy or zero result', () => {
    state.site.data = { ...fixtures.site, projected_unstable: true, queue_wait_p90_s: Number.NaN };
    renderSubject(<ChargingSiteTwinPage />);
    const brief = screen.getByTestId('advanced-intelligence-site-brief');
    expect(within(brief).getByText('Unstable')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="projection-status"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="queue-p90"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(brief.querySelector('[data-operational-metric="queue-p90"] [data-operational-value]')).toHaveTextContent('—');
    expect(state.site.data.queue_wait_p90_s).toBeNaN();
    expect(state.site.data.projected_unstable).toBe(true);
    expect(state.site.mutate).not.toHaveBeenCalled();
  });

  it('keeps the original modeled result and detail action while another site calculation is pending or fails', () => {
    state.site.data = fixtures.site;
    state.site.isPending = false;
    const view = renderSubject(<ChargingSiteTwinPage />);
    state.site.isPending = true;
    view.rerender(<ChargingSiteTwinPage />);
    const brief = screen.getByTestId('advanced-intelligence-site-brief');
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(within(brief).getByText('Updating result')).toBeInTheDocument();
    expect(within(brief).getByText('Stable')).toBeInTheDocument();
    state.site.isPending = false;
    state.site.error = new Error('recalculation unavailable');
    view.rerender(<ChargingSiteTwinPage />);
    expect(within(brief).getByText('Retained result')).toBeInTheDocument();
    expect(within(brief).getByText('0.00 h')).toBeInTheDocument();
    expect(within(brief).getByRole('button', { name: 'Review details' })).toBeEnabled();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run confirmed site simulation' })).toBeEnabled();
  });

  it('preserves subject privacy raw dimensionless values and a genuine zero balance during a failed refresh', () => {
    state.reads.federated = {
      data: {
        items: [fixtures.modelCard], total: 24, limit: 12, offset: 0, vehicle_id: 7,
        total_epsilon_budget: 1.5, total_epsilon_spent: 2, privacy_statement: 'Local evidence only.',
        data_quality: fixtures.quality, evidence: [fixtures.observation], generated_at: '2026-08-03T00:00:00Z',
      },
      error: new Error('privacy refresh failed'), refetch: state.retry,
    };
    renderSubject(<FederatedLearningStudioPage />);
    const brief = screen.getByTestId('advanced-intelligence-federated-brief');
    expect(brief.querySelector('[data-operational-metric="epsilon-budget"] [data-operational-value]')).toHaveTextContent('1.50');
    expect(brief.querySelector('[data-operational-metric="epsilon-spent"] [data-operational-value]')).toHaveTextContent('2.00');
    expect(brief.querySelector('[data-operational-metric="epsilon-remaining"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="epsilon-remaining"] [data-operational-value]')).toHaveTextContent('0.00');
    expect(within(brief).getByText('Retained result')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review privacy spend' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'local-observation-model' })).toBeInTheDocument();
    expect(state.federated.mutate).not.toHaveBeenCalled();
  });

  it('preserves every uncertainty bound, unknown versus zero, calibration and sensitivity ordering in the actual Twin chart frame', () => {
    state.twin.data = structuredClone(fixtures.twin);
    const original = structuredClone(state.twin.data);
    renderSubject(<TwinLabPage />);
    const baseline = card('Calibrated baseline');
    expect(within(baseline).getByText('calibrated-not-guaranteed')).toBeInTheDocument();
    expect(within(baseline).getByText('0.00 kWh')).toBeInTheDocument();
    expect(within(baseline).getByText('0')).toBeInTheDocument();
    expect(within(baseline).getByText('—')).toBeInTheDocument();
    const chart = card('Range-effect uncertainty comparison');
    const table = within(chart).getByRole('table', { name: 'Range-effect uncertainty comparison — data table' });
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Scenario name', 'Low', 'Estimate', 'High']);
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Modeled A', '-1', '0', '2']);
    expect(within(rows[2]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Unsupported B', '—', '—', '—']);
    expectBefore(screen.getByText('first-assumption'), screen.getByText('second-assumption'));
    expect(screen.getByText(fixtures.observation.summary)).toBeInTheDocument();
    expect(screen.getByText(/Modeled range is not an observed route/)).toBeInTheDocument();
    const exportButton = within(chart).getByRole('button', { name: 'Export chart' });
    fireEvent.click(exportButton);
    expect(within(chart).getByRole('menuitem', { name: 'Save as PNG' })).toBeInTheDocument();
    expect(within(chart).getByRole('menuitem', { name: 'Save as SVG' })).toBeInTheDocument();
    expect(within(chart).getByRole('menuitem', { name: 'Copy image to clipboard' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(chart).queryByRole('menu')).not.toBeInTheDocument();
    expect(exportButton).toHaveAttribute('aria-expanded', 'false');
    expect(state.twin.data).toEqual(original);
    expect(state.twin.mutate).not.toHaveBeenCalled();
  });

  it('retains the single-scenario floor, twelve-scenario ceiling, nullable temperature and every caller-edited SI input', () => {
    renderSubject(<TwinLabPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove scenario' })[1]);
    expect(screen.getByRole('button', { name: 'Remove scenario' })).toBeDisabled();
    const edits: Array<[RegExp, string]> = [
      [/Scenario name/, 'Caller scenario'],
      [/Route distance/, '123456'],
      [/Average speed/, '12.5'],
      [/Scenario horizon/, '7200'],
      [/Outside temperature/, ''],
      [/Auxiliary load/, '0'],
    ];
    edits.forEach(([label, value]) => change(label, value));
    for (let count = 1; count < 12; count++) fireEvent.click(screen.getByRole('button', { name: 'Add scenario' }));
    expect(screen.getAllByLabelText(/Scenario name/)).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Add scenario' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run confirmed simulation' }));
    expect(state.twin.mutate).toHaveBeenCalledWith({
      vehicle_id: 7, confirmed: true,
      scenarios: [
        { name: 'Caller scenario', horizon_s: 7200, distance_m: 123456, speed_mps: 12.5, outside_temp_c: null, auxiliary_load_w: 0 },
        ...Array.from({ length: 11 }, (_, index) => ({
          name: `Scenario ${index + 2}`, horizon_s: 3600, distance_m: 60000,
          speed_mps: 27, outside_temp_c: 20, auxiliary_load_w: 1000,
        })),
      ],
    });
  });

  it('keeps modeled site assumptions visible even when no mitigation is returned, including null queue uncertainty', () => {
    state.site.data = { ...fixtures.site, mitigations: [] };
    renderSubject(<ChargingSiteTwinPage />);
    expect(screen.getByText(/Poisson arrivals are modeled, not live charger telemetry/)).toBeInTheDocument();
    expect(screen.queryByText('No supported mitigations were returned.')).not.toBeInTheDocument();
    const constraints = card('Utilization and constraints');
    expect(within(constraints).getByText('0.00 h')).toBeInTheDocument();
    expect(within(constraints).getByText('—')).toBeInTheDocument();
    expect(within(constraints).getByText('Stable')).toBeInTheDocument();
    expect(screen.getByText(/do not dispatch storage, change charger limits, or operate a site/)).toBeInTheDocument();
    expect(state.site.mutate).not.toHaveBeenCalled();
  });

  it('keeps returned mitigation ranks in caller order rather than re-ranking or actuating the site', () => {
    state.site.data = fixtures.site;
    renderSubject(<ChargingSiteTwinPage />);
    expectBefore(screen.getByRole('heading', { name: 'Caller order first' }), screen.getByRole('heading', { name: 'Caller order second' }));
    expect(screen.getByText('Assumed arrivals only.')).toBeInTheDocument();
    expect(screen.getByText('No site command.')).toBeInTheDocument();
    expect(screen.getByText(/Queue -20.00% · peak -2.00 kW/)).toBeInTheDocument();
    expect(state.site.mutate).not.toHaveBeenCalled();
  });

  it('keeps complete journey factors and unsupported arrival bounds, without upgrading modeled factors to observations', () => {
    state.journey.data = fixtures.journey;
    renderSubject(<JourneyAssurancePage />);
    const summary = card('Readiness and arrival range');
    expect(within(summary).getAllByText('0.00%')).toHaveLength(2);
    expect(within(summary).getAllByText('—')).toHaveLength(2);
    expectBefore(screen.getByRole('heading', { name: 'observed charge' }), screen.getByRole('heading', { name: 'modeled weather' }));
    expect(within(article('observed charge')).getByText('0.00%')).toBeInTheDocument();
    expect(within(article('modeled weather')).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Unknown weather is not zero degrees.')).toBeInTheDocument();
    expect(screen.getByText(/does not reserve chargers, navigate, precondition, or command/)).toBeInTheDocument();
    expect(state.journey.mutate).not.toHaveBeenCalled();
  });

  it('preserves the full TCO matrices, unsupported cost/budget versus real zero, constraints and strategy order', () => {
    state.tco.data = fixtures.tco;
    renderSubject(<TCOOptimizerPage />);
    const unknown = article('unsupported-price-strategy');
    const known = article('zero-recorded-cost-strategy');
    expectBefore(unknown, known);
    expect(within(unknown).getAllByText('Unsupported')).toHaveLength(2);
    expect(within(unknown).getByText('—')).toBeInTheDocument();
    expect(within(known).getByText('$0.00')).toBeInTheDocument();
    expect(within(known).getByText('Within budget')).toBeInTheDocument();
    expect(within(known).getByText('Pareto-efficient')).toBeInTheDocument();
    expect(within(unknown).getAllByRole('rowheader').map(cell => cell.textContent))
      .toEqual(['Projected cost', 'Risk score', 'Convenience', 'Home / public mix', 'Budget status']);
    expect(screen.getByText(/No complete maintenance source/)).toBeInTheDocument();
    expect(screen.getByText(/Optimization is not a purchase/)).toBeInTheDocument();
    expect(state.tco.mutate).not.toHaveBeenCalled();
  });
});

describe('independent forecast, event history and modeled outage sources', () => {
  it.each(['initialFailure', 'loading'] as const)('retains event evidence and modeled outage results when forecast status is %s', failure => {
    state.reads.events = { data: fixtures.stormEvents, error: new Error('event refresh failed'), refetch: state.retry };
    state.reads.storm = failure === 'initialFailure'
      ? { error: new Error('forecast source failed'), refetch: state.retry }
      : { isLoading: true, fetchStatus: 'fetching' };
    state.resilience.data = fixtures.resilience;
    renderSubject(<EmergencyResiliencePage />);
    const history = screen.getByRole('region', { name: 'Recent activity' });
    expect(within(history).getAllByRole('listitem')).toHaveLength(5);
    expect(within(history).getByText('Recorded storm event 1')).toBeInTheDocument();
    expect(within(history).getByText('Recorded storm event 5')).toBeInTheDocument();
    expect(within(history).queryByText('Recorded storm event 6')).not.toBeInTheDocument();
    expect(within(history).getByText(/acted/)).toBeInTheDocument();
    expect(within(history).getByRole('status')).toHaveTextContent('Previously loaded data remains visible');
    fireEvent.click(within(history).getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
    expect(within(card('Survival horizon')).getByText('2.00 h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create confirmed outage plan' })).toBeEnabled();
    expect(state.resilience.mutate).not.toHaveBeenCalled();
    expect(state.stormSave.mutate).not.toHaveBeenCalled();
  });

  it('keeps every modeled timeline checkpoint/risk and load/recommendation order in a real chart/table while storm events initially fail', () => {
    state.reads.storm = { data: fixtures.storm };
    state.reads.events = { error: new Error('history unavailable'), refetch: state.retry };
    state.resilience.data = fixtures.resilience;
    renderSubject(<EmergencyResiliencePage />);
    const chart = card('Outage risk timeline');
    const table = within(chart).getByRole('table', { name: 'Outage risk timeline — data table' });
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Time', 'Remaining energy', 'Risk']);
    expect(within(table).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell').map(cell => cell.textContent)))
      .toEqual([['0', '12', 'supported'], ['1', '6', 'modeled'], ['2', '0', 'depleted']]);
    expect(screen.getByText('Observed forecast, not modeled outage.')).toBeInTheDocument();
    expect(screen.getByText('Battery 0%')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recent activity' })).toHaveTextContent('Recent storm activity could not be loaded.');
    expectBefore(screen.getByRole('heading', { name: 'Caller priority first' }), screen.getByRole('heading', { name: 'Caller priority second' }));
    expectBefore(screen.getByText(/Review evacuation reserve/), screen.getByText(/No automatic shedding/));
    fireEvent.click(within(chart).getByRole('button', { name: 'Export chart' }));
    expect(within(chart).getAllByRole('menuitem')).toHaveLength(3);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(chart).queryByRole('menu')).not.toBeInTheDocument();
  });

  it('retains caller edits and weather assessment on a failed status refresh without treating an unresolved event source as an empty history', () => {
    state.reads.storm = { data: fixtures.storm };
    const view = renderSubject(<StormGuardPanel vehicleId={7} />);
    change('Home latitude', '38.1');
    state.reads.storm.error = new Error('status refresh failed');
    state.reads.storm.isLoading = true;
    state.reads.events.fetchStatus = 'paused';
    view.rerender(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('Observed forecast, not modeled outage.')).toBeInTheDocument();
    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(field('Home latitude')).toHaveValue('38.1');
    expect(screen.getByRole('button', { name: 'Save guard' })).toBeEnabled();
    expect(screen.getByText('Recent storm activity has not resolved yet; no empty result is inferred.')).toBeInTheDocument();
    expect(screen.queryByText('No recent storm activity was returned.')).not.toBeInTheDocument();
    expect(state.stormSave.mutate).not.toHaveBeenCalled();
  });

  it('keeps an authoritative empty storm history visible with its refresh warning rather than reverting to unresolved evidence', () => {
    state.reads.storm = { data: fixtures.storm };
    state.reads.events = { data: [], error: new Error('event refresh failed'), refetch: state.retry };
    renderSubject(<StormGuardPanel vehicleId={7} />);
    const history = screen.getByRole('region', { name: 'Recent activity' });
    expect(within(history).getByText('No recent storm activity was returned.')).toBeInTheDocument();
    expect(within(history).getByRole('status')).toHaveTextContent('Previously loaded data remains visible');
    expect(within(history).queryByText(/has not resolved yet/)).not.toBeInTheDocument();
    expect(screen.getByText('Observed forecast, not modeled outage.')).toBeInTheDocument();
  });
});

describe('complete caller-owned analysis inputs and propose-only actions', () => {
  it('submits all site electrical, arrival/service, growth and optional SI inputs without treating blanks as measurements', () => {
    renderSubject(<ChargingSiteTwinPage />);
    const values: Array<[string | RegExp, string]> = [
      ['Charger count', '4'], [/Per-charger power/, '22000'], [/Panel limit/, '88000'],
      [/Arrival rate/, '0.002'], [/Mean service time/, '3600'], [/Fleet growth/, '25'],
      ['Arrival distribution', 'fixed'], ['Service distribution', 'deterministic'],
      [/Solar power/, '0'], [/Storage energy/, ''],
    ];
    values.forEach(([label, value]) => change(label, value));
    expect(field(/Arrival rate/)).toBeValid();
    expect(state.site.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run confirmed site simulation' }));
    expect(state.site.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, confirmed: true, charger_count: 4, charger_power_w: 22000,
      panel_limit_w: 88000, arrival_rate_per_s: 0.002, mean_service_s: 3600,
      fleet_growth_pct: 25, arrival_distribution: 'fixed', service_distribution: 'deterministic',
      solar_power_w: 0, storage_energy_wh: null,
    });
  });

  it('submits the complete journey scenario with explicit local departure converted to ISO, optional zero and unknown fields intact', () => {
    renderSubject(<JourneyAssurancePage />);
    const departure = '2026-08-12T10:30';
    change(/Route distance/, '123456');
    change('Departure', departure);
    change('Reserve target (%)', '20');
    change(/Outside temperature/, '0');
    change(/Average speed/, '25');
    change(/Auxiliary load/, '');
    expect(state.journey.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run confirmed readiness assessment' }));
    expect(state.journey.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, confirmed: true, route_distance_m: 123456,
      departure_at: new Date(departure).toISOString(), reserve_target_pct: 20,
      outside_temp_c: 0, average_speed_mps: 25, auxiliary_load_w: null,
    });
  });

  it('keeps modeled outage proposals independent of Storm guard saves and submits all caller-owned SI inputs', () => {
    renderSubject(<EmergencyResiliencePage />);
    const values: Array<[RegExp, string]> = [
      [/Vehicle energy/, '50000'], [/Stationary storage/, '10000'],
      [/Expected solar energy/, '0'], [/Essential load/, '1000'],
      [/Outage duration/, '86400'], [/Evacuation reserve/, '12000'],
      [/Restoration uncertainty/, '30'],
    ];
    values.forEach(([label, value]) => change(label, value));
    fireEvent.click(screen.getByRole('button', { name: 'Create confirmed outage plan' }));
    expect(state.resilience.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, confirmed: true, vehicle_energy_wh: 50000, stationary_storage_wh: 10000,
      expected_solar_wh: 0, essential_load_w: 1000, outage_duration_s: 86400,
      evacuation_reserve_wh: 12000, restoration_uncertainty_pct: 30,
    });
    expect(state.stormSave.mutate).not.toHaveBeenCalled();
  });

  it('preserves both charging-share edit directions, currency minor units and every TCO constraint in the caller proposal', () => {
    renderSubject(<TCOOptimizerPage />);
    change('Home charging (%)', '65');
    expect(field('Public charging (%)')).toHaveValue(35);
    change('Public charging (%)', '40');
    expect(field('Home charging (%)')).toHaveValue(60);
    change(/Planning horizon/, '31536000');
    change(/Annual distance/, '12345678');
    change('Risk tolerance (%)', '0');
    change('Budget (minor units)', '123456');
    change('ISO currency code', 'jpy');
    expect(field('ISO currency code')).toHaveValue('JPY');
    expect(state.tco.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Generate confirmed alternatives' }));
    expect(state.tco.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, confirmed: true, horizon_s: 31536000, annual_distance_m: 12345678,
      home_charging_pct: 60, public_charging_pct: 40, risk_tolerance_pct: 0,
      budget_minor: 123456, currency: 'JPY',
    });
  });

  const scenarios: Array<{
    Page: ComponentType; result: 'twin' | 'journey' | 'site' | 'resilience' | 'tco'; action: string;
  }> = [
    { Page: TwinLabPage, result: 'twin', action: 'Run confirmed simulation' },
    { Page: JourneyAssurancePage, result: 'journey', action: 'Run confirmed readiness assessment' },
    { Page: ChargingSiteTwinPage, result: 'site', action: 'Run confirmed site simulation' },
    { Page: EmergencyResiliencePage, result: 'resilience', action: 'Create confirmed outage plan' },
    { Page: TCOOptimizerPage, result: 'tco', action: 'Generate confirmed alternatives' },
  ];

  it.each(scenarios)('blocks $action while pending and preserves a caller-visible failure when it recovers', ({ Page, result, action }) => {
    state[result].isPending = true;
    const view = renderSubject(<Page />);
    expect(screen.getByRole('button', { name: action })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(state[result].mutate).not.toHaveBeenCalled();
    state[result].isPending = false;
    state[result].error = new Error('Analysis source failed; no vehicle change occurred.');
    view.rerender(<Page />);
    expect(screen.getByText('Analysis source failed; no vehicle change occurred.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: action })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(state[result].mutate).not.toHaveBeenCalled();
  });

  it.each(scenarios)('blocks $action when the workspace has no vehicle without inventing a local selector', ({ Page, result, action }) => {
    state.vehicleId = null;
    renderSubject(<Page />);
    expect(screen.getByRole('button', { name: action })).toBeDisabled();
    expect(screen.queryByLabelText('Select vehicle')).not.toBeInTheDocument();
    expect(state[result].mutate).not.toHaveBeenCalled();
  });

  it('populates the next local round from the selected actual model card, keeps all table fields and requires an explicit confirmation', () => {
    state.reads.federated.data = {
      items: [fixtures.modelCard], total: 1, limit: 12, offset: 0, vehicle_id: 7,
      total_epsilon_budget: 2, total_epsilon_spent: 1.5, privacy_statement: 'Local evidence only.',
      data_quality: fixtures.quality, evidence: [fixtures.observation], generated_at: '2026-08-03T00:00:00Z',
    };
    renderSubject(<FederatedLearningStudioPage />);
    const model = article('local-observation-model');
    expect(within(model).getAllByRole('rowheader').map(cell => cell.textContent))
      .toEqual(['Epsilon', 'Rounds', 'Latest local samples', 'Local aggregate']);
    expect(within(model).getByText('1.50 / 2.00')).toBeInTheDocument();
    expect(within(model).getByText('4')).toBeInTheDocument();
    expect(within(model).getByText('0')).toBeInTheDocument();
    expect(within(model).getByText('—')).toBeInTheDocument();
    fireEvent.click(within(model).getByRole('button', { name: 'Use for next local round' }));
    expect(field('Model name')).toHaveValue('local-observation-model');
    expect(field('Model version')).toHaveValue('v4');
    expect(field('Expected model-card version')).toHaveValue(8);
    expect(field('Requested epsilon')).toHaveValue(0.1);
    expect(field('Epsilon budget')).toHaveValue(2);
    expect(state.federated.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review privacy spend' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(state.federated.mutate).not.toHaveBeenCalled();
    change('Requested epsilon', '0.25');
    fireEvent.click(screen.getByRole('button', { name: 'Review privacy spend' }));
    expect(within(screen.getByRole('dialog')).getByText(/never uploads raw vehicle data/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start local round' }));
    expect(state.federated.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, model_name: 'local-observation-model', model_version: 'v4',
      task: 'efficiency', expected_version: 8, epsilon: 0.25, epsilon_budget: 2, confirmed: true,
    }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it('keeps independently returned round evidence visible when the model-card source fails', () => {
    state.reads.federated.error = new Error('model cards unavailable');
    state.federated.data = {
      model_card: fixtures.modelCard,
      round: {
        id: 5, model_card_id: fixtures.modelCard.id, round_number: 5,
        requested_epsilon: 0.1, epsilon_spent: 0, sample_count: 0,
        local_metric_wh_per_m: null, clipped_update_pct: null, status: 'insufficient',
        started_at: '2026-08-03T00:00:00Z', completed_at: null,
      },
      data_quality: { ...fixtures.quality, reasons: ['Independent round source.'] },
      evidence: [{ ...fixtures.observation, source: 'local-round-source' }],
    };
    renderSubject(<FederatedLearningStudioPage />);
    expect(screen.getAllByText('Intelligence evidence could not be loaded.')).toHaveLength(2);
    expect(screen.getByText('local-round-source')).toBeInTheDocument();
    expect(screen.getByText(/Independent round source/)).toBeInTheDocument();
    expect(field('Model name')).toBeInTheDocument();
    expect(screen.getByText(/Raw-data or gradient upload/)).toBeInTheDocument();
    expect(state.federated.mutate).not.toHaveBeenCalled();
  });

  it('keeps every caller-chosen causal window/metric and cancels proposed intervention execution before confirming an observational estimate', () => {
    state.reads.causal.error = new Error('history unavailable');
    renderSubject(<CausalExperimentationPage />);
    change('Intervention', 'tire_service');
    change('Metric', 'average_speed_mps');
    const windows = {
      baseline_start: '2026-07-01T08:00', baseline_end: '2026-07-03T08:00',
      treatment_start: '2026-07-04T08:00', treatment_end: '2026-07-06T08:00',
    };
    change('Baseline start', windows.baseline_start);
    change('Baseline end', windows.baseline_end);
    change('Treatment start', windows.treatment_start);
    change('Treatment end', windows.treatment_end);
    fireEvent.click(screen.getByRole('button', { name: 'Review experiment' }));
    expect(within(screen.getByRole('dialog')).getByText(/does not execute the intervention or prove causality/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(state.causal.mutate).not.toHaveBeenCalled();
    expect(field('Baseline start')).toHaveValue(windows.baseline_start);
    fireEvent.click(screen.getByRole('button', { name: 'Review experiment' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create estimate' }));
    expect(state.causal.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, confirmed: true, intervention_kind: 'tire_service', metric: 'average_speed_mps',
      baseline_start: new Date(windows.baseline_start).toISOString(),
      baseline_end: new Date(windows.baseline_end).toISOString(),
      treatment_start: new Date(windows.treatment_start).toISOString(),
      treatment_end: new Date(windows.treatment_end).toISOString(),
    }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it.each([
    { metric: 'drive_energy_wh_per_m' as const, patch: { baseline_energy_wh_per_m: 0.2, treatment_energy_wh_per_m: 0, effect_energy_wh_per_m: null },
      baseline: '0.20 kWh/km', treatment: '0.00 kWh/km' },
    { metric: 'average_speed_mps' as const, patch: { baseline_speed_mps: 10, treatment_speed_mps: 0, effect_speed_mps: null },
      baseline: '36.00 km/h', treatment: '0.00 km/h' },
  ])('keeps baseline/treatment/effect/samples/confounders distinct for $metric with real SI formatting', ({ metric, patch, baseline, treatment }) => {
    state.reads.causal.data = { items: [{ ...fixtures.causal, ...patch, metric }], total: 1, limit: 10, offset: 0 };
    renderSubject(<CausalExperimentationPage />);
    const history = article('observed-charging-window');
    expect(within(history).getByText(baseline)).toBeInTheDocument();
    expect(within(history).getByText(treatment)).toBeInTheDocument();
    expect(within(history).getAllByText('—')).toHaveLength(2);
    expect(within(history).getByText('0 samples')).toBeInTheDocument();
    expect(within(history).getByText('2 samples')).toBeInTheDocument();
    ['Baseline', 'Treatment', 'Estimated effect', 'Confounder coverage']
      .forEach(label => expect(within(history).getByText(label)).toBeInTheDocument());
    expect(screen.getByText('Association is not proof of causality')).toBeInTheDocument();
    expect(state.causal.mutate).not.toHaveBeenCalled();
  });
});
