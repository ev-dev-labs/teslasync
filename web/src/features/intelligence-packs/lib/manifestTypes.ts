/**
 * Typed Intelligence-Pack manifest schema (v1).
 *
 * A manifest is DECLARATIVE DATA ONLY. There is no field anywhere in this
 * schema that can carry executable code:
 *   - Analytics "formulas" are a finite, closed-vocabulary expression AST
 *     (`PackExpr`) interpreted node-by-node by `expressionInterpreter.ts` —
 *     never `eval`, `new Function`, or a string of source code.
 *   - Dashboard layouts reference one of a fixed, allowlisted set of shared
 *     visualization primitive *kinds* (`PackVizKind`) by name; the manifest
 *     never supplies markup, CSS, or a component to render.
 *   - Automation "recommendations" are plain human-readable strings a user
 *     reviews and manually recreates in the existing Automation Builder —
 *     a pack can never trigger a vehicle command directly.
 *   - Model "coefficients" are bounded numbers (`min <= value <= max`,
 *     validated at parse time and re-clamped defensively at eval time).
 *
 * See `manifestValidator.ts` for the parser/validator that enforces every
 * limit declared here, and `docs/THREAT_MODEL.md` for the full list of
 * security guarantees and explicit non-guarantees.
 */

// ── Schema / envelope versioning ─────────────────────────────────────────

/** Current manifest schema version this build authors/accepts. */
export const PACK_MANIFEST_SCHEMA_VERSION = 1;
/** All schema versions this build can parse (kept as a list for forward planning). */
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS: readonly number[] = [1];

/** Current signed-envelope wire format version (distinct from the manifest's own schemaVersion). */
export const PACK_ENVELOPE_VERSION = 1;

// ── Structural limits (enforced by manifestValidator.ts) ─────────────────

export const MANIFEST_LIMITS = {
  /** Whole uploaded/catalog envelope file, UTF-8 byte length. */
  maxEnvelopeJsonBytes: 200_000,
  /** Recursion depth ceiling for the raw parsed JSON tree (any shape). */
  maxJsonDepth: 14,
  /** Total node count ceiling for the raw parsed JSON tree (any shape). */
  maxJsonNodeCount: 6_000,
  /** Any individual JSON string value. */
  maxStringLength: 4_000,
  /** Any individual JSON array. */
  maxArrayLength: 500,
  maxFormulas: 40,
  maxCoefficients: 64,
  maxDashboards: 10,
  maxWidgetsPerDashboard: 24,
  maxAutomationRecommendations: 20,
  maxCapabilities: 20,
  /** AST node ceiling — per formula. */
  maxExprNodesPerFormula: 200,
  /** AST recursion depth ceiling — per formula. */
  maxExprDepth: 12,
  /** Absolute bound on any numeric literal / coefficient bound in a manifest. */
  maxAbsNumericValue: 1_000_000,
} as const;

// ── Capabilities (strict allowlist — anything else is a parse-time reject) ─

export const PACK_CAPABILITY_IDS = [
  'read:telemetry-sample',
  'read:charging-sample',
  'read:battery-sample',
  'read:drive-sample',
  'render:dashboard',
  'suggest:automation',
] as const;

export type PackCapabilityId = (typeof PACK_CAPABILITY_IDS)[number];

export interface PackCapabilityDescriptor {
  id: PackCapabilityId;
  label: string;
  description: string;
}

/**
 * Every capability a pack could ever request, with the exact meaning shown
 * to the user before install. Deliberately all read-only / suggestion-only —
 * there is no "write", "command", or "network" capability in this allowlist
 * at all, so requesting one is structurally impossible, not merely denied.
 */
export const PACK_CAPABILITY_CATALOG: readonly PackCapabilityDescriptor[] = [
  {
    id: 'read:telemetry-sample',
    label: 'Read sample telemetry',
    description:
      'Read bundled synthetic sample telemetry rows for the sandbox preview. Never live vehicle data, never a network request.',
  },
  {
    id: 'read:charging-sample',
    label: 'Read sample charging data',
    description: 'Read bundled synthetic sample charging-session fields for the sandbox preview.',
  },
  {
    id: 'read:battery-sample',
    label: 'Read sample battery data',
    description: 'Read bundled synthetic sample battery fields for the sandbox preview.',
  },
  {
    id: 'read:drive-sample',
    label: 'Read sample drive data',
    description: 'Read bundled synthetic sample drive/efficiency fields for the sandbox preview.',
  },
  {
    id: 'render:dashboard',
    label: 'Render dashboard widgets',
    description: 'Render this pack\u2019s declarative dashboard layout using allowlisted shared chart primitives.',
  },
  {
    id: 'suggest:automation',
    label: 'Suggest automations',
    description:
      'Show human-readable automation recommendations for you to review and manually recreate in the Automation Builder. Never executes or creates automations on its own.',
  },
] as const;

