import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceIntelligenceFinding, ServiceIntelligenceResponse } from '@/api/hooks/useServiceIntelligence';

const hooks = vi.hoisted(() => ({
  service: vi.fn(),
  warranty: vi.fn(),
  catalog: vi.fn(),
  claim: vi.fn(),
  importCatalog: vi.fn(),
}));
vi.mock('@/api/hooks/useServiceIntelligence', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useServiceIntelligence')>('@/api/hooks/useServiceIntelligence'),
  useServiceIntelligence: hooks.service,
  useWarrantyOutlook: hooks.warranty,
  useCommunicationsCatalogStatus: hooks.catalog,
  useClaimDraft: hooks.claim,
  useImportCommunicationsCatalog: hooks.importCatalog,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));

import ServiceIntelligencePage from './ServiceIntelligencePage';
import { RecallFindingCard } from '../components/RecallFindingCard';

const response: ServiceIntelligenceResponse = {
  vehicle_id: 7,
  generated_at: '2026-08-02',
  vehicle_context: {
    make: 'Tesla', model: 'Model 3', model_year: 2021, build_date: null,
    build_match_basis: 'Decoded build, not eligibility proof.',
    plant_city: null, plant_state: null, plant_country: null, firmware_version: '2026.1',
  },
  summary: { recall_candidates: 0, potentially_applicable_recalls: 0, manufacturer_communications: 0, symptom_matches: 0 },
  recall_findings: [],
  communications: [],
  ranked_symptoms: [],
  evidence: {
    schema_version: '1',
    items: [{ id: 'signal', kind: 'signal_history', title: 'Retained signal evidence', summary: 'Observed overlap only.', source_name: 'Historical signals', source_document_url: null, observed_at: null, confidence: null, finding_id: null }],
    limitations: ['Eligibility requires official confirmation.'],
    disclaimer: 'Not a diagnosis.',
  },
  sources: [],
};

function query(data: unknown, error: Error | null = null) {
  return { data, error, isLoading: false, isFetching: false, isError: error != null, refetch: vi.fn() };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}><ServiceIntelligencePage /></QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.service.mockReturnValue(query(response));
  hooks.warranty.mockReturnValue(query(undefined));
  hooks.catalog.mockReturnValue(query({ latest_attempt: null, latest_successful: null, record_count: 321 }));
  hooks.claim.mockReturnValue(query(undefined));
  hooks.importCatalog.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
});

