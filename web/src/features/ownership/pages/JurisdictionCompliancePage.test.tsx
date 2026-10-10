/**
 * JurisdictionCompliancePage — confirm-gated jurisdiction-rate deletion.
 *
 * Removing a rate is destructive, so the row Remove button must open a
 * danger confirm dialog naming the jurisdiction instead of firing the
 * mutation directly. Only the data hooks, vehicle selection, and i18n are
 * mocked; the table, buttons, and confirm dialog render for real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useOwnership', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useOwnership')>('@/api/hooks/useOwnership');
  return {
    ...actual,
    useJurisdictionRates: vi.fn(),
    useComplianceApportionment: vi.fn(),
    useComplianceFilings: vi.fn(),
    useCreateFiling: vi.fn(),
    useCreateJurisdictionRate: vi.fn(),
    useDeleteJurisdictionRate: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useJurisdictionRates,
  useComplianceApportionment,
  useComplianceFilings,
  useCreateFiling,
  useCreateJurisdictionRate,
  useDeleteJurisdictionRate,
} from '@/api/hooks/useOwnership';
import JurisdictionCompliancePage from './JurisdictionCompliancePage';
import type { ComplianceApportionment, ComplianceFiling, JurisdictionRate } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockRates = useJurisdictionRates as unknown as ReturnType<typeof vi.fn>;
const mockApportion = useComplianceApportionment as unknown as ReturnType<typeof vi.fn>;
const mockFilings = useComplianceFilings as unknown as ReturnType<typeof vi.fn>;
const mockFiling = useCreateFiling as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateJurisdictionRate as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteJurisdictionRate as unknown as ReturnType<typeof vi.fn>;

function makeRate(overrides: Partial<JurisdictionRate> = {}): JurisdictionRate {
  return {
    id: 1,
    jurisdiction_code: 'US-CA',
    label: 'California',
    currency: 'USD',
    road_usage_minor_per_m: 3,
    registration_fee_minor: 6000,
    grid_intensity_g_per_wh: 0.2,
    min_lat: 32,
    max_lat: 42,
    min_lng: -124,
    max_lng: -114,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides };
}

function makeFiling(): ComplianceFiling {
  return {
    id: 8, vehicle_id: 7, period_start: '2026-01-01T00:00:00Z',
    period_end: '2026-02-01T00:00:00Z', status: 'sealed',
    total_distance_m: 12500, total_energy_wh: 25000, total_charge_minor: 12345,
    currency: 'USD', digest: '1234567890abcdef-full-sealed-filing-digest',
    filed_at: null, created_at: '2026-02-01T00:00:00Z',
  };
}

function makeReport(overrides: Partial<ComplianceApportionment> = {}): ComplianceApportionment {
  return {
    vehicle_id: 7,
    window: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', days: 31 },
    currency: 'USD', jurisdictions: [],
    total_distance_m: 12500, total_energy_wh: 25000,
    assigned_distance_m: 10000, unassigned_distance_m: 2500, unassigned_share_pct: 20,
    total_road_usage_charge_minor: 12345, total_registration_fee_minor: 6000,
    total_liability_minor: 18345, total_emissions_g: 123400,
    drive_count: 8, digest: 'current-period-digest',
    quality: {
      status: 'limited', sample_count: 8, coverage_pct: 80,
      window_start: '2026-01-01T00:00:00Z', window_end: '2026-02-01T00:00:00Z',
      reasons: ['Some coordinates are missing'],
    },
    evidence: [],
    ...overrides,
  };
}

function summaryStat(label: string): HTMLElement {
  const element = within(card('Period liability')).getByText(label).closest('[data-operational-metric]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing genuine operational metric: ${label}`);
  return element;
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('[data-card]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing card: ${title}`);
  return element;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <JurisdictionCompliancePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given jurisdiction label. */
