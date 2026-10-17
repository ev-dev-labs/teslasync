/**
 * JurisdictionCompliancePage — confirm-gated jurisdiction-rate deletion.
 *
 * Removing a rate is destructive, so the row Remove button must open a
 * danger confirm dialog naming the jurisdiction instead of firing the
 * mutation directly. Only the data hooks, vehicle selection, and i18n are
 * mocked; the table, buttons, and confirm dialog render for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const preferences = vi.hoisted(() => ({ locale: 'en-US', cancel: 'Cancel' }));
vi.mock('@/hooks/useNumberFormatting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useNumberFormatting')>();
  return { ...actual, useNumberFormatting: () => ({ ...actual.useNumberFormatting(), locale: preferences.locale }) };
});
vi.mock('@/lib/csvExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}));

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
    if (key === 'common.cancel') return preferences.cancel;
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
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import type { ComplianceApportionment, ComplianceFiling, JurisdictionRate } from '@/types/ownership';
import { neonColorMap, typography } from '@/lib/tokens';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import { formatDateTime } from '@/lib/dateFormat';

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
  preferences.locale = 'en-US';
  preferences.cancel = 'Cancel';
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

afterEach(() => {
  window.localStorage.removeItem('teslasync.table.ownership-compliance-filings.columns');
});

describe('JurisdictionCompliancePage — confirm-gated delete', () => {
  it('pages the complete server register and resets the offset when the selected vehicle changes', () => {
    mockFilings.mockImplementation((_vehicle: number, limit: number, offset: number) => makeQuery({
      items: [makeFiling()], total: 51, limit, offset,
    }));
    const view = renderPage();
    const register = card('Sealed filings');
    expect(within(register).getByText('Showing 1–50 of 51')).toBeInTheDocument();
    fireEvent.click(within(register).getByRole('button', { name: 'Next page' }));
    expect(mockFilings).toHaveBeenLastCalledWith(7, 50, 50);
    expect(within(register).getByText('Showing 51–51 of 51')).toBeInTheDocument();
    fireEvent.change(within(register).getByRole('combobox', { name: 'Rows per page' }), { target: { value: '25' } });
    expect(mockFilings).toHaveBeenLastCalledWith(7, 25, 0);
    fireEvent.click(within(register).getByRole('button', { name: 'Next page' }));
    expect(mockFilings).toHaveBeenLastCalledWith(7, 25, 25);
    mockSelected.mockReturnValue({ vehicleId: 9, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
      <JurisdictionCompliancePage />
    </QueryClientProvider></MemoryRouter>);
    expect(mockFilings).toHaveBeenLastCalledWith(9, 25, 0);
  });

  it('does not infer register completeness or a next page from an unknown total', () => {
    mockFilings.mockReturnValue(makeQuery({ items: [makeFiling()] }));
    renderPage();
    const register = card('Sealed filings');
    expect(within(register).getByText('Page 1 of Unknown')).toBeInTheDocument();
    expect(within(register).getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(within(register).getByText('Exports include only matching loaded rows, or selected loaded rows.')).toBeInTheDocument();
  });

  it('sorts all three apportionment quantities and loaded filing periods in both directions', () => {
    const row = {
      jurisdiction_code: 'QA-A', label: 'Small', currency: 'USD', distance_m: 1,
      distance_share_pct: 10, energy_wh: 1, drive_count: 1, road_usage_charge_minor: 1,
      registration_fee_minor: 1, total_liability_minor: 2, emissions_g: 1,
      emissions_g_per_m: 1, confidence_pct: 95,
    };
    mockApportion.mockReturnValue(makeQuery(makeReport({
      jurisdictions: [row, { ...row, jurisdiction_code: 'QA-B', label: 'Large', distance_m: 10,
        road_usage_charge_minor: 10, total_liability_minor: 20 }],
    })));
    mockFilings.mockReturnValue(makeQuery({
      items: [makeFiling(), { ...makeFiling(), id: 9, period_start: '2026-03-01T00:00:00Z', digest: 'later-digest' }],
      total: 2, limit: 50, offset: 0,
    }));
    renderPage();
    const table = within(card('Apportionment by jurisdiction')).getByRole('table');
    for (const header of ['Distance', 'Road-usage charge', 'Total liability']) {
      fireEvent.click(within(table).getByRole('button', { name: header, exact: true }));
      expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Large');
      fireEvent.click(within(table).getByRole('button', { name: header, exact: true }));
      expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Small');
    }
    const register = within(card('Sealed filings')).getByRole('table');
    fireEvent.click(within(register).getByRole('button', { name: 'Period', exact: true }));
    expect(within(register).getAllByRole('row')[1]).toHaveTextContent('later-digest');
    fireEvent.click(within(register).getByRole('button', { name: 'Period', exact: true }));
    expect(within(register).getAllByRole('row')[1]).toHaveTextContent('1234567890abcdef');
  });

  it('exports detached full seals, SI quantities, minor money and original instants despite hidden columns', async () => {
    const filing = makeFiling();
    mockFilings.mockReturnValue(makeQuery({ items: [filing], total: 51, limit: 50, offset: 0 }));
    window.localStorage.setItem('teslasync.table.ownership-compliance-filings.columns', JSON.stringify({
      order: ['period', 'status'], hidden: ['distance', 'energy', 'charge', 'digest'],
    }));
    renderPage();
    const register = card('Sealed filings');
    expect(within(register).queryByText('1234567890abcdef…')).not.toBeInTheDocument();
    fireEvent.click(within(register).getByRole('button', { name: /Export/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /CSV/ }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledOnce());
    const csv = vi.mocked(downloadCSV).mock.calls[0][1];
    for (const value of ['total_distance_m', '12500', 'total_energy_wh', '25000', 'total_charge_minor', '12345',
      'currency', 'USD', filing.digest, filing.period_start, filing.period_end, 'filed_at', 'created_at']) {
      expect(csv).toContain(value);
    }
    fireEvent.click(within(register).getByRole('button', { name: /Export/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /JSON/ }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    const rows = vi.mocked(downloadJSON).mock.calls[0][1];
    expect(rows).toEqual([expect.objectContaining(filing)]);
    expect(Array.isArray(rows) && rows[0]).not.toBe(filing);
    expect(filing).toEqual(makeFiling());
    window.localStorage.removeItem('teslasync.table.ownership-compliance-filings.columns');
  });

  it('exports raw apportionment and rate fields instead of display-unit aliases or action text', async () => {
    const jurisdiction = {
      jurisdiction_code: 'QA-ONLY', label: 'Synthetic apportionment', currency: 'GBP',
      distance_m: 12345, distance_share_pct: 80, energy_wh: 23456, drive_count: 8,
      road_usage_charge_minor: 12345, registration_fee_minor: 6000,
      total_liability_minor: 18345, emissions_g: 123400, emissions_g_per_m: 12.34,
      confidence_pct: 95,
    };
    mockApportion.mockReturnValue(makeQuery(makeReport({ jurisdictions: [jurisdiction] })));
    renderPage();
    fireEvent.click(within(card('Apportionment by jurisdiction')).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    expect(vi.mocked(downloadJSON).mock.calls[0]).toEqual([
      'jurisdiction-apportionment-worksheet', [expect.objectContaining(jurisdiction)],
    ]);
    const rows = vi.mocked(downloadJSON).mock.calls[0][1];
    expect(Array.isArray(rows) && rows[0]).not.toBe(jurisdiction);

    fireEvent.click(within(card('Jurisdiction rate table')).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledOnce());
    const csv = vi.mocked(downloadCSV).mock.calls[0][1];
    for (const key of ['jurisdiction_code', 'road_usage_minor_per_m', 'registration_fee_minor',
      'grid_intensity_g_per_wh', 'min_lat', 'max_lat', 'min_lng', 'max_lng', 'currency', 'version', 'created_at', 'updated_at']) {
      expect(csv).toContain(key);
    }
    expect(csv).not.toContain('Remove');
    expect(mockCreate().mutate).not.toHaveBeenCalled();
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });

  it('rejects reversed spatial bounds with associated feedback and preserves a correctable draft', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add jurisdiction' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Jurisdiction code required' }), { target: { value: 'qa-only' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name required' }), { target: { value: 'Synthetic jurisdiction' } });
    const minLat = screen.getByRole('spinbutton', { name: 'Min latitude required' });
    const maxLat = screen.getByRole('spinbutton', { name: 'Max latitude required' });
    const minLng = screen.getByRole('spinbutton', { name: 'Min longitude required' });
    fireEvent.change(minLat, { target: { value: '10' } });
    fireEvent.change(minLng, { target: { value: '10' } });
    fireEvent.submit(minLat.closest('form')!);
    expect(mockCreate().mutate).not.toHaveBeenCalled();
    expect(minLat).toHaveAttribute('aria-invalid', 'true');
    expect(minLng).toHaveAttribute('aria-invalid', 'true');
    expect(minLat).toHaveAccessibleDescription('Latitude must be between -90 and 0');
    expect(minLat).toHaveValue(10);
    fireEvent.change(maxLat, { target: { value: '10' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Max longitude required' }), { target: { value: '10' } });
    fireEvent.submit(minLat.closest('form')!);
    expect(mockCreate().mutate).toHaveBeenCalledWith(expect.objectContaining({
      min_lat: 10, max_lat: 10, min_lng: 10, max_lng: 10,
    }), expect.any(Object));
  });

  it('preserves cleared business dates and rejects reversed periods before sealing UTC instants', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Seal a period' }));
    const start = screen.getByLabelText(/^Period start\s*\*?\s*required$/);
    const end = screen.getByLabelText(/^Period end\s*\*?\s*required$/);
    fireEvent.change(start, { target: { value: '' } });
    expect(start).toHaveValue('');
    fireEvent.submit(start.closest('form')!);
    expect(start).toHaveAttribute('aria-invalid', 'true');
    expect(mockFiling().mutate).not.toHaveBeenCalled();
    fireEvent.change(start, { target: { value: '2026-03-01' } });
    fireEvent.change(end, { target: { value: '2026-02-01' } });
    fireEvent.submit(start.closest('form')!);
    expect(mockFiling().mutate).not.toHaveBeenCalled();
    expect(start).toHaveValue('2026-03-01');
    fireEvent.change(end, { target: { value: '2026-03-01' } });
    fireEvent.submit(start.closest('form')!);
    expect(mockFiling().mutate).toHaveBeenCalledWith({
      vehicle_id: 7, confirmed: true,
      period_start: '2026-03-01T00:00:00.000Z', period_end: '2026-03-01T00:00:00.000Z',
    }, expect.any(Object));
  });

  it('discloses the no-vehicle prerequisite instead of asserting searched-source emptiness', () => {
    mockSelected.mockReturnValue({ vehicleId: null, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
    renderPage();
    for (const heading of ['Period liability', 'Apportionment by jurisdiction', 'Sealed filings', 'Period digest']) {
      expect(within(card(heading)).getByText('Select a vehicle to begin')).toBeInTheDocument();
    }
    expect(screen.queryByText('No drives with usable coordinates in this window.')).not.toBeInTheDocument();
    expect(screen.queryByText('No periods sealed yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seal a period' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add jurisdiction' })).not.toBeDisabled();
  });

  it('uses the saved locale for period and filing dates and localizes the caller Cancel', () => {
    preferences.locale = 'de-DE';
    preferences.cancel = 'Abbrechen';
    mockApportion.mockReturnValue(makeQuery(makeReport()));
    mockFilings.mockReturnValue(makeQuery({ items: [makeFiling()] }));
    renderPage();
    const filing = makeFiling();
    expect(within(card('Sealed filings')).getByText(
      `${formatDateTime(filing.period_start, { locale: 'de-DE' })} → ${formatDateTime(filing.period_end, { locale: 'de-DE' })}`,
    )).toBeInTheDocument();
    assertOperationalBriefDisclosure(card('Period liability'),
      `${formatDateTime(makeReport().window.from, { locale: 'de-DE', tz: 'UTC' })} → ${formatDateTime(makeReport().window.to, { locale: 'de-DE', tz: 'UTC' })}`,
      { contains: true });
    fireEvent.click(removeButton('California'));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
  });

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

  describe('JurisdictionCompliancePage — restrained presentation and preserved access', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps missing summary quantities unknown without asserting a recorded period or compliance success', () => {
      mockSelected.mockReturnValue({ vehicleId: null, vehicle: null, vehicles: [], setVehicleId: vi.fn() });
      renderPage();

      const summary = card('Period liability');
      expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
      for (const label of ['Total distance', 'Assigned to a jurisdiction', 'Unassigned', 'Road-usage charge', 'Total liability', 'Attributed emissions']) {
        assertOperationalMetricUnavailable(summary, label);
      }
      expect(within(summary).getByText('No metric values are available yet.')).toBeInTheDocument();
      assertOperationalBriefDisclosure(summary, 'Unknown');
      expect(within(summary).queryByText('Recorded apportionment')).not.toBeInTheDocument();
      // Provenance is disclosed by the genuine OperationalBrief details drawer.
      fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('No recorded apportionment window is available.')).toBeInTheDocument();
      expect(screen.getByText('A worksheet, not a tax return')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Period digest' })).toBeInTheDocument();
      expect(within(card('Jurisdiction rate table')).getByText('California')).toBeInTheDocument();
      expect(mockFiling().mutate).not.toHaveBeenCalled();
      expect(mockCreate().mutate).not.toHaveBeenCalled();
    });

    it('associates each editor disclosure with its form and keeps drafts on cancel and reopen', () => {
      renderPage();
      const rateToggle = screen.getByRole('button', { name: 'Add jurisdiction' });
      const filingToggle = screen.getByRole('button', { name: 'Seal a period' });
      expect(rateToggle).toHaveAttribute('aria-expanded', 'false');
      expect(filingToggle).toHaveAttribute('aria-expanded', 'false');
      expect(rateToggle.getAttribute('aria-controls')).not.toBe(filingToggle.getAttribute('aria-controls'));

      fireEvent.click(rateToggle);
      const codeInput = screen.getByRole('textbox', { name: 'Jurisdiction code required' });
      const rateInput = screen.getByRole('spinbutton', { name: 'Road-usage rate (minor / m) required' });
      const rateForm = codeInput.closest('form');
      expect(rateForm).toHaveAttribute('id', rateToggle.getAttribute('aria-controls'));
      expect(rateToggle).toHaveAttribute('aria-expanded', 'true');
      expect(codeInput).toBeRequired();
      expect(rateInput).toBeRequired();
      fireEvent.change(codeInput, { target: { value: 'qa-only' } });
      fireEvent.change(rateInput, { target: { value: '0.003' } });
      fireEvent.click(rateToggle);
      expect(rateToggle).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(rateToggle);
      expect(screen.getByRole('textbox', { name: 'Jurisdiction code required' })).toHaveValue('QA-ONLY');
      expect(screen.getByRole('spinbutton', { name: 'Road-usage rate (minor / m) required' })).toHaveValue(0.003);

      fireEvent.click(filingToggle);
      // Date inputs have no implicit role; Label includes both required markers.
      const periodStart = screen.getByLabelText(/^Period start\s*\*?\s*required$/);
      const filingForm = periodStart.closest('form');
      expect(filingForm).toHaveAttribute('id', filingToggle.getAttribute('aria-controls'));
      expect(filingToggle).toHaveAttribute('aria-expanded', 'true');
      expect(periodStart).toHaveAccessibleName('Period start required');
      expect(periodStart).toBeRequired();
      fireEvent.change(periodStart, { target: { value: '2026-01-15' } });
      fireEvent.click(filingToggle);
      fireEvent.click(filingToggle);
      expect(screen.getByLabelText(/^Period start\s*\*?\s*required$/)).toHaveValue('2026-01-15');
      expect(mockCreate().mutate).not.toHaveBeenCalled();
      expect(mockFiling().mutate).not.toHaveBeenCalled();
    });

    it('uses neutral code for unchanged seals and preserves confidence thresholds with semantic ink', () => {
      const jurisdiction = {
        jurisdiction_code: 'QA-A', label: 'Synthetic jurisdiction A', currency: 'USD',
        distance_m: 10000, distance_share_pct: 80, energy_wh: 20000, drive_count: 8,
        road_usage_charge_minor: 12345, registration_fee_minor: 6000,
        total_liability_minor: 18345, emissions_g: 123400, emissions_g_per_m: 12.34,
        confidence_pct: 90,
      };
      mockApportion.mockReturnValue(makeQuery(makeReport({
        jurisdictions: [
          jurisdiction,
          { ...jurisdiction, jurisdiction_code: 'QA-B', label: 'Synthetic jurisdiction B', confidence_pct: 60 },
          { ...jurisdiction, jurisdiction_code: 'UNASSIGNED', label: 'Synthetic unassigned', confidence_pct: 59 },
        ],
      })));
      mockFilings.mockReturnValue(makeQuery({ items: [makeFiling()] }));
      renderPage();

      const apportionment = card('Apportionment by jurisdiction');
      for (const [label, percentage, tone] of [
        ['Synthetic jurisdiction A', '90.00%', neonColorMap.green.text],
        ['Synthetic jurisdiction B', '60.00%', neonColorMap.amber.text],
        ['Synthetic unassigned', '59.00%', neonColorMap.red.text],
      ]) {
        const row = within(apportionment).getByText(label).closest('tr') as HTMLElement;
        expect(within(row).getByText(percentage)).toHaveClass(tone);
        expect(within(row).getByText('$183.45')).toHaveClass(neonColorMap.amber.text);
      }
      const periodDigest = within(card('Period digest')).getByText('current-period-digest');
      expect(periodDigest.tagName).toBe('CODE');
      expect(periodDigest).toHaveClass(typography.color.secondary);
      const seal = within(card('Sealed filings')).getByText('1234567890abcdef…');
      expect(seal.tagName).toBe('CODE');
      expect(seal).toHaveAttribute('title', makeFiling().digest);
      expect(seal).toHaveClass(typography.color.secondary);
    });

    it('keeps every narrow-table field and confirmed Remove reachable through the existing mobile details owner', async () => {
      const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
      vi.stubGlobal('ResizeObserver', class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) { observers.push({ element, callback: this.callback }); }
        unobserve() {}
        disconnect() {}
      });
      mockApportion.mockReturnValue(makeQuery(makeReport({
        jurisdictions: [{
          jurisdiction_code: 'QA-ONLY', label: 'Synthetic apportionment', currency: 'USD',
          distance_m: 10000, distance_share_pct: 80, energy_wh: 20000, drive_count: 8,
          road_usage_charge_minor: 12345, registration_fee_minor: 6000,
          total_liability_minor: 18345, emissions_g: 123400, emissions_g_per_m: 12.34,
          confidence_pct: 95,
        }],
      })));
      mockFilings.mockReturnValue(makeQuery({ items: [makeFiling()] }));
      renderPage();
      act(() => observers.forEach(({ element, callback }) => callback(
        [{ target: element, contentRect: { width: 375 } } as ResizeObserverEntry], {} as ResizeObserver,
      )));

      const apportionment = card('Apportionment by jurisdiction');
      expect(apportionment.querySelector('[data-mobile-table]')).toBeInTheDocument();
      fireEvent.click(within(apportionment).getByRole('button', { name: 'Quick view' }));
      let dialog = screen.getByRole('dialog');
      for (const field of ['Jurisdiction', 'Distance', 'Drives', 'Energy', 'Road-usage charge', 'Registration', 'Total liability', 'Attributed emissions', 'Confidence']) {
        expect(within(dialog).getByText(field)).toBeInTheDocument();
      }
      expect(within(dialog).getByText('8')).toBeInTheDocument();
      expect(within(dialog).getByText('$183.45')).toBeInTheDocument();
      fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close', exact: true })[0]);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const rates = card('Jurisdiction rate table');
      fireEvent.click(within(rates).getAllByRole('button', { name: 'Quick view' })[0]);
      dialog = screen.getByRole('dialog');
      for (const field of ['Jurisdiction', 'Road-usage rate', 'Annual registration', 'Grid intensity', 'Bounding box', 'Actions']) {
        expect(within(dialog).getByText(field)).toBeInTheDocument();
      }
      expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
      fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close', exact: true })[0]);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      fireEvent.click(within(rates).getAllByRole('button', { name: 'Remove' })[0]);
      expect(within(screen.getByRole('dialog')).getByText('Delete this jurisdiction rate?')).toBeInTheDocument();
      expect(mockRemove().mutate).not.toHaveBeenCalled();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      fireEvent.click(within(card('Sealed filings')).getByRole('button', { name: 'Quick view' }));
      dialog = screen.getByRole('dialog');
      for (const field of ['Period', 'Distance', 'Energy', 'Charge', 'Status', 'Seal']) {
        expect(within(dialog).getByText(field)).toBeInTheDocument();
      }
      expect(within(dialog).getByText('$123.45')).toBeInTheDocument();
      expect(within(dialog).getByText('1234567890abcdef…')).toHaveAttribute('title', makeFiling().digest);
      expect(mockFiling().mutate).not.toHaveBeenCalled();
      expect(mockCreate().mutate).not.toHaveBeenCalled();
    });
  });

  describe('JurisdictionCompliancePage — period liability OperationalBrief', () => {
    it('keeps all six quantities, captions, recorded period and original controls', () => {
      mockApportion.mockReturnValue(makeQuery(makeReport()));
      renderPage();

      const summary = card('Period liability');
      expect(summary.querySelector('[data-operational-brief]')).toBeInTheDocument();
      expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
      expect(summaryStat('Total distance')).toHaveAttribute('data-value-state', 'value');
      expect(summaryStat('Total distance').querySelector('[data-operational-value]')).toHaveTextContent('12.50 km');
      expect(summaryStat('Assigned to a jurisdiction')).toHaveAttribute('data-value-state', 'value');
      expect(summaryStat('Unassigned').querySelector('[data-operational-value]')).toHaveTextContent('2.50 km');
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
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('group', { name: 'Total distance' })).toHaveTextContent('8 drives');
      expect(within(dialog).getByRole('group', { name: 'Unassigned' })).toHaveTextContent('20.00%');
      expect(within(dialog).getByText('8 drives')).toBeInTheDocument();
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
      expect(summaryStat('Total distance').querySelector('[data-operational-value]')).toHaveTextContent('0.00 km');
      fireEvent.click(within(card('Period liability')).getByRole('button', { name: 'Review details' }));
      const zeroDialog = screen.getByRole('dialog');
      expect(within(zeroDialog).getByRole('group', { name: 'Total distance' })).toHaveTextContent('0 drives');
      fireEvent.keyDown(zeroDialog, { key: 'Escape' });

      const missing = { ...report, total_emissions_g: undefined, total_liability_minor: undefined };
      mockApportion.mockReturnValue(makeQuery(missing));
      view.rerender(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <JurisdictionCompliancePage />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      assertOperationalMetricUnavailable(card('Period liability'), 'Attributed emissions');
      assertOperationalMetricUnavailable(card('Period liability'), 'Total liability');
      expect(summaryStat('Road-usage charge')).toHaveAttribute('data-value-state', 'value');
    });

    it('does not borrow the USD editor default for an unknown report denomination', () => {
      mockApportion.mockReturnValue(makeQuery(makeReport({ currency: '' })));
      renderPage();
      assertOperationalMetricUnavailable(card('Period liability'), 'Road-usage charge');
      assertOperationalMetricUnavailable(card('Period liability'), 'Total liability');
      expect(card('Period liability')).not.toHaveTextContent('$');
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
      assertOperationalMetricUnavailable(card('Period liability'), 'Road-usage charge');
      assertOperationalMetricUnavailable(card('Period liability'), 'Total liability');
      expect(card('Period liability')).not.toHaveTextContent('$');
      const row = within(card('Apportionment by jurisdiction')).getByText('London').closest('tr') as HTMLElement;
      expect(within(row).getByText('£123.45')).toBeInTheDocument();
      expect(within(row).getByText('£183.45')).toBeInTheDocument();
      expect(summaryStat('Attributed emissions')).toHaveAttribute('data-value-state', 'value');
    });

    it('retains measured quantities after a refresh failure without invoking any mutations', () => {
      mockApportion.mockReturnValue({ ...makeQuery(makeReport()), error: new Error('report refresh failed') });
      renderPage();
      assertOperationalBriefDisclosure(card('Period liability'), 'Data may be stale');
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
