import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { SignalEvidenceBundleResult } from '@/api/hooks/useTelemetry';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { analyzeRootCause } from '../lib/rootCauseIntelligence';
import RootCauseIntelligencePage from './RootCauseIntelligencePage';

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), announcement: vi.fn() }));
vi.mock('../hooks/useRootCauseWorkspace', () => ({
  ROOT_CAUSE_WINDOW_HOUR_PRESETS: [24, 72, 168, 720],
  useRootCauseWorkspace: () => mocks.workspace(),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 4 }) }));
vi.mock('@/hooks/useStatusAnnouncer', () => ({ useLoadAnnouncement: mocks.announcement }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: 'C', pressure: 'bar',
      energy: 'kWh', power: 'kW', duration: 'h', locale: 'en-US', precision: 2,
    },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('react-i18next', async (importActual) => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string' ? fallback
        : typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

function history(signal: string, value: SignalHistoryResponse['data'][number]['value'] = 0): SignalHistoryResponse {
  const data = Array.from({ length: 48 }, (_, index) => ({
    ts: new Date(Date.UTC(2026, 9, 6, 0, index)).toISOString(),
    kind: typeof value === 'number' ? 'ValueKindDouble'
      : typeof value === 'string' ? 'ValueKindString' : 'ValueKindBoolean',
    value, ingest_origin: null, source_emitted_at: null, received_at: null, normalization_version: null,
  }));
  return { vehicleId: 4, signal, from: data[0]!.ts, to: data[47]!.ts, count: data.length, data };
}

function workspace(focal: DataStateSource<SignalHistoryResponse>) {
  const neighbor = history('PackVoltage', 400);
  const retryFocal = vi.fn();
  const evidenceBundle: SignalEvidenceBundleResult = {
    data: [
      ...(focal.data ? [{ signal: 'Soc', response: focal.data }] : []),
      { signal: 'PackVoltage', response: neighbor },
    ],
    sources: [
      { signal: 'Soc', state: deriveDataState({ ...focal, refetch: retryFocal }, {
        provenance: 'historical', unavailable: focal.data?.data.length === 0,
      }) },
      { signal: 'PackVoltage', state: deriveDataState({ data: neighbor }, { provenance: 'historical' }) },
    ],
    isLoading: focal.isLoading ?? false, isFetching: focal.isFetching ?? false,
    isError: focal.error != null, error: focal.error ?? null, refetch: vi.fn(async () => {}),
  };
  return {
    catalog: ['Soc', 'PackVoltage'],
    signalsQuery: { data: ['Soc', 'PackVoltage'], isLoading: false, isFetching: false, refetch: vi.fn() },
    focalSignal: 'Soc', setFocalSignal: vi.fn(), windowHours: 72, setWindowHours: vi.fn(),
    hasChosenSignal: true, isDefensible: false, relatedCandidates: [],
    evidenceBundle, retryFocal,
    analysis: analyzeRootCause({
      focalSignal: 'Soc', catalog: ['Soc', 'PackVoltage'],
      focalPoints: (focal.data?.data ?? []).map(point => ({
        ts: point.ts, value: typeof point.value === 'boolean' ? null : point.value,
      })),
      relatedSeries: [{ signal: 'PackVoltage', points: neighbor.data }],
    }),
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><RootCauseIntelligencePage /></MemoryRouter></QueryClientProvider>);
}

function interpretation() {
  return screen.getByRole('heading', { name: 'Interpretation & limits' }).closest('[data-print-card]')!;
}

beforeEach(() => {
  mocks.workspace.mockReturnValue(workspace({ data: history('Soc') }));
  mocks.announcement.mockClear();
});

describe('root-cause page evidence eligibility and progressive presentation', () => {
  it.each(['pending', 'failed', 'empty'] as const)('qualifies missing focal conclusions while preserving every section and neighbor for %s history', (outcome) => {
    const focal = outcome === 'pending' ? { isLoading: true, isFetching: true }
      : outcome === 'failed' ? { error: new Error('Focal history failed') }
        : { data: { ...history('Soc'), count: 0, data: [] } };
    const input = workspace(focal);
    mocks.workspace.mockReturnValue(input);
    renderPage();
    expect(interpretation()).toHaveTextContent('Focal history unavailable; no shift conclusion can be drawn.');
    expect(interpretation()).not.toHaveTextContent(input.analysis.summary);
    for (const limitation of input.analysis.limitations) expect(interpretation()).toHaveTextContent(limitation);
    for (const title of ['Choose a signal to investigate', 'Normalized signal timeline', 'Evidence graph', 'Ranked hypotheses', 'Interpretation & limits']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByTestId('root-cause-summary')).toBeInTheDocument();
    expect(document.querySelector('[data-signal-source="PackVoltage"]')).toHaveTextContent('48 sample(s)');
    expect(document.querySelector('[data-signal-source="Soc"]')).toHaveAttribute('data-source-status',
      outcome === 'pending' ? 'initial' : outcome === 'failed' ? 'initialFailure' : 'unavailable');
  });

  it.each(['text', 'boolean', 'invalid-time'] as const)('retains recorded source rows without publishing numeric stability for %s evidence', (kind) => {
    const focal = history('Soc', kind === 'text' ? 'Park' : kind === 'boolean' ? false : 0);
    if (kind === 'invalid-time') focal.data = focal.data.map(point => ({ ...point, ts: 'invalid' }));
    const input = workspace({ data: focal });
    mocks.workspace.mockReturnValue(input);
    renderPage();
    expect(document.querySelector('[data-signal-source="Soc"]')).toHaveTextContent('48 sample(s)');
    expect(interpretation()).toHaveTextContent('Not enough history yet for this signal and window.');
    expect(interpretation()).not.toHaveTextContent(input.analysis.summary);
    const brief = screen.getByTestId('root-cause-summary');
    for (const id of ['root-cause-effect', 'root-cause-hypotheses', 'root-cause-focal-samples']) {
      expect(brief.querySelector(`[data-operational-metric="${id}"]`)).toHaveAttribute('data-value-state', 'missing');
    }
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).not.toHaveTextContent(input.analysis.summary);
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    for (const limitation of input.analysis.limitations) expect(drawer).toHaveTextContent(limitation);
    expect(input.evidenceBundle.data[0]!.response).toBe(focal);
  });

  it('retains measured zero, raw SI, narrative and all limitations through a refresh failure with independent retry', () => {
    const raw = history('Soc', 0);
    const input = workspace({ data: raw, error: new Error('Focal refresh failed'), dataUpdatedAt: 123456 });
    mocks.workspace.mockReturnValue(input);
    renderPage();
    expect(interpretation()).toHaveTextContent(input.analysis.summary);
    const brief = screen.getByTestId('root-cause-summary');
    expect(brief.querySelector('[data-operational-metric="root-cause-hypotheses"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="root-cause-hypotheses"] [data-operational-value]')).toHaveTextContent(/^0$/);
    expect(brief.querySelector('[data-operational-metric="root-cause-focal-samples"] [data-operational-value]')).toHaveTextContent(/^48$/);
    expect(within(brief).getByText('Showing retained measurements')).toBeInTheDocument();
    const source = document.querySelector<HTMLElement>('[data-signal-source="Soc"]')!;
    fireEvent.click(within(source).getByRole('button', { name: 'Retry' }));
    expect(input.retryFocal).toHaveBeenCalledTimes(1);
    expect(input.evidenceBundle.refetch).not.toHaveBeenCalled();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent(input.analysis.summary);
    for (const limitation of input.analysis.limitations) expect(drawer).toHaveTextContent(limitation);
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(raw.data.map(point => point.value)).toEqual(Array(48).fill(0));
    expect(input.evidenceBundle.data[1]!.response.data[0]!.value).toBe(400);
  });

  it('marks progressive refresh busy without erasing sections or claiming catalog freshness as evidence freshness', () => {
    const input = workspace({ data: history('Soc'), isFetching: true });
    mocks.workspace.mockReturnValue(input);
    const { rerender } = renderPage();
    expect(document.querySelector('[data-role="page-container"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('root-cause-summary')).toBeInTheDocument();
    expect(interpretation()).toHaveTextContent(input.analysis.summary);
    expect(mocks.announcement).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Root-cause evidence metrics', isLoading: false, isError: false, enabled: true,
    }));
    mocks.workspace.mockReturnValue({ ...input, evidenceBundle: { ...input.evidenceBundle, isFetching: false } });
    rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><RootCauseIntelligencePage /></MemoryRouter></QueryClientProvider>);
    expect(document.querySelector('[data-role="page-container"]')).not.toHaveAttribute('aria-busy');
  });
});