// ── Sample data fields (allowlisted; see lib/sampleTelemetry.ts) ─────────

export const SAMPLE_ROW_FIELDS = [
  'day_index',
  'battery_level_pct',
  'charge_energy_added_kwh',
  'drive_distance_km',
  'drive_efficiency_wh_per_km',
  'avg_speed_kmh',
  'cabin_temp_c',
  'ambient_temp_c',
] as const;

export type SampleRowField = (typeof SAMPLE_ROW_FIELDS)[number];

/** Which capability gates a given sample-data field. */
export const SAMPLE_FIELD_CAPABILITY: Record<SampleRowField, PackCapabilityId> = {
  day_index: 'read:telemetry-sample',
  battery_level_pct: 'read:battery-sample',
  charge_energy_added_kwh: 'read:charging-sample',
  drive_distance_km: 'read:drive-sample',
  drive_efficiency_wh_per_km: 'read:drive-sample',
  avg_speed_kmh: 'read:drive-sample',
  cabin_temp_c: 'read:telemetry-sample',
  ambient_temp_c: 'read:telemetry-sample',
};

// ── Dashboard visualization primitives (allowlisted shared components) ──

export const PACK_VIZ_KINDS = ['line', 'area', 'bar', 'sparkline', 'radial-gauge', 'stat'] as const;
export type PackVizKind = (typeof PACK_VIZ_KINDS)[number];

// ── Expression AST (closed vocabulary — declarative data only) ──────────

export type PackExprNaryOp = 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max' | 'avg';
export type PackExprUnaryOp = 'abs' | 'neg' | 'round' | 'clamp01';
export type PackExprCompareOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

export type PackExpr =
  | { op: 'const'; value: number }
  | { op: 'field'; name: SampleRowField }
  | { op: 'coef'; name: string }
  | { op: PackExprUnaryOp; arg: PackExpr }
  | { op: PackExprNaryOp; args: PackExpr[] }
  | { op: PackExprCompareOp; left: PackExpr; right: PackExpr }
  | { op: 'if'; cond: PackExpr; then: PackExpr; else: PackExpr };

export const PACK_EXPR_OPS: readonly string[] = [
  'const',
  'field',
  'coef',
  'abs',
  'neg',
  'round',
  'clamp01',
  'add',
  'sub',
  'mul',
  'div',
  'min',
  'max',
  'avg',
  'lt',
  'lte',
  'gt',
  'gte',
  'eq',
  'if',
];

// ── Manifest content types ────────────────────────────────────────────────

export interface PackCoefficient {
  name: string;
  value: number;
  min: number;
  max: number;
  description?: string;
}

export interface PackFormula {
  id: string;
  label: string;
  unit?: string;
  expr: PackExpr;
}

export interface PackDashboardWidget {
  id: string;
  kind: PackVizKind;
  title: string;
  formulaRef: string;
  span?: 1 | 2 | 3 | 4;
}

export interface PackDashboardLayout {
  id: string;
  title: string;
  widgets: PackDashboardWidget[];
}

export interface PackAutomationRecommendation {
  id: string;
  title: string;
  rationale: string;
  suggestedTriggerSummary: string;
  suggestedConditionSummary: string;
  suggestedActionSummary: string;
}

export interface PackAppCompatibility {
  minAppVersion: string;
  maxAppVersion: string | null;
}

export interface PackPublisher {
  name: string;
  /**
   * Claimed SHA-256 fingerprint (lowercase hex) of the signing public key.
   * Empty string for unsigned packs (there is no key to fingerprint).
   * This is a CLAIM inside signed data — `verifyEnvelope.ts` independently
   * recomputes the real fingerprint from `signature.publicKeyBase64` and
   * flags any mismatch as suspicious.
   */
  fingerprint: string;
}

export interface PackManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description: string;
  publisher: PackPublisher;
  appCompatibility: PackAppCompatibility;
  capabilities: PackCapabilityId[];
  coefficients: PackCoefficient[];
  formulas: PackFormula[];
  dashboards: PackDashboardLayout[];
  automationRecommendations: PackAutomationRecommendation[];
}

// ── Signed envelope (the unit that is catalogued / installed / exported) ─

export interface PackSignature {
  algorithm: 'Ed25519';
  /** Raw 32-byte Ed25519 public key, standard base64. */
  publicKeyBase64: string;
  /** Raw 64-byte Ed25519 signature over `canonicalStringify(manifest)`, standard base64. */
  signatureBase64: string;
}

export interface SignedPackEnvelope {
  envelopeVersion: 1;
  manifest: PackManifest;
  /**
   * Optional informational digest the publisher may choose to include for
   * offline eyeballing. ALWAYS independently recomputed by the verifier —
   * a mismatch between a supplied value and the recomputed one is treated
   * as tampering, but the supplied value itself is never trusted on its own.
   */
  contentDigestSha256Hex?: string;
  /** `null` = explicitly unsigned. */
  signature: PackSignature | null;
}
