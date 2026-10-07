import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExportReportPanel } from './ExportReportPanel';
import { signReport } from '../lib/reportSigner';
import { recordAuditEvent } from '../lib/auditTrail';
import { makeMinimalReport } from '../lib/testFixtures';
import { ALL_EVIDENCE_SECTIONS } from '../lib/constants';
import type { SignedVaultReport, VaultReport } from '../lib/types';

vi.mock('../lib/reportSigner', () => ({ signReport: vi.fn() }));
vi.mock('../lib/auditTrail', () => ({ recordAuditEvent: vi.fn() }));

function completeReport(): VaultReport {
  const base = makeMinimalReport();
  return {
    ...base,
    disclosure: { ...base.disclosure, profileId: 'custom', sections: ALL_EVIDENCE_SECTIONS },
    evidence: {
      ...base.evidence,
      battery: {
        ...base.evidence.battery!,
        capacity_wh: null,
        equivalent_full_cycles: 0,
        degradation_trend: Array.from({ length: 32 }, (_, index) => ({
          date: `2024-01-${String(index % 28 + 1).padStart(2, '0')}`,
          soh_pct: 100 - index / 10,
        })),
        recommendations: Array.from({ length: 24 }, (_, index) => `Recommendation ${index}`),
      },
      maintenance: {
        scheduled_item_count: 3,
        service_record_count: 32,
        categories: ['brakes', 'tires'],
        service_records: Array.from({ length: 32 }, (_, index) => ({
          item_id: `service_${index}`,
          date: `2024-02-${String(index % 28 + 1).padStart(2, '0')}`,
          odometer_m: index === 0 ? null : index * 1000,
          notes: `Service detail ${index}`,
        })),
      },
      software_updates: {
        update_count: 32,
        latest_version: '2024.32',
        installed_versions: Array.from({ length: 32 }, (_, index) => ({
          version: `2024.${index + 1}`,
          installed_at: index === 0 ? null : '2024-02-01',
        })),
      },
      warranty: { fetched_at: null, data: { plan: 'Basic', remaining_distance_m: 0, unknown_expiry: null } },
      driving_history: {
        observed_drive_count: 1000, total_distance_m: 1200000, total_duration_s: 7200,
        avg_efficiency_wh_per_km: null, regen_ratio: 0, co2_saved_kg: 0,
        score_overall: null, score_grade: null, earliest_drive_at: '2023-01-01', latest_drive_at: '2024-02-01',
      },
      charging_history: {
        observed_session_count: 1000, total_energy_added_wh: 245000, fast_charge_session_count: 0,
        avg_peak_power_w: null, total_cost: 0, earliest_session_at: '2023-01-02', latest_session_at: '2024-02-02',
      },
      security_incidents: {
        observed_event_count: 32, acknowledged_count: 0, earliest_event_at: null, latest_event_at: null,
        by_type: Array.from({ length: 32 }, (_, index) => ({ event_type: `event_${index}`, count: 1 })),
      },
    },
    limitations: [...base.limitations, 'Observed records are not a complete lifetime history.'],
  };
}

function signedReport(report: VaultReport): SignedVaultReport {
  return {
    report,
    digest_sha256_hex: 'ab'.repeat(32),
    signature: {
      alg: 'ECDSA_P256_SHA256', key_id: 'key_preserved', signed_at: '2024-03-01T12:00:00Z',
      signature_b64: 'complete-signature',
      public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'full-x', y: 'full-y', key_ops: ['verify'] },
    },
    local_key_status: { persisted: false, revoked: true },
  };
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:vault-preservation');
const revokeObjectURL = vi.fn();
let downloadedName: string;

