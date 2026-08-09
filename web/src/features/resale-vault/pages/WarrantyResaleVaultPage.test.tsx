import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import WarrantyResaleVaultPage from './WarrantyResaleVaultPage';
import { __resetKeyRepositoryForTests } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';

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
  return render(<WarrantyResaleVaultPage />, { wrapper: Wrapper });
}

describe('WarrantyResaleVaultPage', () => {
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
});
