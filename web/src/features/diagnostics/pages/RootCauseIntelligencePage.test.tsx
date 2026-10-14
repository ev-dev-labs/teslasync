import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { SignalEvidenceBundleResult } from '@/api/hooks/useTelemetry';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { analyzeRootCause, presentRootCause } from '../lib/rootCauseIntelligence';
import RootCauseIntelligencePage from './RootCauseIntelligencePage';
import { SHARED_RANGE_STORAGE_KEY, useRangeState } from '@/hooks/useRangeState';
import { useSignalEvidenceBundle, telemetryKeys } from '@/api/hooks/useTelemetry';
import * as apiClient from '@/api/client';
import { SignalWindowPicker } from '../components/SignalWindowPicker';
import { getFormatterPreferences, setGlobalLocale } from '@/lib/numberFormat';

const initialLocale = getFormatterPreferences().locale;
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), announcement: vi.fn() }));
vi.mock('../hooks/useRootCauseWorkspace', () => ({
  ROOT_CAUSE_WINDOW_HOUR_PRESETS: [24, 72, 168, 720],
  useRootCauseWorkspace: (...args: unknown[]) => mocks.workspace(...args),
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
  localStorage.removeItem(SHARED_RANGE_STORAGE_KEY);
  mocks.workspace.mockReturnValue(workspace({ data: history('Soc') }));
  mocks.announcement.mockClear();
});

afterEach(() => {
  setGlobalLocale(initialLocale);
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.removeItem(SHARED_RANGE_STORAGE_KEY);
});

describe('root-cause shared analysis window', () => {
  it('passes the header instants to the workspace and leaves only the focal selector in the page', () => {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/diagnostics/root-cause?from=2026-03-08&to=2026-03-08&time_scope=custom']}>
        <RootCauseIntelligencePage />
      </MemoryRouter>
    </QueryClientProvider>);
    expect(mocks.workspace).toHaveBeenCalledWith(4, expect.objectContaining({
      start: '2026-03-08', end: '2026-03-08',
      startInstant: expect.stringMatching(/T/), endInstantExclusive: expect.stringMatching(/T/),
    }));
    expect(screen.getByRole('combobox', { name: 'Focal signal' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Analysis window' })).not.toBeInTheDocument();
  });

  it('preserves the service evidence picker and local 72-hour workspace', async () => {
    const actual = await vi.importActual<typeof import('../hooks/useRootCauseWorkspace')>('../hooks/useRootCauseWorkspace');
    vi.spyOn(apiClient, 'request').mockResolvedValue({ signals: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => actual.useRootCauseWorkspace(null), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(result.current.windowHours).toBe(72);
    act(() => result.current.setWindowHours(168));
    expect(result.current.windowHours).toBe(168);
    render(<SignalWindowPicker catalog={['Soc']} signalsLoading={false} signalsError={null}
      onRetrySignals={vi.fn()} focalSignal="Soc" onFocalSignalChange={vi.fn()}
      windowHours={72} onWindowHoursChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Analysis window' })).toHaveValue('72');
  });

  it.each([
    ['America/Los_Angeles', '2026-03-08', '2026-03-08', '2026-03-08T08:00:00.000Z', '2026-03-09T07:00:00.000Z', 23],
    ['Asia/Kolkata', '2026-10-14', '2026-10-14', '2026-10-13T18:30:00.000Z', '2026-10-14T18:30:00.000Z', 24],
  ])('propagates both calendar bounds and cache identity in %s', async (timezone, from, to, start, end, hours) => {
    const savedLocale = getFormatterPreferences().locale;
    setGlobalLocale('de-DE');
    localStorage.setItem(SHARED_RANGE_STORAGE_KEY, JSON.stringify({
      version: 2, start: from, end: to,
    }));
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(history('Soc'));
    const actual = await vi.importActual<typeof import('../hooks/useRootCauseWorkspace')>('../hooks/useRootCauseWorkspace');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => {
      const range = useRangeState({ timezone });
      const workspace = actual.useRootCauseWorkspace(4, range);
      return { range, workspace };
    }, {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/diagnostics/root-cause']}>{children}</MemoryRouter>
      </QueryClientProvider>,
    });
    act(() => result.current.workspace.setFocalSignal('Soc'));
    await waitFor(() => expect(result.current.workspace.evidenceBundle.data).toHaveLength(1));
    expect(result.current.range.startInstant).toBe(start);
    expect(result.current.range.endInstantExclusive).toBe(end);
    expect(result.current.workspace.windowHours).toBe(hours);
    expect(request).toHaveBeenCalledWith(
      `/signals/4/Soc/history?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&limit=10000`,
      { signal: expect.any(AbortSignal) },
    );
    expect(client.getQueryData(telemetryKeys.signalEvidenceHistory(4, 'Soc', hours, 10_000, start, end))).toBeDefined();
    act(() => result.current.range.setRange({ start: from, end: '2026-10-15' }, 'custom'));
    await waitFor(() => expect(request.mock.calls.some(([url]) =>
      String(url).includes(encodeURIComponent(result.current.range.endInstantExclusive)))).toBe(true));
    expect(client.getQueryCache().findAll({ queryKey: ['signal-evidence-history'] })).toHaveLength(2);
    expect(getFormatterPreferences().locale).toBe('de-DE');
    setGlobalLocale(savedLocale);
  });

  it.each(['', '?from=bad&to=2026-10-14', '?from=2026-10-14', '?from=2026-10-15&to=2026-10-14'])(
    'uses the saved shared window for missing or invalid URL dates: %s', (query) => {
      localStorage.setItem(SHARED_RANGE_STORAGE_KEY, JSON.stringify({
        version: 2, start: '2026-10-13', end: '2026-10-14',
      }));
      const { result } = renderHook(() => useRangeState({ timezone: 'Asia/Kolkata' }), {
        wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[`/diagnostics/root-cause${query}`]}>{children}</MemoryRouter>,
      });
      expect(result.current.startInstant).toBe('2026-10-12T18:30:00.000Z');
      expect(result.current.endInstantExclusive).toBe('2026-10-14T18:30:00.000Z');
    },
  );

  it('preserves precise rolling instants across midnight instead of widening to calendar days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T18:29:30Z'));
    localStorage.setItem(SHARED_RANGE_STORAGE_KEY, JSON.stringify({
      version: 2, start: '2026-10-13', end: '2026-10-14', presetId: '24h',
    }));
    const { result } = renderHook(() => useRangeState({ timezone: 'Asia/Kolkata' }), {
      wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/diagnostics/root-cause?time_scope=24h']}>{children}</MemoryRouter>,
    });
    expect(result.current.startInstant).toBe('2026-10-13T18:29:30.000Z');
    expect(result.current.endInstantExclusive).toBe('2026-10-14T18:29:30.000Z');
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.end).toBe('2026-10-15');
    expect(result.current.startInstant).toBe('2026-10-13T18:30:30.000Z');
    expect(result.current.endInstantExclusive).toBe('2026-10-14T18:30:30.000Z');
  });

  it('retains the hour-only evidence request and cache key for unrelated consumers', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(history('Soc'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSignalEvidenceBundle(4, ['Soc'], 72), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(request).toHaveBeenCalledWith('/signals/4/Soc/history?hours=72&limit=10000', { signal: expect.any(AbortSignal) });
    expect(telemetryKeys.signalEvidenceHistory(4, 'Soc', 72, 10_000)).toEqual(['signal-evidence-history', 4, 'Soc', 72, 10_000]);
  });
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
    expect(interpretation()).not.toHaveTextContent('The focal signal did not show a robust');
    expect(interpretation()).not.toHaveTextContent('Evidence quality is low');
    for (const title of ['Choose a signal to investigate', 'Normalized signal timeline', 'Evidence graph', 'Ranked hypotheses', 'Interpretation & limits']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByTestId('root-cause-summary')).toBeInTheDocument();
    expect(document.querySelector('[data-signal-source="PackVoltage"]')).toHaveTextContent('48 sample(s)');
    expect(document.querySelector('[data-signal-source="Soc"]')).toHaveAttribute('data-source-status',
      outcome === 'pending' ? 'initial' : outcome === 'failed' ? 'initialFailure' : 'unavailable');
  });

  it.each(['text', 'boolean', 'invalid-time', 'blank', 'nan', 'infinity'] as const)('retains recorded source rows without publishing numeric stability for %s evidence', (kind) => {
    const focal = history('Soc', kind === 'text' ? 'Park' : kind === 'boolean' ? false
      : kind === 'blank' ? '  ' : kind === 'nan' ? NaN : kind === 'infinity' ? Infinity : 0);
    if (kind === 'invalid-time') focal.data = focal.data.map(point => ({ ...point, ts: 'invalid' }));
    const input = workspace({ data: focal });
    mocks.workspace.mockReturnValue(input);
    renderPage();
    expect(document.querySelector('[data-signal-source="Soc"]')).toHaveTextContent('48 sample(s)');
    expect(interpretation()).toHaveTextContent('Not enough history yet for this signal and window.');
    expect(interpretation()).not.toHaveTextContent(input.analysis.summary);
    const brief = screen.getByTestId('root-cause-summary');
    for (const id of ['root-cause-quality', 'root-cause-overall-score', 'root-cause-effect', 'root-cause-hypotheses', 'root-cause-focal-samples']) {
      expect(brief.querySelector(`[data-operational-metric="${id}"]`)).toHaveAttribute('data-value-state', 'missing');
    }
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).not.toHaveTextContent(input.analysis.summary);
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(drawer).not.toHaveTextContent('The focal signal did not show a robust');
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
    expect(drawer).not.toHaveTextContent('Evidence quality is low');
    expect(brief.querySelector('[data-operational-metric="root-cause-overall-score"]')).toHaveAttribute('data-value-state', 'missing');
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

  it.each([-2.5, 0.125])('retains a valid signed or fractional measured value %s', (value) => {
    const input = workspace({ data: history('Soc', value) });
    mocks.workspace.mockReturnValue(input);
    renderPage();
    expect(interpretation()).toHaveTextContent(input.analysis.summary);
    expect(screen.getByTestId('root-cause-summary').querySelector(
      '[data-operational-metric="root-cause-focal-samples"] [data-operational-value]',
    )).toHaveTextContent('48');
    expect(input.evidenceBundle.data[0]!.response.data[0]!.value).toBe(value);
  });

  it('withholds zero-hypothesis conclusions for unresolved related histories while retaining the focal shift', () => {
    const focal = history('Soc');
    focal.data = focal.data.map((point, index) => ({ ...point, value: index < 24 ? -2.5 : 0.125 }));
    const input = workspace({ data: focal });
    input.evidenceBundle.data = input.evidenceBundle.data.filter(({ signal }) => signal === 'Soc');
    input.evidenceBundle.sources[1]!.state = deriveDataState<SignalHistoryResponse>({ error: new Error('Neighbor failed') });
    input.analysis = analyzeRootCause({
      focalSignal: 'Soc', catalog: ['Soc', 'PackVoltage'], focalPoints: focal.data, relatedSeries: [],
    });
    const presentation = presentRootCause(input.analysis, [{ signal: 'Soc', points: focal.data }]);
    mocks.workspace.mockReturnValue(input);
    renderPage();
    expect(interpretation()).toHaveTextContent(presentation.summary);
    expect(interpretation()).toHaveTextContent('0 of 1 selected related histories resolved');
    expect(interpretation()).not.toHaveTextContent('isolated change');
    expect(screen.getByTestId('root-cause-summary').querySelector(
      '[data-operational-metric="root-cause-hypotheses"]',
    )).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByRole('heading', { name: 'Ranked hypotheses' }).closest('[data-print-card]'))
      .not.toHaveTextContent('no other analyzed signal showed');
  });
});
