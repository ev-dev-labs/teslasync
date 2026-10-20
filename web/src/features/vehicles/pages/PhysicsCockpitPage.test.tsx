import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { FsdHeartbeat, PhysicsCockpit, SessionCertificate } from '@/types/teslaPhysics';

const h = vi.hoisted(() => ({
  cockpitError: null as Error | null,
  heartbeatError: null as Error | null,
  cockpitMissing: false,
  heartbeatMissing: false,
  vehicleId: 7 as number | null,
  certificateError: null as Error | null,
  certificateMissing: false,
  certificateLoading: false,
  certificatePaused: false,
  cockpitPending: false,
  heartbeatPending: false,
  certificatePending: false,
  cockpitPaused: false,
  heartbeatPaused: false,
  nullPark: false,
  nullRejections: false,
  nullMeasurements: false,
  nullCertificateArrays: false,
  lastTickAt: null as string | null,
  dateLocale: 'en-US',
  dateTimezone: 'UTC',
  certificateRefetch: vi.fn(),
  heartbeatRefetch: vi.fn(),
  refetch: vi.fn(),
}));
const { downloadJSON } = vi.hoisted(() => ({ downloadJSON: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useDateFormat', async (importOriginal) => {
  // wrapped-real-hook: keep every real formatter, override only what this file controls.
  const actual = await importOriginal<typeof import('@/hooks/useDateFormat')>();
  const overrides = await (async () => {
  const { formatDateTime } = await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
  return {
    useDateFormat: () => ({
      formatDateTime: (value: string | Date | null | undefined) =>
        formatDateTime(value, { locale: h.dateLocale, tz: h.dateTimezone }),
    }),
  };
})();
  return {
    ...actual,
    ...overrides,
    useDateFormat: (...args: Parameters<typeof actual.useDateFormat>) => ({
      ...actual.useDateFormat(...args),
      ...overrides.useDateFormat(...args),
    }),
  };
});
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', precision: 2, locale: 'en-US' },
    formatDistance: (meters: number) => `${(meters / 1000).toFixed(1)} km`,
    formatEnergy: (wh: number) => `${(wh / 1000).toFixed(1)} kWh`,
    formatSpeed: (mps: number) => `${Math.round(mps * 3.6)} km/h`,
  }),
}));
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));
vi.mock('@/lib/csvExport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport');
  return { ...actual, downloadJSON };
});

const cockpit: PhysicsCockpit = {
  vehicle_id: 7,
  gear: 'P',
  charge_state: 'Idle',
  detailed_charge_state: 'Disconnected',
  charge_port_latch: 'Engaged',
  charge_port_door_open: false,
  battery_level_pct: 81,
  energy_remaining_wh: 62000,
  pack_current_a: 1.2,
  pack_voltage_v: 398,
  fsd_distance_m: 1234000,
  driving_distance_m: 9000000,
  speed_mps: 0,
  sentry_mode: 'Armed',
  valet_mode: false,
  service_mode: false,
  park: {
    confirmed_park: true,
    park_confirmed_at: '2026-03-03T12:00:00Z',
    neutral_rolling: false,
    gear: 'P',
    sentry_reported: true,
    sentry_counted: true,
    cabin_overheat_reported: false,
    cabin_overheat_counted: false,
    preconditioning_reported: true,
    preconditioning_counted: false,
    rejected: ['Preconditioning not counted — not confirmed Park'],
    honesty: 'Sentry only counts after confirmed Park.',
  },
  honesty: 'Live Tesla physics: Gear, ChargeState, port latch, BMS, and trip meters.',
};

const heartbeat: FsdHeartbeat = {
  vehicle_id: 7,
  fsd_distance_m: 1234000,
  driving_distance_m: 9000000,
  last_tick_at: null,
  gear: 'P',
  speed_mps: 0,
  valet_mode: false,
  service_mode: false,
  firmware_version: '2026.20.3',
  label: 'FSD trip meter — not an engagement flag',
  honesty: 'SelfDrivingMilesSinceReset is a resettable trip meter.',
};

