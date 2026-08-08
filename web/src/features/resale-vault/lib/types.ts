/**
 * Warranty & Resale Vault — report schema types.
 *
 * `VaultReport` is the canonical, redacted, JSON-serializable payload that
 * gets hashed and signed. Every field must be a plain JSON value (see
 * `canonicalJson.ts`) — no `undefined`, functions, or class instances.
 */
import type { DisclosureProfileId, EvidenceSectionId } from './constants';

/** Precision applied to any date/time field in the report. */
export type DatePrecision = 'day' | 'exact';

/** How a VIN is represented in the report. */
export type VinDisclosure = 'excluded' | 'masked' | 'full';

/** User-controlled sensitive-field toggles. Anything not listed here is a hard exclusion (see constants.ts). */
export interface SensitiveFieldSelection {
  vinDisclosure: VinDisclosure;
  /** When false (default), all dates in the report are truncated to day precision. */
  exactTimestamps: boolean;
}

/** Full user selection driving report assembly: which profile, which sections, which sensitive toggles. */
export interface DisclosureSelection {
  profileId: DisclosureProfileId;
  /** Effective section membership. For built-in profiles this mirrors DISCLOSURE_PROFILE_SECTIONS; 'custom' is user-picked. */
  sections: readonly EvidenceSectionId[];
  sensitive: SensitiveFieldSelection;
}

export interface VehicleIdentityEvidence {
  vin_disclosure: VinDisclosure;
  vin_masked: string | null;
  vin_full: string | null;
  display_name: string | null;
  model: string | null;
  trim_badging: string | null;
  exterior_color: string | null;
  wheel_type: string | null;
}

export interface BatteryEvidence {
  soh_pct: number | null;
  /** Watt-hours (Wh, SI) — converted from the Battery Passport's kWh figure by an exact ×1000 metric-prefix multiplication (not a preference-based unit guess). Convert for display with `formatEnergy()` from `useUnits()`. */
  capacity_wh: number | null;
  original_capacity_wh: number | null;
  equivalent_full_cycles: number | null;
  fast_charge_ratio: number | null;
  avg_charge_limit_pct: number | null;
  health_grade: string | null;
  thermal_exposure: {
    cold_pct: number;
    nominal_pct: number;
    hot_pct: number;
  } | null;
  degradation_trend: Array<{ date: string; soh_pct: number }>;
  recommendations: string[];
  /** The upstream Battery Passport's own tamper-evidence hash, carried through as supplementary evidence. */
  source_provenance_hash: string | null;
  issued_at: string | null;
  first_observed_at: string | null;
}

export interface MaintenanceEvidence {
  scheduled_item_count: number;
  service_record_count: number;
  service_records: Array<{
    item_id: string;
    date: string;
    /** Meters (m, SI) — converted from the service-records hook's km figure by an exact ×1000 metric-prefix multiplication. Convert for display with `formatDistance()`. */
    odometer_m: number | null;
    notes: string;
  }>;
  categories: string[];
}

export interface SoftwareUpdateEvidence {
  update_count: number;
  installed_versions: Array<{ version: string; installed_at: string | null }>;
  latest_version: string | null;
}

export interface WarrantyEvidence {
  fetched_at: string | null;
  /** Best-effort scrub of the opaque Tesla warranty payload — see redaction.ts::scrubSensitiveRecord. */
  data: Record<string, unknown> | null;
}

export interface DrivingHistoryEvidence {
  observed_drive_count: number;
  /** Meters (m, SI) — converted from the stats hook's km figure by an exact ×1000 metric-prefix multiplication. Convert for display with `formatDistance()` from `useUnits()`. */
  total_distance_m: number | null;
  /** Seconds (s, SI) — passed through unchanged; the driving-stats hook already reports this field in SI seconds. Convert for display with `formatDuration()`. */
  total_duration_s: number | null;
  /** Watt-hours per kilometer. Kept as the compound ratio the stats hook reports (not decomposed to Wh-per-meter) — display components must convert the distance denominator explicitly (see DrivingChargingSummaryPanel) rather than treating this as a plain SI scalar. */
  avg_efficiency_wh_per_km: number | null;
  regen_ratio: number | null;
  co2_saved_kg: number | null;
  score_overall: number | null;
  score_grade: string | null;
  earliest_drive_at: string | null;
  latest_drive_at: string | null;
}

export interface ChargingHistoryEvidence {
  observed_session_count: number;
  /** Watt-hours (Wh, SI) — summed directly from `ChargingSession.total_energy_added_wh`, already SI-native. Convert for display with `formatEnergy()`. */
  total_energy_added_wh: number | null;
  fast_charge_session_count: number;
  /** Watts (W, SI) — averaged directly from `ChargingSession.peak_power_w`, already SI-native. Convert for display with `formatPower()`. */
  avg_peak_power_w: number | null;
  total_cost: number | null;
  earliest_session_at: string | null;
  latest_session_at: string | null;
}

