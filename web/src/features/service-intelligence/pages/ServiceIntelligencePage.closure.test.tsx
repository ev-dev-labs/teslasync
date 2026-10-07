import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS,
  SudoCanceledError,
} from '@/api/hooks/useServiceIntelligence';
import { ApiError } from '@/lib/resilience';
import { catalogReport, claimReport, serviceReport, warrantyReport } from './ServiceIntelligencePage.closure.fixtures';

const hooks = vi.hoisted(() => ({
  service: vi.fn(),
  warranty: vi.fn(),
  catalog: vi.fn(),
  claim: vi.fn(),
  importCatalog: vi.fn(),
  selected: vi.fn(),
}));
vi.mock('@/api/hooks/useServiceIntelligence', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useServiceIntelligence')>('@/api/hooks/useServiceIntelligence'),
  useServiceIntelligence: hooks.service,
  useWarrantyOutlook: hooks.warranty,
  useCommunicationsCatalogStatus: hooks.catalog,
  useClaimDraft: hooks.claim,
  useImportCommunicationsCatalog: hooks.importCatalog,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: hooks.selected }));

import ServiceIntelligencePage from './ServiceIntelligencePage';

function query<T>(data: T | undefined, error: Error | null = null, isLoading = false) {
  return {
    data, error, isLoading, isPending: isLoading, isFetching: isLoading,
    isError: error != null, fetchStatus: isLoading ? 'fetching' : 'idle',
    refetch: vi.fn(),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current test route">{location.pathname}{location.search}</output>;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <MemoryRouter initialEntries={['/service-intelligence']}>
      <QueryClientProvider client={client}>
        <ServiceIntelligencePage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}

const headings = [
  'Official NHTSA TSB catalog', 'Vehicle match context', 'Warranty countdown',
  'Warranty claim draft', 'Recall inventory', 'Manufacturer communications & TSBs',
  'Ranked observed symptoms', 'Evidence & limitations', 'Source freshness',
];

function expectAllSections() {
  for (const heading of headings) {
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
  }
}

function expectCompleteServiceReport() {
  for (const text of [
    'Returned campaign candidate', 'Published campaign summary.',
    'Published potential consequence.', 'Published remedy requires confirmation.',
    'Build overlap is a hypothesis, not confirmed eligibility.',
    'Completion unknown', 'NHTSA park-outside warning', 'OTA remedy', '72% confidence',
    'SB-26-07', 'Returned bulletin summary.', 'Technical service bulletin',
    'Bulletin overlap does not establish a fault.', '41% confidence',
    'First supplied symptom explanation.', 'Second supplied symptom explanation.',
    'Returned maintenance evidence', 'Recorded service history, not proof of recall completion.',
    'Returned signal evidence', 'Observed association is not diagnosis.',
    'Campaign completion must be officially confirmed.',
    'Confirm these hypotheses with a qualified technician.',
  ]) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
  expect(screen.getByRole('link', { name: 'Open NHTSA campaign' }))
    .toHaveAttribute('href', serviceReport.recall_findings[0].source_document_url);
  expect(screen.getByRole('link', { name: 'Open official NHTSA document' }))
    .toHaveAttribute('href', serviceReport.communications[0].source_document_url);
  expect(screen.getByRole('link', { name: 'Open evidence source' }))
    .toHaveAttribute('href', 'https://example.org/maintenance-7');
  expect(screen.getByTitle('2026-07-01T00:00:00.000Z')).toBeInTheDocument();
  const first = screen.getByText('first_server_rank').closest('li');
  const second = screen.getByText('second_server_rank').closest('li');
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first?.nextElementSibling).toBe(second);
  const factor = screen.getByText('model year: matched');
  expect(factor).toHaveAttribute('title', 'Decoded model year matched the publication.');
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.selected.mockReturnValue({ vehicleId: 7 });
  hooks.service.mockReturnValue(query(serviceReport));
  hooks.warranty.mockReturnValue(query(warrantyReport));
  hooks.catalog.mockReturnValue(query(catalogReport));
  hooks.claim.mockReturnValue(query(claimReport));
  hooks.importCatalog.mockReturnValue({
    mutate: vi.fn(), isPending: false, error: null, variables: undefined,
  });
});