const certificate: SessionCertificate = {
  vehicle_id: 7,
  issued_at: '2026-03-03T12:00:00Z',
  from: '2026-02-01T00:00:00Z',
  to: '2026-03-03T12:00:00Z',
  rules: 'Park ends drives. Disconnected ends charges.',
  drives: [],
  charges: [],
  integrity_sha256: 'abc',
  hmac_sha256: null,
  honesty: 'Hashed export of session boundaries.',
};

function queryStub<T>(data: T, error: Error | null = null) {
  return {
    data,
    error,
    isError: error != null,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isSuccess: error == null,
    fetchStatus: 'idle' as const,
    dataUpdatedAt: Date.now(),
    refetch: h.refetch,
  };
}

function pendingStub(pending: boolean, paused: boolean, error: Error | null) {
  return {
    isPending: pending,
    isLoading: pending && !paused,
    isFetching: pending && !paused,
    isSuccess: !pending && error == null,
    fetchStatus: paused ? 'paused' as const : pending ? 'fetching' as const : 'idle' as const,
  };
}

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  usePhysicsCockpit: () => ({
    ...queryStub(h.cockpitMissing ? undefined : {
      ...cockpit,
      ...(h.nullMeasurements ? {
        battery_level_pct: null, energy_remaining_wh: null, pack_current_a: null,
        pack_voltage_v: null, driving_distance_m: null, speed_mps: null,
      } : {}),
      park: h.nullPark ? null : h.nullRejections ? { ...cockpit.park, rejected: null } : cockpit.park,
    }, h.cockpitError),
    ...pendingStub(h.cockpitPending, h.cockpitPaused, h.cockpitError),
  }),
  useFsdHeartbeat: () => ({
    ...queryStub(h.heartbeatMissing ? undefined : { ...heartbeat, last_tick_at: h.lastTickAt }, h.heartbeatError),
    ...pendingStub(h.heartbeatPending, h.heartbeatPaused, h.heartbeatError),
    refetch: h.heartbeatRefetch,
  }),
  useSessionCertificate: () => ({
    ...queryStub(h.certificateMissing ? undefined : h.nullCertificateArrays ? {
      ...certificate, drives: null, charges: null,
    } : certificate, h.certificateError),
    ...pendingStub(h.certificatePending || h.certificateLoading, h.certificatePaused, h.certificateError),
    refetch: h.certificateRefetch,
  }),
}));

import PhysicsCockpitPage from './PhysicsCockpitPage';

function renderPage() {
  return render(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.cockpitError = null;
  h.heartbeatError = null;
  h.cockpitMissing = false;
  h.heartbeatMissing = false;
  h.vehicleId = 7;
  h.certificateError = null;
  h.certificateMissing = false;
  h.certificateLoading = false;
  h.certificatePaused = false;
  h.cockpitPending = false;
  h.heartbeatPending = false;
  h.certificatePending = false;
  h.cockpitPaused = false;
  h.heartbeatPaused = false;
  h.nullPark = false;
  h.nullRejections = false;
  h.nullMeasurements = false;
  h.nullCertificateArrays = false;
  h.lastTickAt = null;
  h.dateLocale = 'en-US';
  h.dateTimezone = 'UTC';
});

