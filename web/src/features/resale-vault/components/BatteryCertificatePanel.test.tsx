/**
 * BatteryCertificatePanel — behaviour coverage.
 *
 * Data hooks (`useBatteryCertificate` / `useVerifyBatteryCertificate`) are
 * mocked and driven per test; shared UI (GlassPanel, KVList, CopyButton,
 * Badge) is REAL so the render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/feedback';

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
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  vi.restoreAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

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
    variables: { certificate, signature: SIGNATURE },
    isPending: false,
    isError: false,
  });
});

describe('BatteryCertificatePanel', () => {
  it('opens actual certificate details without conflating measurements with signature verification', () => {
    render(<BatteryCertificatePanel vehicleId="7" />);
    const brief = screen.getByTestId('vault-certificate-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('91.50%')).toBeInTheDocument();
    expect(within(drawer).getByText('88.00 / 100')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Issued 2026-03-01T12:00:00Z; expires 2026-03-31T12:00:00Z', { selector: 'div' })).toHaveLength(4);
    expect(screen.getByText('Copy certificate')).toBeInTheDocument();
    expect(screen.getByText('Copy signature')).toBeInTheDocument();
  });
  it('renders the certificate snapshot and signature prefix', () => {
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('Battery certificate')).toBeInTheDocument();
    expect(screen.getByText('91.50%')).toBeInTheDocument();
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
    mockCert.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText(/No certificate available/)).toBeInTheDocument();
  });

  it('distinguishes an initial certificate failure from an authoritative empty result', () => {
    mockCert.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('certificate failed') });
    render(<MemoryRouter><BatteryCertificatePanel vehicleId="7" /></MemoryRouter>);
    expect(screen.getByText('The battery certificate could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/No certificate available/)).not.toBeInTheDocument();
  });

  it('keeps the snapshot, complete copy actions and signature when refresh fails', () => {
    mockCert.mockReturnValue({
      data: { certificate, signature: SIGNATURE },
      isLoading: false,
      isError: true,
      error: new Error('refresh failed'),
    });
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('91.50%')).toBeInTheDocument();
    expect(screen.getByText('Copy certificate')).toBeInTheDocument();
    expect(screen.getByText('Copy signature')).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
  });

  it('surfaces self-verification failures', () => {
    mockVerify.mockReturnValue({
      mutate: vi.fn(),
      data: undefined,
      variables: { certificate, signature: SIGNATURE },
      isPending: false,
      isError: true,
    });
    render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText(/Self-verification failed/)).toBeInTheDocument();
    expect(screen.queryByText('Signature verified')).not.toBeInTheDocument();
  });

  it('does not attach a prior verification success to a refreshed certificate and verifies the new payload', () => {
    const mutate = vi.fn();
    mockVerify.mockReturnValue({
      mutate,
      data: { valid: true, certificate },
      variables: { certificate, signature: SIGNATURE },
      isPending: false,
      isError: false,
    });
    const { rerender } = render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('Signature verified')).toBeInTheDocument();
    mutate.mockClear();

    const refreshed = { ...certificate, current_soh: 89, issued_at: '2026-03-02T12:00:00Z' };
    const refreshedSignature = 'ff'.repeat(32);
    mockCert.mockReturnValue({ data: { certificate: refreshed, signature: refreshedSignature }, isLoading: false, isError: false });
    rerender(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('89.00%')).toBeInTheDocument();
    expect(screen.queryByText('Signature verified')).not.toBeInTheDocument();
    expect(mutate).toHaveBeenCalledExactlyOnceWith({ certificate: refreshed, signature: refreshedSignature });

    mockVerify.mockReturnValue({
      mutate,
      data: { valid: true, certificate: refreshed },
      variables: { certificate: refreshed, signature: refreshedSignature },
      isPending: false,
      isError: false,
    });
    rerender(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('Signature verified')).toBeInTheDocument();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('never shows success from another vehicle while the new certificate is being verified', () => {
    const otherCertificate = { ...certificate, vehicle_id: 8 };
    const mutate = vi.fn();
    mockVerify.mockReturnValue({
      mutate,
      data: { valid: true, certificate },
      variables: { certificate, signature: SIGNATURE },
      isPending: true,
      isError: false,
    });
    mockCert.mockReturnValue({ data: { certificate: otherCertificate, signature: 'ee'.repeat(32) }, isLoading: false, isError: false });
    const { rerender } = render(<BatteryCertificatePanel vehicleId="8" />);
    expect(screen.queryByText('Signature verified')).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    mockVerify.mockReturnValue({
      mutate,
      data: { valid: true, certificate },
      variables: { certificate, signature: SIGNATURE },
      isPending: false,
      isError: false,
    });
    rerender(<BatteryCertificatePanel vehicleId="8" />);
    expect(mutate).toHaveBeenCalledExactlyOnceWith({ certificate: otherCertificate, signature: 'ee'.repeat(32) });
    expect(screen.queryByText('Signature verified')).not.toBeInTheDocument();
  });

  it.each(['request failed', 'signature invalid'])('offers explicit verification recovery after %s without discarding the certificate', (failure) => {
    const mutate = vi.fn();
    mockVerify.mockReturnValue({
      mutate,
      data: failure === 'signature invalid' ? { valid: false } : undefined,
      variables: { certificate, signature: SIGNATURE },
      isPending: false,
      isError: failure === 'request failed',
    });
    const { rerender } = render(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.queryByText('Signature verified')).not.toBeInTheDocument();
    expect(screen.getByText(/Self-verification failed/)).toBeInTheDocument();
    expect(screen.getByText('91.50%')).toBeInTheDocument();
    mutate.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Retry verification' }));
    expect(mutate).toHaveBeenCalledExactlyOnceWith({ certificate, signature: SIGNATURE });

    mockVerify.mockReturnValue({
      mutate,
      data: { valid: true, certificate },
      variables: { certificate, signature: SIGNATURE },
      isPending: false,
      isError: false,
    });
    rerender(<BatteryCertificatePanel vehicleId="7" />);
    expect(screen.getByText('Signature verified')).toBeInTheDocument();
    expect(screen.queryByText(/Self-verification failed/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry verification' })).not.toBeInTheDocument();
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('keeps certificate recovery source-specific when its initial read is denied', async () => {
    const refetch = vi.fn();
    mockCert.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: Object.assign(new Error('Forbidden'), { status: 403 }),
      refetch,
    });
    const { rerender } = render(<MemoryRouter><BatteryCertificatePanel vehicleId="7" /></MemoryRouter>);
    expect(screen.getByText('The battery certificate could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy certificate' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();

    mockCert.mockReturnValue({ data: { certificate, signature: SIGNATURE }, isLoading: false, isError: false, refetch });
    rerender(<MemoryRouter><BatteryCertificatePanel vehicleId="7" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy certificate' })).toBeEnabled());
    expect(screen.getByText('91.50%')).toBeInTheDocument();
    expect(screen.queryByText('The battery certificate could not be loaded.')).not.toBeInTheDocument();
  });

  it('copies complete retained certificate and signature after clipboard denial and explicit recovery', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new DOMException('Clipboard permission denied', 'NotAllowedError'))
      .mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCert.mockReturnValue({
      data: { certificate, signature: SIGNATURE }, isLoading: false, isError: true,
      error: new Error('Refresh failed'), refetch: vi.fn(),
    });
    render(<ToastProvider><BatteryCertificatePanel vehicleId="7" /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Copy certificate' }));
    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    expect(await screen.findByText('Failed to copy')).toBeInTheDocument();
    expect(writeText).toHaveBeenNthCalledWith(1, JSON.stringify(certificate));
    expect(screen.getByText('91.50%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy certificate' })).toBeEnabled();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy certificate' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
    expect(JSON.parse(writeText.mock.calls[1]?.[0] ?? '')).toEqual(certificate);
    fireEvent.click(screen.getByRole('button', { name: 'Copy signature' }));
    await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(3, SIGNATURE));
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
