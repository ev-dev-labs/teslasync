/**
 * DriverAttributionPage — confirm-gated driver-profile deletion.
 *
 * Removing a driver profile is destructive (trip attributions go with it),
 * so the row Remove button must open a danger confirm dialog naming the
 * profile instead of firing the mutation directly. Only the data hooks,
 * vehicle selection, and i18n are mocked; the table, buttons, and confirm
 * dialog render for real.
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
    useDriverAttribution: vi.fn(),
    useDriverProfiles: vi.fn(),
    useAssignDrive: vi.fn(),
    useCreateDriverProfile: vi.fn(),
    useDeleteDriverProfile: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useDriverAttribution,
  useDriverProfiles,
  useAssignDrive,
  useCreateDriverProfile,
  useDeleteDriverProfile,
} from '@/api/hooks/useOwnership';
import DriverAttributionPage from './DriverAttributionPage';
import type { DriverProfile } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockReport = useDriverAttribution as unknown as ReturnType<typeof vi.fn>;
const mockProfiles = useDriverProfiles as unknown as ReturnType<typeof vi.fn>;
const mockAssign = useAssignDrive as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateDriverProfile as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteDriverProfile as unknown as ReturnType<typeof vi.fn>;

function makeProfile(overrides: Partial<DriverProfile> = {}): DriverProfile {
  return {
    id: 1,
    vehicle_id: 7,
    name: 'Alex',
    accent: '#00b4d8',
    is_primary: true,
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
        <DriverAttributionPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The Remove button in the table row showing the given profile name. */
function removeButton(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr') as HTMLElement;
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
  mockReport.mockReturnValue(makeQuery(undefined));
  mockProfiles.mockReturnValue(
    makeQuery({ items: [makeProfile(), makeProfile({ id: 2, name: 'Sam', is_primary: false })] }),
  );
  mockAssign.mockReturnValue(makeMutation());
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
});

describe('DriverAttributionPage — confirm-gated delete', () => {
  it('opens a danger confirm naming the profile instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Alex'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this driver profile?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Alex');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Sam'));
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

    fireEvent.click(removeButton('Alex'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('Sam')).toBeDisabled();
    expect(removeButton('Alex')).not.toBeDisabled();
  });
});
