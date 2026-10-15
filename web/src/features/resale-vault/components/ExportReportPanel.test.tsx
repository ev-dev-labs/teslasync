import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExportReportPanel } from './ExportReportPanel';
import { makeMinimalReport } from '../lib/testFixtures';
import { __resetKeyRepositoryForTests } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { VaultEvidenceSource } from '../hooks/useVaultEvidence';
import * as reportSigner from '../lib/reportSigner';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: 'de-DE',
    settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles' },
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
}));
vi.mock('@/lib/timezone', async () => vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone'));

function batterySource(query: DataStateSource<unknown>): VaultEvidenceSource {
  const state = deriveDataState(query);
  return { id: 'battery', section: 'battery', labelKey: 'resaleVault.battery.title', label: 'Battery health', loading: state.status === 'initial', state };
}

describe('ExportReportPanel', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    __resetKeyRepositoryForTests();
    __resetAuditTrailForTests();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock-url');
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  });

  it('signs the report and shows digest/key-id/signed-at summary', async () => {
    const onSigned = vi.fn();
    render(<ExportReportPanel report={makeMinimalReport()} onSigned={onSigned} />);

    fireEvent.click(screen.getByRole('button', { name: /sign report/i }));

    await waitFor(() => expect(screen.getByText(/SHA-256 digest:/i)).toBeInTheDocument());
    expect(onSigned).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /download json/i })).not.toBeDisabled();
  });

  it('disables the download button until a report has been signed', () => {
    render(<ExportReportPanel report={makeMinimalReport()} />);
    expect(screen.getByRole('button', { name: /download json/i })).toBeDisabled();
  });

  it('triggers a download after signing', async () => {
    render(<ExportReportPanel report={makeMinimalReport()} />);
    fireEvent.click(screen.getByRole('button', { name: /sign report/i }));
    await waitFor(() => expect(screen.getByText(/SHA-256 digest:/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /download json/i }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it('always renders the digest-is-not-a-signature disclaimer', () => {
    render(<ExportReportPanel report={makeMinimalReport()} />);
    expect(screen.getByText(/does not prove who created the report/i)).toBeInTheDocument();
  });

  it.each([
    ['active first load', { isLoading: true, fetchStatus: 'fetching' as const }],
    ['paused first load', { isPending: true, fetchStatus: 'paused' as const }],
  ])('blocks signing for %s without classifying it as empty', (_, query) => {
    render(<ExportReportPanel report={makeMinimalReport()} sources={[batterySource(query)]} />);
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled();
  });

  it.each([{ data: [] }, { data: { soh_pct: 0 } }, { data: null }])('allows a successful empty/zero response: %j', async ({ data }) => {
    const onSigned = vi.fn();
    const report = makeMinimalReport();
    if (data != null && !Array.isArray(data)) report.evidence.battery!.soh_pct = data.soh_pct;
    render(<ExportReportPanel report={report} sources={[batterySource({ data, isSuccess: true })]} onSigned={onSigned} />);
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledOnce());
    expect(onSigned.mock.calls[0][0].report.limitations.join(' ')).toContain('status=ok; retained=true');
    expect(onSigned.mock.calls[0][0].report.evidence.battery?.soh_pct).toBe(report.evidence.battery?.soh_pct);
  });

  it.each([
    { data: { soh_pct: 95 }, error: new Error('Refresh denied') },
    { data: { soh_pct: 95 }, fetchStatus: 'paused' as const },
    { data: { soh_pct: 95 }, isFetching: true },
    { error: new Error('First read failed') },
  ])('requires intentional acknowledgment for retained/partial evidence: %j', async (query) => {
    const onSigned = vi.fn();
    const report = makeMinimalReport();
    const { rerender } = render(<ExportReportPanel report={report} sources={[batterySource(query)]} onSigned={onSigned} />);
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Included with warning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledOnce());
    expect(onSigned.mock.calls[0][0].report.evidence.battery).toEqual(report.evidence.battery);
    expect(onSigned.mock.calls[0][0].report.limitations.join(' ')).toContain('Source readiness: battery/battery');
    rerender(<ExportReportPanel report={report} sources={[batterySource({ data: {}, isSuccess: true })]} onSigned={onSigned} />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled();
    rerender(<ExportReportPanel report={report} sources={[batterySource(query)]} onSigned={onSigned} />);
    // Acknowledgment is bound to the exact report/readiness snapshot.
    rerender(<ExportReportPanel report={{ ...report, report_id: 'changed' }} sources={[batterySource(query)]} onSigned={onSigned} />);
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
  });

  it('ignores unresolved sources excluded by disclosure', () => {
    render(<ExportReportPanel report={makeMinimalReport()} sources={[{
      ...batterySource({ isPending: true }), section: 'security_incidents',
    }]} />);
    expect(screen.getByRole('button', { name: 'Sign report' })).toBeEnabled();
  });

  it('keeps the signed bytes and original disclosure through refresh failure, recovery and a changed preview', async () => {
    const report = makeMinimalReport();
    const onSigned = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const healthy = batterySource({ data: { soh_pct: 94.2 }, isSuccess: true, dataUpdatedAt: 1000 });
    const { rerender } = render(<ExportReportPanel report={report} sources={[healthy]} onSigned={onSigned} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledOnce());
    const original = structuredClone(onSigned.mock.calls[0][0]);
    const changed = makeMinimalReport({ report_id: 'new-preview' });
    changed.disclosure.profileId = 'custom';
    changed.disclosure.sections = [];
    changed.time_bounds.earliest_evidence_at = '2026-01-01';

    for (const sources of [
      [batterySource({ data: {}, error: new Error('Refresh denied'), dataUpdatedAt: 1000 })],
      [batterySource({ data: {}, isSuccess: true, dataUpdatedAt: 2000 })],
    ]) {
      rerender(<ExportReportPanel report={report} sources={sources} onSigned={onSigned} />);
      expect(screen.getByText(/belongs to an older preview/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
    }
    rerender(<ExportReportPanel report={changed} sources={[healthy]} onSigned={onSigned} />);
    expect(screen.getByText(original.report.report_id)).toBeInTheDocument();
    expect(screen.getByText(`Disclosure profile: ${original.report.disclosure.profileId}`)).toBeInTheDocument();
    expect(screen.getByText(`Evidence sections: ${original.report.disclosure.sections.join(', ')}`)).toBeInTheDocument();
    expect(screen.getByText(/Evidence window:/)).toHaveTextContent(original.report.time_bounds.earliest_evidence_at);
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    expect(click).toHaveBeenCalledOnce();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0];
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob as Blob);
    });
    expect(JSON.parse(text)).toEqual(original);
    expect(onSigned).toHaveBeenCalledOnce();
  });

  it('detaches the signed snapshot before asynchronous signing and from callback mutations', async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const sign = vi.spyOn(reportSigner, 'signReport').mockImplementation(async (snapshot) => {
      await pending;
      return {
        report: snapshot, digest_sha256_hex: 'abc',
        signature: { alg: 'ECDSA_P256_SHA256', key_id: 'key', public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, signature_b64: 'sig', signed_at: '2024-01-01T00:30:00Z' },
        local_key_status: { persisted: false, revoked: false },
      };
    });
    const report = makeMinimalReport();
    const onSigned = vi.fn((result) => { result.report.report_id = 'callback_mutation'; });
    const { rerender } = render(<ExportReportPanel report={report} onSigned={onSigned} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    report.evidence.battery!.soh_pct = 0;
    report.limitations.push('late mutation');
    rerender(<ExportReportPanel report={makeMinimalReport({ report_id: 'new_preview' })} onSigned={onSigned} />);
    release();
    await waitFor(() => expect(onSigned).toHaveBeenCalledOnce());
    expect(sign.mock.calls[0][0].evidence.battery?.soh_pct).toBe(94.2);
    expect(sign.mock.calls[0][0].limitations).not.toContain('late mutation');
    expect(screen.getByText('report_test_0001')).toBeInTheDocument();
    expect(screen.queryByText('callback_mutation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0];
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob as Blob);
    });
    const downloaded = JSON.parse(text);
    expect(downloaded.report.report_id).toBe('report_test_0001');
    expect(downloaded.report.evidence.battery.soh_pct).toBe(94.2);
    expect(downloaded.report.limitations).not.toContain('late mutation');
    expect(downloaded.signature.signed_at).toBe('2024-01-01T00:30:00Z');
    expect(downloaded.report.time_bounds.earliest_evidence_at).toBe('2022-06-01');
  });

  it.each([
    ['2026-01-01T00:30:00Z', '31. Dez. 2025, 16:30'],
    ['2026-07-01T00:30:00Z', '30. Juni 2026, 17:30'],
    ['2026-01-01', '1. Jan. 2026'],
    ['2026-02-30', '—'],
    ['invalid', '—'],
    ['', '—'],
  ])('localizes signed instants without rewriting the signed timestamp %s', async (signed_at, expected) => {
    vi.spyOn(reportSigner, 'signReport').mockImplementation(async (report) => ({
      report, digest_sha256_hex: 'abc',
      signature: {
        alg: 'ECDSA_P256_SHA256', key_id: 'key',
        public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
        signature_b64: 'sig', signed_at,
      },
      local_key_status: { persisted: false, revoked: false },
    }));
    const report = makeMinimalReport();
    const onSigned = vi.fn();
    render(<ExportReportPanel report={report} onSigned={onSigned} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledOnce());
    expect(screen.getByText('Signed at:').parentElement).toHaveTextContent(`Signed at: ${expected}`);
    expect(onSigned.mock.calls[0][0].signature.signed_at).toBe(signed_at);
    expect(onSigned.mock.calls[0][0].report).toEqual(report);
  });

  it('localizes source freshness only in the preview and keeps calendar evidence and signed provenance unchanged', async () => {
    const report = makeMinimalReport();
    report.evidence.warranty = { fetched_at: '2026-01-01T00:30:00Z', data: { expiry_date: '2026-01-01' } };
    const source = batterySource({
      data: {}, error: new Error('Refresh failed'), dataUpdatedAt: Date.parse('2026-01-01T00:30:00Z'),
    });
    const onSigned = vi.fn();
    render(<ExportReportPanel report={report} sources={[source]} onSigned={onSigned} />);
    expect(screen.getByText(/last successful load=31\. Dez\. 2025, 16:30/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Included with warning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign report' }));
    await waitFor(() => expect(onSigned).toHaveBeenCalledOnce());
    expect(onSigned.mock.calls[0][0].report.limitations.join(' ')).toContain('last successful load=2026-01-01T00:30:00.000Z');
    expect(onSigned.mock.calls[0][0].report.evidence.warranty).toEqual(report.evidence.warranty);
    expect(report.evidence.warranty.data?.expiry_date).toBe('2026-01-01');
  });
});
