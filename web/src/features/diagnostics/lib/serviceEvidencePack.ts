/**
 * Service Evidence Pack builder.
 *
 * Pure core (no DOM / fetch / React) that turns a `RootCauseAnalysisResult`
 * plus a vehicle reference, time window, and optional vehicle-scoped
 * software-update context into a canonical, offline-verifiable JSON
 * document, then computes a SHA-256 integrity digest over a stable
 * canonicalization of that document via Web Crypto.
 *
 * Two important boundaries this module enforces:
 *
 *   1. Privacy — the vehicle reference is rebuilt field-by-field (never
 *      spread) into exactly `{ id, displayName }`. VIN, coordinates,
 *      addresses, geofence names, and tokens can never leak into the pack
 *      even if the caller's vehicle object happens to carry them upstream.
 *   2. Honesty — this is an integrity digest, NOT a digital signature.
 *      `integrity.isSignature` is always `false`. A digest lets a
 *      technician verify offline that a shared JSON file has not been
 *      altered since it was generated; it does not attest to WHO generated
 *      it (that would require a private key, which this app does not
 *      hold). If Web Crypto is unavailable (non-secure context), this
 *      module throws `CryptoUnavailableError` rather than silently falling
 *      back to a weaker, non-cryptographic hash.
 *
 * Every hypothesis carried over from the root-cause analysis remains an
 * evidence-ranked statistical association — see `NO_CAUSAL_PROOF_DISCLAIMER`
 * (reused verbatim as `core.disclaimer`).
 *
 * No `any`. No `Array.prototype.at`.
 */

import type {
  EvidenceQuality,
  EvidenceRelation,
  RobustShift,
  RootCauseAnalysisResult,
  SignalDomain,
} from './rootCauseIntelligence';
import { NO_CAUSAL_PROOF_DISCLAIMER } from './rootCauseIntelligence';

// ─────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────

export const SERVICE_EVIDENCE_PACK_SCHEMA_VERSION = '1.0.0';

export const SERVICE_EVIDENCE_PACK_INCLUDED_VEHICLE_FIELDS = ['id', 'displayName'] as const;

/** Non-exhaustive but representative list of the categories of sensitive
 *  data this pack deliberately never includes. Used both to populate the
 *  human-readable privacy manifest and as the source of truth a test can
 *  check the manifest against. */
export const SERVICE_EVIDENCE_PACK_EXCLUDED_FIELD_NOTES = [
  'vin',
  'coordinates',
  'latitude',
  'longitude',
  'address',
  'geofenceName',
  'authToken',
  'apiKey',
  'rawLocationHistory',
] as const;

export interface VehicleReference {
  id: number;
  displayName: string;
}

export interface ServiceEvidencePackWindow {
  hours: number;
  earliestMs: number | null;
  latestMs: number | null;
}

export interface RawSoftwareUpdateEntry {
  version?: unknown;
  status?: unknown;
  installedAt?: unknown;
  installed_at?: unknown;
}

export interface ServiceEvidencePackSoftwareUpdateEntry {
  version: string;
  status: string;
  installedAt: string | null;
}

export interface ServiceEvidencePackSignalEvidence {
  signal: string;
  role: 'focal' | 'candidate';
  domains: SignalDomain[];
  sampleCount: number;
  hasEvidence: boolean;
}

export interface ServiceEvidencePackHypothesis {
  signal: string;
  domains: SignalDomain[];
  relation: EvidenceRelation;
  lagMs: number;
  /** The candidate's own detected shift — split time plus before/after
   *  median, MAD, and sample count — so a reviewer can see the concrete
   *  numbers behind the effect size, not just an abstract score. */
  shift: RobustShift;
  score: number;
  sampleCount: number;
  rationale: string;
}

export interface ServiceEvidencePackPrivacyManifest {
  includedVehicleFields: string[];
  excludedFields: string[];
  notes: string;
}

export interface ServiceEvidencePackCore {
  schemaVersion: string;
  generatedAt: string;
  vehicle: VehicleReference;
  window: ServiceEvidencePackWindow;
  focalSignal: string;
  focalDomains: SignalDomain[];
  /** The focal signal's own strongest robust shift in the analyzed window
   *  (`null` when no qualifying shift was found — see `quality.band`). */
  focalShift: RobustShift | null;
  signalEvidence: ServiceEvidencePackSignalEvidence[];
  hypotheses: ServiceEvidencePackHypothesis[];
  quality: EvidenceQuality;
  limitations: string[];
  summary: string;
  softwareUpdates: ServiceEvidencePackSoftwareUpdateEntry[] | null;
  privacy: ServiceEvidencePackPrivacyManifest;
  /** Verbatim `NO_CAUSAL_PROOF_DISCLAIMER` — repeated here so the exported
   *  JSON file is self-explanatory even without the app around it. */
  disclaimer: string;
}

