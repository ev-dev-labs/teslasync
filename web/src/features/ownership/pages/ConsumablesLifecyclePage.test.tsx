/**
 * ConsumablesLifecyclePage — confirm-gated part deletion.
 *
 * Removing a part is destructive (service history goes with it), so the row
 * Remove button must open a danger confirm dialog naming the part instead of
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
    useConsumableItems: vi.fn(),
    useConsumablesReport: vi.fn(),
    useCreateConsumable: vi.fn(),
    useCreateConsumableEvent: vi.fn(),
    useDeleteConsumable: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useConsumableItems,
  useConsumablesReport,
  useCreateConsumable,
  useCreateConsumableEvent,
  useDeleteConsumable,
} from '@/api/hooks/useOwnership';
import ConsumablesLifecyclePage from './ConsumablesLifecyclePage';
import type { ConsumableItem } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockItems = useConsumableItems as unknown as ReturnType<typeof vi.fn>;
const mockReport = useConsumablesReport as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateConsumable as unknown as ReturnType<typeof vi.fn>;
const mockEvent = useCreateConsumableEvent as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteConsumable as unknown as ReturnType<typeof vi.fn>;

function makeItem(overrides: Partial<ConsumableItem> = {}): ConsumableItem {
  return {
    id: 1,
    vehicle_id: 7,
    category: 'cabin_filter',
    label: 'Cabin Filter',
    position: 'front',
    installed_at: '2026-01-01T00:00:00Z',
    installed_odometer_m: 10000,
    rated_life_m: 40000,
    rated_life_s: 365 * 86400,
    cost_minor: 2500,
    currency: 'USD',
    retired_at: null,
    notes: '',
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
        <ConsumablesLifecyclePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given part label. */
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
  mockItems.mockReturnValue(
    makeQuery({ items: [makeItem(), makeItem({ id: 2, label: 'Wiper Blades', category: 'wiper' })] }),
  );
  mockReport.mockReturnValue(makeQuery(undefined));
  mockCreate.mockReturnValue(makeMutation());
  mockEvent.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('ConsumablesLifecyclePage — confirm-gated delete', () => {
  it('opens a danger confirm naming the part instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Cabin Filter'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this part?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Cabin Filter');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Wiper Blades'));
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

    fireEvent.click(removeButton('Cabin Filter'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('Wiper Blades')).toBeDisabled();
    expect(removeButton('Cabin Filter')).not.toBeDisabled();
  });
});
