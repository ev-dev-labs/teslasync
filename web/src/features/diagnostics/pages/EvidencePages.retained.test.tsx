import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { analyzeRootCause } from '../lib/rootCauseIntelligence';
import RootCauseIntelligencePage from './RootCauseIntelligencePage';
import ServiceEvidencePackPage from './ServiceEvidencePackPage';

const sources = vi.hoisted(() => ({ workspace: vi.fn(), updates: vi.fn() }));

vi.mock('react-i18next', async (importActual) => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? `{{${name}}}`));
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
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  valueNum: index < 24 ? 20 : 80,
}));
const analysis = analyzeRootCause({
  focalSignal: 'Soc',
  catalog: ['Soc'],
  focalPoints: points,
  relatedSeries: [],
});

function query<T>(data: T, error: Error | null = null) {
  return {
    data, error, isError: error != null, isLoading: false, isFetching: false,
    dataUpdatedAt: Date.now(), refetch: vi.fn(),
  };
}

function workspace(evidenceError: Error | null = null, catalogError: Error | null = null) {
  return {
    catalog: ['Soc'],
    signalsQuery: query(['Soc'], catalogError),
    focalSignal: 'Soc',
    setFocalSignal: vi.fn(),
    windowHours: 72,
    setWindowHours: vi.fn(),
    relatedCandidates: [],
    evidenceBundle: query([{ signal: 'Soc', response: { data: points } }], evidenceError),
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
  sources.workspace.mockReturnValue(workspace());
  sources.updates.mockReturnValue(query([]));
});

describe('diagnostic evidence source preservation', () => {
  it('retains the picker and all six analysis sections after evidence/catalog refresh failures', () => {
    sources.workspace.mockReturnValue(workspace(new Error('history refresh'), new Error('catalog refresh')));
    renderPage('analysis');
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByLabelText('Focal signal')).toHaveValue('Soc');
    expect(screen.getByLabelText('Analysis window')).toHaveValue('72');
    expect(screen.getByRole('region', { name: 'Root-cause evidence metrics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Normalized signal timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence graph' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ranked hypotheses' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Interpretation & limits' })).toBeInTheDocument();
    expect(screen.getByText('Focal samples')).toBeInTheDocument();
    expect(screen.getByText(String(analysis.quality.focalSampleCount))).toBeInTheDocument();
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
});
