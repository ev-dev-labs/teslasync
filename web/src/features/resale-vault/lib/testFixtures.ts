/**
 * Shared test fixtures for the resale-vault report pipeline
 * (signer/verifier/builder tests). Not imported by any production code
 * path — deliberately kept in `lib/` (not `__tests__/`) to match this
 * repo's co-located test-file convention, but this specific file has no
 * `.test.ts` suffix so Vitest does not treat it as a test suite itself.
 */
import { VAULT_APP_VERSION, VAULT_SCHEMA_VERSION } from './constants';
import type { VaultReport } from './types';

export function makeMinimalReport(overrides: Partial<VaultReport> = {}): VaultReport {
  return {
    schema_version: VAULT_SCHEMA_VERSION,
    app_version: VAULT_APP_VERSION,
    report_id: 'report_test_0001',
    disclosure: {
      profileId: 'resale',
      sections: ['vehicle_identity', 'battery'],
      sensitive: { vinDisclosure: 'masked', exactTimestamps: false },
    },
    time_bounds: {
      generated_at: '2024-01-15T00:00:00.000Z',
      earliest_evidence_at: '2022-06-01',
      latest_evidence_at: '2024-01-01',
      precision: 'day',
    },
    evidence: {
      vehicle_identity: {
        vin_disclosure: 'masked',
        vin_masked: '•••••••••••••1234',
        vin_full: null,
        display_name: 'My Model 3',
        model: 'Model 3',
        trim_badging: 'Long Range',
        exterior_color: 'White',
        wheel_type: 'Aero',
      },
      battery: {
        soh_pct: 94.2,
        capacity_wh: 72100,
        original_capacity_wh: 75000,
        equivalent_full_cycles: 210,
        fast_charge_ratio: 0.18,
        avg_charge_limit_pct: 80,
        health_grade: 'B',
        thermal_exposure: { cold_pct: 10, nominal_pct: 80, hot_pct: 10 },
        degradation_trend: [{ date: '2023-01-01', soh_pct: 97 }],
        recommendations: ['Avoid frequent fast charging above 80%.'],
        source_provenance_hash: 'sha256:deadbeef',
        issued_at: '2024-01-01',
        first_observed_at: '2022-06-01',
      },
      maintenance: null,
      software_updates: null,
      warranty: null,
      driving_history: null,
      charging_history: null,
      security_incidents: null,
    },
    redaction_manifest: {
      hard_excluded: [{ field: 'precise_gps_coordinates', reason: 'Always excluded — no warranty/resale use case.' }],
      excluded_by_selection: [],
      coarsened: [{ field: 'time_bounds', reason: 'Truncated to day precision (exact timestamps not selected).' }],
      included_with_warning: [],
    },
    limitations: ['Maintenance data reflects the fleet-wide "first vehicle" backend limitation.'],
    attestation_statement:
      'This report attests only that the enclosed data was assembled and signed by this browser instance.',
    ...overrides,
  };
}
