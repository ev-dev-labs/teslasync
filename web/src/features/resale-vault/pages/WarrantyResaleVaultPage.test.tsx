import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import WarrantyResaleVaultPage from './WarrantyResaleVaultPage';
import { __resetKeyRepositoryForTests, generateSigningKey, getActiveSigningKeyRecord } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';
import * as reportSigner from '../lib/reportSigner';
import * as auditTrail from '../lib/auditTrail';
import type { SignedVaultReport, VaultReport } from '../lib/types';
import type { BatteryCertificateIssueResponse } from '@/api/hooks/useBatteryCertificate';

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

function signedResult(report: VaultReport): SignedVaultReport {
  return {
    report, digest_sha256_hex: 'pending-digest',
    signature: {
      alg: 'ECDSA_P256_SHA256', key_id: 'key_mock',
      public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      signature_b64: 'sig', signed_at: '2024-01-01T00:00:00Z',
    },
    local_key_status: { persisted: false, revoked: false },
  };
}

describe('WarrantyResaleVaultPage', () => {
  afterEach(() => { onlineManager.setOnline(true); vi.restoreAllMocks(); });
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

  it('scopes browser-only claims to vault reports and discloses automatic server certificate fetching and verification before export', async () => {
    const issued: BatteryCertificateIssueResponse = {
      certificate: {
        issuer: 'TeslaSync', version: 1, vehicle_id: 1,
        issued_at: '2024-01-01T00:00:00Z', expires_at: '2024-01-31T00:00:00Z',
        current_soh: 95, estimated_capacity_kwh: 74, original_capacity_kwh: 75,
        degradation_rate_pct_per_year: 1, battery_age_months: 24, total_cycles: 100,
        charge_habits_score: 90, stress_level: 'low', fast_charge_pct: 10,
        temp_exposure_score: null, temp_exposure_reason: 'Insufficient observations',
      },
      signature: 'server-signature',
    };
    requestMock.mockImplementation((path: string) => {
      if (path === '/analytics/battery-health/certificate?vehicle_id=1') return Promise.resolve(issued);
      if (path === '/public/battery-certificate/verify') return Promise.resolve({ valid: true, certificate: issued.certificate });
      return Promise.resolve(routeResponse(path));
    });
    const sign = vi.spyOn(reportSigner, 'signReport');
    renderPage();

    expect(screen.getByText(/report in this browser using evidence fetched from the server/)).toBeInTheDocument();
    expect(screen.getByText(/Vault report assembly, report signing, imported report verification/)).toBeInTheDocument();
    expect(screen.getByText(/opening Evidence fetches it from the server.*automatically sends its certificate payload and signature/)).toBeInTheDocument();
    expect(screen.getByText(/not the separate server certificate requests/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing leaves your browser until you explicitly export it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/entirely in this browser/)).not.toBeInTheDocument();

    expect(await screen.findByText('Signature verified')).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith('/analytics/battery-health/certificate?vehicle_id=1', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(requestMock).toHaveBeenCalledWith('/public/battery-certificate/verify', {
      method: 'POST', body: JSON.stringify(issued),
    });
    expect(screen.getAllByText('95.00%').length).toBeGreaterThan(0);
    expect(screen.getByText('Passport provenance hash: abc')).toBeInTheDocument();
    expect(screen.getByText('Basic')).toBeInTheDocument();
    expect(sign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy certificate' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Copy signature' })).toBeEnabled();
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

  it('reconciles automatic signing-key generation even when signing subsequently rejects', async () => {
    vi.spyOn(reportSigner, 'signReport').mockImplementation(async () => {
      await generateSigningKey();
      throw new Error('Signature denied');
    });
    renderPage();
    await screen.findByText('95.00%');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    expect(await screen.findByText('Signature denied')).toBeInTheDocument();
    const active = await getActiveSigningKeyRecord();
    expect(active).not.toBeNull();
    expect(screen.getByText(`Active key: ${active?.key_id}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeEnabled();
  });

  it('reconciles a partially applied rotation without clearing its error', async () => {
    await generateSigningKey();
    renderPage();
    await screen.findByText('95.00%');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeEnabled());
    vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new Error('Generation denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate active key' }));
    expect(await screen.findByText('Generation denied')).toBeInTheDocument();
    expect(screen.getByText(/Active key: none/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
  });

  it.each(['success', 'rejection'] as const)(
    'ignores stale signing %s after a vehicle change and holds the cross-panel guard until settlement',
    async (settlement) => {
      let resolve!: (result: SignedVaultReport) => void;
      let reject!: (error: Error) => void;
      const pending = new Promise<SignedVaultReport>((done, fail) => { resolve = done; reject = fail; });
      const sign = vi.spyOn(reportSigner, 'signReport').mockReturnValue(pending);
      const { rerender } = renderPage();
      await screen.findByText('95.00%');
      fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
      expect(screen.getByRole('button', { name: 'Generate new key' })).toBeDisabled();
      selectedVehicleId = 2;
      rerender(<WarrantyResaleVaultPage />);
      expect(screen.getByRole('button', { name: 'Generate new key' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
      await act(async () => {
        if (settlement === 'success') resolve(signedResult(sign.mock.calls[0][0]));
        else reject(new Error('Old vehicle signing denied'));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Generate new key' })).toBeEnabled());
      expect(screen.queryByText('pending-digest')).not.toBeInTheDocument();
      expect(screen.queryByText('Old vehicle signing denied')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled();
    },
  );

  it.each(['success', 'rejection'] as const)('settles matching signing %s and releases both panels', async (settlement) => {
    let resolve!: (result: SignedVaultReport) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<SignedVaultReport>((done, fail) => { resolve = done; reject = fail; });
    const sign = vi.spyOn(reportSigner, 'signReport').mockReturnValue(pending);
    renderPage();
    await screen.findByText('95.00%');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    expect(screen.getByRole('button', { name: 'Generate new key' })).toBeDisabled();
    await act(async () => {
      if (settlement === 'success') resolve(signedResult(sign.mock.calls[0][0]));
      else reject(new Error('Current signing denied'));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate new key' })).toBeEnabled());
    if (settlement === 'success') {
      expect(screen.getByText('pending-digest')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
    } else {
      expect(screen.getByText('Current signing denied')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled();
    }
  });

  it('does not revive an old completion after leaving and returning to the same preview scope', async () => {
    let resolve!: (result: SignedVaultReport) => void;
    const pending = new Promise<SignedVaultReport>((done) => { resolve = done; });
    const sign = vi.spyOn(reportSigner, 'signReport').mockReturnValue(pending);
    renderPage();
    await screen.findByText('95.00%');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Disclosure profile' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generate new key' })).toBeDisabled();
    await act(async () => { resolve(signedResult(sign.mock.calls[0][0])); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    expect(screen.queryByText('pending-digest')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled();
    sign.mockImplementation(async (report) => signedResult(report));
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    expect(await screen.findByText('pending-digest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate new key' })).toBeEnabled();
  });

  it('retains a matching signed report and the error when its audit write rejects', async () => {
    vi.spyOn(reportSigner, 'signReport').mockImplementation(async (report) => {
      await generateSigningKey();
      return signedResult(report);
    });
    vi.spyOn(auditTrail, 'recordAuditEvent').mockRejectedValue(new Error('Audit write denied'));
    renderPage();
    await screen.findByText('95.00%');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    expect(await screen.findByText('Audit write denied')).toBeInTheDocument();
    expect(screen.getByText('pending-digest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
  });

  it('retains a signed export across disclosure tabs but resets it when leaving its vehicle scope', async () => {
    vi.spyOn(reportSigner, 'signReport').mockImplementation(async (report) => signedResult(report));
    const { rerender } = renderPage();
    await screen.findByText('95.00%');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    expect(await screen.findByText('pending-digest')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Disclosure profile' }));
    fireEvent.click(screen.getByDisplayValue('custom'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Battery health' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    expect(screen.getByText('pending-digest')).toBeInTheDocument();
    expect(screen.getByText(/belongs to an older preview/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();

    selectedVehicleId = 2;
    rerender(<WarrantyResaleVaultPage />);
    expect(screen.queryByText('pending-digest')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled();
    selectedVehicleId = 1;
    rerender(<WarrantyResaleVaultPage />);
    expect(screen.queryByText('pending-digest')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled();
  });

  it('holds signing during key audit work and reconciles the generated key when that audit rejects', async () => {
    let rejectAudit!: (error: Error) => void;
    const pendingAudit = new Promise<never>((_, reject) => { rejectAudit = reject; });
    const audit = vi.spyOn(auditTrail, 'recordAuditEvent').mockReturnValue(pendingAudit);
    const sign = vi.spyOn(reportSigner, 'signReport');
    const { rerender } = renderPage();
    await screen.findByText('95.00%');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate new key' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Generate new key' }));
    await waitFor(() => expect(audit).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    selectedVehicleId = 2;
    rerender(<WarrantyResaleVaultPage />);
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    await act(async () => { rejectAudit(new Error('Key audit denied')); });
    expect(await screen.findByText('Key audit denied')).toBeInTheDocument();
    const active = await getActiveSigningKeyRecord();
    expect(screen.getByText(`Active key: ${active?.key_id}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate active key' })).toBeEnabled();
    expect(sign).not.toHaveBeenCalled();
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
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    expect(screen.getAllByText(/Source readiness: battery\/battery; status=stale; retained=true/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('switch', { name: 'Included with warning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(sign).toHaveBeenCalledOnce());
    const report = sign.mock.calls[0]?.[0];
    expect(report?.evidence.battery?.capacity_wh).toBe(74000);
    expect(report?.evidence.battery?.source_provenance_hash).toBe('abc');
    expect(report?.evidence.warranty?.data).toEqual({ plan: 'Basic' });
    expect(report?.evidence.vehicle_identity?.vin_full).toBeNull();
    expect(report?.limitations.join(' ')).toContain('Source readiness: battery/battery; status=stale; retained=true');

    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    requestMock.mockImplementation((path: string) => Promise.resolve(routeResponse(path)));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByText(/Previously loaded data remains visible/)).not.toBeInTheDocument());
    expect(screen.getByText('Passport provenance hash: abc')).toBeInTheDocument();
    expect(screen.getByText('Basic')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    expect(screen.queryByRole('switch', { name: 'Included with warning' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled();
    expect(screen.getByText(/Source readiness: battery\/battery; status=ok; retained=true/)).toBeInTheDocument();
  });

  it('carries unresolved loading through the preview until successful empty sources resolve', async () => {
    let resolveSoftware: (data: unknown) => void = () => {};
    const pending = new Promise((resolve) => { resolveSoftware = resolve; });
    requestMock.mockImplementation((path: string) => path.startsWith('/software-updates')
      ? pending : Promise.resolve(routeResponse(path)));
    renderPage();
    await screen.findByText('95.00%');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    expect(screen.getByText(/Source readiness: software_updates\/software; status=initial; retained=false/)).toBeInTheDocument();
    await act(async () => { resolveSoftware([]); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    expect(screen.getByText(/Source readiness: software_updates\/software; status=ok; retained=true/)).toBeInTheDocument();
  });

  it('does not sign paused first reads as empty evidence and recovers when online', async () => {
    onlineManager.setOnline(false);
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    expect(screen.getAllByText(/status=initial; retained=false; refreshing=false; paused=true/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('switch', { name: 'Included with warning' }));
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    await act(async () => { onlineManager.setOnline(true); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    expect(screen.queryByText(/status=initial; retained=false/)).not.toBeInTheDocument();
  });

  it('allows an intentional partial report after a failed first read without deleting other selected evidence', async () => {
    requestMock.mockImplementation((path: string) => path.includes('/battery-passport')
      ? Promise.reject(new Error('Battery source unavailable'))
      : Promise.resolve(routeResponse(path)));
    const sign = vi.spyOn(reportSigner, 'signReport').mockImplementation(async (report) => ({
      report, digest_sha256_hex: 'abc',
      signature: {
        alg: 'ECDSA_P256_SHA256', key_id: 'key_mock', public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
        signature_b64: 'sig', signed_at: '2024-01-01T00:00:00Z',
      },
      local_key_status: { persisted: false, revoked: false },
    }));
    renderPage();
    await screen.findByText(/Battery health could not be loaded/);
    fireEvent.click(screen.getByRole('tab', { name: 'Preview & sign' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Included with warning' })).toBeInTheDocument());
    await waitFor(() => expect(screen.queryAllByText(/status=initial; retained=false/)).toHaveLength(0));
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Included with warning' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(sign).toHaveBeenCalledOnce());
    const snapshot = sign.mock.calls[0][0];
    expect(snapshot.evidence.battery).toBeNull();
    expect(snapshot.evidence.warranty?.data).toEqual({ plan: 'Basic' });
    expect(snapshot.disclosure.sections).toContain('battery');
    expect(snapshot.limitations.join(' ')).toContain('status=initialFailure; retained=false');
    expect(snapshot.limitations.join(' ')).toContain('not evidence of an empty history or a zero measurement');
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

describe('WarrantyResaleVaultPage tab/panel identity', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    selectedVehicleId = 1;
    requestMock.mockReset();
    requestMock.mockImplementation((path: string) => Promise.resolve(routeResponse(path)));
    __resetKeyRepositoryForTests();
    __resetAuditTrailForTests();
  });

  it('links each selected tab to its named active panel and preserves IDs when returning to Evidence', async () => {
    renderPage();
    expect(await screen.findByText('95.00%')).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    const originalIds = tabs.map((tab) => tab.id);
    const evidencePanelId = screen.getByRole('tabpanel', { name: 'Evidence' }).id;

    for (const tab of tabs) {
      fireEvent.click(tab);
      const panel = screen.getByRole('tabpanel', { name: tab.textContent ?? '' });
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(tab).toHaveAttribute('tabindex', '0');
      expect(tab).toHaveAttribute('aria-controls', panel.id);
      expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')).toBe(panel);
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')).toBe(tab);
      for (const inactive of tabs.filter((item) => item !== tab)) {
        expect(inactive).toHaveAttribute('aria-selected', 'false');
        expect(inactive).toHaveAttribute('tabindex', '-1');
      }
    }

    fireEvent.click(tabs[0]);
    expect(screen.getByRole('tabpanel', { name: 'Evidence' })).toHaveAttribute('id', evidencePanelId);
    expect(screen.getAllByRole('tab').map((tab) => tab.id)).toEqual(originalIds);
    expect(screen.getByText('95.00%')).toBeInTheDocument();
    expect(screen.getByText('Passport provenance hash: abc')).toBeInTheDocument();
    expect(screen.getByText('Basic')).toBeInTheDocument();
  });

  it('keeps keyboard automatic activation, focus and roving selection linked across arrows, Home and End', async () => {
    renderPage();
    await screen.findByText(/evidence inventory/i);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    const moves = [
      { from: 0, key: 'ArrowRight', to: 1 },
      { from: 1, key: 'End', to: 4 },
      { from: 4, key: 'ArrowRight', to: 0 },
      { from: 0, key: 'ArrowLeft', to: 4 },
      { from: 4, key: 'Home', to: 0 },
    ];

    for (const { from, key, to } of moves) {
      fireEvent.keyDown(tabs[from], { key });
      const selected = tabs[to];
      await waitFor(() => expect(selected).toHaveFocus());
      const panel = screen.getByRole('tabpanel', { name: selected.textContent ?? '' });
      expect(selected).toHaveAttribute('aria-selected', 'true');
      expect(selected).toHaveAttribute('tabindex', '0');
      expect(selected).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveAttribute('aria-labelledby', selected.id);
      expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([selected]);
    }
    expect(screen.getByText(/evidence inventory/i)).toBeInTheDocument();
  });

  it('lets keyboard users enter every active named panel and return to its selected tab without invoking vault actions', async () => {
    const user = userEvent.setup();
    const sign = vi.spyOn(reportSigner, 'signReport');
    renderPage();
    await screen.findByText(/evidence inventory/i);
    const tabs = screen.getAllByRole('tab');

    for (const tab of tabs) {
      await user.click(tab);
      expect(tab).toHaveFocus();
      const panel = screen.getByRole('tabpanel', { name: tab.textContent ?? '' });
      expect(panel).toHaveAttribute('tabindex', '0');
      expect(tab).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveClass('min-w-0', 'focus-visible:outline-2', 'focus-visible:outline-offset-2');
      await user.tab();
      expect(panel).toHaveFocus();
      await user.tab({ shift: true });
      expect(tab).toHaveFocus();
    }

    expect(sign).not.toHaveBeenCalled();
    expect(requestMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it('isolates tab and panel IDs between simultaneous page instances and retains identity on rerender', async () => {
    const { container, rerender } = renderPage();
    rerender(<><WarrantyResaleVaultPage /><WarrantyResaleVaultPage /></>);
    const tablists = within(container).getAllByRole('tablist');
    const first = within(tablists[0]);
    const second = within(tablists[1]);
    const firstEvidence = first.getByRole('tab', { name: 'Evidence' });
    const secondEvidence = second.getByRole('tab', { name: 'Evidence' });
    expect(firstEvidence.id).not.toBe(secondEvidence.id);
    expect(firstEvidence.getAttribute('aria-controls')).not.toBe(secondEvidence.getAttribute('aria-controls'));
    expect(new Set(within(container).getAllByRole('tab').map((tab) => tab.id)).size).toBe(10);
    const originalIds = within(container).getAllByRole('tab').map((tab) => tab.id);

    const firstDisclosure = first.getByRole('tab', { name: 'Disclosure profile' });
    fireEvent.click(firstDisclosure);
    const disclosurePanel = within(container).getByRole('tabpanel', { name: 'Disclosure profile' });
    const evidencePanel = within(container).getByRole('tabpanel', { name: 'Evidence' });
    expect(firstDisclosure).toHaveAttribute('aria-controls', disclosurePanel.id);
    expect(disclosurePanel).toHaveAttribute('aria-labelledby', firstDisclosure.id);
    expect(secondEvidence).toHaveAttribute('aria-controls', evidencePanel.id);
    expect(evidencePanel).toHaveAttribute('aria-labelledby', secondEvidence.id);
    expect(secondEvidence).toHaveAttribute('aria-selected', 'true');

    rerender(<><WarrantyResaleVaultPage /><WarrantyResaleVaultPage /></>);
    expect(within(container).getAllByRole('tab').map((tab) => tab.id)).toEqual(originalIds);
    expect(within(container).getByRole('tabpanel', { name: 'Disclosure profile' })).toHaveAttribute('id', disclosurePanel.id);
    expect(within(container).getByRole('tabpanel', { name: 'Evidence' })).toHaveAttribute('id', evidencePanel.id);
  });
});