describe('ServiceIntelligencePage independent source preservation', () => {
  it('exposes full recall match details in source order through keyboard and pointer tooltips', async () => {
    const user = userEvent.setup();
    const finding: ServiceIntelligenceFinding = {
      id: 'recall-details', kind: 'recall', title: 'Published recall candidate',
      component: 'Electrical system', summary: 'Published campaign summary.',
      consequence: 'Published potential consequence.', remedy: 'Published inspection remedy.',
      report_received_at: '2026-08-01', applicability: 'needs_review',
      confidence: 0.42, confidence_label: 'low', completion_status: 'unknown',
      hypothesis: 'Official applicability confirmation is still required.',
      match_factors: [
        { dimension: 'model', status: 'matched', weight: 1, detail: 'Model matches the published campaign; this is not VIN eligibility confirmation.' },
        { dimension: 'model_year', status: 'unknown', weight: 0, detail: 'The full build interval remains unknown. Confirm the production date with the official campaign before drawing a conclusion.' },
      ],
      symptom_matches: [], park_it: false, park_outside: false,
      over_the_air_update: true, source_document_url: 'https://www.nhtsa.gov/recalls',
    };
    render(<ul><RecallFindingCard finding={finding} /></ul>);

    const triggers = screen.getAllByRole('button');
    expect(triggers.map((trigger) => trigger.textContent)).toEqual([
      'model: matched', 'model year: unknown',
    ]);
    const tooltips = screen.getAllByRole('tooltip');
    expect(tooltips.map((tooltip) => tooltip.textContent)).toEqual(
      finding.match_factors.map((factor) => factor.detail),
    );
    for (const [index, trigger] of triggers.entries()) {
      expect(trigger).not.toHaveAttribute('title');
      expect(trigger.querySelector('[title]')).toBeNull();
      expect(trigger).toHaveAttribute('aria-describedby', tooltips[index].id);
      expect(trigger).toHaveAccessibleDescription(finding.match_factors[index].detail);
      expect(tooltips[index]).toHaveClass('whitespace-normal', 'break-words');
      await user.tab();
      expect(trigger).toHaveFocus();
      await user.keyboard('{Escape}');
      expect(tooltips[index]).toHaveClass('!opacity-0');
      await user.hover(trigger);
      expect(tooltips[index]).not.toHaveClass('!opacity-0');
      await user.unhover(trigger);
    }
    expect(screen.getByText('OTA remedy')).toBeInTheDocument();
    expect(screen.getByText(finding.summary)).toBeInTheDocument();
    expect(screen.getByText(finding.hypothesis)).toBeInTheDocument();
    expect(screen.getByText(finding.consequence)).toBeInTheDocument();
    expect(screen.getByText(finding.remedy)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open NHTSA campaign' }))
      .toHaveAttribute('href', finding.source_document_url);
  });

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [true, true, false],
    [false, false, true],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('exposes independent recall flags park_it=%s park_outside=%s ota=%s without changing conclusions', (parkIt, parkOutside, ota) => {
    const finding: ServiceIntelligenceFinding = {
      id: 'recall-1', kind: 'recall', title: 'Published recall candidate',
      component: 'Electrical system', summary: 'Published campaign summary.',
      consequence: 'Published potential consequence.', remedy: 'Published inspection remedy.',
      report_received_at: '2026-08-01', applicability: 'needs_review',
      confidence: 0.42, confidence_label: 'low', completion_status: 'unknown',
      hypothesis: 'Official applicability confirmation is still required.',
      match_factors: [{ dimension: 'model', status: 'matched', weight: 1, detail: 'Model matches.' }],
      symptom_matches: [], park_it: parkIt, park_outside: parkOutside,
      over_the_air_update: ota, source_document_url: 'https://www.nhtsa.gov/recalls',
    };
    hooks.service.mockReturnValue(query({ ...response, recall_findings: [finding] }));
    renderPage();

    expect(screen.queryAllByText('NHTSA park-it warning')).toHaveLength(parkIt ? 1 : 0);
    expect(screen.queryAllByText('NHTSA park-outside warning')).toHaveLength(parkOutside ? 1 : 0);
    expect(screen.queryAllByText('OTA remedy')).toHaveLength(ota ? 1 : 0);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('42% confidence')).toBeInTheDocument();
    expect(screen.getByText('Completion unknown')).toBeInTheDocument();
    expect(screen.getByText(finding.summary)).toBeInTheDocument();
    expect(screen.getByText(finding.hypothesis)).toBeInTheDocument();
    expect(screen.getByText(finding.consequence)).toBeInTheDocument();
    expect(screen.getByText(finding.remedy)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open NHTSA campaign' })).toHaveAttribute('href', finding.source_document_url);
    expect(screen.getByText('Not a diagnosis.')).toBeInTheDocument();
  });

  it('retains context, evidence, limitations and catalog actions when the service refresh fails', () => {
    hooks.service.mockReturnValue(query(response, new Error('service refresh failed')));
    hooks.warranty.mockReturnValue(query(undefined, new Error('warranty first load failed')));
    renderPage();
    expect(screen.getByText('Decoded build, not eligibility proof.')).toBeInTheDocument();
    expect(screen.getByText('Retained signal evidence')).toBeInTheDocument();
    expect(screen.getByText('Eligibility requires official confirmation.')).toBeInTheDocument();
    expect(screen.getByText('Not a diagnosis.')).toBeInTheDocument();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Import official NHTSA artifact for/ })).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Warranty countdown' })).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
  });

  it('never turns a service first-load failure into a page-level gate on the independent catalog', () => {
    hooks.service.mockReturnValue(query(undefined, new Error('service unavailable')));
    renderPage();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recall inventory' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence & limitations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open service evidence pack' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open service evidence pack' }))
      .toHaveClass('min-h-11', 'min-w-11', 'md:min-h-10', 'md:min-w-0', 'whitespace-normal');
    expect(screen.queryByText('Retained signal evidence')).not.toBeInTheDocument();
  });

  it('keeps active first loads unresolved at every service panel without gating the catalog', () => {
    hooks.service.mockReturnValue({ ...query(undefined), isLoading: true, isFetching: true, fetchStatus: 'fetching' });
    renderPage();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getAllByText('No requested source has returned usable data yet.')).toHaveLength(7);
    expect(screen.getAllByRole('status', { name: /^Loading / })).toHaveLength(7);
    expect(screen.queryByText('Retained signal evidence')).not.toBeInTheDocument();
  });

  it('explains paused first loads independently and recovers to successful empty and zero values', () => {
    const paused = { ...query(undefined), isPending: true, fetchStatus: 'paused' };
    hooks.service.mockReturnValue(paused);
    hooks.warranty.mockReturnValue(paused);
    hooks.catalog.mockReturnValue(paused);
    const view = renderPage();
    expect(screen.getAllByText(/Source paused/)).toHaveLength(8);
    expect(screen.queryByText('TSB catalog is not populated')).not.toBeInTheDocument();
    expect(screen.queryByText('This source could not be loaded.')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /^Loading / })).not.toBeInTheDocument();
    expect(screen.getByText('No ticket yet')).toBeInTheDocument();
    hooks.service.mockReturnValue(query(response));
    hooks.warranty.mockReturnValue(query({ vehicle_id: 7, model: 'Model 3', model_year: 2021, coverages: [], assumption: 'No coverage returned.' }));
    hooks.catalog.mockReturnValue(query({ latest_attempt: null, latest_successful: null, record_count: 0 }));
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><ServiceIntelligencePage /></QueryClientProvider></MemoryRouter>);
    expect(screen.queryByText(/Source paused/)).not.toBeInTheDocument();
    expect(screen.getByText('TSB catalog is not populated')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('Decoded build, not eligibility proof.')).toBeInTheDocument();
  });

  it('keeps catalog and warranty first loads local while service evidence remains available', () => {
    hooks.catalog.mockReturnValue({ ...query(undefined), isLoading: true, isFetching: true, fetchStatus: 'fetching' });
    hooks.warranty.mockReturnValue({ ...query(undefined), isPending: true, fetchStatus: 'paused' });
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading Official NHTSA TSB catalog' })).toBeInTheDocument();
    expect(screen.getByText(/Source paused/)).toBeInTheDocument();
    expect(screen.getByText('Retained signal evidence')).toBeInTheDocument();
    expect(screen.getByText('Decoded build, not eligibility proof.')).toBeInTheDocument();
    expect(screen.queryByText('TSB catalog is not populated')).not.toBeInTheDocument();
    expect(screen.queryByText('This source could not be loaded.')).not.toBeInTheDocument();
  });

  it('preserves retained data during a pause and removes the refresh warning after recovery', () => {
    hooks.service.mockReturnValue({ ...query(response), fetchStatus: 'paused' });
    const view = renderPage();
    expect(screen.getByText('Retained signal evidence')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    hooks.service.mockReturnValue(query(response, new Error('refresh failed')));
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><ServiceIntelligencePage /></QueryClientProvider></MemoryRouter>);
    expect(screen.getByText('Retained signal evidence')).toBeInTheDocument();
    hooks.service.mockReturnValue(query(response));
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><ServiceIntelligencePage /></QueryClientProvider></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('Retained signal evidence')).toBeInTheDocument();
  });
});