export interface SecurityIncidentsEvidence {
  observed_event_count: number;
  by_type: Array<{ event_type: string; count: number }>;
  acknowledged_count: number;
  earliest_event_at: string | null;
  latest_event_at: string | null;
}

export interface VaultEvidence {
  vehicle_identity: VehicleIdentityEvidence | null;
  battery: BatteryEvidence | null;
  maintenance: MaintenanceEvidence | null;
  software_updates: SoftwareUpdateEvidence | null;
  warranty: WarrantyEvidence | null;
  driving_history: DrivingHistoryEvidence | null;
  charging_history: ChargingHistoryEvidence | null;
  security_incidents: SecurityIncidentsEvidence | null;
}

export interface RedactionManifestEntry {
  field: string;
  reason: string;
}

export interface RedactionManifest {
  /** Categories excluded for every report, regardless of selection (see HARD_EXCLUDED_CATEGORIES). */
  hard_excluded: RedactionManifestEntry[];
  /** Fields excluded because the current disclosure selection did not opt in. */
  excluded_by_selection: RedactionManifestEntry[];
  /** Fields coarsened (e.g. date truncated to day) rather than fully excluded. */
  coarsened: RedactionManifestEntry[];
  /** Sensitive fields the user explicitly opted into, each carrying the warning shown at selection time. */
  included_with_warning: RedactionManifestEntry[];
}

export interface VaultTimeBounds {
  /** Exact instant the report was assembled — never coarsened; it describes the report, not the vehicle. */
  generated_at: string;
  /** Earliest evidence timestamp across all included sections, at the selected precision. Null if no dated evidence. */
  earliest_evidence_at: string | null;
  /** Latest evidence timestamp across all included sections, at the selected precision. */
  latest_evidence_at: string | null;
  precision: DatePrecision;
}

export interface VaultReport {
  schema_version: string;
  app_version: string;
  report_id: string;
  disclosure: DisclosureSelection;
  time_bounds: VaultTimeBounds;
  evidence: VaultEvidence;
  redaction_manifest: RedactionManifest;
  limitations: string[];
  attestation_statement: string;
}

/* ── Signing / verification ─────────────────────────────────────────── */

/** Minimal JWK shape we round-trip — matches the subset `crypto.subtle.exportKey('jwk', ...)` returns for EC keys. */
export interface EcPublicJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  ext?: boolean;
  key_ops?: string[];
  [extra: string]: unknown;
}

export interface VaultSignature {
  alg: 'ECDSA_P256_SHA256';
  key_id: string;
  public_key_jwk: EcPublicJwk;
  signature_b64: string;
  signed_at: string;
}

export interface LocalKeyStatus {
  /** Whether the signing private key is durably stored (survives reload) vs. in-memory session-only. */
  persisted: boolean;
  /** Whether the key was already revoked in the local registry at the moment of signing. */
  revoked: boolean;
}

export interface SignedVaultReport {
  report: VaultReport;
  digest_sha256_hex: string;
  signature: VaultSignature;
  local_key_status: LocalKeyStatus;
}

export interface VerificationResult {
  digestMatches: boolean;
  signatureValid: boolean;
  /** True only when both digestMatches and signatureValid are true. */
  valid: boolean;
  keyId: string;
  /** Whether the signing public key matches a key in the verifier's OWN local registry (self-signed check). */
  isKnownLocalKey: boolean;
  /** Revocation state of the matching local key; null when the key isn't locally known (e.g. an imported report). */
  localKeyRevoked: boolean | null;
  errors: string[];
  attestationNote: string;
}

/* ── Key repository ──────────────────────────────────────────────────── */

export interface SigningKeyRecord {
  key_id: string;
  public_jwk: EcPublicJwk;
  created_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  rotated_from: string | null;
  /** Whether this key's private material is durably stored (IndexedDB) vs. in-memory-only for this session. */
  persisted: boolean;
}

export interface VaultKeyCapability {
  supported: boolean;
  reason: string | null;
}

/* ── Audit trail ─────────────────────────────────────────────────────── */

export type AuditAction =
  | 'key_generated'
  | 'key_rotated'
  | 'key_revoked'
  | 'report_signed'
  | 'report_exported'
  | 'report_imported'
  | 'report_verified';

export interface AuditEntry {
  id: string;
  ts: string;
  action: AuditAction;
  detail: string;
}
