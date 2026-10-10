/**
 * ChargingReconciliationPage — source exports and confirm-gated deletion.
 *
 * Removing an invoice is destructive (reconciled lines go with it), so the
 * row Remove button must open a danger confirm dialog naming the invoice
 * instead of firing the mutation directly. Only the data hooks, vehicle
 * selection, i18n, and download boundaries are mocked; the table, export menu,
 * serialization, buttons, and confirm dialog render for real.
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
vi.mock('@/lib/csvExport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport');
  return { ...actual, downloadCSV: vi.fn(), downloadJSON: vi.fn() };
});
vi.mock('@/api/hooks/useOwnership', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useOwnership')>('@/api/hooks/useOwnership');
  return {
    ...actual,
    useChargingInvoices: vi.fn(),
    useCreateDispute: vi.fn(),
    useCreateInvoice: vi.fn(),
    useDeleteInvoice: vi.fn(),
    useReconciliationReport: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useChargingInvoices,
  useCreateDispute,
  useCreateInvoice,
  useDeleteInvoice,
  useReconciliationReport,
} from '@/api/hooks/useOwnership';
import ChargingReconciliationPage from './ChargingReconciliationPage';
import { downloadCSV, downloadJSON, objectsToCSV } from '@/lib/csvExport';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { ChargingInvoice, ReconciledLine, ReconciliationReport } from '@/types/ownership';
import { formatPct } from '../formatters';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockInvoices = useChargingInvoices as unknown as ReturnType<typeof vi.fn>;
const mockDispute = useCreateDispute as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateInvoice as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteInvoice as unknown as ReturnType<typeof vi.fn>;
const mockReport = useReconciliationReport as unknown as ReturnType<typeof vi.fn>;

function makeInvoice(overrides: Partial<ChargingInvoice> = {}): ChargingInvoice {
  return {
    id: 1,
    vehicle_id: 7,
    provider: 'GridCo',
    invoice_ref: 'INV-001',
    currency: 'USD',
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    billed_total_minor: 1250,
    status: 'open',
    line_count: 2,
    version: 1,
    lines: [],
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
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

function makeLine(overrides: Partial<ReconciledLine> = {}): ReconciledLine {
  return {
    line: {
      id: 71, line_ref: 'Unknown price line', occurred_at: '2026-01-04T12:00:00Z',
      location: 'Site A', billed_energy_wh: 12500,
      billed_energy_minor: 1250, billed_idle_minor: 0, billed_tax_minor: 0,
      billed_total_minor: 1250,
    },
    match_state: 'probable', match_confidence_pct: 80,
    session_id: 77, session_started_at: '2026-01-04T12:00:00Z',
    measured_energy_wh: null, energy_delta_wh: null, energy_delta_pct: null,
    time_delta_s: null, expected_cost_minor: null, variance_minor: 0,
    variance_reasons: ['price_not_observed'], recoverable: false, ambiguous: false,
    ...overrides,
  };
}

function makeReport(): ReconciliationReport {
  const line = makeLine();
  return {
    invoice: makeInvoice(),
    lines: [line, makeLine({
      line: { ...line.line, id: 72, line_ref: 'Observed zero price line' },
      measured_energy_wh: 0, energy_delta_wh: 0, energy_delta_pct: 0,
      time_delta_s: 0, expected_cost_minor: 0, variance_reasons: [],
    })],
    uninvoiced_sessions: [{
      session_id: 88, started_at: '2026-01-05T12:00:00Z', energy_wh: 25000,
      location: 'Unbilled site', narrative: 'Independent measured session evidence.',
    }],
    variance_buckets: [{
      reason: 'energy_overcharge', label: 'Observed energy overcharge',
      line_count: 1, amount_minor: 345, share_pct: 100, recoverable: true,
    }],
    matched_line_count: 2, unmatched_line_count: 0, billed_total_minor: 1250,
    expected_total_minor: 905, net_variance_minor: 345, recoverable_minor: 345,
    measured_energy_wh: 12500, billed_energy_wh: 15000, energy_variance_wh: 2500,
    dispute_packet_digest: 'full-dispute-packet-digest-with-no-truncation',
    disputes: [{
      id: 3, invoice_id: 1, claimed_minor: 345, recovered_minor: 123,
      status: 'open', reasons: ['energy_overcharge'], note: 'Retained dispute note.',
      opened_at: '2026-02-01T00:00:00Z', resolved_at: null,
    }],
    quality: { status: 'limited', sample_count: 2, coverage_pct: 50, window_start: null, window_end: null, reasons: ['Price not observed'] },
    evidence: [],
  };
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('[data-card]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing card: ${title}`);
  return element;
}

function selectInvoice() {
  const row = screen.getByText('INV-001').closest('tr');
  expect(row).not.toBeNull();
  fireEvent.click(within(row!).getByRole('button', { name: 'Audit' }));
}

async function exportPanel(title: string, format: 'CSV' | 'JSON') {
  fireEvent.click(within(card(title)).getByRole('button', { name: 'Export list' }));
  fireEvent.click(screen.getByRole('menuitem', { name: `Download as ${format}` }));
  await waitFor(() => expect(format === 'CSV' ? downloadCSV : downloadJSON).toHaveBeenCalledOnce());
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChargingReconciliationPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given invoice ref. */
function removeButton(ref: string): HTMLElement {
  const row = screen.getByText(ref).closest('tr') as HTMLElement;
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
  mockInvoices.mockReturnValue(
    makeQuery({ items: [makeInvoice(), makeInvoice({ id: 2, invoice_ref: 'INV-002' })] }),
  );
  mockDispute.mockReturnValue(makeMutation());
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
  mockReport.mockReturnValue(makeQuery(undefined));
});

