import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceIntelligenceResponse } from '@/api/hooks/useServiceIntelligence';

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
    expect(screen.queryByText('Retained signal evidence')).not.toBeInTheDocument();
  });
});
