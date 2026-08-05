import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportVerifyPanel } from './ImportVerifyPanel';
import { signReport } from '../lib/reportSigner';
import { makeMinimalReport } from '../lib/testFixtures';
import { __resetKeyRepositoryForTests } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';
import type { SignedVaultReport } from '../lib/types';

function jsonFile(data: unknown, name = 'report.json'): File {
  return new File([JSON.stringify(data)], name, { type: 'application/json' });
}

describe('ImportVerifyPanel', () => {
  beforeEach(() => {
    __resetKeyRepositoryForTests();
    __resetAuditTrailForTests();
  });

  it('shows the empty state before any file is imported', () => {
    render(<ImportVerifyPanel />);
    expect(screen.getByText(/no report imported yet/i)).toBeInTheDocument();
  });

  it('imports and verifies a validly-signed report as valid', async () => {
    const signed: SignedVaultReport = await signReport(makeMinimalReport());
    render(<ImportVerifyPanel />);

    const input = screen.getByLabelText(/choose report file/i);
    fireEvent.change(input, { target: { files: [jsonFile(signed)] } });

    expect(await screen.findByText(/all checks passed/i)).toBeInTheDocument();
    expect(screen.getByText(/digest matches/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(signed.signature.key_id, 'i'))).toBeInTheDocument();
    // Signed by a key generated in this same browser session/registry.
    expect(screen.getByText(/known to this browser/i)).toBeInTheDocument();
  });

  it('flags a tampered report as invalid with a digest mismatch error', async () => {
    const signed = await signReport(makeMinimalReport());
    const tampered: SignedVaultReport = {
      ...signed,
      report: { ...signed.report, report_id: 'report_tampered_0001' },
    };
    render(<ImportVerifyPanel />);

    const input = screen.getByLabelText(/choose report file/i);
    fireEvent.change(input, { target: { files: [jsonFile(tampered)] } });

    expect(await screen.findByText(/some checks failed/i)).toBeInTheDocument();
    expect(screen.getByText('Digest mismatch')).toBeInTheDocument();
  });

  it('rejects a file that is not valid JSON', async () => {
    render(<ImportVerifyPanel />);
    const input = screen.getByLabelText(/choose report file/i);
    fireEvent.change(input, { target: { files: [new File(['not json'], 'bad.json', { type: 'application/json' })] } });

    expect(await screen.findByText(/not valid json/i)).toBeInTheDocument();
  });

  it('rejects a file with the wrong shape', async () => {
    render(<ImportVerifyPanel />);
    const input = screen.getByLabelText(/choose report file/i);
    fireEvent.change(input, { target: { files: [jsonFile({ hello: 'world' })] } });

    expect(await screen.findByText(/does not look like a signed vault report/i)).toBeInTheDocument();
  });

  it('always renders the digest-is-not-a-signature and local-attestation notes', () => {
    render(<ImportVerifyPanel />);
    expect(screen.getByText(/does not prove who created the report/i)).toBeInTheDocument();
    expect(screen.getByText(/generated and held in a browser/i)).toBeInTheDocument();
  });
});
