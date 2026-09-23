/**
 * WarrantyCommandPage — confirm-gated warranty deletion.
 *
 * Removing a warranty is destructive (claims go with it), so the row Remove
 * button must open a danger confirm dialog naming the coverage instead of
 * firing the mutation directly. Only the data hooks, vehicle selection, and
 * i18n are mocked; the table, buttons, and confirm dialog render for real.
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
    useWarrantyOverview: vi.fn(),
    useWarranties: vi.fn(),
    useCreateWarranty: vi.fn(),
    useDeleteWarranty: vi.fn(),
    useCreateWarrantyClaim: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useWarrantyOverview,
  useWarranties,
  useCreateWarranty,
  useDeleteWarranty,
  useCreateWarrantyClaim,
} from '@/api/hooks/useOwnership';
import WarrantyCommandPage from './WarrantyCommandPage';
import type { Warranty } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockOverview = useWarrantyOverview as unknown as ReturnType<typeof vi.fn>;
const mockWarranties = useWarranties as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateWarranty as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteWarranty as unknown as ReturnType<typeof vi.fn>;
const mockClaim = useCreateWarrantyClaim as unknown as ReturnType<typeof vi.fn>;

function makeWarranty(overrides: Partial<Warranty> = {}): Warranty {
  return {
    id: 1,
    vehicle_id: 7,
    kind: 'battery',
    label: 'Battery Shield',
    provider: 'Tesla',
    start_at: '2026-01-01T00:00:00Z',
    start_odometer_m: 0,
    term_s: 8 * 365 * 86400,
    term_distance_m: 192000,
    capacity_floor_pct: 70,
    deductible_minor: 0,
    currency: 'USD',
    notes: '',
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
        <WarrantyCommandPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given coverage label. */
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
  mockOverview.mockReturnValue(makeQuery({ currency: 'USD', coverages: [] }));
  mockWarranties.mockReturnValue(
    makeQuery({
      items: [makeWarranty(), makeWarranty({ id: 2, label: 'Paint Guard', kind: 'corrosion' })],
    }),
  );
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
  mockClaim.mockReturnValue(makeMutation());
});

describe('WarrantyCommandPage — confirm-gated delete', () => {
  it('opens a danger confirm naming the coverage instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Battery Shield'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this warranty?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Battery Shield');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Paint Guard'));
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

    fireEvent.click(removeButton('Battery Shield'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('Paint Guard')).toBeDisabled();
    expect(removeButton('Battery Shield')).not.toBeDisabled();
  });
});