export interface ServiceEvidencePackIntegrity {
  algorithm: 'SHA-256';
  digestHex: string;
  /** Explains exactly how `digestHex` was derived so a technician can
   *  reproduce it offline with any SHA-256 tool — this is documentation,
   *  not itself a machine-checked contract. */
  canonicalizationNote: string;
  /** Always `false`. A digest proves the content was not altered after
   *  generation; it does NOT prove who generated it. That would require a
   *  private key, which this client-side app does not hold. */
  isSignature: false;
}

/** The single canonical JSON document the page exports — the core fields
 *  plus the `integrity` block computed over them. */
export type ServiceEvidencePackDocument = ServiceEvidencePackCore & {
  integrity: ServiceEvidencePackIntegrity;
};

export const CANONICALIZATION_NOTE =
  "digestHex is the SHA-256 hex digest of this document's canonical JSON " +
  "serialization with the `integrity` field removed: recursively sort every " +
  'object\'s keys (arrays keep their original order), then JSON.stringify ' +
  'with no added whitespace. Re-run the same two steps offline with any ' +
  'SHA-256 tool to verify this pack has not been altered since it was generated.';

// ─────────────────────────────────────────────────────────────────────────
// Defensive input normalization
// ─────────────────────────────────────────────────────────────────────────

function normalizeVehicleReference(vehicle: VehicleReference | null | undefined): VehicleReference {
  const rawId = vehicle?.id;
  const id = typeof rawId === 'number' && Number.isFinite(rawId) ? rawId : 0;
  const rawName = vehicle?.displayName;
  const displayName = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : `Vehicle ${id}`;
  // Object literal, never a spread of `vehicle` — this is the privacy
  // boundary: whatever extra fields the caller's object carries (VIN,
  // coordinates, ...) are structurally impossible to include below.
  return { id, displayName };
}

function normalizeSoftwareUpdates(
  entries: readonly RawSoftwareUpdateEntry[] | null | undefined,
): ServiceEvidencePackSoftwareUpdateEntry[] | null {
  if (entries == null) return null;
  const out: ServiceEvidencePackSoftwareUpdateEntry[] = [];
  for (const raw of entries) {
    if (raw == null || typeof raw !== 'object') continue;
    const version = typeof raw.version === 'string' ? raw.version.trim() : '';
    if (version === '') continue;
    const status = typeof raw.status === 'string' && raw.status.trim() !== '' ? raw.status.trim() : 'unknown';
    const installedAtRaw = raw.installedAt ?? raw.installed_at;
    const installedAt = typeof installedAtRaw === 'string' && installedAtRaw !== '' ? installedAtRaw : null;
    out.push({ version, status, installedAt });
  }
  return out;
}