function removeButton(label: string): HTMLElement {
  const row = screen.getByText(label).closest('tr') as HTMLElement;
  return within(row).getByRole('button', { name: 'Remove' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockRates.mockReturnValue(
    makeQuery({ items: [makeRate(), makeRate({ id: 2, jurisdiction_code: 'US-TX', label: 'Texas' })] }),
  );
  mockApportion.mockReturnValue(makeQuery(undefined));
  mockFilings.mockReturnValue(makeQuery({ items: [] }));
  mockFiling.mockReturnValue(makeMutation());
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('JurisdictionCompliancePage — confirm-gated delete', () => {
  it('keeps retained filing amounts independent of failed current apportionment and rate sources', () => {
    const refetch = vi.fn();
    mockApportion.mockReturnValue({ ...makeQuery(undefined), error: new Error('report failed') });
    mockRates.mockReturnValue({ ...makeQuery(undefined), error: new Error('rate library failed') });
    mockFilings.mockReturnValue({ ...makeQuery({ items: [makeFiling()] }), error: new Error('filing refresh failed'), refetch });
    renderPage();

    const filings = card('Sealed filings');
    expect(within(filings).getByText('$123.45')).toBeInTheDocument();
    expect(within(filings).getByText('sealed')).toBeInTheDocument();
    expect(within(filings).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(filings).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockFilings).toHaveBeenCalledWith(7, 50, 0);
    expect(mockFiling().mutate).not.toHaveBeenCalled();
  });

  describe('JurisdictionCompliancePage — period liability OperationalBrief', () => {
    it('keeps all six quantities, captions, recorded period and original controls', () => {
      mockApportion.mockReturnValue(makeQuery(makeReport()));
      renderPage();

      const summary = card('Period liability');
      expect(summary.querySelector('[data-operational-brief]')).toBeInTheDocument();
      expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
      expect(summaryStat('Total distance')).toHaveAttribute('data-value-state', 'value');
      expect(summaryStat('Total distance')).toHaveTextContent('8 drives');
      expect(summaryStat('Assigned to a jurisdiction')).toHaveAttribute('data-value-state', 'value');
      expect(summaryStat('Unassigned')).toHaveTextContent('20.00%');
      expect(summaryStat('Road-usage charge').querySelector('[data-operational-value]')).toHaveTextContent('$123.45');
      expect(summaryStat('Total liability').querySelector('[data-operational-value]')).toHaveTextContent('$183.45');
      expect(summaryStat('Attributed emissions').querySelector('[data-operational-value]')).toHaveTextContent('123.40 kg');
      expect(screen.getByRole('combobox', { name: 'Analysis window' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Apportionment by jurisdiction' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Jurisdiction rate table' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Sealed filings' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Period digest' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add jurisdiction' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Seal a period' })).toBeInTheDocument();
      expect(removeButton('California')).toBeInTheDocument();
      fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('8 drives')).toBeInTheDocument();
    });

    it('keeps recorded zeros distinct from missing emissions and liabilities', () => {
      const report = makeReport({
        total_distance_m: 0, assigned_distance_m: 0, unassigned_distance_m: 0,
        unassigned_share_pct: 0, total_road_usage_charge_minor: 0,
        total_liability_minor: 0, total_emissions_g: 0, drive_count: 0,
      });
      mockApportion.mockReturnValue(makeQuery(report));
      const view = renderPage();
      expect(summaryStat('Total liability').querySelector('[data-operational-value]')).toHaveTextContent('$0.00');
      expect(summaryStat('Attributed emissions')).toHaveAttribute('data-value-state', 'value');
      expect(summaryStat('Attributed emissions').querySelector('[data-operational-value]')).toHaveTextContent('0.00 kg');
      expect(summaryStat('Total distance')).toHaveTextContent('0 drives');

      const missing = { ...report, total_emissions_g: undefined, total_liability_minor: undefined };
      mockApportion.mockReturnValue(makeQuery(missing));
      view.rerender(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <JurisdictionCompliancePage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      expect(summaryStat('Attributed emissions')).toHaveAttribute('data-value-state', 'missing');
      expect(summaryStat('Total liability')).toHaveAttribute('data-value-state', 'missing');
      expect(summaryStat('Road-usage charge')).toHaveAttribute('data-value-state', 'value');
    });

    it('does not borrow the USD editor default for an unknown report denomination', () => {
      mockApportion.mockReturnValue(makeQuery(makeReport({ currency: '' })));
      renderPage();
      expect(summaryStat('Road-usage charge')).toHaveAttribute('data-value-state', 'missing');
      expect(summaryStat('Total liability')).toHaveAttribute('data-value-state', 'missing');
      expect(summaryStat('Total liability')).toHaveTextContent('The recorded liability currency is unknown.');
      expect(summaryStat('Total distance')).toHaveAttribute('data-value-state', 'value');
    });

    it('keeps mixed-currency jurisdiction amounts visible instead of relabeling their aggregate as USD', () => {
      mockApportion.mockReturnValue(makeQuery(makeReport({
        jurisdictions: [{
          jurisdiction_code: 'GB-LND', label: 'London', currency: 'GBP',
          distance_m: 10000, distance_share_pct: 80, energy_wh: 20000, drive_count: 8,
          road_usage_charge_minor: 12345, registration_fee_minor: 6000,
          total_liability_minor: 18345, emissions_g: 123400, emissions_g_per_m: 12.34,
          confidence_pct: 95,
        }],
      })));
      renderPage();
      expect(summaryStat('Road-usage charge')).toHaveAttribute('data-value-state', 'missing');
      expect(summaryStat('Total liability')).toHaveTextContent('Mixed currencies; see the jurisdiction amounts below.');
      const row = within(card('Apportionment by jurisdiction')).getByText('London').closest('tr') as HTMLElement;
      expect(within(row).getByText('£123.45')).toBeInTheDocument();
      expect(within(row).getByText('£183.45')).toBeInTheDocument();
      expect(summaryStat('Attributed emissions')).toHaveAttribute('data-value-state', 'value');
    });

    it('retains measured quantities after a refresh failure without invoking any mutations', () => {
      mockApportion.mockReturnValue({ ...makeQuery(makeReport()), error: new Error('report refresh failed') });
      renderPage();
      expect(within(card('Period liability')).getByText('Data may be stale')).toBeInTheDocument();
      expect(summaryStat('Total liability')).toHaveTextContent('$183.45');
      expect(mockCreate().mutate).not.toHaveBeenCalled();
      expect(mockFiling().mutate).not.toHaveBeenCalled();
    });
  });

  it('keeps the global rate library usable when both vehicle-specific sources fail', () => {
    mockApportion.mockReturnValue({ ...makeQuery(undefined), error: new Error('report failed') });
    mockFilings.mockReturnValue({ ...makeQuery(undefined), error: new Error('filings failed') });
    renderPage();

    const rates = card('Jurisdiction rate table');
    expect(within(rates).getByText('California')).toBeInTheDocument();
    expect(within(rates).getByText('Texas')).toBeInTheDocument();
    expect(within(rates).getAllByText('$60.00')).toHaveLength(2);
    expect(within(rates).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(mockRates).toHaveBeenCalledWith();
    expect(mockApportion).toHaveBeenCalledWith(7, 90);
    expect(mockCreate().mutate).not.toHaveBeenCalled();
  });

  it('opens a danger confirm naming the jurisdiction instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('California'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this jurisdiction rate?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('California');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Texas'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('California'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('Texas')).toBeDisabled();
    expect(removeButton('California')).not.toBeDisabled();
  });
});