describe('PhysicsCockpitPage', () => {
  it('updates tick and certificate timestamps with display preferences without changing exported evidence', () => {
    const tickInstant = '2026-03-03T00:15:00Z';
    h.lastTickAt = tickInstant;
    const originalCertificate = structuredClone(certificate);
    const view = renderPage();
    const expectedDate = (instant: string) => new Date(instant).toLocaleString(h.dateLocale, {
      timeZone: h.dateTimezone,
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const expectedTick = () => `Last tick ${expectedDate(tickInstant)}`;
    const expectedWindow = () =>
      `Certificate window: ${expectedDate(certificate.from)} to ${expectedDate(certificate.to)} · Issued ${expectedDate(certificate.issued_at)}`;
    const initialTick = expectedTick();
    const initialWindow = expectedWindow();
    expect(screen.getByText(initialTick)).toBeVisible();
    expect(screen.getByText(initialWindow)).toBeVisible();

    h.dateTimezone = 'America/Los_Angeles';
    view.rerender(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
    expect(screen.getByText(expectedTick())).toBeVisible();
    expect(screen.getByText(expectedWindow())).toBeVisible();
    expect(screen.queryByText(initialTick)).not.toBeInTheDocument();
    expect(screen.queryByText(initialWindow)).not.toBeInTheDocument();
    const zonedTick = expectedTick();
    const zonedWindow = expectedWindow();

    h.dateLocale = 'de-DE';
    view.rerender(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
    expect(screen.getByText(expectedTick())).toBeVisible();
    expect(screen.getByText(expectedWindow())).toBeVisible();
    expect(screen.queryByText(zonedTick)).not.toBeInTheDocument();
    expect(screen.queryByText(zonedWindow)).not.toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeVisible();
    expect(screen.getByText('Confirmed park')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Session certificate' }));
    expect(downloadJSON.mock.calls[0][1]).toBe(certificate);
    expect(downloadJSON.mock.calls[0][1]).toEqual(originalCertificate);
    expect(h.lastTickAt).toBe(tickInstant);
  });

  it.each(['cockpit', 'heartbeat', 'certificate'] as const)(
    'distinguishes active loading, deferred availability and successful empty %s evidence',
    (source) => {
      h[`${source}Missing`] = true;
      h[`${source}Pending`] = true;
      const labels = source === 'cockpit'
        ? ['Live cockpit readings', 'Park truth']
        : [source === 'heartbeat' ? 'FSD trip-meter heartbeat' : 'Session certificate'];
      const emptyMessage = source === 'cockpit' ? 'No park evidence has been reported.'
        : source === 'heartbeat' ? 'No trip-meter heartbeat has been reported.'
          : 'A session certificate is not available for this vehicle yet.';
      const view = renderPage();
      for (const label of labels) {
        expect(screen.getByRole('status', { name: `Loading ${label}` })).toBeVisible();
      }
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();

      h[`${source}Paused`] = true;
      view.rerender(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
      for (const label of labels) {
        expect(screen.queryByRole('status', { name: `Loading ${label}` })).not.toBeInTheDocument();
      }
      expect(screen.getAllByText('Source availability has not resolved yet.')).toHaveLength(labels.length);
      expect(screen.getAllByText('Refresh paused')).toHaveLength(labels.length);
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
      expect(screen.queryByText(/device is offline|Paused offline/i)).not.toBeInTheDocument();

      h[`${source}Pending`] = false;
      h[`${source}Paused`] = false;
      view.rerender(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
      expect(screen.getByText(emptyMessage)).toBeVisible();
      h[`${source}Missing`] = false;
      view.rerender(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
      expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
      expect(screen.queryByText('Source availability has not resolved yet.')).not.toBeInTheDocument();
    },
  );

  it('recovers each retained refresh failure without losing measurements or export evidence', () => {
    h.cockpitError = new Error('cockpit refresh failed');
    h.heartbeatError = new Error('heartbeat refresh failed');
    h.certificateError = new Error('certificate refresh failed');
    const view = renderPage();
    expect(screen.getByText('0 km/h')).toBeVisible();
    expect(screen.getByText('Confirmed park')).toBeVisible();
    expect(screen.getByText(certificate.rules)).toBeVisible();
    for (const id of ['physics-cockpit-readings', 'physics-heartbeat-readings', 'physics-park-readings']) {
      const brief = screen.getByTestId(id);
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('Retained after refresh failure')).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]);
    }

    h.cockpitError = null;
    h.heartbeatError = null;
    h.certificateError = null;
    view.rerender(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Retained after refresh failure')).not.toBeInTheDocument();
    expect(screen.getByText('0 km/h')).toBeVisible();
    expect(screen.getByText('Confirmed park')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Session certificate' }));
    expect(downloadJSON.mock.calls[0][1]).toBe(certificate);
  });

  it('retries and recovers an initial heartbeat failure independently', () => {
    h.heartbeatMissing = true;
    h.heartbeatError = new Error('heartbeat initial failure');
    const view = renderPage();
    expect(screen.getByText('Trip-meter heartbeat could not be loaded.')).toBeVisible();
    expect(screen.getByText('Disconnected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.heartbeatRefetch).toHaveBeenCalledTimes(1);
    expect(h.refetch).not.toHaveBeenCalled();
    expect(h.certificateRefetch).not.toHaveBeenCalled();
    h.heartbeatMissing = false;
    h.heartbeatError = null;
    view.rerender(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
    expect(screen.queryByText('Trip-meter heartbeat could not be loaded.')).not.toBeInTheDocument();
    expect(screen.getByText('No trip-meter tick in the recent window')).toBeVisible();
  });

  it('retains all cockpit, heartbeat and park evidence after independent refresh failures', () => {
    h.cockpitError = new Error('cockpit refresh failed');
    h.heartbeatError = new Error('heartbeat refresh failed');
    renderPage();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText('0 km/h')).toBeInTheDocument();
    expect(screen.getByText('Confirmed park')).toBeInTheDocument();
    expect(screen.getByText('No trip-meter tick in the recent window')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Session certificate' }));
    expect(downloadJSON.mock.calls[0][1]).toEqual(certificate);
  });

  it('keeps heartbeat and park shells visible with independent recovery when both sources fail initially', () => {
    h.cockpitMissing = true;
    h.heartbeatMissing = true;
    h.cockpitError = new Error('cockpit initial failure');
    h.heartbeatError = new Error('heartbeat initial failure');
    renderPage();
    expect(screen.getByRole('heading', { name: 'FSD trip-meter heartbeat' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Park truth' })).toBeInTheDocument();
    expect(screen.getByText('Trip-meter heartbeat could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('Park evidence could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
  it('shows Tesla physics fields and does not treat a present FSD meter as a tick', () => {
    renderPage();
    expect(screen.getByText('Tesla physics cockpit')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    for (const id of ['physics-cockpit-readings', 'physics-heartbeat-readings', 'physics-park-readings']) {
      const brief = screen.getByTestId(id);
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const drawer = within(screen.getAllByRole('dialog').at(-1)!);
      if (id === 'physics-cockpit-readings') {
        expect(drawer.getByText(/398\.00 V/)).toBeInTheDocument();
      } else if (id === 'physics-heartbeat-readings') {
        expect(drawer.getByText('No trip-meter tick in the recent window')).toBeInTheDocument();
        expect(drawer.queryByText(/Last tick/)).toBeNull();
      } else {
        expect(drawer.getByText('Confirmed park')).toBeInTheDocument();
        expect(drawer.getByText('Sentry')).toBeInTheDocument();
        expect(drawer.getByText('Preconditioning reported, not counted')).toBeInTheDocument();
      }
      fireEvent.click(drawer.getAllByRole('button', { name: 'Close' }).at(-1)!);
    }
  });

  it('keeps real zero speed numeric and reviews independently reported pack measurements', () => {
    renderPage();
    const brief = screen.getByTestId('physics-cockpit-readings');
    const speed = brief.querySelector('[data-operational-metric="cockpit-speed"]');
    if (!(speed instanceof HTMLElement)) throw new Error('Speed evidence missing');
    expect(speed).toHaveAttribute('data-value-state', 'value');
    expect(within(speed).getByText('0 km/h')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-metric="cockpit-current"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/Pack voltage \(V\) and current \(A\)/)).toBeInTheDocument();
    expect(within(drawer).getByText('398.00 V')).toBeInTheDocument();
    expect(within(drawer).getByText('1.20 A')).toBeInTheDocument();
  });

  it('recovers an initial certificate failure without removing neighboring physics evidence', () => {
    h.certificateMissing = true;
    h.certificateError = new Error('certificate initial failure');
    renderPage();
    expect(screen.getByText('Unable to load the session certificate.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeDisabled();
    expect(screen.getByText('Disconnected')).toBeVisible();
    expect(screen.getByText('Confirmed park')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.certificateRefetch).toHaveBeenCalledTimes(1);
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it('retains a failed certificate refresh with one source warning and unchanged raw export', () => {
    h.certificateError = new Error('certificate refresh failed');
    renderPage();
    expect(screen.getByText('Session certificate may be out of date')).toBeVisible();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.getByText(certificate.rules)).toBeVisible();
    expect(screen.getByText(certificate.honesty)).toBeVisible();
    expect(screen.getByText(/Certificate window:/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Session certificate' }));
    expect(downloadJSON.mock.calls[0][1]).toBe(certificate);
    fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!);
    expect(h.certificateRefetch).toHaveBeenCalledTimes(1);
  });

  it('distinguishes certificate loading from resolved empty evidence', () => {
    h.certificateMissing = true;
    h.certificateLoading = true;
    const view = renderPage();
    expect(screen.getByRole('status', { name: 'Loading Session certificate' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeDisabled();
    expect(screen.queryByText('A session certificate is not available for this vehicle yet.')).not.toBeInTheDocument();
    h.certificateLoading = false;
    view.rerender(<MemoryRouter><PhysicsCockpitPage /></MemoryRouter>);
    expect(screen.getByText('A session certificate is not available for this vehicle yet.')).toBeVisible();
    expect(screen.queryByRole('status', { name: 'Loading Session certificate' })).not.toBeInTheDocument();
  });

  it('keeps all source shells and disables export when the workspace has no selected vehicle', () => {
    h.vehicleId = null;
    h.cockpitMissing = true;
    h.heartbeatMissing = true;
    h.certificateMissing = true;
    h.cockpitPending = true;
    h.heartbeatPending = true;
    h.certificatePending = true;
    renderPage();
    expect(screen.getByTestId('physics-cockpit-readings')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'FSD trip-meter heartbeat' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Park truth' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Session certificate' })).toBeVisible();
    expect(screen.getAllByText('No vehicle selected')).toHaveLength(4);
    expect(screen.queryByText('Loading source')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeDisabled();
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
  });

  it('keeps null park evidence and numeric measurements unknown instead of inventing zeros', () => {
    h.nullPark = true;
    h.nullMeasurements = true;
    renderPage();
    expect(screen.getByText('No park evidence has been reported.')).toBeVisible();
    expect(screen.queryByText('Confirmed park')).not.toBeInTheDocument();
    expect(screen.queryByText('0 km/h')).not.toBeInTheDocument();
    const brief = screen.getByTestId('physics-cockpit-readings');
    for (const id of ['battery', 'pack', 'current', 'energy', 'trip', 'speed']) {
      expect(brief.querySelector(`[data-operational-metric="cockpit-${id}"]`)).toBeNull();
    }
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getAllByRole('dialog').at(-1)).toHaveTextContent('6 empty fields are hidden.');
    const heartbeat = screen.getByTestId('physics-heartbeat-readings');
    fireEvent.click(within(heartbeat).getByRole('button', { name: 'Review details' }));
    expect(screen.queryByText('FSD trip meter - not an engagement flag')).toBeNull();
  });

  it('preserves nullable rejection and certificate arrays without normalizing the exported evidence', () => {
    h.nullRejections = true;
    h.nullCertificateArrays = true;
    renderPage();
    expect(screen.getByText('Confirmed park')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Session certificate' }));
    expect(downloadJSON.mock.calls[0][1]).toEqual({ ...certificate, drives: null, charges: null });
    expect(downloadJSON.mock.calls[0][1].hmac_sha256).toBeNull();
  });

  it('keeps a paused certificate available without claiming the vehicle is offline', () => {
    h.certificatePaused = true;
    renderPage();
    expect(screen.getByText('Session certificate may be out of date')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeEnabled();
    expect(screen.queryByText(/Paused offline|device is offline/i)).not.toBeInTheDocument();
    expect(screen.getByText(certificate.honesty)).toBeVisible();
  });
});
