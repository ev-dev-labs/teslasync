/**
 * TariffLabPage — confirm-gated tariff deletion.
 *
 * Removing a tariff is destructive (rates + simulation history go with it),
 * so the row Remove button must open a danger confirm dialog naming the plan
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
    useTariffs: vi.fn(),
    useCreateTariff: vi.fn(),
    useDeleteTariff: vi.fn(),
    useSimulateTariffs: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useTariffs,
  useCreateTariff,
  useDeleteTariff,
  useSimulateTariffs,
} from '@/api/hooks/useOwnership';
import TariffLabPage from './TariffLabPage';
import type { Tariff } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockTariffs = useTariffs as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateTariff as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteTariff as unknown as ReturnType<typeof vi.fn>;
const mockSimulate = useSimulateTariffs as unknown as ReturnType<typeof vi.fn>;

function makeTariff(overrides: Partial<Tariff> = {}): Tariff {
  return {
    id: 1,
    name: 'EV Nights',
    provider: 'GridCo',
    currency: 'USD',
    structure: 'tou',
    standing_charge_minor_per_day: 120,
    demand_charge_minor_per_w: 0,
    export_price_minor_per_wh: 0,
    is_current: true,
    version: 1,
    rates: [],
    created_at: '2026-01-01T00:00:00Z',
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
        <TariffLabPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given plan name. */
function removeButton(planName: string): HTMLElement {
  const row = screen.getByText(planName).closest('tr') as HTMLElement;
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
  mockTariffs.mockReturnValue(
    makeQuery({ items: [makeTariff(), makeTariff({ id: 2, name: 'Flat Saver', is_current: false })] }),
  );
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
  mockSimulate.mockReturnValue({ ...makeMutation(), data: undefined });
});

describe('TariffLabPage — confirm-gated delete', () => {
  it('opens a danger confirm naming the plan instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('EV Nights'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this tariff?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('EV Nights');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Flat Saver'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    // The confirm() promise resolves off the click — wait a tick for mutate.
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('EV Nights'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('Flat Saver')).toBeDisabled();
    expect(removeButton('EV Nights')).not.toBeDisabled();
  });
});
