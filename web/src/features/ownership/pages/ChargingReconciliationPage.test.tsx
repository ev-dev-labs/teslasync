/**
 * ChargingReconciliationPage — confirm-gated invoice deletion.
 *
 * Removing an invoice is destructive (reconciled lines go with it), so the
 * row Remove button must open a danger confirm dialog naming the invoice
 * instead of firing the mutation directly. Only the data hooks, vehicle
 * selection, and i18n are mocked; the table, buttons, and confirm dialog
 * render for real.
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
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { ChargingInvoice, ReconciledLine, ReconciliationReport } from '@/types/ownership';

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