describe('ServiceIntelligencePage bounded behavior closure', () => {
  it('retains both real summary briefs and their drawer context without collapsing independent source failures', () => {
    hooks.service.mockReturnValue(query(serviceReport, new Error('service refresh failed')));
    hooks.catalog.mockReturnValue(query(catalogReport, new Error('catalog refresh failed')));
    renderPage();
    const serviceBrief = screen.getByTestId('service-intelligence-summary');
    const catalogBrief = screen.getByTestId('service-intelligence-catalog-summary');
    expect(serviceBrief).toHaveAttribute('data-operational-brief');
    expect(catalogBrief).toHaveAttribute('data-operational-brief');
    expect(within(serviceBrief).getByText('Retained report')).toBeInTheDocument();
    expect(catalogBrief.querySelector('[data-operational-metric="normalized-tesla-records"] [data-operational-value]')).toHaveTextContent('321');
    fireEvent.click(within(serviceBrief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Service match summary details' });
    expect(within(drawer).getByText('Returned model-year recall candidates, not confirmed vehicle eligibility.')).toBeInTheDocument();
    expect(within(drawer).getByText('Maintenance retrieval is unavailable; absence is not completion evidence.')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(within(drawer).getByText('No action is recommended from this evidence alone.')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expectAllSections();
    expectCompleteServiceReport();
    expect(screen.getByRole('button', { name: 'Open service evidence pack' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Copy ticket text' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /Import official NHTSA artifact/ })).toHaveLength(5);
  });

  it('retains complete service and maintenance evidence, warranty assumptions and drafts across independent refresh failures', () => {
    const view = renderPage();
    expectAllSections();
    expectCompleteServiceReport();
    hooks.service.mockReturnValue(query(serviceReport, new Error('service refresh failed')));
    hooks.warranty.mockReturnValue(query(warrantyReport, new Error('warranty refresh failed')));
    hooks.catalog.mockReturnValue(query(catalogReport, new Error('catalog refresh failed')));
    hooks.claim.mockReturnValue(query(claimReport, new Error('draft refresh failed')));
    view.refresh();
    expectAllSections();
    expectCompleteServiceReport();
    expect(screen.getAllByText('Retained battery coverage').length).toBeGreaterThan(0);
    expect(screen.getByText(warrantyReport.assumption)).toBeInTheDocument();
    expect(screen.getByText(claimReport.subject)).toBeInTheDocument();
    expect(screen.getByText(claimReport.ask)).toBeInTheDocument();
    expect(screen.getByText(claimReport.disclaimer)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy ticket text' })).toBeEnabled();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(4);
    expect(screen.queryByText('This source could not be loaded.')).not.toBeInTheDocument();
  });

  it('retries only the retained source identified by its warning', () => {
    const service = query(serviceReport, new Error('service refresh failed'));
    const warranty = query(warrantyReport, new Error('warranty refresh failed'));
    const catalog = query(catalogReport, new Error('catalog refresh failed'));
    const claim = query(claimReport, new Error('draft refresh failed'));
    hooks.service.mockReturnValue(service);
    hooks.warranty.mockReturnValue(warranty);
    hooks.catalog.mockReturnValue(catalog);
    hooks.claim.mockReturnValue(claim);
    renderPage();
    const sources = [
      ['Official NHTSA TSB catalog', catalog], ['Recall & service intelligence', service],
      ['Warranty countdown', warranty], ['Warranty claim draft', claim],
    ] as const;
    for (const [label, source] of sources) {
      const notice = screen.getAllByTestId('stale-refresh-warning')
        .find((item) => within(item).queryByText(`${label} may be out of date`));
      expect(notice).toBeDefined();
      fireEvent.click(within(notice!).getByRole('button', { name: 'Refresh' }));
      expect(source.refetch).toHaveBeenCalledOnce();
    }
    expectCompleteServiceReport();
  });

  it.each(['failed', 'loading'] as const)('keeps warranty, claim and catalog evidence independent of a %s service request', (state) => {
    hooks.service.mockReturnValue(query(undefined, state === 'failed' ? new Error('service unavailable') : null, state === 'loading'));
    renderPage();
    expectAllSections();
    expect(screen.getByText(warrantyReport.assumption)).toBeInTheDocument();
    expect(screen.getByText(claimReport.subject)).toBeInTheDocument();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open service evidence pack' })).toBeEnabled();
    expect(screen.queryByText('Returned campaign candidate')).not.toBeInTheDocument();
    expect(screen.queryByText('No recall candidates')).not.toBeInTheDocument();
    expect(screen.queryByText('No communications found')).not.toBeInTheDocument();
    expect(screen.queryByText('No evidence bundle')).not.toBeInTheDocument();
  });

  it('keeps the full report and warranty visible during independent catalog and draft first-load failures', () => {
    hooks.catalog.mockReturnValue(query(undefined, new Error('catalog permission denied')));
    hooks.claim.mockReturnValue(query(undefined, new Error('draft unavailable')));
    renderPage();
    expectAllSections();
    expectCompleteServiceReport();
    expect(screen.getByText(warrantyReport.assumption)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import official NHTSA artifact/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy ticket text' })).not.toBeInTheDocument();
  });

  it.each(['failed', 'loading'] as const)('does not gate service or maintenance evidence on a %s warranty source', (state) => {
    hooks.warranty.mockReturnValue(query(undefined, state === 'failed' ? new Error('warranty unavailable') : null, state === 'loading'));
    renderPage();
    expectAllSections();
    expectCompleteServiceReport();
    expect(screen.getByText(claimReport.subject)).toBeInTheDocument();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.queryByText(warrantyReport.assumption)).not.toBeInTheDocument();
    expect(screen.queryByText('No warranty outlook')).not.toBeInTheDocument();
  });

  it('keeps administrator permission denial local to the catalog and does not offer an import or auto-retry it', () => {
    const denied = query(undefined, new ApiError('Administrator access required', 403, 'PERMISSION_DENIED'));
    const mutate = vi.fn();
    hooks.catalog.mockReturnValue(denied);
    hooks.importCatalog.mockReturnValue({ mutate, isPending: false, error: null });
    renderPage();
    expectAllSections();
    expectCompleteServiceReport();
    expect(screen.getByText('Permission denied')).toBeInTheDocument();
    const guidance = screen.getByTestId('permission-guidance');
    expect(guidance).toHaveAttribute('data-access-block', 'forbidden');
    expect(within(guidance).getByText('Who can grant this:')).toBeInTheDocument();
    expect(within(guidance).getAllByRole('listitem')).toHaveLength(3);
    expect(within(guidance).getByRole('link', { name: 'Request access' }))
      .toHaveAttribute('href', '/help');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import official NHTSA artifact/ })).not.toBeInTheDocument();
    expect(denied.refetch).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open service evidence pack' })).toBeEnabled();
  });

  it('keeps the global catalog accessible without a selected vehicle and never leaks retained vehicle evidence', () => {
    hooks.selected.mockReturnValue({ vehicleId: null });
    renderPage();
    expectAllSections();
    expect(hooks.service).toHaveBeenCalledWith(null);
    expect(hooks.warranty).toHaveBeenCalledWith(null);
    expect(hooks.claim).toHaveBeenCalledWith(null, null);
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Import official NHTSA artifact/ })).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Open service evidence pack' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Draft ticket' })).toBeDisabled();
    expect(screen.queryByText('Returned maintenance evidence')).not.toBeInTheDocument();
    expect(screen.queryByText(warrantyReport.assumption)).not.toBeInTheDocument();
    expect(screen.queryByText(claimReport.subject)).not.toBeInTheDocument();
  });

  it('navigates to the evidence pack with the selected vehicle ID without changing service data', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Open service evidence pack' }));
    expect(screen.getByLabelText('Current test route'))
      .toHaveTextContent('/diagnostics/service-evidence?vehicle_id=7');
    expectCompleteServiceReport();
  });

  it('delegates exactly one allow-listed import and preserves cancellation and pending feedback without inventing a second confirmation', () => {
    const mutate = vi.fn();
    hooks.importCatalog.mockReturnValue({ mutate, isPending: false, error: null });
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Import official NHTSA artifact for 2010–2014' }));
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[1].url);
    hooks.importCatalog.mockReturnValue({
      mutate, isPending: true, error: null, variables: OFFICIAL_NHTSA_COMMUNICATION_ARTIFACTS[1].url,
    });
    view.refresh();
    for (const button of screen.getAllByRole('button', { name: /Import official NHTSA artifact/ })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Import official NHTSA artifact for 2010–2014' }))
      .toHaveAttribute('aria-busy', 'true');
    hooks.importCatalog.mockReturnValue({ mutate, isPending: false, error: new SudoCanceledError() });
    view.refresh();
    expect(screen.queryByText('Catalog import failed')).not.toBeInTheDocument();
    expect(screen.queryByText('Reauthentication cancelled by user')).not.toBeInTheDocument();
    expect(screen.getByText('321')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import official NHTSA artifact for 2010–2014' })).toBeEnabled();
    hooks.importCatalog.mockReturnValue({ mutate, isPending: false, error: new Error('Import authorization rejected') });
    view.refresh();
    expect(screen.getByText('Catalog import failed')).toBeInTheDocument();
    expect(screen.getByText('Import authorization rejected')).toBeInTheDocument();
    expectCompleteServiceReport();
    expect(mutate).toHaveBeenCalledOnce();
  });
});