describe('ChargingReconciliationPage — confirm-gated delete', () => {
  it.each(['CSV', 'JSON'] as const)('exports all fourteen original line fields as %s with null/zero/array fidelity', async (format) => {
    const report = makeReport();
    report.lines![1] = makeLine({
      line: { ...report.lines![1].line, billed_total_minor: -12345 },
      measured_energy_wh: 0, energy_delta_pct: 0, time_delta_s: -90,
      expected_cost_minor: 0, variance_minor: -12345,
      recoverable: true, variance_reasons: ['energy_overcharge', 'timing, mismatch'],
    });
    report.invoice.currency = 'KWD';
    mockReport.mockReturnValue(makeQuery(report));
    renderPage();
    selectInvoice();
    const expected = [
      {
        line_ref: 'Unknown price line', location: 'Site A', occurred_at: '2026-01-04T12:00:00Z',
        match_state: 'probable', match_confidence_pct: 80, billed_energy_wh: 12500,
        measured_energy_wh: null, energy_delta_pct: null, time_delta_s: null,
        billed_total_minor: 1250, expected_cost_minor: null, variance_minor: 0,
        recoverable: false, variance_reasons: ['price_not_observed'],
      },
      {
        line_ref: 'Observed zero price line', location: 'Site A', occurred_at: '2026-01-04T12:00:00Z',
        match_state: 'probable', match_confidence_pct: 80, billed_energy_wh: 12500,
        measured_energy_wh: 0, energy_delta_pct: 0, time_delta_s: -90,
        billed_total_minor: -12345, expected_cost_minor: 0, variance_minor: -12345,
        recoverable: true, variance_reasons: ['energy_overcharge', 'timing, mismatch'],
      },
    ];
    await exportPanel('Line-by-line audit', format);
    if (format === 'JSON') expect(downloadJSON).toHaveBeenCalledWith('charging-reconciliation-lines', expected);
    else {
      expect(downloadCSV).toHaveBeenCalledWith('charging-reconciliation-lines', objectsToCSV(expected));
      expect(vi.mocked(downloadCSV).mock.calls[0][1].split('\r\n')[0]).toBe(
        'line_ref,location,occurred_at,match_state,match_confidence_pct,billed_energy_wh,measured_energy_wh,energy_delta_pct,time_delta_s,billed_total_minor,expected_cost_minor,variance_minor,recoverable,variance_reasons',
      );
    }
  });

  it.each(['CSV', 'JSON'] as const)('exports all six variance fields as %s without display currency conversion', async (format) => {
    const report = makeReport();
    report.invoice.currency = 'JPY';
    report.variance_buckets = [
      { label: 'Observed energy overcharge', reason: 'energy_overcharge', line_count: 1, amount_minor: -345, share_pct: 12.5, recoverable: true },
      { label: 'No variance', reason: 'no_variance', line_count: 0, amount_minor: 0, share_pct: 0, recoverable: false },
    ];
    mockReport.mockReturnValue(makeQuery(report));
    renderPage();
    selectInvoice();
    const expected = [
      { category: 'Observed energy overcharge', reason: 'energy_overcharge', line_count: 1, amount_minor: -345, share_pct: 12.5, recoverable: true },
      { category: 'No variance', reason: 'no_variance', line_count: 0, amount_minor: 0, share_pct: 0, recoverable: false },
    ];
    await exportPanel('Variance attribution', format);
    if (format === 'JSON') expect(downloadJSON).toHaveBeenCalledWith('charging-variance-attribution', expected);
    else expect(downloadCSV).toHaveBeenCalledWith('charging-variance-attribution', objectsToCSV(expected));
  });

  it.each(['CSV', 'JSON'] as const)('exports all five uninvoiced fields as %s preserving ISO time, empty location and zero Wh', async (format) => {
    const report = makeReport();
    report.uninvoiced_sessions = [{
      session_id: 0, started_at: '2026-01-05T12:00:00Z', location: '',
      energy_wh: 0, narrative: 'Measured, not billed\nOriginal evidence.',
    }];
    mockReport.mockReturnValue(makeQuery(report));
    renderPage();
    selectInvoice();
    const expected = [{
      session_id: 0, started_at: '2026-01-05T12:00:00Z', location: '',
      energy_wh: 0, narrative: 'Measured, not billed\nOriginal evidence.',
    }];
    await exportPanel('Sessions the provider never billed', format);
    if (format === 'JSON') expect(downloadJSON).toHaveBeenCalledWith('charging-uninvoiced-sessions', expected);
    else expect(downloadCSV).toHaveBeenCalledWith('charging-uninvoiced-sessions', objectsToCSV(expected));
  });

  it('exports only line search matches while retaining hidden raw fields and nullable reasons', async () => {
    localStorage.setItem('teslasync.table.ownership-reconcile-lines.columns',
      JSON.stringify({ order: ['ref', 'match', 'billedEnergy', 'measuredEnergy', 'energyDelta', 'timeDelta', 'billed', 'expected', 'variance', 'reasons'], hidden: ['measuredEnergy', 'billed'] }));
    try {
      const report = makeReport();
      report.lines![1].variance_reasons = null;
      mockReport.mockReturnValue(makeQuery(report));
      renderPage();
      selectInvoice();
      const panel = card('Line-by-line audit');
      fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: 'Observed zero price line' } });
      await waitFor(() => expect(within(panel).queryByText('Unknown price line')).toBeNull());
      await exportPanel('Line-by-line audit', 'JSON');
      expect(downloadJSON).toHaveBeenCalledWith('charging-reconciliation-lines', [{
        line_ref: 'Observed zero price line', location: 'Site A', occurred_at: '2026-01-04T12:00:00Z',
        match_state: 'probable', match_confidence_pct: 80, billed_energy_wh: 12500,
        measured_energy_wh: 0, energy_delta_pct: 0, time_delta_s: 0,
        billed_total_minor: 1250, expected_cost_minor: 0, variance_minor: 0,
        recoverable: false, variance_reasons: null,
      }]);
      expect(within(panel).queryByRole('columnheader', { name: 'Billed' })).toBeNull();
      expect(within(card('Provider statements')).getByText('INV-002')).toBeInTheDocument();
    } finally {
      localStorage.removeItem('teslasync.table.ownership-reconcile-lines.columns');
    }
  });

  it('exports only matching-state value-filtered lines with original numeric amounts', async () => {
    const report = makeReport();
    report.lines![0].match_confidence_pct = 60;
    report.lines![1].match_state = 'unmatched';
    mockReport.mockReturnValue(makeQuery(report));
    renderPage();
    selectInvoice();
    const panel = card('Line-by-line audit');
    fireEvent.click(within(panel).getByRole('button', { name: 'Match filter' }));
    const filter = screen.getByRole('dialog', { name: 'Match filter' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }));
    const unmatched = within(filter).getByRole('checkbox', { name: formatPct(80) });
    expect(unmatched).toBeDefined();
    fireEvent.click(unmatched!);
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(within(panel).queryByText('Unknown price line')).toBeNull());
    await exportPanel('Line-by-line audit', 'JSON');
    expect(downloadJSON).toHaveBeenCalledWith('charging-reconciliation-lines', [{
      line_ref: 'Observed zero price line', location: 'Site A', occurred_at: '2026-01-04T12:00:00Z',
      match_state: 'unmatched', match_confidence_pct: 80, billed_energy_wh: 12500,
      measured_energy_wh: 0, energy_delta_pct: 0, time_delta_s: 0,
      billed_total_minor: 1250, expected_cost_minor: 0, variance_minor: 0,
      recoverable: false, variance_reasons: [],
    }]);
    expect(within(card('Variance attribution')).getByText('Observed energy overcharge')).toBeInTheDocument();
  });

  it('keeps variance search independent of invoice and line-table search', async () => {
    const report = makeReport();
    report.variance_buckets!.push({ label: 'Excluded cause', reason: 'excluded', line_count: 2, amount_minor: 90, share_pct: 5, recoverable: false });
    mockReport.mockReturnValue(makeQuery(report));
    renderPage();
    selectInvoice();
    const panel = card('Variance attribution');
    fireEvent.change(within(panel).getByRole('searchbox'), { target: { value: 'Observed energy overcharge' } });
    await waitFor(() => expect(within(panel).queryByText('Excluded cause')).toBeNull());
    await exportPanel('Variance attribution', 'JSON');
    expect(downloadJSON).toHaveBeenCalledWith('charging-variance-attribution', [{
      category: 'Observed energy overcharge', reason: 'energy_overcharge',
      line_count: 1, amount_minor: 345, share_pct: 100, recoverable: true,
    }]);
    expect(within(card('Line-by-line audit')).getByText('Unknown price line')).toBeInTheDocument();
    expect(within(card('Provider statements')).getByText('INV-002')).toBeInTheDocument();
  });

  it('exports uninvoiced value-filter matches rather than all loaded sessions', async () => {
    const report = makeReport();
    report.uninvoiced_sessions!.push({
      session_id: 89, started_at: '2026-01-06T12:00:00Z',
      location: 'Excluded site', energy_wh: 0, narrative: 'Other session.',
    });
    mockReport.mockReturnValue(makeQuery(report));
    renderPage();
    selectInvoice();
    const panel = card('Sessions the provider never billed');
    fireEvent.click(within(panel).getByRole('button', { name: 'Location filter' }));
    const filter = screen.getByRole('dialog', { name: 'Location filter' });
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Select all shown values' }));
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Unbilled site' }));
    fireEvent.click(within(filter).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(within(panel).queryByText('Excluded site')).toBeNull());
    await exportPanel('Sessions the provider never billed', 'JSON');
    expect(downloadJSON).toHaveBeenCalledWith('charging-uninvoiced-sessions', [{
      session_id: 88, started_at: '2026-01-05T12:00:00Z', location: 'Unbilled site',
      energy_wh: 25000, narrative: 'Independent measured session evidence.',
    }]);
    expect(within(card('Line-by-line audit')).getByText('Unknown price line')).toBeInTheDocument();
  });

  it('exports every original statement field as JSON without projecting display columns or server totals', async () => {
    mockInvoices.mockReturnValue(makeQuery({
      items: [makeInvoice()],
      total: 81,
      limit: 50,
      offset: 0,
    }));
    renderPage();
    const statements = card('Provider statements');
    expect(within(statements).getAllByRole('columnheader').map((header) => header.textContent))
      .toEqual(['Invoice', 'Billing period', 'Billed', 'Lines', 'Status', 'Actions']);
    expect(within(statements).getByRole('button', { name: 'Audit' })).toBeEnabled();
    expect(within(statements).getByRole('button', { name: 'Remove' })).toBeEnabled();

    fireEvent.click(within(statements).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));

    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    expect(downloadJSON).toHaveBeenCalledWith('charging-invoices', [{
      invoice_ref: 'INV-001', provider: 'GridCo',
      period_start: '2026-01-01', period_end: '2026-01-31',
      billed_total_minor: 1250, currency: 'USD', line_count: 2, status: 'open',
    }]);
    expect(mockInvoices).toHaveBeenCalledWith(7, 50, 0);
    expect(mockReport).toHaveBeenLastCalledWith(null);
    expect(mockCreate().mutate).not.toHaveBeenCalled();
    expect(mockRemove().mutate).not.toHaveBeenCalled();
    expect(mockDispute().mutate).not.toHaveBeenCalled();
  });

  it.each([
    { currency: 'USD', billed_total_minor: 0 },
    { currency: 'JPY', billed_total_minor: 1250 },
    { currency: 'KWD', billed_total_minor: 12345 },
    { currency: 'USD', billed_total_minor: -345 },
  ])('keeps $currency source minor amount $billed_total_minor numeric in JSON and exact in CSV', async (amount) => {
    mockInvoices.mockReturnValue(makeQuery({ items: [makeInvoice(amount)] }));
    renderPage();
    const statements = card('Provider statements');
    fireEvent.click(within(statements).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    expect(downloadJSON).toHaveBeenCalledWith('charging-invoices', [{
      invoice_ref: 'INV-001', provider: 'GridCo',
      period_start: '2026-01-01', period_end: '2026-01-31',
      ...amount, line_count: 2, status: 'open',
    }]);

    fireEvent.click(within(statements).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledOnce());
    expect(downloadCSV).toHaveBeenCalledWith('charging-invoices',
      'invoice_ref,provider,period_start,period_end,billed_total_minor,currency,line_count,status\r\n'
      + `INV-001,GridCo,2026-01-01,2026-01-31,${amount.billed_total_minor},${amount.currency},2,open`);
  });

  it('exports the loaded register independently of table search and retained refresh errors', async () => {
    const items = [makeInvoice(), makeInvoice({
      id: 2, invoice_ref: 'INV-002', provider: 'Other provider',
      billed_total_minor: 0, currency: 'JPY', line_count: 0,
    })];
    const refetch = vi.fn();
    mockInvoices.mockReturnValue({
      ...makeQuery({ items, total: 500, limit: 50, offset: 0 }),
      error: new Error('register refresh failed'), refetch,
    });
    renderPage();
    const statements = card('Provider statements');
    fireEvent.change(within(statements).getByRole('searchbox'), { target: { value: 'INV-001' } });
    expect(within(statements).getByText('INV-001')).toBeInTheDocument();
    await waitFor(() => expect(within(statements).queryByText('INV-002')).not.toBeInTheDocument());
    expect(statements).toHaveTextContent('regardless of table search or visible columns');
    fireEvent.click(within(statements).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    expect(downloadJSON).toHaveBeenCalledWith('charging-invoices', [
      {
        invoice_ref: 'INV-001', provider: 'GridCo',
        period_start: '2026-01-01', period_end: '2026-01-31',
        billed_total_minor: 1250, currency: 'USD', line_count: 2, status: 'open',
      },
      {
        invoice_ref: 'INV-002', provider: 'Other provider',
        period_start: '2026-01-01', period_end: '2026-01-31',
        billed_total_minor: 0, currency: 'JPY', line_count: 0, status: 'open',
      },
    ]);
    expect(refetch).not.toHaveBeenCalled();
    expect(mockInvoices).toHaveBeenCalledWith(7, 50, 0);
    expect(mockReport).toHaveBeenLastCalledWith(null);
  });

  it('retains the complete source schema when the billed display column is hidden', async () => {
    mockInvoices.mockReturnValue(makeQuery({ items: [makeInvoice()] }));
    renderPage();
    const statements = card('Provider statements');
    fireEvent.click(within(statements).getByRole('button', { name: 'Reorder or hide columns' }));
    const columns = screen.getByRole('menu', { name: 'Reorder or hide columns' });
    fireEvent.click(within(columns).getByRole('checkbox', { name: 'Show or hide Billed' }));
    expect(within(statements).queryByRole('columnheader', { name: 'Billed' })).not.toBeInTheDocument();
    fireEvent.click(within(statements).getByRole('button', { name: 'Reorder or hide columns' }));

    fireEvent.click(within(statements).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    expect(downloadJSON).toHaveBeenCalledWith('charging-invoices', [{
      invoice_ref: 'INV-001', provider: 'GridCo',
      period_start: '2026-01-01', period_end: '2026-01-31',
      billed_total_minor: 1250, currency: 'USD', line_count: 2, status: 'open',
    }]);
    expect(within(statements).getByRole('button', { name: 'Audit' })).toBeEnabled();
    expect(within(statements).getByRole('button', { name: 'Remove' })).toBeEnabled();
    fireEvent.click(within(statements).getByRole('button', { name: 'Reorder or hide columns' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Reorder or hide columns' }))
      .getByRole('checkbox', { name: 'Show or hide Billed' }));
  });

  it('uses the latest loaded statement source after refresh rather than a stale export snapshot', async () => {
    const view = renderPage();
    mockInvoices.mockReturnValue(makeQuery({ items: [makeInvoice({
      id: 3, invoice_ref: 'INV-003', currency: 'KWD', billed_total_minor: 9876,
    })], total: 81, limit: 50, offset: 0 }));
    view.rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ChargingReconciliationPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    fireEvent.click(within(card('Provider statements')).getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledOnce());
    expect(downloadJSON).toHaveBeenCalledWith('charging-invoices', [{
      invoice_ref: 'INV-003', provider: 'GridCo',
      period_start: '2026-01-01', period_end: '2026-01-31',
      billed_total_minor: 9876, currency: 'KWD', line_count: 2, status: 'open',
    }]);
  });

  it('keeps empty source export disabled without inventing statements or monetary zero', () => {
    mockInvoices.mockReturnValue(makeQuery({ items: [], total: 0, limit: 50, offset: 0 }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Import statement' }));
    expect(within(card('Provider statements')).getByRole('button', { name: 'No data to export' }))
      .toBeDisabled();
    expect(downloadJSON).not.toHaveBeenCalled();
    expect(downloadCSV).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Invoice reference required' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import and reconcile' })).toBeEnabled();
  });

  it('uses both real briefs with statement currency, matching counts and canonical energy', () => {
    mockReport.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    selectInvoice();
    expectOperationalBand('Reconciliation result', [
      'billed', 'expected', 'variance', 'recoverable', 'matched', 'unmatched', 'billedEnergy', 'energyVariance',
    ]);
    for (const key of ['billed', 'expected', 'variance', 'recoverable', 'matched', 'unmatched', 'billedEnergy', 'energyVariance']) {
      expect(summaryMetric('Reconciliation result', key)).toHaveAttribute('data-value-state', 'value');
    }
    expect(summaryMetric('Reconciliation result', 'billed')).toHaveTextContent('$12.50');
    const briefs = card('Reconciliation result').querySelectorAll('[data-operational-brief]');
    expect(briefs).toHaveLength(2);
    const energyBrief = briefs[1];
    if (!(energyBrief instanceof HTMLElement)) throw new Error('Missing energy brief');
    fireEvent.click(within(energyBrief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Energy variance');
    expect(screen.getByRole('dialog')).toHaveTextContent('Matched lines');
    expect(mockDispute().mutate).not.toHaveBeenCalled();
  });

  it('keeps all retained reconciliation amounts and historical details when both sources fail to refresh', () => {
    const reportRefetch = vi.fn();
    const invoiceRefetch = vi.fn();
    mockReport.mockReturnValue({ ...makeQuery(makeReport()), error: new Error('report refresh failed'), refetch: reportRefetch });
    mockInvoices.mockReturnValue({ ...makeQuery({ items: [makeInvoice()] }), error: new Error('register refresh failed'), refetch: invoiceRefetch });
    renderPage();
    selectInvoice();

    const summary = card('Reconciliation result');
    expect(summary).toHaveTextContent('$12.50');
    expect(summary).toHaveTextContent('$9.05');
    expect(within(summary).getAllByText('$3.45')).toHaveLength(2);
    for (const label of ['Matched lines', 'Unmatched lines', 'Billed energy', 'Energy variance']) {
      expect(within(summary).getByText(label)).toBeInTheDocument();
    }
    expect(within(card('Line-by-line audit')).getByText('Unknown price line')).toBeInTheDocument();
    expect(within(card('Variance attribution')).getByText('Observed energy overcharge')).toBeInTheDocument();
    expect(within(card('Sessions the provider never billed')).getByText('Independent measured session evidence.')).toBeInTheDocument();
    const desk = card('Dispute desk');
    expect(within(desk).getByText('full-dispute-packet-digest-with-no-truncation')).toBeInTheDocument();
    expect(desk).toHaveTextContent('recovered $1.23');
    expect(desk).toHaveTextContent('Retained dispute note.');
    expect(within(desk).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(desk).getByRole('button', { name: 'Retry' }));
    expect(reportRefetch).toHaveBeenCalledOnce();
    expect(invoiceRefetch).not.toHaveBeenCalled();
    expect(mockReport).toHaveBeenLastCalledWith(1);
    expect(mockDispute().mutate).not.toHaveBeenCalled();
  });

  it('distinguishes unobserved expected pricing and telemetry from an observed real zero line', () => {
    mockReport.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    selectInvoice();

    const audit = card('Line-by-line audit');
    const unknown = within(audit).getByText('Unknown price line').closest('tr');
    const zero = within(audit).getByText('Observed zero price line').closest('tr');
    expect(unknown).toHaveTextContent('price not observed');
    expect(unknown?.textContent?.match(/—/g)).toHaveLength(4);
    expect(zero).toHaveTextContent('$0.00');
    expect(zero).not.toHaveTextContent('price not observed');
    expect(zero?.textContent?.match(/—/g)).toHaveLength(1);
  });

  it('isolates initial audit failure from the imported statements and preserves report recovery', () => {
    const refetch = vi.fn();
    mockReport.mockReturnValue({ ...makeQuery(undefined), error: new Error('audit failed'), refetch });
    renderPage();
    selectInvoice();

    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByText('INV-002')).toBeInTheDocument();
    expect(within(card('Provider statements')).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(within(card('Reconciliation result')).queryByText('$0.00')).not.toBeInTheDocument();
    fireEvent.click(within(card('Line-by-line audit')).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockCreate().mutate).not.toHaveBeenCalled();
  });

  it('keeps imported statements and all audit shells visible during a register refresh error', () => {
    const refetch = vi.fn();
    mockInvoices.mockReturnValue({
      ...makeQuery({ items: [makeInvoice()] }),
      error: new Error('refresh failed'),
      isError: true,
      refetch,
    });
    renderPage();
    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Line-by-line audit' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Variance attribution' })).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockInvoices).toHaveBeenCalledWith(7, 50, 0);
  });

  it('keeps the import action and audit prerequisites reachable after an initial register failure', () => {
    mockInvoices.mockReturnValue({ ...makeQuery(undefined), error: new Error('initial failure') });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Provider statements' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dispute desk' })).toBeInTheDocument();
    expect(screen.getByText('Select a statement above to run the audit.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('does not advertise checklist filters over the first server invoice page', () => {
    mockInvoices.mockReturnValue(makeQuery({
      items: [makeInvoice()],
      total: 500,
      limit: 50,
      offset: 0,
    }));
    renderPage();

    const row = screen.getByText('INV-001').closest('tr');
    const table = row?.closest('table');
    expect(table).not.toBeNull();
    expect(within(table!).queryByRole('button', { name: /^Filter / })).not.toBeInTheDocument();
    expect(mockInvoices).toHaveBeenCalledWith(7, 50, 0);
  });

  it('opens a danger confirm naming the invoice instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('INV-001'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this invoice?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('INV-001');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('INV-002'));
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

    fireEvent.click(removeButton('INV-001'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('INV-002')).toBeDisabled();
    expect(removeButton('INV-001')).not.toBeDisabled();
  });
});
