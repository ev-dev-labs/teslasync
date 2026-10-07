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
import type { JurisdictionRate } from '@/types/ownership';

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
