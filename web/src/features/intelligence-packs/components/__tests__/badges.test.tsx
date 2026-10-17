import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { CatalogCard } from '../CatalogCard';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
import type { VerificationResult } from '../../lib/verifyEnvelope';
import { isAppVersionCompatible } from '../../lib/compatibility';

const verification = vi.hoisted(() => ({
  data: undefined as VerificationResult | undefined,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock('../../hooks/usePackVerification', () => ({
  usePackVerification: () => verification,
}));

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
  it('renders unsigned copy only when the envelope has no signature', () => {
    render(<PublisherFingerprintDisplay fingerprintHex={null} hasSignature={false} />);
    expect(screen.getByText(/unsigned/i)).toBeInTheDocument();
  });

  describe('CatalogCard fingerprint state', () => {
    beforeEach(() => {
      verification.data = undefined;
      verification.isLoading = false;
      verification.error = null;
    });

    function renderCard(signature = EFFICIENCY_INSIGHTS_ENVELOPE.signature) {
      return render(
        <CatalogCard
          entry={{
            envelope: { ...EFFICIENCY_INSIGHTS_ENVELOPE, signature },
            sourceNote: '',
            installedVersion: null,
            isUpToDate: false,
          }}
          onOpenDetail={vi.fn()}
        />,
      );
    }

    it('does not call a signed pack unsigned while checking its fingerprint', () => {
      verification.isLoading = true;
      renderCard();
      expect(screen.getAllByText(/Checking signature/i)).toHaveLength(2);
      expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
    });

    it('does not infer unsigned from an empty signing key', () => {
      const signature = EFFICIENCY_INSIGHTS_ENVELOPE.signature;
      if (!signature) throw new Error('Expected a signed test fixture');
      verification.data = baseResult({ status: 'signature-invalid' });
      renderCard({ ...signature, publicKeyBase64: '' });
      expect(screen.getAllByText(/Signature invalid/i)).toHaveLength(2);
      expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
    });

    it('passes verification errors through when a fingerprint is unavailable', () => {
      verification.error = new Error('Web Crypto unavailable');
      renderCard();
      expect(screen.getAllByText(/Verification unavailable on this browser/i)).toHaveLength(2);
      expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
    });

    it('renders unsigned fingerprint copy for an actually unsigned envelope', () => {
      renderCard(null);
      expect(screen.getByText('No signing key (unsigned)')).toBeInTheDocument();
    });

    it('renders the recomputed fingerprint of a valid signed pack', () => {
      verification.data = baseResult({
        status: 'signature-valid',
        recomputedPublisherFingerprint: 'ab'.repeat(32),
        recognizedPublisherName: 'TeslaSync Labs',
      });
      renderCard();
      expect(screen.getByText(/ABAB:ABAB/)).toBeInTheDocument();
      expect(screen.getByText('Recognized: TeslaSync Labs')).toBeInTheDocument();
      expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
    });
  });

  it('does not infer unsigned from a missing fingerprint or unknown signature presence', () => {
    render(<PublisherFingerprintDisplay fingerprintHex={null} />);
    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
  });

  it('shows pending verification for a signed envelope', () => {
    render(<PublisherFingerprintDisplay fingerprintHex={null} hasSignature isLoading />);
    expect(screen.getByText(/Checking signature/i)).toBeInTheDocument();
    expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
  });

  it.each(['signature-invalid', 'digest-mismatch', 'crypto-unavailable', 'ed25519-unsupported'] as const)(
    'does not label a signed envelope unsigned when verification returns %s without a fingerprint',
    (status) => {
      render(<PublisherFingerprintDisplay fingerprintHex={null} hasSignature verificationResult={baseResult({ status })} />);
      expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
      expect(screen.queryByText('Not verified')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Copy fingerprint/i })).not.toBeInTheDocument();
    },
  );

  it.each([new Error('boom'), new Error('Ed25519 algorithm not supported')])(
    'surfaces a verification error instead of unsigned copy: %s',
    (error) => {
      render(<PublisherFingerprintDisplay fingerprintHex={null} hasSignature error={error} />);
      expect(screen.getByText(/Verification failed|Verification unavailable/i)).toBeInTheDocument();
      expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
    },
  );

  it.each(['', 'not-hex', '0', '0.5', 'ab'.repeat(31), 'gg'.repeat(32)])(
    'does not display or copy an invalid fingerprint: %s',
    (fingerprintHex) => {
      render(<PublisherFingerprintDisplay fingerprintHex={fingerprintHex} hasSignature />);
      expect(screen.getByText('Not verified')).toBeInTheDocument();
      expect(screen.queryByText(/unsigned/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Copy fingerprint/i })).not.toBeInTheDocument();
    },
  );

  it('preserves a valid all-zero fingerprint rather than treating it as missing', () => {
    render(<PublisherFingerprintDisplay fingerprintHex={'0'.repeat(64)} hasSignature verificationResult={baseResult({ status: 'signature-valid' })} />);
    expect(screen.getByText(Array(16).fill('0000').join(':'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy fingerprint/i })).toBeInTheDocument();
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
  beforeEach(() => {
    vi.stubEnv('VITE_APP_VERSION', '1.2.3');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['', 'dev', 'not-a-version'])('shows skipped compatibility neutrally without blocking for app version "%s"', (appVersion) => {
    vi.stubEnv('VITE_APP_VERSION', appVersion);
    const compat = { minAppVersion: '99.0.0', maxAppVersion: null };
    render(<CompatibilityBadge compat={compat} />);

    expect(screen.getByText('Not verified')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getByText(/compatibility check skipped/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Compatible$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Incompatible$/i)).not.toBeInTheDocument();
    expect(isAppVersionCompatible(compat, appVersion || 'dev').compatible).toBe(true);
  });

  it('shows compatible for a satisfied range', () => {
    render(<CompatibilityBadge compat={{ minAppVersion: '0.0.1', maxAppVersion: null }} />);
    expect(screen.getByText(/^Compatible$/i)).toHaveClass('text-[var(--semantic-success)]');
    expect(screen.getByText('Compatible with app version 1.2.3.')).toBeInTheDocument();
  });

  it.each([
    { minAppVersion: '2.0.0', maxAppVersion: null },
    { minAppVersion: '0.0.1', maxAppVersion: '1.2.2' },
    { minAppVersion: '0.0.1', maxAppVersion: 'not-a-version' },
  ])('shows incompatible for an unsatisfied or invalid range: %j', (compat) => {
    render(<CompatibilityBadge compat={compat} />);
    expect(screen.getByText(/^Incompatible$/i)).toHaveClass('text-[var(--semantic-danger)]');
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
