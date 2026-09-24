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
import type { InsurancePolicy } from '@/types/ownership';

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
