import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import WarrantyResaleVaultPage from './WarrantyResaleVaultPage';
import { __resetKeyRepositoryForTests } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';
import * as reportSigner from '../lib/reportSigner';
import * as auditTrail from '../lib/auditTrail';
import type { VaultReport } from '../lib/types';

const requestMock = vi.fn();
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

let selectedVehicleId: number | null = 1;
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: selectedVehicleId,
    vehicle: null,
    vehicles: selectedVehicleId != null ? [{ id: selectedVehicleId }] : [],
    setVehicleId: vi.fn(),
  }),
}));

function routeResponse(path: string): unknown {
  if (/^\/vehicles\/\d+$/.test(path)) {
    return {
      id: 1, vehicle_id: 1, vin: '5YJ3E1EA7KF123456', display_name: 'My Model 3', model: 'Model 3',
      trim_badging: 'LR', exterior_color: 'White', wheel_type: 'Aero', state: 'online', healthy: true,
      created_at: '2022-01-01T00:00:00Z', updated_at: '2022-01-01T00:00:00Z',
    };
  }
  if (path.includes('/battery-passport')) {
    return {
      vehicle_id: 1, vin_masked: '5YJ•••3456', issued_at: '2024-01-01T00:00:00Z', first_observed_at: '2022-01-01T00:00:00Z',
      soh_pct: 95, capacity_kwh: 74, original_capacity_kwh: 75, equivalent_full_cycles: 100, fast_charge_ratio: 0.1,
      avg_charge_limit_pct: 80, thermal_exposure: { cold_pct: 10, nominal_pct: 80, hot_pct: 10 }, health_grade: 'A',
      degradation_trend: [], recommendations: [], provenance_hash: 'abc',
    };
  }
  if (path.startsWith('/maintenance/records')) return [];
  if (path.startsWith('/maintenance')) return [];
  if (path.startsWith('/software-updates')) return [];
  if (path === '/vehicles/1/warranty') return { data: { plan: 'Basic' }, fetched_at: '2024-01-01T00:00:00Z' };
  if (path.startsWith('/drives/score')) return { overall: 90, efficiency: 90, smoothness: 90, speedDiscipline: 90, grade: 'A', totalDrives: 1, trend: 'up' };
  if (path.startsWith('/drives/stats')) return { totalDrives: 1, totalDistanceKm: 10, totalDurationS: 600, avgEfficiencyWhKm: 150, avgSpeedKmh: 40, topSpeedKmh: 80, regenRatio: 0.1, regenEnergyWh: 100, co2SavedKg: 1 };
  if (path.startsWith('/drives')) return [];
  if (path.startsWith('/charging-sessions')) return [];
  if (path.includes('/guard/events')) return { vehicle_id: 1, events: [] };
  return null;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  return { ...render(<WarrantyResaleVaultPage />, { wrapper: Wrapper }), client };
}

