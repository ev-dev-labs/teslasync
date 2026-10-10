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
    useGhostDrives: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useDriverAttribution,
  useDriverProfiles,
  useAssignDrive,
  useCreateDriverProfile,
  useDeleteDriverProfile,
  useGhostDrives,
} from '@/api/hooks/useOwnership';
import DriverAttributionPage from './DriverAttributionPage';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { DriverAttributionReport, DriverProfile } from '@/types/ownership';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockReport = useDriverAttribution as unknown as ReturnType<typeof vi.fn>;
const mockProfiles = useDriverProfiles as unknown as ReturnType<typeof vi.fn>;
const mockAssign = useAssignDrive as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateDriverProfile as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteDriverProfile as unknown as ReturnType<typeof vi.fn>;
const mockGhosts = vi.mocked(useGhostDrives);

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

function makeReport(cost: number | null = null): DriverAttributionReport {
  return {
    vehicle_id: 7,
    window: { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z', days: 60 },
    profiles: [], fingerprints: [], total: 0, limit: 100, offset: 0,
    clusters: [{
      cluster_id: 0, driver_profile_id: null, driver_name: 'Inferred Cost Cluster',
      accent: 'cyan', drive_count: 4, share_pct: 100, distance_m: 12000,
      duration_s: 3600, energy_wh: 25000, efficiency_wh_per_m: null,
      avg_speed_mps: null, peak_power_w: null, regen_share_pct: null,
      night_share_pct: 0, aggression_score: 25, cost_share_minor: cost,
      centroid: [], cohesion: 0.8, labelled_count: 0,
    }],
    separation_score: null, separation_verdict: 'unlabelled',
    labelled_drive_count: 0, inferred_drive_count: 4, ambiguous_drive_count: 0,
    currency: 'USD',
    quality: { status: 'limited', sample_count: 4, coverage_pct: 100, window_start: null, window_end: null, reasons: [] },
    evidence: [],
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
  mockGhosts.mockReturnValue(makeQuery({ vehicle_id: 7, scanned: 0, ghosts: [] }) as ReturnType<typeof useGhostDrives>);
});

describe('DriverAttributionPage — confirm-gated delete', () => {
  it('retains every attribution quantity and ambiguity caption in the real brief without labelling a drive', () => {
    mockReport.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    expectOperationalBand('Separation quality', ['clusters', 'separation', 'labelled', 'inferred', 'ambiguous']);
    for (const key of ['clusters', 'labelled', 'inferred', 'ambiguous']) {
      expect(summaryMetric('Separation quality', key)).toHaveAttribute('data-value-state', 'value');
    }
    expect(summaryMetric('Separation quality', 'separation')).toHaveAttribute('data-value-state', 'missing');
    expect(summaryMetric('Separation quality', 'ambiguous')).toHaveTextContent('Two clusters fit almost equally well');
    expect(screen.getByRole('combobox', { name: 'Analysis window' })).toBeInTheDocument();
    fireEvent.click(within(card('Separation quality')).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Two clusters fit almost equally well');
  });

  it('keeps named driver records usable when inferred history has an initial failure', () => {
    mockReport.mockReturnValue({ ...makeQuery(undefined), error: new Error('history failed') });
    renderPage();
    const profiles = card('Named drivers');
    expect(within(profiles).getByText('Alex')).toBeInTheDocument();
    expect(within(profiles).getByText('Sam')).toBeInTheDocument();
    expect(within(profiles).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(within(card('Cluster characteristics')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(mockReport).toHaveBeenCalledWith(7, 90, 100, 0);
    expect(mockAssign().mutate).not.toHaveBeenCalled();
  });

  it('retains measured cluster cost while an independent profile source is unavailable', () => {
    const refetch = vi.fn();
    mockReport.mockReturnValue({ ...makeQuery(makeReport(12345)), error: new Error('history refresh failed'), refetch });
    mockProfiles.mockReturnValue({ ...makeQuery(undefined), error: new Error('profiles failed') });
    renderPage();
    const characteristics = card('Cluster characteristics');
    expect(within(characteristics).getByText('Inferred Cost Cluster')).toBeInTheDocument();
    expect(within(characteristics).getByText('$123.45')).toBeInTheDocument();
    expect(within(characteristics).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(characteristics).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockAssign().mutate).not.toHaveBeenCalled();
  });

  it.each([null, 0])('does not confuse nullable cluster cost %s with a real zero', (cost) => {
    mockReport.mockReturnValue(makeQuery(makeReport(cost)));
    renderPage();
    const row = within(card('Cluster characteristics')).getByText('Inferred Cost Cluster').closest('tr');
    if (cost == null) {
      expect(row).not.toHaveTextContent('$0.00');
      expect(row?.textContent?.match(/—/g)).toHaveLength(4);
    } else {
      expect(row).toHaveTextContent('$0.00');
      expect(row?.textContent?.match(/—/g)).toHaveLength(3);
    }
  });

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
