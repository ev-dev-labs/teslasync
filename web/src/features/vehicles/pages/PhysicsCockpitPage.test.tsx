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
  nullPark: false,
  nullRejections: false,
  nullMeasurements: false,
  nullCertificateArrays: false,
  certificateRefetch: vi.fn(),
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
    isSuccess: true,
    fetchStatus: 'idle' as const,
    dataUpdatedAt: Date.now(),
    refetch: h.refetch,
  };
}

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  usePhysicsCockpit: () => queryStub(h.cockpitMissing ? undefined : {
    ...cockpit,
    ...(h.nullMeasurements ? {
      battery_level_pct: null, energy_remaining_wh: null, pack_current_a: null,
      pack_voltage_v: null, driving_distance_m: null, speed_mps: null,
    } : {}),
    park: h.nullPark ? null : h.nullRejections ? { ...cockpit.park, rejected: null } : cockpit.park,
  }, h.cockpitError),
  useFsdHeartbeat: () => queryStub(h.heartbeatMissing ? undefined : heartbeat, h.heartbeatError),
  useSessionCertificate: () => ({
    ...queryStub(h.certificateMissing ? undefined : h.nullCertificateArrays ? {
      ...certificate, drives: null, charges: null,
    } : certificate, h.certificateError),
    isLoading: h.certificateLoading,
    fetchStatus: h.certificatePaused ? 'paused' as const : 'idle' as const,
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
  h.nullPark = false;
  h.nullRejections = false;
  h.nullMeasurements = false;
  h.nullCertificateArrays = false;
});

describe('PhysicsCockpitPage', () => {
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
    expect(screen.getByText(/398\.00 V/)).toBeInTheDocument();
    expect(screen.getByText('FSD trip meter — not an engagement flag')).toBeInTheDocument();
    expect(screen.getByText('No trip-meter tick in the recent window')).toBeInTheDocument();
    expect(screen.getByText('Confirmed park')).toBeInTheDocument();
    expect(screen.getByText('Sentry')).toBeInTheDocument();
    expect(screen.getByText('Preconditioning reported, not counted')).toBeInTheDocument();
    const caveat = screen.getByText(cockpit.honesty);
    expect(caveat).toBeVisible();
    expect(caveat.closest('[data-role="page-header"]')).toBeNull();
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
      expect(brief.querySelector(`[data-operational-metric="cockpit-${id}"]`)).toHaveAttribute('data-value-state', 'missing');
    }
    expect(screen.getByText('FSD trip meter — not an engagement flag')).toBeVisible();
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
