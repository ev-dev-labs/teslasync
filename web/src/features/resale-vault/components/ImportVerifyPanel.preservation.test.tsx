import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportVerifyPanel } from './ImportVerifyPanel';
import { verifyReport } from '../lib/reportVerifier';
import { recordAuditEvent } from '../lib/auditTrail';
import { makeMinimalReport } from '../lib/testFixtures';
import type { SignedVaultReport, VerificationResult } from '../lib/types';

vi.mock('../lib/reportVerifier', () => ({ verifyReport: vi.fn() }));
vi.mock('../lib/auditTrail', () => ({ recordAuditEvent: vi.fn() }));

function signedReport(id: string): SignedVaultReport {
  return {
    report: makeMinimalReport({ report_id: id }), digest_sha256_hex: 'digest',
    signature: {
      alg: 'ECDSA_P256_SHA256', key_id: `key_${id}`,
      public_key_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      signature_b64: 'signature', signed_at: '2024-01-01T00:00:00Z',
    },
    local_key_status: { persisted: false, revoked: false },
  };
}

function verification(id: string): VerificationResult {
  return {
    digestMatches: true, signatureValid: true, valid: true, keyId: `key_${id}`,
    isKnownLocalKey: false, localKeyRevoked: null, errors: [], attestationNote: 'A signature is not proof of identity.',
  };
}

function jsonFile(report: SignedVaultReport): File {
  const file = new File([], `${report.report.report_id}.json`, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(JSON.stringify(report)) });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recordAuditEvent).mockImplementation(async (action, detail) => ({
    id: 'audit_mock', ts: '2024-01-01T00:00:00Z', action, detail,
  }));
});

describe('ImportVerifyPanel preservation', () => {
  it('recovers from a denied local verification by reselecting the same file and distinguishes cryptographic validity from revoked-key trust', async () => {
    const report = signedReport('report_retry');
    const file = jsonFile(report);
    vi.mocked(verifyReport).mockRejectedValueOnce(new DOMException('Verification permission denied', 'NotAllowedError'));
    render(<ImportVerifyPanel />);
    const input = screen.getByLabelText('Choose report file');
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('Verification permission denied')).toBeInTheDocument();
    expect(screen.queryByText('All checks passed')).not.toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(input).toBeEnabled();
    expect(recordAuditEvent).not.toHaveBeenCalled();

    vi.mocked(verifyReport).mockResolvedValueOnce({
      ...verification('report_retry'), isKnownLocalKey: true, localKeyRevoked: true,
    });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('All checks passed')).toBeInTheDocument();
    expect(screen.getByText('Signed with a locally-known, revoked key')).toBeInTheDocument();
    expect(screen.getByText('Digest matches')).toBeInTheDocument();
    expect(screen.getByText('Signature valid')).toBeInTheDocument();
    expect(screen.getByText('Report ID: report_retry')).toBeInTheDocument();
    expect(screen.queryByText('Verification permission denied')).not.toBeInTheDocument();
    expect(verifyReport).toHaveBeenNthCalledWith(2, report);
    await waitFor(() => expect(recordAuditEvent).toHaveBeenCalledWith(
      'report_verified', 'Verified imported report report_retry: valid.',
    ));
    expect(screen.getByText(/does not prove who created the report/)).toBeInTheDocument();
    expect(screen.getByText(/does NOT verify the identity/)).toBeInTheDocument();
  });

  it.each(['success', 'denial'])('ignores an older %s while a newly selected report is still pending', async (outcome) => {
    let resolveOld: (value: VerificationResult) => void = () => { throw new Error('Old verification did not start'); };
    let rejectOld: (error: Error) => void = () => { throw new Error('Old verification did not start'); };
    let resolveNew: (value: VerificationResult) => void = () => { throw new Error('New verification did not start'); };
    vi.mocked(verifyReport)
      .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    render(<ImportVerifyPanel />);
    const input = screen.getByLabelText('Choose report file');
    fireEvent.change(input, { target: { files: [jsonFile(signedReport('report_old'))] } });
    await waitFor(() => expect(verifyReport).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { files: [jsonFile(signedReport('report_new'))] } });
    await waitFor(() => expect(verifyReport).toHaveBeenCalledTimes(2));
    await act(async () => {
      if (outcome === 'success') resolveOld(verification('report_old'));
      else rejectOld(new Error('Old verification denied'));
    });
    expect(screen.getByText('Verifying…')).toBeInTheDocument();
    expect(screen.queryByText('All checks passed')).not.toBeInTheDocument();
    expect(screen.queryByText('Old verification denied')).not.toBeInTheDocument();
    expect(screen.queryByText('Key ID: key_report_old')).not.toBeInTheDocument();
    expect(recordAuditEvent).not.toHaveBeenCalled();

    await act(async () => resolveNew(verification('report_new')));
    expect(screen.getByText('All checks passed')).toBeInTheDocument();
    expect(screen.getByText('Report ID: report_new')).toBeInTheDocument();
    expect(screen.getByText('Key ID: key_report_new')).toBeInTheDocument();
    expect(screen.queryByText('Verifying…')).not.toBeInTheDocument();
    expect(recordAuditEvent).toHaveBeenCalledTimes(2);
  });

  it('does not replace the latest verified report when an older file read completes afterwards', async () => {
    const old = jsonFile(signedReport('report_old_read'));
    let resolveText: (value: string) => void = () => { throw new Error('File read did not start'); };
    vi.mocked(old.text).mockImplementationOnce(() => new Promise((resolve) => { resolveText = resolve; }));
    vi.mocked(verifyReport).mockResolvedValueOnce(verification('report_current'));
    render(<ImportVerifyPanel />);
    const input = screen.getByLabelText('Choose report file');
    fireEvent.change(input, { target: { files: [old] } });
    fireEvent.change(input, { target: { files: [jsonFile(signedReport('report_current'))] } });
    expect(await screen.findByText('Report ID: report_current')).toBeInTheDocument();
    await act(async () => resolveText(JSON.stringify(signedReport('report_old_read'))));
    expect(screen.getByText('Report ID: report_current')).toBeInTheDocument();
    expect(screen.getByText('Key ID: key_report_current')).toBeInTheDocument();
    expect(verifyReport).toHaveBeenCalledOnce();
    expect(recordAuditEvent).not.toHaveBeenCalledWith('report_imported', expect.stringContaining('report_old_read'));
  });
});
