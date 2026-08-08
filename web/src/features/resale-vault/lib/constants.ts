/**
 * Warranty & Resale Vault — shared constants.
 *
 * Kept in one place so the report schema version, app version tag, and
 * disclosure-profile catalog are each defined exactly once and imported
 * everywhere else in the feature (report builder, signer, UI panels).
 */

/**
 * Report schema version. Bump this (semver) whenever the shape of
 * `VaultReport` changes in a way that could break an older verifier.
 * Embedded in every report so a future importer can detect and handle
 * schema drift explicitly instead of guessing field shapes.
 */
export const VAULT_SCHEMA_VERSION = '1.0.0';

/**
 * Build-time app version, matching the convention already used by
 * `src/observability/rum.ts`. Falls back to 'unknown' outside a Vite build
 * (e.g. certain test runners) rather than throwing.
 */
export const VAULT_APP_VERSION: string =
  (import.meta as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION ?? 'unknown';

/** Disclosure profile identifiers. 'custom' unlocks per-section toggles. */
export type DisclosureProfileId = 'warranty' | 'service' | 'resale' | 'custom';

/** Evidence section identifiers — one per evidence category the vault can assemble. */
export type EvidenceSectionId =
  | 'vehicle_identity'
  | 'battery'
  | 'maintenance'
  | 'software_updates'
  | 'warranty'
  | 'driving_history'
  | 'charging_history'
  | 'security_incidents';

export const ALL_EVIDENCE_SECTIONS: readonly EvidenceSectionId[] = [
  'vehicle_identity',
  'battery',
  'maintenance',
  'software_updates',
  'warranty',
  'driving_history',
  'charging_history',
  'security_incidents',
];

/** Default section membership for each built-in (non-custom) profile. */
export const DISCLOSURE_PROFILE_SECTIONS: Record<Exclude<DisclosureProfileId, 'custom'>, readonly EvidenceSectionId[]> = {
  // Warranty claims: identity + the certificate data a service center or
  // Tesla would want to see. No behavioral (driving/charging) data — it is
  // not relevant to a warranty claim and would only expand the disclosure
  // surface without benefit.
  warranty: ['vehicle_identity', 'battery', 'maintenance', 'software_updates', 'warranty'],
  // Service visit: what a shop needs to plan a service appointment.
  service: ['vehicle_identity', 'maintenance', 'software_updates', 'battery', 'security_incidents'],
  // Resale: the full "vehicle history report" a buyer would want, still
  // scrubbed of anything identity/location sensitive.
  resale: [
    'vehicle_identity',
    'battery',
    'maintenance',
    'software_updates',
    'warranty',
    'driving_history',
    'charging_history',
    'security_incidents',
  ],
};

/**
 * Fields that are ALWAYS excluded, regardless of profile or user toggle.
 * There is no legitimate warranty/resale use case for shipping these in a
 * disclosure report, so — unlike VIN and exact timestamps — they are not
 * exposed as opt-in toggles at all.
 */
export const HARD_EXCLUDED_CATEGORIES = [
  'authentication_tokens',
  'precise_gps_coordinates',
  'street_addresses',
  'raw_trip_paths',
  'driver_identity',
] as const;

export type HardExcludedCategory = (typeof HARD_EXCLUDED_CATEGORIES)[number];

/** ECDSA curve/hash pairing used for every signature this feature produces or verifies. */
export const SIGNING_ALGORITHM = 'ECDSA_P256_SHA256' as const;

/** Honest, fixed local-attestation disclaimer surfaced everywhere a signature is shown. */
export const LOCAL_ATTESTATION_NOTE =
  'A valid signature only proves this exact report content was signed by an ECDSA P-256 ' +
  'private key generated and held in a browser — it does NOT verify the identity of the ' +
  'person who generated it, and it is NOT an attestation, warranty, or notarization by ' +
  'Tesla, a government authority, or any third party.';

/** Shown wherever a bare SHA-256 digest is displayed, to prevent it being mistaken for proof of authorship. */
export const DIGEST_IS_NOT_A_SIGNATURE_NOTE =
  'The SHA-256 digest only proves the report content has not changed since it was computed. ' +
  'By itself it does not prove who created the report — only the ECDSA signature (below) does that.';
