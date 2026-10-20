import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportVerifyPanel } from './ImportVerifyPanel';
import { signReport } from '../lib/reportSigner';
import { makeMinimalReport } from '../lib/testFixtures';
import {
  __resetKeyRepositoryForTests,
  generateSigningKey,
  revokeSigningKey,
} from '../lib/signingKeyRepository';
import { verifyReport } from '../lib/reportVerifier';
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

  it.each([false, true])('keeps an external signature valid and unknown despite a local key ID collision (revoked: %s)', async (revoked) => {
    const external = await signReport(makeMinimalReport());
    __resetKeyRepositoryForTests();
    const local = await generateSigningKey();
    if (revoked) await revokeSigningKey(local.key_id, 'Regression test');
    const imported: SignedVaultReport = {
      ...external,
      signature: { ...external.signature, key_id: local.key_id },
    };

    expect(await verifyReport(imported)).toMatchObject({
      valid: true,
      signatureValid: true,
      isKnownLocalKey: false,
      localKeyRevoked: null,
      errors: [],
    });
    render(<ImportVerifyPanel />);
    fireEvent.change(screen.getByLabelText(/choose report file/i), {
      target: { files: [jsonFile(imported)] },
    });

    expect(await screen.findByText(/all checks passed/i)).toBeInTheDocument();
    expect(screen.getByText('Signature valid')).toBeInTheDocument();
    expect(screen.queryByText(/known to this browser|locally-known, revoked/i)).not.toBeInTheDocument();
  });

  it.each([false, true])('recognizes the same public key despite a changed ID and optional JWK metadata (revoked: %s)', async (revoked) => {
    const signed = await signReport(makeMinimalReport());
    if (revoked) await revokeSigningKey(signed.signature.key_id, 'Regression test');
    const { kty, crv, x, y } = signed.signature.public_key_jwk;
    const imported: SignedVaultReport = {
      ...signed,
      signature: {
        ...signed.signature,
        key_id: 'external-key-alias',
        public_key_jwk: { y, x, crv, kty },
      },
    };

    expect(await verifyReport(imported)).toMatchObject({
      valid: true,
      signatureValid: true,
      isKnownLocalKey: true,
      localKeyRevoked: revoked,
    });
    render(<ImportVerifyPanel />);
    fireEvent.change(screen.getByLabelText(/choose report file/i), {
      target: { files: [jsonFile(imported)] },
    });

    expect(await screen.findByText(/all checks passed/i)).toBeInTheDocument();
    expect(screen.getByText(revoked
      ? 'Signed with a locally-known, revoked key'
      : 'Signed with a key known to this browser')).toBeInTheDocument();
  });

  it('does not label a failed signature as signed by a recognized local key', async () => {
    const signed = await signReport(makeMinimalReport());
    const tampered: SignedVaultReport = {
      ...signed,
      report: { ...signed.report, report_id: 'tampered-local-report' },
    };
    render(<ImportVerifyPanel />);
    fireEvent.change(screen.getByLabelText(/choose report file/i), {
      target: { files: [jsonFile(tampered)] },
    });

    expect(await screen.findByText(/some checks failed/i)).toBeInTheDocument();
    expect(screen.getByText('Signature invalid')).toBeInTheDocument();
    expect(screen.queryByText(/known to this browser/i)).not.toBeInTheDocument();
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
