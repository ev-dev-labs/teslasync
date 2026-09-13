/**
 * BatteryCertificatePanel — behaviour coverage.
 *
 * Data hooks (`useBatteryCertificate` / `useVerifyBatteryCertificate`) are
 * mocked and driven per test; shared UI (GlassPanel, KVList, CopyButton,
 * Badge) is REAL so the render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/hooks/useBatteryCertificate', () => ({
  useBatteryCertificate: vi.fn(),
  useVerifyBatteryCertificate: vi.fn(),
}));

import {
  useBatteryCertificate,
  useVerifyBatteryCertificate,
} from '@/api/hooks/useBatteryCertificate';
import type { BatteryCertificate } from '@/api/hooks/useBatteryCertificate';
import { BatteryCertificatePanel } from './BatteryCertificatePanel';

const mockCert = useBatteryCertificate as unknown as ReturnType<typeof vi.fn>;
const mockVerify = useVerifyBatteryCertificate as unknown as ReturnType<typeof vi.fn>;

const certificate: BatteryCertificate = {
  issuer: 'teslasync',
  version: 1,
  vehicle_id: 7,
  issued_at: '2026-03-01T12:00:00Z',
  expires_at: '2026-03-31T12:00:00Z',
  current_soh: 91.5,
  estimated_capacity_kwh: 68.625,
  original_capacity_kwh: 75,
  degradation_rate_pct_per_year: 1.8,
  battery_age_months: 36,
  total_cycles: 412,
  charge_habits_score: 88,
  stress_level: 'low',
  fast_charge_pct: 12.5,
  temp_exposure_score: 82,
  temp_exposure_reason: 'garage-kept',
};

const SIGNATURE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';

beforeEach(() => {
  vi.clearAllMocks();
  mockCert.mockReturnValue({
    data: { certificate, signature: SIGNATURE },
    isLoading: false,
    isError: false,
  });
  mockVerify.mockReturnValue({
    mutate: vi.fn(),
    data: { valid: true, certificate },
    isPending: false,
    isError: false,
  });
});

describe('BatteryCertificatePanel', () => {
  it('renders the certificate snapshot and signature prefix', () => {
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('Battery Certificate')).toBeInTheDocument();
    expect(screen.getByText('91.5%')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText(/Signature:/)).toBeInTheDocument();
    expect(screen.getByText(/a1b2c3d4/)).toBeInTheDocument();
  });

  it('shows the verified badge when self-verification succeeds', () => {
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('Signature verified')).toBeInTheDocument();
  });

  it('offers certificate and signature copies', () => {
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('Copy certificate')).toBeInTheDocument();
    expect(screen.getByText('Copy signature')).toBeInTheDocument();
  });

  it('renders an empty state when no certificate is available', () => {
    mockCert.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText(/No certificate available/)).toBeInTheDocument();
  });

  it('surfaces self-verification failures', () => {
    mockVerify.mockReturnValue({
      mutate: vi.fn(),
      data: undefined,
      isPending: false,
      isError: true,
    });
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText(/Self-verification failed/)).toBeInTheDocument();
    expect(screen.queryByText('Signature verified')).not.toBeInTheDocument();
  });
});
