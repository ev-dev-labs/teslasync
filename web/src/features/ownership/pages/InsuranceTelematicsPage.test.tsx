/**
 * InsuranceTelematicsPage — confirm-gated policy deletion.
 *
 * Removing the policy is destructive (telematics enrolment goes with it), so
 * the Remove button must open a danger confirm dialog naming the policy ref
 * instead of firing the mutation directly. Only the data hooks, vehicle
 * selection, and i18n are mocked; the page, buttons, and confirm dialog
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
    useInsuranceRiskProfile: vi.fn(),
    useUpsertInsurancePolicy: vi.fn(),
    useDeleteInsurancePolicy: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useInsuranceRiskProfile,
  useUpsertInsurancePolicy,
  useDeleteInsurancePolicy,
} from '@/api/hooks/useOwnership';
import InsuranceTelematicsPage from './InsuranceTelematicsPage';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { InsurancePolicy, InsuranceRiskProfile } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockProfile = useInsuranceRiskProfile as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = useUpsertInsurancePolicy as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteInsurancePolicy as unknown as ReturnType<typeof vi.fn>;

function makePolicy(overrides: Partial<InsurancePolicy> = {}): InsurancePolicy {
  return {
    id: 1,
    vehicle_id: 7,
    insurer: 'SafeDrive',
    policy_ref: 'POL-001',
    currency: 'USD',
    annual_premium_minor: 120000,
    deductible_minor: 50000,
    coverage_start: '2026-01-01',
    coverage_end: null,
    telematics_program: true,
    max_discount_pct: 20,
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

function makeProfile(overrides: Partial<InsuranceRiskProfile> = {}): InsuranceRiskProfile {
  return {
    vehicle_id: 7,
    window: { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z', days: 60 },
    policy: makePolicy(),
    exposure_distance_m: 10000, exposure_duration_s: 3600,
    drive_count: 4, night_distance_m: 1000,
    risk_score: 35, risk_grade: 'standard', frequency_index: 1.1,
    severity_index: 0.9, loss_cost_index: 0.99, peer_percentile: null,
    factors: [], trend: [], levers: [],
    premium: {
      currency: 'USD', baseline_premium_minor: 120000, modelled_premium_minor: 108000,
      delta_minor: -12000, delta_pct: -10, applied_discount_pct: 10,
      max_discount_pct: 20, expected_loss_minor: 80000, deductible_minor: 50000,
      cost_per_distance_minor_per_m: 0.5,
    },
    evidence_packet_hash: 'untruncated-insurance-packet-digest',
    quality: { status: 'sufficient', sample_count: 4, coverage_pct: 100, window_start: null, window_end: null, reasons: [] },
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
        <InsuranceTelematicsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockProfile.mockReturnValue(
    makeQuery({
      vehicle_id: 7,
      policy: makePolicy(),
      premium: {
        currency: 'USD',
        delta_minor: -5000,
        delta_pct: -4,
        applied_discount_pct: 10,
        max_discount_pct: 20,
        expected_loss_minor: 80000,
        deductible_minor: 50000,
        cost_per_distance_minor_per_m: 5,
      },
      factors: [],
      levers: [],
    }),
  );
  mockUpsert.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('InsuranceTelematicsPage — confirm-gated delete', () => {
  it('retains all four real briefs with exposure, policy units, caps and no insurer-quote claim', () => {
    mockProfile.mockReturnValue(makeQuery(makeProfile()));
    renderPage();
    expectOperationalBand('Underwriting position', [
      'score', 'frequency', 'severity', 'losscost', 'exposure', 'duration', 'night', 'percentile',
    ]);
    expectOperationalBand('Premium simulation', [
      'baseline', 'modelled', 'delta', 'discount', 'expected', 'deductible', 'perDistance',
    ]);
    expect(summaryMetric('Underwriting position', 'percentile')).toHaveAttribute('data-value-state', 'missing');
    expect(summaryMetric('Underwriting position', 'night')).toHaveTextContent(/10(?:\.0+)?%/);
    expect(summaryMetric('Premium simulation', 'perDistance')).toHaveTextContent('$5.00 / 1000 m');
    expect(summaryMetric('Premium simulation', 'discount')).toHaveTextContent(/Cap 20(?:\.0+)?%/);
    const briefs = card('Premium simulation').querySelectorAll('[data-operational-brief]');
    expect(briefs).toHaveLength(2);
    const brief = briefs[0];
    if (!(brief instanceof HTMLElement)) throw new Error('Missing premium brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('never an insurer quote');
    expect(screen.getByRole('dialog')).toHaveTextContent(/Cap 20(?:\.0+)?%/);
    expect(mockUpsert().mutate).not.toHaveBeenCalled();
  });

  it('keeps every modelled premium amount, cap and full digest during a refresh failure', () => {
    const refetch = vi.fn();
    mockProfile.mockReturnValue({ ...makeQuery(makeProfile()), error: new Error('refresh failed'), refetch });
    renderPage();

    const premium = card('Premium simulation');
    expect(premium).toHaveTextContent('Baseline annual premium');
    expect(premium).toHaveTextContent('$1,200.00');
    expect(premium).toHaveTextContent('Modelled annual premium');
    expect(premium).toHaveTextContent('$1,080.00');
    expect(premium).toHaveTextContent('-$120.00');
    expect(within(premium).getByText('Applied discount').parentElement).toHaveTextContent(/10(?:\.0+)?%/);
    expect(premium).toHaveTextContent(/Cap 20(?:\.0+)?%/);
    expect(premium).toHaveTextContent('Expected annual loss');
    expect(premium).toHaveTextContent('$800.00');
    expect(premium).toHaveTextContent('Deductible');
    expect(premium).toHaveTextContent('$500.00');
    expect(premium).toHaveTextContent('$5.00 / 1000 m');
    expect(premium).toHaveTextContent('SafeDrive · POL-001');
    expect(within(premium).getByRole('button', { name: 'Edit policy' })).toBeEnabled();
    expect(screen.getByText('untruncated-insurance-packet-digest')).toBeInTheDocument();
    expect(within(premium).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(premium).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockUpsert().mutate).not.toHaveBeenCalled();
  });

  it('does not promote the default editor premium to an observed premium without a stored policy', () => {
    mockProfile.mockReturnValue(makeQuery(makeProfile({ policy: null, premium: null })));
    renderPage();

    const premium = card('Premium simulation');
    expect(within(premium).getByText('Register a policy below to simulate a telematics-adjusted premium.')).toBeInTheDocument();
    expect(within(premium).queryByText('$1,200.00')).not.toBeInTheDocument();
    expect(within(premium).queryByText('$0.00')).not.toBeInTheDocument();
    expect(card('Underwriting position')).toHaveTextContent('Frequency index');
    fireEvent.click(within(premium).getByRole('button', { name: 'Add policy' }));
    expect(screen.getByRole('spinbutton', { name: 'Annual premium required' })).toHaveValue(120000);
    expect(mockUpsert().mutate).not.toHaveBeenCalled();
  });

  it('keeps uncomputed loss and distance pricing unknown while preserving a real zero deductible', () => {
    const profile = makeProfile();
    mockProfile.mockReturnValue(makeQuery({
      ...profile,
      premium: { ...profile.premium, expected_loss_minor: null, cost_per_distance_minor_per_m: null, deductible_minor: 0 },
    }));
    renderPage();
    const premium = card('Premium simulation');
    const loss = within(premium).getByText('Expected annual loss').parentElement;
    const distance = within(premium).getByText('Cost per distance').parentElement;
    const deductible = within(premium).getByText('Deductible').parentElement;
    expect(loss).toHaveTextContent('—');
    expect(loss).not.toHaveTextContent('$0.00');
    expect(distance).toHaveTextContent('—');
    expect(distance).not.toHaveTextContent('$0.00');
    expect(deductible).toHaveTextContent('$0.00');
  });

  it('opens a danger confirm naming the policy instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this policy?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('POL-001');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks the button pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 1 }));
    renderPage();

    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
