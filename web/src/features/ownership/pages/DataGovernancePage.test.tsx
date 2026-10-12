/**
 * DataGovernancePage — confirm-gated retention-policy deletion.
 *
 * Removing a retention policy is destructive, so the row Remove button must
 * open a danger confirm dialog naming the dataset instead of firing the
 * mutation directly. Only the data hooks, vehicle selection, and i18n are
 * mocked; the table, buttons, and confirm dialog render for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
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
import type { DatasetInventory, GovernanceOverview, RetentionImpact, RetentionPolicy, RetentionRun } from '@/types/ownership';
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

  const inventoryRow: DatasetInventory = {
    dataset: 'drives', label: 'Drive observations', row_count: 2400, total_bytes: 4096,
    bytes_per_row: 1.7, span_s: 30 * 86400, oldest_at: '2026-01-01T00:00:00Z',
    newest_at: '2026-01-31T00:00:00Z', is_hypertable: true, governed: true,
  };
  const impactRow: RetentionImpact = {
    dataset: 'drives', label: 'Drive observations', policy_id: 1, retention_s: 365 * 86400,
    rows_scanned: 2400, rows_expiring: 300, rows_downsampling: 400, rows_retained: 1700,
    bytes_reclaimable: 1024, reclaim_share_pct: 25, fidelity_loss_pct: 26,
    blocked_by_legal_hold: true, projected_daily_growth_bytes: 1024, runway_days: 10,
    warnings: ['source_warning'],
  };

  function populatedGovernance() {
    mockOverview.mockReturnValue(makeQuery(makeOverview({
      inventory: [inventoryRow], policies: [makePolicy({
        legal_hold: true, downsample_after_s: 30 * 86400, downsample_bucket_s: 60,
      })],
    })));
    mockRuns.mockReturnValue(makeQuery({ items: [makeRun()], total: 51, limit: 50, offset: 0 }));
    mockSimulate.mockReturnValue({
      ...makeMutation(),
      data: {
        as_of: '2026-03-01T00:00:00Z', impacts: [impactRow], total_rows_expiring: 300,
        total_bytes_reclaimable: 1024, total_fidelity_loss_pct: 26, plan_only: true,
      },
    });
  }

  describe('DataGovernancePage presentation preservation', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('embeds all four tables without changing their saved identifiers or desktop fields', () => {
      populatedGovernance();
      renderPage();
      for (const id of ['inventory', 'policies', 'impact', 'runs']) {
        const table = screen.getByRole('table', { name: `ownership-governance-${id}` });
        expect(table.closest('[data-grid-frame]')).toHaveAttribute('data-grid-variant', 'embedded');
      }
      expect(within(card('Dataset inventory')).getByRole('columnheader', { name: /Rows/ })).toBeInTheDocument();
      expect(within(card('Retention policies')).getByRole('columnheader', { name: /Bucket/ })).toBeInTheDocument();
      expect(within(card('Dry-run impact')).getByRole('columnheader', { name: /Growth runway/ })).toBeInTheDocument();
      expect(within(card('Plan ledger')).getByRole('columnheader', { name: /Fidelity lost/ })).toBeInTheDocument();
      expect(within(screen.getByRole('table', { name: 'ownership-governance-impact' }))
        .getByText(/26(?:\.0+)?%/)).toHaveClass('text-[var(--semantic-danger)]');
      expect(mockRemove().mutate).not.toHaveBeenCalled();
    });

    it('retains mobile plan actions and every inventory, policy, impact and ledger detail', async () => {
      const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
      vi.stubGlobal('ResizeObserver', class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) { observers.push({ element, callback: this.callback }); }
        unobserve() {}
        disconnect() {}
      });
      populatedGovernance();
      renderPage();
      act(() => observers.forEach(({ element, callback }) => callback(
        [{ target: element, contentRect: { width: 375 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )));
      expect(document.querySelectorAll('[data-mobile-table]')).toHaveLength(4);

      const inventory = card('Dataset inventory');
      const include = within(inventory).getByRole('button', { name: 'Include' });
      expect(include).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(include);
      expect(within(inventory).getByRole('button', { name: 'In plan' })).toHaveAttribute('aria-pressed', 'true');
      expect(mockSimulate().mutate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Run dry-run plan' }));
      expect(mockSimulate().mutate).toHaveBeenCalledWith({ datasets: ['drives'], confirmed: true });

      fireEvent.click(within(inventory).getByRole('button', { name: 'Quick view' }));
      let dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('drives');
      expect(dialog).toHaveTextContent('2,400');
      expect(dialog).toHaveTextContent('4.0 KiB');
      expect(dialog).toHaveTextContent('1.7');
      expect(dialog).toHaveTextContent('History span');
      expect(dialog).toHaveTextContent('hypertable');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const policies = card('Retention policies');
      expect(within(policies).getByRole('button', { name: 'Edit' })).toHaveClass('min-h-11');
      const remove = within(policies).getByRole('button', { name: 'Remove' });
      fireEvent.click(remove);
      expect(screen.getByRole('dialog')).toHaveTextContent('drives');
      expect(mockRemove().mutate).not.toHaveBeenCalled();
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      fireEvent.click(within(policies).getByRole('button', { name: 'Quick view' }));
      dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('legal hold');
      expect(dialog).toHaveTextContent('Downsample after');
      expect(dialog).toHaveTextContent('Bucket');
      expect(dialog).toHaveTextContent(/1(?:\.0+)? min/);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      fireEvent.click(within(card('Dry-run impact')).getByRole('button', { name: 'Quick view' }));
      dialog = screen.getByRole('dialog');
      for (const detail of ['300', '1700 retained', '400', '10 days', '1.0 KiB', 'legal hold', 'source warning']) {
        expect(dialog).toHaveTextContent(detail);
      }
      expect(dialog).toHaveTextContent(/26(?:\.0+)?%/);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      fireEvent.click(within(card('Plan ledger')).getByRole('button', { name: 'Quick view' }));
      dialog = screen.getByRole('dialog');
      for (const detail of ['Observed ledger dataset', 'dry run', '300', '1.0 KiB']) {
        expect(dialog).toHaveTextContent(detail);
      }
      expect(dialog).toHaveTextContent(/2\.5(?:0+)?%/);
      expect(mockUpsert().mutate).not.toHaveBeenCalled();
      expect(mockRemove().mutate).not.toHaveBeenCalled();
    });

    it('pages the ledger with real server totals while preserving the initial fifty-row request', () => {
      populatedGovernance();
      renderPage();
      expect(mockRuns).toHaveBeenCalledWith(50, 0);
      fireEvent.click(within(card('Plan ledger')).getByRole('button', { name: 'Next page' }));
      expect(mockRuns).toHaveBeenLastCalledWith(50, 50);
      expect(mockSimulate().mutate).not.toHaveBeenCalled();
    });

    it('associates the inline editor, preserves unsaved fields, and restores its trigger on cancel', () => {
      populatedGovernance();
      renderPage();
      const trigger = screen.getByRole('button', { name: 'Define policy' });
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const form = screen.getByRole('form', { name: 'Retention policies' });
      expect(form).toHaveAttribute('id', trigger.getAttribute('aria-controls'));
      expect(screen.getByRole('combobox', { name: 'Dataset' })).toHaveFocus();
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Retention (days)' }), { target: { value: '120' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: 'Define policy' })).toHaveFocus();
      fireEvent.click(screen.getByRole('button', { name: 'Define policy' }));
      expect(screen.getByRole('spinbutton', { name: 'Retention (days)' })).toHaveValue(120);
      for (const label of ['Downsample after (days)', 'Downsample bucket (seconds)', 'Legal hold', 'Enabled']) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
      expect(mockUpsert().mutate).not.toHaveBeenCalled();
    });

    it('explains missing dry-run prerequisites and retains prior impact during a failed simulation', () => {
      mockOverview.mockReturnValue(makeQuery(makeOverview({ inventory: [], policies: [] })));
      mockSimulate.mockReturnValue({
        ...makeMutation(), error: new Error('simulation failed'),
        data: { impacts: [impactRow], total_rows_expiring: 300, total_bytes_reclaimable: 1024,
          total_fidelity_loss_pct: 26, as_of: '2026-03-01T00:00:00Z', plan_only: true },
      });
      renderPage();
      const run = screen.getByRole('button', { name: 'Run dry-run plan' });
      expect(run).toBeDisabled();
      expect(run).toHaveAccessibleDescription('No retention policies defined.');
      const impact = card('Dry-run impact');
      expect(within(impact).getByText('Drive observations')).toBeInTheDocument();
      expect(impact).toHaveTextContent(/Previously loaded data remains visible/);
      expect(mockSimulate().mutate).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    });
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