function buildPrivacyManifest(): ServiceEvidencePackPrivacyManifest {
  return {
    includedVehicleFields: [...SERVICE_EVIDENCE_PACK_INCLUDED_VEHICLE_FIELDS],
    excludedFields: [...SERVICE_EVIDENCE_PACK_EXCLUDED_FIELD_NOTES],
    notes:
      "This pack references the vehicle by its numeric id and user-facing display name only. " +
      'VIN, GPS coordinates, street address, geofence names, authentication tokens, and raw ' +
      'location history are never included. Signal evidence is limited to statistical ' +
      'summaries (medians, MAD, effect sizes, sample counts, signal names) — raw telemetry ' +
      'payloads are not embedded.',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Core builder (pure, sync, no crypto)
// ─────────────────────────────────────────────────────────────────────────

export interface BuildServiceEvidencePackInput {
  vehicle: VehicleReference;
  windowHours: number;
  analysis: RootCauseAnalysisResult;
  /** Optional vehicle-scoped software-update context, supplied by the page
   *  (e.g. from an existing software-updates query). Pass `null`/`undefined`
   *  when unavailable — the output field is always present (as `null`) so
   *  consumers never need to guess whether it was omitted vs. empty. */
  softwareUpdates?: readonly RawSoftwareUpdateEntry[] | null;
  /** Injectable clock for deterministic tests; defaults to the real clock. */
  now?: () => string;
}

/**
 * Builds the canonical core document (everything the integrity digest is
 * computed OVER) from a root-cause analysis. Pure and synchronous — no
 * network, no DOM, no crypto. Never throws: every field is defensively
 * normalized, so malformed input yields a structurally complete, low/zero
 * value document rather than an exception.
 */
export function buildServiceEvidencePackCore(input: BuildServiceEvidencePackInput): ServiceEvidencePackCore {
  const nowFn = typeof input.now === 'function' ? input.now : () => new Date().toISOString();
  const analysis = input.analysis;

  const vehicle = normalizeVehicleReference(input.vehicle);
  const window: ServiceEvidencePackWindow = {
    hours: typeof input.windowHours === 'number' && Number.isFinite(input.windowHours) ? input.windowHours : 0,
    earliestMs: analysis?.dataWindow?.earliestMs ?? null,
    latestMs: analysis?.dataWindow?.latestMs ?? null,
  };

  const signalEvidence: ServiceEvidencePackSignalEvidence[] = (analysis?.graph?.nodes ?? []).map((n) => ({
    signal: n.id,
    role: n.kind,
    domains: n.domains,
    sampleCount: n.sampleCount,
    hasEvidence: n.hasEvidence,
  }));

  const hypotheses: ServiceEvidencePackHypothesis[] = (analysis?.hypotheses ?? []).map((h) => ({
    signal: h.signal,
    domains: h.domains,
    relation: h.relation,
    lagMs: h.lagMs,
    shift: h.shift,
    score: h.score,
    sampleCount: h.sampleCount,
    rationale: h.rationale,
  }));

  return {
    schemaVersion: SERVICE_EVIDENCE_PACK_SCHEMA_VERSION,
    generatedAt: nowFn(),
    vehicle,
    window,
    focalSignal: analysis?.focalSignal ?? '',
    focalDomains: analysis?.focalDomains ?? [],
    focalShift: analysis?.focalShift ?? null,
    signalEvidence,
    hypotheses,
    quality: analysis?.quality ?? {
      band: 'insufficient',
      overallScore: 0,
      focalSampleCount: 0,
      candidatesWithEvidence: 0,
      candidatesConsidered: 0,
      windowMs: 0,
    },
    limitations: analysis?.limitations ?? [],
    summary: analysis?.summary ?? '',
    softwareUpdates: normalizeSoftwareUpdates(input.softwareUpdates),
    privacy: buildPrivacyManifest(),
    disclaimer: NO_CAUSAL_PROOF_DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Canonicalization / serialization
// ─────────────────────────────────────────────────────────────────────────

/**
 * Recursively rebuilds objects with their keys sorted lexicographically so
 * `JSON.stringify` afterwards is insensitive to the original key insertion
 * order. Arrays keep their element order (order is semantically meaningful
 * there — e.g. ranked hypotheses). Primitives pass through unchanged.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) out[key] = canonicalize(obj[key]);
    return out;
  }
  return value;
}

/** `JSON.stringify` over a `canonicalize`d value — deterministic, whitespace-free. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Pretty (2-space indented) JSON, suitable for the exported file / preview panel. */
export function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────
// SHA-256 digest (Web Crypto)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Thrown when `crypto.subtle` is unavailable (e.g. plain-HTTP access to a
 * LAN IP or custom hostname — SubtleCrypto requires a secure context). The
 * caller must surface this explicitly; there is no silent fallback to a
 * weaker, non-cryptographic hash.
 */
export class CryptoUnavailableError extends Error {
  constructor() {
    super('SHA-256 requires a secure context (HTTPS or localhost) with Web Crypto (crypto.subtle) available.');
    this.name = 'CryptoUnavailableError';
  }
}

function getSubtle(): SubtleCrypto | null {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
  return null;
}

/** SHA-256 hex digest of a UTF-8 string. Throws `CryptoUnavailableError` — never silently degrades. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = getSubtle();
  if (subtle == null) throw new CryptoUnavailableError();
  const bytes = new TextEncoder().encode(text);
  const digestBuffer = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digestBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────
// Top-level orchestration
// ─────────────────────────────────────────────────────────────────────────

/**
 * Builds the full, single canonical Service Evidence Pack document: the
 * core fields plus an `integrity` block whose `digestHex` is the SHA-256
 * hex digest of `canonicalStringify(core)`. Rejects with
 * `CryptoUnavailableError` (not a generic error, not a fallback hash) when
 * Web Crypto is unavailable.
 */
export async function buildServiceEvidencePack(
  input: BuildServiceEvidencePackInput,
): Promise<ServiceEvidencePackDocument> {
  const core = buildServiceEvidencePackCore(input);
  const digestHex = await sha256Hex(canonicalStringify(core));
  return {
    ...core,
    integrity: {
      algorithm: 'SHA-256',
      digestHex,
      canonicalizationNote: CANONICALIZATION_NOTE,
      isSignature: false,
    },
  };
}

/** Deterministic download filename: vehicle id + a short digest prefix so
 *  two packs for the same vehicle never silently overwrite one another. */
export function buildServiceEvidencePackFilename(doc: ServiceEvidencePackDocument): string {
  const shortDigest = doc.integrity.digestHex.length >= 12 ? doc.integrity.digestHex.slice(0, 12) : 'nodigest';
  return `service-evidence-pack-${doc.vehicle.id}-${shortDigest}.json`;
}
