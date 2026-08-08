/**
 * Curated local catalog fixtures.
 *
 * Three entries, each demonstrating a distinct trust state the marketplace
 * UI must render correctly:
 *
 *   1. `EFFICIENCY_INSIGHTS_ENVELOPE` — validly Ed25519-signed by a key in
 *      the local `KNOWN_PUBLISHER_FINGERPRINTS` allowlist. See
 *      `docs/SIGNED_FIXTURE_PROVENANCE.md` for exactly how this was
 *      produced (only the public key + signature are committed; the
 *      private key was generated in local process memory and discarded —
 *      never written anywhere).
 *   2. `COMMUNITY_DRAFT_ENVELOPE` — unsigned (`signature: null`). Can be
 *      previewed but cannot be enabled without the explicit
 *      local-development trust flow.
 *   3. `TAMPERED_DEMO_ENVELOPE` — a structural clone of entry 1 with one
 *      manifest field mutated AFTER signing, so its signature genuinely
 *      fails verification through the real `verifyPackEnvelope()` code
 *      path. Included so the "do not trust" UI state is something you can
 *      actually see, not merely described.
 *
 * This is local, static, bundled data — never fetched from a network.
 */

import type { SignedPackEnvelope } from './manifestTypes';

export const EFFICIENCY_INSIGHTS_ENVELOPE: SignedPackEnvelope = {
  envelopeVersion: 1,
  manifest: {
    schemaVersion: 1,
    id: 'efficiency-insights-starter',
    name: 'Efficiency Insights Starter Pack',
    version: '1.0.0',
    description:
      'Sample analytics pack demonstrating efficiency and charging insight formulas, a starter dashboard, and automation recommendations \u2014 built entirely from bounded, declarative data (no executable code).',
    publisher: {
      name: 'TeslaSync Labs (Sample Publisher)',
      fingerprint: 'a6bf3419682a8c5d510521cbaf99bbdaaff96af7f984c8e08f5590c6627ab233',
    },
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
          args: [
            { op: 'field', name: 'drive_efficiency_wh_per_km' },
            { op: 'coef', name: 'efficiency_target_wh_per_km' },
          ],
        },
      },
      {
        id: 'battery-headroom',
        label: 'Battery Headroom Above Low Threshold',
        unit: '%',
        expr: {
          op: 'sub',
          args: [
            { op: 'field', name: 'battery_level_pct' },
            { op: 'coef', name: 'battery_low_threshold_pct' },
          ],
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
          'Consider manually enabling battery preconditioning in the Automation Builder \u2014 this pack only suggests the idea and never creates or runs an automation itself.',
      },
    ],
  },
  contentDigestSha256Hex: 'fa952a107bd4e34cb1062f7b8cfbbecefe60e771ed4e0c157d934adf08cf5c8d',
  signature: {
    algorithm: 'Ed25519',
    publicKeyBase64: '4snZl+DAyA76TLCEQSKzxED6q0n8uYaiFF3VJxnus6Y=',
    signatureBase64: 'fE4iDM0cQXHvOkF5sj4kc1pcK4SuaUiYNwDsVCG88xKQ4G4DN/KPpEjGqd/nmJe2Q2Pjcee+YruuN9GU26Q/Cw==',
  },
};

export const COMMUNITY_DRAFT_ENVELOPE: SignedPackEnvelope = {
  envelopeVersion: 1,
  manifest: {
    schemaVersion: 1,
    id: 'community-speed-temp-explorer',
    name: 'Community Draft: Speed & Temp Explorer',
    version: '0.1.0',
    description:
      'An unsigned community draft exploring average speed alongside cabin/ambient temperature. Preview-only until you explicitly opt into the local-development trust flow \u2014 this publisher\u2019s identity has not been verified in any way.',
    publisher: { name: 'Anonymous Community Contributor', fingerprint: '' },
    appCompatibility: { minAppVersion: '0.1.0', maxAppVersion: null },
    capabilities: ['read:telemetry-sample', 'read:drive-sample', 'render:dashboard'],
    coefficients: [
      { name: 'comfortable_cabin_c', value: 21, min: 15, max: 26, description: 'Reference cabin temperature.' },
    ],
    formulas: [
      {
        id: 'cabin-vs-comfort',
        label: 'Cabin Temp vs Comfort Reference',
        unit: '\u00b0C',
        expr: { op: 'sub', args: [{ op: 'field', name: 'cabin_temp_c' }, { op: 'coef', name: 'comfortable_cabin_c' }] },
      },
      {
        id: 'avg-speed',
        label: 'Average Speed',
        unit: 'km/h',
        expr: { op: 'field', name: 'avg_speed_kmh' },
      },
    ],
    dashboards: [
      {
        id: 'draft-dashboard',
        title: 'Speed & Temp Explorer (Draft)',
        widgets: [
          { id: 'w-cabin-delta', kind: 'line', title: 'Cabin Temp vs Comfort', formulaRef: 'cabin-vs-comfort', span: 2 },
          { id: 'w-avg-speed', kind: 'sparkline', title: 'Average Speed', formulaRef: 'avg-speed', span: 1 },
        ],
      },
    ],
    automationRecommendations: [],
  },
  signature: null,
};

/**
 * Structural clone of `EFFICIENCY_INSIGHTS_ENVELOPE` with one coefficient
 * mutated AFTER copying the (unmodified) signature block — the signature
 * therefore no longer matches the canonical bytes of this manifest, and
 * `verifyPackEnvelope()` will genuinely report `signature-invalid` for it.
 */
export const TAMPERED_DEMO_ENVELOPE: SignedPackEnvelope = (() => {
  const clone: SignedPackEnvelope = JSON.parse(JSON.stringify(EFFICIENCY_INSIGHTS_ENVELOPE)) as SignedPackEnvelope;
  clone.manifest.id = 'tampered-demo-pack';
  clone.manifest.name = 'Demo: Tampered Pack (Intentionally Invalid Signature)';
  clone.manifest.description =
    'For demonstration only: this manifest was altered after it was signed, so its signature no longer verifies. Used to show the "signature invalid \u2014 do not trust" state live.';
  const coefficient = clone.manifest.coefficients[0];
  if (coefficient) coefficient.value = Math.min(coefficient.max, coefficient.value + 1);
  // Deliberately drop the optional publisher-supplied digest: it was
  // computed over the ORIGINAL (untampered) manifest and would otherwise
  // be caught by the (distinct) digest-mismatch check before the
  // Ed25519 signature check ever runs. Omitting it isolates this fixture
  // to demonstrating the signature check specifically, which is the
  // headline "do not trust" mechanism this demo exists to exercise.
  delete clone.contentDigestSha256Hex;
  return clone;
})();

export interface CatalogEntry {
  envelope: SignedPackEnvelope;
  sourceNote: string;
}

export const CATALOG_ENTRIES: readonly CatalogEntry[] = [
  {
    envelope: EFFICIENCY_INSIGHTS_ENVELOPE,
    sourceNote: 'Signed sample pack bundled with this build. See docs/SIGNED_FIXTURE_PROVENANCE.md.',
  },
  {
    envelope: COMMUNITY_DRAFT_ENVELOPE,
    sourceNote: 'Unsigned community draft bundled with this build for demonstration purposes.',
  },
  {
    envelope: TAMPERED_DEMO_ENVELOPE,
    sourceNote: 'Deliberately tampered demo bundled with this build to exercise the signature-invalid UI state.',
  },
];