describe('WarrantyResaleVaultPage', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    selectedVehicleId = 1;
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) => Promise.resolve(routeResponse(path)));
    __resetKeyRepositoryForTests();
    __resetAuditTrailForTests();
  });

  it('shows the no-vehicle-selected empty state when no vehicle is selected', () => {
    selectedVehicleId = null;
    renderPage();
    expect(screen.getByText(/no vehicle selected/i)).toBeInTheDocument();
  });

  it('renders the Evidence tab by default with the evidence inventory panel', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /warranty & resale vault/i })).toBeInTheDocument();
    expect(await screen.findByText(/evidence inventory/i)).toBeInTheDocument();
  });

  it('switches to the Disclosure Profile tab and shows the profile builder', async () => {
    renderPage();
    await screen.findByText(/evidence inventory/i);

    fireEvent.click(screen.getByRole('tab', { name: /disclosure profile/i }));
    expect(await screen.findByText(/nothing is shared until you export/i)).toBeInTheDocument();
  });

  it('switches to the Preview & Sign tab and shows the privacy preview and signing panels', async () => {
    renderPage();
    await screen.findByText(/evidence inventory/i);

    fireEvent.click(screen.getByRole('tab', { name: /preview & sign/i }));
    expect(await screen.findByText(/export signed report/i)).toBeInTheDocument();
    expect(screen.getByText(/signature & key management/i)).toBeInTheDocument();
  });

  it('switches to the Import & Verify tab', async () => {
    renderPage();
    await screen.findByText(/evidence inventory/i);

    fireEvent.click(screen.getByRole('tab', { name: /import & verify/i }));
    expect(await screen.findByText(/import & verify a report/i)).toBeInTheDocument();
  });

  it('switches to the Audit Trail tab', async () => {
    renderPage();
    await screen.findByText(/evidence inventory/i);

    fireEvent.click(screen.getByRole('tab', { name: /audit trail/i }));
    await waitFor(() => expect(screen.getByText(/no activity yet/i)).toBeInTheDocument());
  });

  it('preserves selected report evidence and provenance through one denied source refresh and its own recovery', async () => {
    const sign = vi.spyOn(reportSigner, 'signReport').mockImplementation(async (report) => ({
      report, digest_sha256_hex: 'abc',
      signature: {
        alg: 'ECDSA_P256_SHA256', key_id: 'key_mock', public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
        signature_b64: 'sig', signed_at: '2024-01-01T00:00:00Z',
      },
      local_key_status: { persisted: false, revoked: false },
    }));
    vi.spyOn(auditTrail, 'recordAuditEvent').mockImplementation(async (action, detail) => ({
      id: 'audit_mock', ts: '2024-01-01T00:00:00Z', action, detail,
    }));
    const { client } = renderPage();
    expect(await screen.findByText('95.00%')).toBeInTheDocument();
    expect(screen.getByText('Passport provenance hash: abc')).toBeInTheDocument();

    requestMock.mockImplementation((path: string) => path.includes('/battery-passport')
      ? Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }))
      : Promise.resolve(routeResponse(path)));
    await act(async () => { await client.invalidateQueries({ queryKey: ['battery-passport', '1'] }); });
    expect(await screen.findByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    expect(screen.getByText('95.00%')).toBeInTheDocument();
    expect(screen.getByText('Passport provenance hash: abc')).toBeInTheDocument();
    expect(screen.getByText('Basic')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Battery health Data found Included/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Warranty Data found Included/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(sign).toHaveBeenCalledOnce());
    const report = sign.mock.calls[0]?.[0];
    expect(report?.evidence.battery?.capacity_wh).toBe(74000);
    expect(report?.evidence.battery?.source_provenance_hash).toBe('abc');
    expect(report?.evidence.warranty?.data).toEqual({ plan: 'Basic' });
    expect(report?.evidence.vehicle_identity?.vin_full).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    requestMock.mockImplementation((path: string) => Promise.resolve(routeResponse(path)));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText(/Previously loaded data remains visible/)).not.toBeInTheDocument());
    expect(screen.getByText('Passport provenance hash: abc')).toBeInTheDocument();
    expect(screen.getByText('Basic')).toBeInTheDocument();
  });

  it('wires custom section, VIN and timestamp controls to the actual signed report without mutating unselected inventory', async () => {
    const sign = vi.spyOn(reportSigner, 'signReport').mockImplementation(async (report) => ({
      report, digest_sha256_hex: 'abc',
      signature: {
        alg: 'ECDSA_P256_SHA256', key_id: 'key_mock', public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
        signature_b64: 'sig', signed_at: '2024-01-01T00:00:00Z',
      },
      local_key_status: { persisted: false, revoked: false },
    }));
    vi.spyOn(auditTrail, 'recordAuditEvent').mockImplementation(async (action, detail) => ({
      id: 'audit_mock', ts: '2024-01-01T00:00:00Z', action, detail,
    }));
    renderPage();
    expect(await screen.findByText('95.00%')).toBeInTheDocument();
    expect(sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Disclosure profile' }));
    fireEvent.click(screen.getByDisplayValue('custom'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Battery health' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'VIN disclosure' }), { target: { value: 'full' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Use exact timestamps' }));
    expect(screen.getByText(/identifying information/)).toBeInTheDocument();
    expect(screen.getByText(/easier to correlate/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    expect(screen.getByText(/vehicle_identity.vin_full/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(sign).toHaveBeenCalledOnce());
    const report: VaultReport | undefined = sign.mock.calls[0]?.[0];
    expect(report?.disclosure.profileId).toBe('custom');
    expect(report?.disclosure.sections).not.toContain('battery');
    expect(report?.disclosure.sensitive).toEqual({ vinDisclosure: 'full', exactTimestamps: true });
    expect(report?.evidence.battery).toBeNull();
    expect(report?.evidence.vehicle_identity?.vin_full).toBe('5YJ3E1EA7KF123456');
    expect(report?.time_bounds.precision).toBe('exact');
    expect(report?.redaction_manifest.excluded_by_selection).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'evidence.battery' }),
    ]));

    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    expect(screen.getByRole('row', { name: /Battery health Data found Excluded by profile/ })).toBeInTheDocument();
    expect(screen.getByText('95.00%')).toBeInTheDocument();
    expect(screen.getByText('Passport provenance hash: abc')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Disclosure profile' }));
    expect(screen.getByRole('checkbox', { name: 'Battery health' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'VIN disclosure' })).toHaveValue('full');
    expect(screen.getByRole('switch', { name: 'Use exact timestamps' })).toBeChecked();
  });
});