beforeEach(() => {
  vi.clearAllMocks();
  downloadedName = '';
  vi.mocked(recordAuditEvent).mockImplementation(async (action, detail) => ({
    id: 'audit_mock', ts: '2024-03-01T12:00:00Z', action, detail,
  }));
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloadedName = this.download;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ExportReportPanel preservation', () => {
  it('downloads the entire signed envelope, every selected section and all records without display conversion or truncation', async () => {
    const report = completeReport();
    const signed = signedReport(report);
    vi.mocked(signReport).mockResolvedValueOnce(signed);
    render(<ExportReportPanel report={report} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled());
    expect(signReport).toHaveBeenCalledExactlyOnceWith(report);
    expect(screen.getByText('Signing key session-only')).toBeInTheDocument();
    expect(screen.getByText('Signed with a revoked key')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    await waitFor(() => expect(recordAuditEvent).toHaveBeenCalledWith(
      'report_exported', `Exported signed report ${report.report_id} as JSON.`,
    ));

    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (!blob) throw new Error('Download did not supply a blob');
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await readBlob(blob))).toEqual(signed);
    expect(downloadedName).toBe(`${report.report_id}.json`);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:vault-preservation');
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
  });

  it('retains the previously signed report through a denied re-sign and does not rename it to the changed preview', async () => {
    const first = signedReport(completeReport());
    const next = { ...completeReport(), report_id: 'report_next_selection' };
    const onSigned = vi.fn();
    vi.mocked(signReport).mockResolvedValueOnce(first);
    const { rerender } = render(<ExportReportPanel report={first.report} onSigned={onSigned} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledOnce());

    rerender(<ExportReportPanel report={next} onSigned={onSigned} />);
    vi.mocked(signReport).mockRejectedValueOnce(new DOMException('Signing permission denied', 'NotAllowedError'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    expect(await screen.findByText('Signing permission denied')).toBeInTheDocument();
    expect(screen.getByText(first.digest_sha256_hex)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
    expect(onSigned).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    await waitFor(() => expect(downloadedName).toBe(`${first.report.report_id}.json`));
    const blob = createObjectURL.mock.calls[0]?.[0];
    if (!blob) throw new Error('Retained signed report did not download');
    expect(JSON.parse(await readBlob(blob))).toEqual(first);
    expect(recordAuditEvent).toHaveBeenCalledWith('report_exported', `Exported signed report ${first.report.report_id} as JSON.`);
    expect(screen.queryByText('Signing permission denied')).not.toBeInTheDocument();

    const recovered = signedReport(next);
    vi.mocked(signReport).mockResolvedValueOnce(recovered);
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(onSigned).toHaveBeenLastCalledWith(recovered));
    expect(signReport).toHaveBeenLastCalledWith(next);
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    await waitFor(() => expect(downloadedName).toBe(`${next.report_id}.json`));
  });

  it('keeps signing caller-driven, prevents duplicate pending actions and recovers from an initial denial', async () => {
    let rejectSign: (reason: Error) => void = () => { throw new Error('Signing was not started'); };
    vi.mocked(signReport).mockImplementationOnce(() => new Promise((_, reject) => { rejectSign = reject; }));
    const report = completeReport();
    render(<ExportReportPanel report={report} />);
    expect(signReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    expect(signReport).toHaveBeenCalledOnce();
    await act(async () => rejectSign(new Error('Key access denied')));
    expect(screen.getByText('Key access denied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled();
    expect(createObjectURL).not.toHaveBeenCalled();

    vi.mocked(signReport).mockResolvedValueOnce(signedReport(report));
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled());
    expect(screen.queryByText('Key access denied')).not.toBeInTheDocument();
  });

  it('retains the signed report and releases the object URL after a failed download, allowing an explicit retry', async () => {
    const signed = signedReport(completeReport());
    vi.mocked(signReport).mockResolvedValueOnce(signed);
    render(<ExportReportPanel report={signed.report} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled());

    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {
      throw new DOMException('Download blocked', 'NotAllowedError');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    expect(await screen.findByText('Download blocked')).toBeInTheDocument();
    expect(screen.getByText(signed.digest_sha256_hex)).toBeInTheDocument();
    expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(recordAuditEvent).not.toHaveBeenCalledWith('report_exported', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    await waitFor(() => expect(recordAuditEvent).toHaveBeenCalledWith('report_exported', `Exported signed report ${signed.report.report_id} as JSON.`));
    expect(screen.queryByText('Download blocked')).not.toBeInTheDocument();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(signReport).toHaveBeenCalledOnce();
  });
});
