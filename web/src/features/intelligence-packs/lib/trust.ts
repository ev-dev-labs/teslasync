/**
 * Local trust policy: publisher fingerprints and per-pack trust decisions.
 *
 * IMPORTANT DISTINCTION (see `verifyEnvelope.ts` for where this is wired
 * together): a valid Ed25519 signature proves the signer possesses the
 * private key matching the embedded public key, and that the manifest
 * bytes have not changed since signing. It does NOT prove that key belongs
 * to a publisher you (or anyone) should trust. `KNOWN_PUBLISHER_FINGERPRINTS`
 * below is a small, LOCAL, bundled allowlist of fingerprints this build
 * happens to recognize (e.g. the sample catalog's own signing key) — it is
 * not a certificate authority, not remotely updated, and not a substitute
 * for the user's own judgement.
 */

import type { PackCapabilityId } from './manifestTypes';

/** Groups of 4 hex chars, uppercase, colon-separated — easier for a human to eyeball/compare than a raw 64-char hex blob. */
export function formatFingerprint(hex: string): string {
  if (!hex) return '\u2014';
  const upper = hex.toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < upper.length; i += 4) groups.push(upper.slice(i, i + 4));
  return groups.join(':');
}

export interface KnownPublisher {
  name: string;
  note: string;
}

/**
 * Locally-bundled recognized-publisher allowlist, keyed by lowercase hex
 * SHA-256 fingerprint of the Ed25519 public key. This is intentionally
 * small and shipped with the app build — see
 * `docs/SIGNED_FIXTURE_PROVENANCE.md` for exactly how the one bundled entry
 * (the sample "TeslaSync Labs (Sample Publisher)" catalog key) was
 * generated. Recognizing a fingerprint here means "this build's authors
 * chose to vouch for this specific key" — it is a LOCAL, static decision,
 * never fetched from a network.
 */
export const KNOWN_PUBLISHER_FINGERPRINTS: Readonly<Record<string, KnownPublisher>> = {
  a6bf3419682a8c5d510521cbaf99bbdaaff96af7f984c8e08f5590c6627ab233: {
    name: 'TeslaSync Labs (Sample Publisher)',
    note: 'Bundled sample-catalog signing key. Recognized locally by this build only; not a network-verified CA trust chain.',
  },
};

export function isRecognizedPublisher(fingerprintHex: string | null): KnownPublisher | null {
  if (!fingerprintHex) return null;
  return KNOWN_PUBLISHER_FINGERPRINTS[fingerprintHex.toLowerCase()] ?? null;
}

// ── Per-pack trust decisions (what the USER decided to do about a pack) ──

export type TrustDecisionKind =
  /** Signature valid + fingerprint in the local recognized-publisher list. */
  | 'trusted-signed-recognized'
  /** Signature valid, but the key is not in the local recognized list — user opted to trust it anyway. */
  | 'trusted-signed-unrecognized'
  /** No signature at all — user explicitly opted into the labeled local-development trust flow. */
  | 'trusted-dev-unsigned'
  /** User explicitly blocked this pack (e.g. after seeing signature-invalid). */
  | 'blocked';

export interface TrustDecision {
  packId: string;
  decision: TrustDecisionKind;
  publisherFingerprint: string | null;
  decidedAtIso: string;
  /** Capability ids the user approved as part of this trust decision. */
  approvedCapabilities: PackCapabilityId[];
  note?: string;
}

/** Enabling (or previewing beyond read-only) requires an explicit non-blocked trust decision. */
export function isEnableAllowed(decision: TrustDecision | null): boolean {
  return decision != null && decision.decision !== 'blocked';
}
