import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
// Real i18n init (mirrors the app's main.tsx side effect) so `{{name}}`
// interpolation is exercised for real rather than left as a literal token —
// see web/src/types/vehicle.test.tsx for the established precedent.
import '@/i18n';

import { VerificationStatusBadge } from '../VerificationStatusBadge';
import { PublisherFingerprintDisplay } from '../PublisherFingerprintDisplay';
import { CapabilityRequestList } from '../CapabilityRequestList';
import { CompatibilityBadge } from '../CompatibilityBadge';
import { TrustDistinctionNote } from '../TrustDistinctionNote';
import type { VerificationResult } from '../../lib/verifyEnvelope';

function baseResult(overrides: Partial<VerificationResult>): VerificationResult {
  return {
    status: 'unsigned',
    recomputedDigestSha256Hex: 'a'.repeat(64),
    recomputedPublisherFingerprint: null,
    claimedFingerprintMismatch: false,
    recognizedPublisherName: null,
    summary: 'summary',
    ...overrides,
  };
}

describe('VerificationStatusBadge', () => {
  it('shows a checking state while loading', () => {
    render(<VerificationStatusBadge result={undefined} isLoading />);
    expect(screen.getByText(/Checking signature/i)).toBeInTheDocument();
  });

  it('shows a platform-unsupported message for Ed25519UnsupportedError', () => {
    render(<VerificationStatusBadge result={undefined} error={new Error('Ed25519 algorithm not supported')} />);
    expect(screen.getByText(/Verification unavailable on this browser/i)).toBeInTheDocument();
  });

  it('shows a generic error for a non-platform error', () => {
    render(<VerificationStatusBadge result={undefined} error={new Error('boom')} />);
    expect(screen.getByText(/Verification failed/i)).toBeInTheDocument();
  });

  it('distinguishes recognized vs unrecognized signed publishers', () => {
    const { rerender } = render(
      <VerificationStatusBadge result={baseResult({ status: 'signature-valid', recognizedPublisherName: 'TeslaSync Labs' })} />,
    );
    expect(screen.getByText(/recognized publisher/i)).toBeInTheDocument();

    rerender(<VerificationStatusBadge result={baseResult({ status: 'signature-valid', recognizedPublisherName: null })} />);
    expect(screen.getByText(/unrecognized publisher/i)).toBeInTheDocument();
  });

  it('renders "do not trust" copy for signature-invalid', () => {
    render(<VerificationStatusBadge result={baseResult({ status: 'signature-invalid' })} />);
    expect(screen.getByText(/do not trust/i)).toBeInTheDocument();
  });

  it('renders digest-mismatch distinctly from signature-invalid', () => {
    render(<VerificationStatusBadge result={baseResult({ status: 'digest-mismatch' })} />);
    expect(screen.getByText(/digest mismatch/i)).toBeInTheDocument();
  });
});

describe('PublisherFingerprintDisplay', () => {
  it('renders "no signing key" when fingerprint is null', () => {
    render(<PublisherFingerprintDisplay fingerprintHex={null} />);
    expect(screen.getByText(/unsigned/i)).toBeInTheDocument();
  });

  it('renders a grouped fingerprint and a recognized badge', () => {
    render(<PublisherFingerprintDisplay fingerprintHex={'ab'.repeat(32)} recognizedName="TeslaSync Labs" />);
    expect(screen.getByText(/Recognized: TeslaSync Labs/i)).toBeInTheDocument();
    expect(screen.getByText(/ABAB:ABAB/)).toBeInTheDocument();
  });

  it('flags a claimed-fingerprint mismatch', () => {
    render(<PublisherFingerprintDisplay fingerprintHex={'ab'.repeat(32)} claimedMismatch />);
    expect(screen.getByText(/does not match/i)).toBeInTheDocument();
  });
});

describe('CapabilityRequestList', () => {
  it('renders a "no capabilities" message for an empty list', () => {
    render(<CapabilityRequestList capabilityIds={[]} />);
    expect(screen.getByText(/requests no capabilities/i)).toBeInTheDocument();
  });

  it('renders granted/denied badges when a granted set is supplied', () => {
    render(<CapabilityRequestList capabilityIds={['read:telemetry-sample', 'read:battery-sample']} granted={new Set(['read:telemetry-sample'])} />);
    expect(screen.getByText('Granted')).toBeInTheDocument();
    expect(screen.getByText('Denied')).toBeInTheDocument();
  });
});

describe('CompatibilityBadge', () => {
  it('shows compatible for a satisfied range', () => {
    render(<CompatibilityBadge compat={{ minAppVersion: '0.0.1', maxAppVersion: null }} />);
    expect(screen.getByText(/^Compatible$/i)).toBeInTheDocument();
  });

  it('shows incompatible for an invalid minAppVersion', () => {
    render(<CompatibilityBadge compat={{ minAppVersion: 'not-a-version', maxAppVersion: null }} />);
    expect(screen.getByText(/^Incompatible$/i)).toBeInTheDocument();
  });
});

describe('TrustDistinctionNote', () => {
  it('renders the key-possession-vs-trust distinction', () => {
    render(<TrustDistinctionNote />);
    expect(screen.getByText(/does not prove/i)).toBeInTheDocument();
  });
});
