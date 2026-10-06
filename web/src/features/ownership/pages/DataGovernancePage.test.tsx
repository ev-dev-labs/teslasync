/**
 * DataGovernancePage — confirm-gated retention-policy deletion.
 *
 * Removing a retention policy is destructive, so the row Remove button must
 * open a danger confirm dialog naming the dataset instead of firing the
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
    useGovernanceOverview: vi.fn(),
    useRetentionRuns: vi.fn(),
    useSimulateGovernance: vi.fn(),
    useUpsertRetentionPolicy: vi.fn(),
    useDeleteRetentionPolicy: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useGovernanceOverview,
  useRetentionRuns,
  useSimulateGovernance,
  useUpsertRetentionPolicy,
  useDeleteRetentionPolicy,
} from '@/api/hooks/useOwnership';
import DataGovernancePage from './DataGovernancePage';
import type { GovernanceOverview, RetentionPolicy, RetentionRun } from '@/types/ownership';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockOverview = useGovernanceOverview as unknown as ReturnType<typeof vi.fn>;
const mockRuns = useRetentionRuns as unknown as ReturnType<typeof vi.fn>;
const mockSimulate = useSimulateGovernance as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = useUpsertRetentionPolicy as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteRetentionPolicy as unknown as ReturnType<typeof vi.fn>;

function makePolicy(overrides: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return {
    id: 1,
    dataset: 'drives',
    retention_s: 365 * 86400,
    downsample_after_s: null,
    downsample_bucket_s: null,
    legal_hold: false,
    enabled: true,
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

function makeRun(): RetentionRun {
  return {
    id: 3, dataset: 'Observed ledger dataset', mode: 'dry_run',
    rows_scanned: 2000, rows_expiring: 300, rows_downsampling: 400,
    bytes_reclaimable: 1024, fidelity_loss_pct: 2.5, blocked_by_hold: false,
    executed_at: '2026-02-01T00:00:00Z',
  };
}

function makeOverview(overrides: Partial<GovernanceOverview> = {}): GovernanceOverview {
  return {
    as_of: '2026-03-01T00:00:00Z',
    inventory: [], policies: [makePolicy()],
    total_bytes: 4 * 1024 ** 2, governed_bytes: 3 * 1024 ** 2,
    ungoverned_bytes: 1024 ** 2, governed_share_pct: 75,
    legal_hold_count: 0, plan_only: true,
    quality: { status: 'limited', sample_count: 1, coverage_pct: 75, window_start: null, window_end: null, reasons: [] },
    evidence: [],
    ...overrides,
  };
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
        <DataGovernancePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given dataset. */
