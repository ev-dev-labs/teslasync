// Signed-fixture generation script (Node.js, run manually / offline).
//
// This is the exact tool used to produce the bundled "Efficiency Insights
// Starter Pack" signed catalog fixture in `lib/catalogFixtures.ts`. It is
// NOT run by the app, the build, or CI — it is kept here purely for
// transparency and reproducibility (see `SIGNED_FIXTURE_PROVENANCE.md`).
//
// Re-running this script generates a BRAND NEW Ed25519 keypair every time
// (Node's CSPRNG), so it will print a different public key, signature, and
// fingerprint than the ones committed in `catalogFixtures.ts`. That is
// expected: this script demonstrates the exact, reproducible signing
// procedure, not a fixed "official" keypair. The private key this script
// generates is held only in local process memory, printed nowhere, and
// discarded when the process exits — it is never written to disk and
// never committed.
//
// Usage:  node docs/generate-signed-fixture.mjs
//
// Prints: the manifest JSON (with `publisher.fingerprint` filled in), the
// base64 public key, the base64 Ed25519 signature, and the SHA-256
// content digest hex — everything needed to hand-assemble a
// `SignedPackEnvelope` and nothing that could reconstruct the private key.

import { generateKeyPairSync, sign as edSign, createHash } from 'node:crypto';

// ---- canonicalize(): byte-for-byte port of lib/canonicalJson.ts ----------
// Any change here MUST be mirrored in lib/canonicalJson.ts (and vice
// versa) or signatures produced by this script will fail verification in
// the app, and vice versa. See that file's header comment for the full
// spec this implements.
function canonicalize(value) {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number');
    return value === 0 ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const sortedKeys = Object.keys(value).sort();
  const out = {};
  for (const key of sortedKeys) out[key] = canonicalize(value[key]);
  return out;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

// ---- 1. Generate an ephemeral Ed25519 keypair ----------------------------
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicJwk = publicKey.export({ format: 'jwk' });
const rawPublicKeyBytes = Buffer.from(publicJwk.x, 'base64url'); // 32 raw bytes
const publicKeyBase64 = rawPublicKeyBytes.toString('base64');
const publisherFingerprint = createHash('sha256').update(rawPublicKeyBytes).digest('hex');

// ---- 2. Build the manifest, with the real fingerprint filled in ---------
const manifest = {
  schemaVersion: 1,
  id: 'efficiency-insights-starter',
  name: 'Efficiency Insights Starter Pack',
  version: '1.0.0',
  description:
    'Sample analytics pack demonstrating efficiency and charging insight formulas, a starter dashboard, and automation recommendations — built entirely from bounded, declarative data (no executable code).',
  publisher: { name: 'TeslaSync Labs (Sample Publisher)', fingerprint: publisherFingerprint },
  appCompatibility: { minAppVersion: '0.1.0', maxAppVersion: null },
  capabilities: [
    'read:telemetry-sample',
    'read:charging-sample',
    'read:battery-sample',
    'read:drive-sample',
    'render:dashboard',
    'suggest:automation',
  ],
  coefficients: [
    {
      name: 'efficiency_target_wh_per_km',
      value: 150,
      min: 100,
      max: 250,
      description: 'Target efficiency used by the efficiency-gap formula.',
    },
    {
      name: 'battery_low_threshold_pct',
      value: 20,
      min: 5,
      max: 40,
      description: 'Threshold used by the battery-headroom formula.',
    },
  ],
  formulas: [
    {
      id: 'efficiency-gap',
      label: 'Efficiency Gap vs Target',
      unit: 'Wh/km',
      expr: {
        op: 'sub',
        args: [{ op: 'field', name: 'drive_efficiency_wh_per_km' }, { op: 'coef', name: 'efficiency_target_wh_per_km' }],
      },
    },
    {
      id: 'battery-headroom',
      label: 'Battery Headroom Above Low Threshold',
      unit: '%',
      expr: {
        op: 'sub',
        args: [{ op: 'field', name: 'battery_level_pct' }, { op: 'coef', name: 'battery_low_threshold_pct' }],
      },
    },
    {
      id: 'charge-added',
      label: 'Charge Energy Added',
      unit: 'kWh',
      expr: { op: 'field', name: 'charge_energy_added_kwh' },
    },
    {
      id: 'is-below-target',
      label: 'Below Efficiency Target?',
      unit: 'flag',
      expr: {
        op: 'gt',
        left: { op: 'field', name: 'drive_efficiency_wh_per_km' },
        right: { op: 'coef', name: 'efficiency_target_wh_per_km' },
      },
    },
  ],
  dashboards: [
    {
      id: 'starter-dashboard',
      title: 'Efficiency Starter Dashboard',
      widgets: [
        { id: 'w-eff-gap', kind: 'line', title: 'Efficiency Gap vs Target', formulaRef: 'efficiency-gap', span: 2 },
        { id: 'w-batt-headroom', kind: 'area', title: 'Battery Headroom', formulaRef: 'battery-headroom', span: 2 },
        { id: 'w-charge-added', kind: 'bar', title: 'Charge Added', formulaRef: 'charge-added', span: 2 },
        { id: 'w-below-target', kind: 'stat', title: 'Currently Below Target', formulaRef: 'is-below-target', span: 1 },
        { id: 'w-eff-gap-spark', kind: 'sparkline', title: 'Efficiency Gap Trend', formulaRef: 'efficiency-gap', span: 1 },
        { id: 'w-headroom-gauge', kind: 'radial-gauge', title: 'Battery Headroom', formulaRef: 'battery-headroom', span: 1 },
      ],
    },
  ],
  automationRecommendations: [
    {
      id: 'low-battery-precondition',
      title: 'Precondition before DC fast charging when battery is low',
      rationale:
        'Sample rows show battery headroom occasionally dips close to the low threshold before a charge session; preconditioning generally improves DC fast-charge speed in cold weather.',
      suggestedTriggerSummary: 'When a charge session is about to start.',
      suggestedConditionSummary: 'Battery headroom above the low threshold is less than 10%.',
      suggestedActionSummary:
        'Consider manually enabling battery preconditioning in the Automation Builder — this pack only suggests the idea and never creates or runs an automation itself.',
    },
  ],
};

// ---- 3. Sign canonicalStringify(manifest) with Ed25519 -------------------
const message = Buffer.from(canonicalStringify(manifest), 'utf8');
const signature = edSign(null, message, privateKey); // 64 raw bytes, matches Web Crypto Ed25519 format
const signatureBase64 = signature.toString('base64');
const contentDigestSha256Hex = createHash('sha256').update(message).digest('hex');

// ---- 4. Print everything needed to assemble the SignedPackEnvelope ------
console.log(JSON.stringify(
  {
    manifest,
    publicKeyBase64,
    signatureBase64,
    contentDigestSha256Hex,
    publisherFingerprint,
  },
  null,
  2,
));
// privateKey / rawPublicKeyBytes fall out of scope here and are never
// written anywhere else in this script.
