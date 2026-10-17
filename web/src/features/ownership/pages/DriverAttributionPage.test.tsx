/**
 * DriverAttributionPage — confirm-gated driver-profile deletion.
 *
 * Removing a driver profile is destructive (trip attributions go with it),
 * so the row Remove button must open a danger confirm dialog naming the
 * profile instead of firing the mutation directly. Only the data hooks,
 * vehicle selection, and i18n are mocked; the table, buttons, and confirm
 * dialog render for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const translations = vi.hoisted(() => new Map<string, string>());

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
    const translated = translations.get(key);
    if (translated != null) {
      return interpolate(translated, (typeof second === 'object' ? second : third) as Record<string, unknown> | undefined);
    }
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
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { DriverAttributionReport, DriverProfile } from '@/types/ownership';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const originalFormatterPreferences = getFormatterPreferences();

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
  translations.clear();
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

afterEach(() => {
  act(() => {
    setGlobalLocale(originalFormatterPreferences.locale);
    setGlobalPrecision(originalFormatterPreferences.precision);
  });
});

describe('DriverAttributionPage — confirm-gated delete', () => {
  it('retains every attribution quantity and ambiguity caption in the real brief without labelling a drive', () => {
    mockReport.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    expectOperationalBand('Separation quality', ['clusters', 'labelled', 'inferred', 'ambiguous']);
    for (const key of ['clusters', 'labelled', 'inferred', 'ambiguous']) {
      expect(summaryMetric('Separation quality', key)).toHaveAttribute('data-value-state', 'value');
    }
    assertOperationalMetricUnavailable(card('Separation quality'), 'Separation score');
    expect(screen.getByRole('combobox', { name: 'Analysis window' })).toBeInTheDocument();
    fireEvent.click(within(card('Separation quality')).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Ambiguous drives' }))
      .toHaveTextContent('Two clusters fit almost equally well');
    expect(dialog).toHaveTextContent('Two clusters fit almost equally well');
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

describe('DriverAttributionPage — preserved attribution presentation', () => {
  it.each([
    ['labelled', 'confirmed'],
    ['inferred', 'inferred'],
    ['unknown', 'Unknown (unknown)'],
    ['future_source', 'Unknown (future_source)'],
    ['', 'Unknown'],
  ])('preserves honest provenance for source %s without changing identity or ambiguity', (source, label) => {
    const report = makeReport();
    report.fingerprints = [{
      drive_id: 42, started_at: '2026-01-01T00:00:00Z', distance_m: 12000,
      duration_s: 3600, features: [], cluster_id: 0, driver_profile_id: 1,
      driver_name: 'Untranslated driver name', source, confidence_pct: 55,
      distance_to_own_centroid: 0.1, distance_to_next_centroid: 0.2, ambiguous: true,
    }];
    mockReport.mockReturnValue(makeQuery(report));
    renderPage();
    const fingerprints = card('Drive fingerprints');
    const badge = within(fingerprints).getByText(label);
    expect(badge).toHaveClass(source === 'labelled'
      ? 'text-[var(--semantic-success)]'
      : source === 'inferred' ? 'text-[var(--semantic-info)]' : 'text-[var(--text-secondary)]');
    expect(fingerprints).toHaveTextContent('Untranslated driver name');
    expect(within(fingerprints).getByText('ambiguous')).toBeInTheDocument();
    if (source !== 'inferred') expect(within(fingerprints).queryByText('inferred')).not.toBeInTheDocument();
    expect(report.fingerprints[0].source).toBe(source);
    expect(mockAssign().mutate).not.toHaveBeenCalled();
  });

  it('keeps raw chart values until preference-aware accessible table display', () => {
    const report = makeReport();
    report.clusters![0] = { ...report.clusters![0], share_pct: 12.3456, aggression_score: 34.5678 };
    mockReport.mockReturnValue(makeQuery(report));
    setGlobalPrecision(4);
    setGlobalLocale('de-DE');
    renderPage();
    const table = within(card('Cluster mix and driving intensity')).getByRole('table');
    expect(table).toHaveTextContent('12,3456%');
    expect(table).toHaveTextContent('34,5678/100');
    expect(table).not.toHaveTextContent('34,5678%');
    act(() => setGlobalPrecision(3));
    expect(table).toHaveTextContent('12,346%');
    expect(table).toHaveTextContent('34,568/100');
    expect(report.clusters![0].share_pct).toBe(12.3456);
    expect(report.clusters![0].aggression_score).toBe(34.5678);
    expect(mockAssign().mutate).not.toHaveBeenCalled();
  });

  it.each(['cyan', 'emerald', 'amber', 'purple', 'rose', 'indigo'])(
    'localizes accent %s while submitting the original saved identifier and user name',
    (accent) => {
      translations.set(`ownership.driver.form.accents.${accent}`, `Translated ${accent}`);
      const mutate = vi.fn();
      mockCreate.mockReturnValue(makeMutation({ mutate }));
      renderPage();
      fireEvent.click(within(card('Named drivers')).getByRole('button', { name: 'Add driver' }));
      const select = screen.getByRole('combobox', { name: 'Accent colour' });
      expect(within(select).getByRole('option', { name: `Translated ${accent}` })).toHaveValue(accent);
      expect(within(select).getAllByRole('option')).toHaveLength(6);
      fireEvent.change(select, { target: { value: accent } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Display name required' }), { target: { value: 'Driver-entered name' } });
      fireEvent.click(within(card('Named drivers')).getByRole('button', { name: 'Save' }));
      expect(mutate).toHaveBeenCalledWith(
        { vehicle_id: 7, name: 'Driver-entered name', accent, is_primary: false },
        { onSuccess: expect.any(Function) },
      );
      expect(mockAssign().mutate).not.toHaveBeenCalled();
    },
  );

  it.each(['strong', 'moderate', 'weak'])('uses the existing localized verdict %s in brief and details', (verdict) => {
    translations.set(`ownership.verdict.${verdict}`, `Translated ${verdict}`);
    mockReport.mockReturnValue(makeQuery({ ...makeReport(), separation_score: 0.5, separation_verdict: verdict }));
    renderPage();
    expect(summaryMetric('Separation quality', 'separation')).toHaveTextContent('0.50');
    expect(card('Interpretation')).toHaveTextContent(`Translated ${verdict}`);
    fireEvent.click(within(card('Separation quality')).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Separation score' }))
      .toHaveTextContent(`Translated ${verdict}`);
    expect(dialog).toHaveTextContent(`Translated ${verdict}`);
    expect(mockAssign().mutate).not.toHaveBeenCalled();
  });

  it('preserves unrecognized separation prose unchanged in brief context', () => {
    const verdict = 'Future_Source: Do NOT recase';
    translations.set(`ownership.verdict.${verdict}`, 'Must not translate arbitrary source prose');
    mockReport.mockReturnValue(makeQuery({ ...makeReport(), separation_score: 0.5, separation_verdict: verdict }));
    renderPage();
    expect(summaryMetric('Separation quality', 'separation')).toHaveTextContent('0.50');
    fireEvent.click(within(card('Separation quality')).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByRole('group', { name: 'Separation score' }))
      .toHaveTextContent(verdict);
    expect(screen.queryByText('Must not translate arbitrary source prose')).not.toBeInTheDocument();
  });

  it('keeps an unrecognized verdict distinct from a weak separation claim', () => {
    mockReport.mockReturnValue(makeQuery(makeReport()));
    renderPage();
    const interpretation = card('Interpretation');
    expect(within(interpretation).getByText('unlabelled')).toBeInTheDocument();
    expect(within(interpretation).getByText('Unknown')).toBeInTheDocument();
    expect(interpretation).not.toHaveTextContent('Behaviour is too similar');
    expect(mockAssign().mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['strong', 'Clusters are well separated'],
    ['moderate', 'Clusters overlap somewhat'],
    ['weak', 'Behaviour is too similar'],
  ])('retains the existing explanation for a known verdict %s', (verdict, explanation) => {
    mockReport.mockReturnValue(makeQuery({ ...makeReport(), separation_verdict: verdict }));
    renderPage();
    expect(card('Interpretation')).toHaveTextContent(explanation);
    expect(within(card('Interpretation')).queryByText('Unknown')).not.toBeInTheDocument();
  });

  it('sorts raw cluster values only on request and retains every specialist column', () => {
    const report = makeReport(12345);
    const first = report.clusters![0];
    report.clusters = [
      first,
      { ...first, cluster_id: 1, driver_name: 'Second anonymous cluster', drive_count: 9, distance_m: 5000 },
    ];
    mockReport.mockReturnValue(makeQuery(report));
    renderPage();
    const table = within(card('Cluster characteristics')).getByRole('table');
    const rows = () => within(table).getAllByRole('row').slice(1);
    expect(rows()[0]).toHaveTextContent('Inferred Cost Cluster');
    fireEvent.click(within(table).getByRole('button', { name: 'Drives' }));
    expect(rows()[0]).toHaveTextContent('Second anonymous cluster');
    fireEvent.click(within(table).getByRole('button', { name: 'Drives' }));
    expect(rows()[0]).toHaveTextContent('Inferred Cost Cluster');
    for (const name of ['Distance', 'Efficiency', 'Avg speed', 'Regen share', 'Night share', 'Aggression', 'Energy cost share', 'Cohesion']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    const meter = within(rows()[0]).getByRole('progressbar', { name: 'Aggression' });
    expect(meter).toHaveAttribute('aria-valuenow', '25');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(rows()[0]).toHaveTextContent('/100');
    expect(mockAssign().mutate).not.toHaveBeenCalled();
  });

  it('keeps mobile actions and all original row fields reachable through the shared detail view', () => {
    const dimensions = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 300, top: 0, left: 0, right: 375, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const originalObserver = globalThis.ResizeObserver;
    class MobileResizeObserver implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = MobileResizeObserver;
    try {
      const report = makeReport(12345);
      report.fingerprints = [{
        drive_id: 42, started_at: '2026-01-01T00:00:00Z', distance_m: 12000,
        duration_s: 3600, features: [{
          code: 'regen', label: 'Regen trait', raw_value: 0.3, si_unit: 'ratio',
          normalised: 0.3, weight: 1,
        }],
        cluster_id: 0, driver_profile_id: null, driver_name: null, source: 'inferred',
        confidence_pct: 55, distance_to_own_centroid: 0.1,
        distance_to_next_centroid: 0.2, ambiguous: true,
      }];
      report.total = 101;
      mockReport.mockReturnValue(makeQuery(report));
      renderPage();
      const clusters = card('Cluster characteristics');
      fireEvent.click(within(clusters).getByRole('button', { name: 'Quick view' }));
      const clusterDetails = screen.getByRole('dialog');
      expect(clusterDetails).toHaveTextContent('Energy cost share');
      expect(clusterDetails).toHaveTextContent('$123.45');
      expect(clusterDetails).toHaveTextContent('Cohesion');
      expect(clusterDetails).toHaveTextContent('Regen share');
      fireEvent.click(within(clusterDetails).getAllByRole('button', { name: 'Close' })[1]);

      const fingerprints = card('Drive fingerprints');
      expect(fingerprints).toHaveTextContent('Showing 1 of 101 drives');
      fireEvent.click(within(fingerprints).getByRole('button', { name: 'Quick view' }));
      const fingerprintDetails = screen.getByRole('dialog');
      for (const text of ['Drive', 'Attributed to', 'Confidence', 'Distance', 'Duration', 'Separation margin', 'Dominant traits', 'Actions', 'inferred', 'ambiguous', 'Regen trait']) {
        expect(fingerprintDetails).toHaveTextContent(text);
      }
      fireEvent.click(within(fingerprintDetails).getAllByRole('button', { name: 'Close' })[1]);
      fireEvent.click(within(fingerprints).getByRole('button', { name: 'Label' }));
      expect(screen.getByRole('spinbutton', { name: 'Drive ID required' })).toHaveValue(42);
      expect(screen.getByRole('combobox', { name: 'Driver' })).toHaveValue('1');
      fireEvent.click(within(fingerprints).getByRole('button', { name: 'Cancel' }));
      expect(mockAssign().mutate).not.toHaveBeenCalled();

      fireEvent.click(within(card('Named drivers')).getAllByRole('button', { name: 'Remove' })[0]);
      expect(screen.getByRole('dialog')).toHaveTextContent('Delete this driver profile?');
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(mockRemove().mutate).not.toHaveBeenCalled();
    } finally {
      dimensions.mockRestore();
      globalThis.ResizeObserver = originalObserver;
    }
  });
});