function removeButton(dataset: string): HTMLElement {
  const row = screen.getByText(dataset).closest('tr') as HTMLElement;
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
  mockOverview.mockReturnValue(
    makeQuery({
      inventory: [],
      policies: [makePolicy(), makePolicy({ id: 2, dataset: 'sessions' })],
    }),
  );
  mockRuns.mockReturnValue(makeQuery({ items: [] }));
  mockSimulate.mockReturnValue({ ...makeMutation(), data: undefined });
  mockUpsert.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('DataGovernancePage — confirm-gated delete', () => {
  it('retains all five storage quantities, binary units, policy coverage and legal exemptions in the real brief', () => {
    mockOverview.mockReturnValue(makeQuery(makeOverview()));
    renderPage();
    expectOperationalBand('Storage posture', ['total', 'governed', 'ungoverned', 'holds', 'mode']);
    expect(summaryMetric('Storage posture', 'total')).toHaveTextContent('4.0 MiB');
    expect(summaryMetric('Storage posture', 'governed')).toHaveTextContent('3.0 MiB');
    expect(summaryMetric('Storage posture', 'governed')).toHaveTextContent(/75(?:\.0+)?%/);
    expect(summaryMetric('Storage posture', 'ungoverned')).toHaveTextContent('1.0 MiB');
    expect(summaryMetric('Storage posture', 'holds')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Storage posture', 'holds').querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(summaryMetric('Storage posture', 'holds')).toHaveTextContent('Exempt from every plan');
    expect(summaryMetric('Storage posture', 'mode')).toHaveTextContent('Plan only');
    expect(screen.getByRole('button', { name: 'Run dry-run plan' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Define policy' })).toBeEnabled();
    expect(removeButton('drives')).toBeEnabled();
    fireEvent.click(within(card('Storage posture')).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Exempt from every plan');
    expect(screen.getByRole('dialog')).toHaveTextContent('3.0 MiB');
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });

  it.each([true, false])('keeps the source enforcement flag %s separate from the dry-run-only screen', (planOnly) => {
    mockOverview.mockReturnValue(makeQuery(makeOverview({
      total_bytes: 0, governed_bytes: 0, ungoverned_bytes: 0, governed_share_pct: 0, plan_only: planOnly,
    })));
    renderPage();
    expect(summaryMetric('Storage posture', 'total').querySelector('[data-operational-value]')).toHaveTextContent('0 B');
    expect(summaryMetric('Storage posture', 'mode').querySelector('[data-operational-value]'))
      .toHaveTextContent(planOnly ? 'Plan only' : 'Enforcing');
    expect(screen.getByText('Plan only — nothing is ever deleted here')).toBeInTheDocument();
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
  });

  it('does not turn missing storage measurements or an absent enforcement flag into zero or enforcing', () => {
    mockOverview.mockReturnValue(makeQuery({ inventory: [], policies: [] }));
    renderPage();
    for (const key of ['total', 'governed', 'ungoverned', 'holds', 'mode']) {
      expect(summaryMetric('Storage posture', key)).toHaveAttribute('data-value-state', 'missing');
      expect(summaryMetric('Storage posture', key).querySelector('[data-operational-value]')).toHaveTextContent('—');
    }
    expect(summaryMetric('Storage posture', 'mode')).toHaveTextContent('Enforcement mode unknown');
    expect(summaryMetric('Storage posture', 'mode')).not.toHaveTextContent('Enforcing');
  });

  it('retains a loading brief and independent ledger, then keeps all dry-run totals non-destructive', () => {
    mockOverview.mockReturnValue({ ...makeQuery(undefined), isLoading: true });
    mockRuns.mockReturnValue(makeQuery({ items: [makeRun()] }));
    mockSimulate.mockReturnValue({
      ...makeMutation(), data: { as_of: '2026-03-01T00:00:00Z', impacts: [],
        total_rows_expiring: 0, total_bytes_reclaimable: 0, total_fidelity_loss_pct: 0, plan_only: true },
    });
    renderPage();
    expect(card('Storage posture').querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(card('Storage posture').querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(within(card('Plan ledger')).getByText('Observed ledger dataset')).toBeInTheDocument();
    expectOperationalBand('Dry-run impact', ['rows', 'bytes', 'fidelity', 'mode']);
    expect(summaryMetric('Dry-run impact', 'bytes')).toHaveTextContent('0 B');
    expect(summaryMetric('Dry-run impact', 'mode')).toHaveTextContent('Never — dry run');
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
  });

  it('retains historical plan records and their independent retry when the current overview is unavailable', () => {
    const refetch = vi.fn();
    mockOverview.mockReturnValue({ ...makeQuery(undefined), error: new Error('overview failed') });
    mockRuns.mockReturnValue({ ...makeQuery({ items: [makeRun()] }), error: new Error('ledger refresh failed'), refetch });
    renderPage();

    const ledger = card('Plan ledger');
    expect(within(ledger).getByText('Observed ledger dataset')).toBeInTheDocument();
    expect(ledger).toHaveTextContent('300');
    expect(ledger).toHaveTextContent(/1(?:\.0+)? KiB/);
    expect(within(ledger).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockRuns).toHaveBeenCalledWith(50, 0);
    expect(mockOverview).toHaveBeenCalledWith();
    expect(mockSimulate().mutate).not.toHaveBeenCalled();
  });

  it('does not replace current retention policies with a failed historical ledger', () => {
    mockRuns.mockReturnValue({ ...makeQuery(undefined), error: new Error('ledger failed') });
    renderPage();

    expect(within(card('Retention policies')).getByText('drives')).toBeInTheDocument();
    expect(within(card('Retention policies')).getByText('sessions')).toBeInTheDocument();
    expect(within(card('Retention policies')).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(within(card('Plan ledger')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });

  it('opens a danger confirm naming the dataset instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('drives'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this retention policy?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('drives');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('sessions'));
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

    fireEvent.click(removeButton('drives'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('sessions')).toBeDisabled();
    expect(removeButton('drives')).not.toBeDisabled();
  });
});
