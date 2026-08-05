import { describe, it, expect } from 'vitest';
import { buildVaultReport } from './reportBuilder';
import { toCanonicalJson } from './canonicalJson';
import { ALL_EVIDENCE_SECTIONS, DISCLOSURE_PROFILE_SECTIONS } from './constants';
import type { DisclosureSelection, VaultEvidence } from './types';

function emptyEvidence(): VaultEvidence {
  return {
    vehicle_identity: null,
    battery: null,
    maintenance: null,
    software_updates: null,
    warranty: null,
    driving_history: null,
    charging_history: null,
    security_incidents: null,
  };
}

const baseSelection: DisclosureSelection = {
  profileId: 'resale',
  sections: DISCLOSURE_PROFILE_SECTIONS.resale,
  sensitive: { vinDisclosure: 'excluded', exactTimestamps: false },
};

describe('buildVaultReport — determinism and schema', () => {
  it('is deterministic given injected now/reportId (needed for canonical-stability tests)', () => {
    const now = new Date('2024-06-01T00:00:00.000Z');
    const a = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence(), now, reportId: 'report_fixed' });
    const b = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence(), now, reportId: 'report_fixed' });
    expect(toCanonicalJson(a)).toBe(toCanonicalJson(b));
  });

  it('stamps schema_version/app_version/report_id', () => {
    const report = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence(), reportId: 'report_x' });
    expect(report.schema_version).toBe('1.0.0');
    expect(report.report_id).toBe('report_x');
  });

  it('generates a random report_id when none is injected', () => {
    const a = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence() });
    const b = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence() });
    expect(a.report_id).not.toBe(b.report_id);
    expect(a.report_id).toMatch(/^report_/);
  });
});

describe('buildVaultReport — selective disclosure enforcement', () => {
  it('blanks out evidence for sections NOT in the disclosure selection, even if the caller passed data for them', () => {
    const evidence = emptyEvidence();
    evidence.driving_history = {
      observed_drive_count: 10,
      total_distance_m: 100000,
      total_duration_s: 3600,
      avg_efficiency_wh_per_km: 150,
      regen_ratio: 0.1,
      co2_saved_kg: 20,
      score_overall: 90,
      score_grade: 'A',
      earliest_drive_at: '2024-01-01',
      latest_drive_at: '2024-02-01',
    };
    const warrantyOnlySelection: DisclosureSelection = {
      profileId: 'warranty',
      sections: DISCLOSURE_PROFILE_SECTIONS.warranty,
      sensitive: { vinDisclosure: 'excluded', exactTimestamps: false },
    };
    const report = buildVaultReport({ disclosure: warrantyOnlySelection, evidence });
    expect(report.evidence.driving_history).toBeNull();
  });

  it('keeps evidence for sections that ARE in the selection', () => {
    const evidence = emptyEvidence();
    evidence.vehicle_identity = {
      vin_disclosure: 'excluded', vin_masked: null, vin_full: null, display_name: 'X', model: 'Model 3',
      trim_badging: null, exterior_color: null, wheel_type: null,
    };
    const report = buildVaultReport({ disclosure: baseSelection, evidence });
    expect(report.evidence.vehicle_identity).not.toBeNull();
  });

  it('custom profile with a minimal section list only includes those sections', () => {
    const evidence = emptyEvidence();
    evidence.battery = {
      soh_pct: 90, capacity_wh: 70000, original_capacity_wh: 75000, equivalent_full_cycles: 100,
      fast_charge_ratio: 0.1, avg_charge_limit_pct: 80, health_grade: 'A', thermal_exposure: null,
      degradation_trend: [], recommendations: [], source_provenance_hash: null, issued_at: null, first_observed_at: null,
    };
    evidence.security_incidents = {
      observed_event_count: 3, by_type: [{ event_type: 'x', count: 3 }], acknowledged_count: 1,
      earliest_event_at: null, latest_event_at: null,
    };
    const customSelection: DisclosureSelection = {
      profileId: 'custom',
      sections: ['battery'],
      sensitive: { vinDisclosure: 'excluded', exactTimestamps: false },
    };
    const report = buildVaultReport({ disclosure: customSelection, evidence });
    expect(report.evidence.battery).not.toBeNull();
    expect(report.evidence.security_incidents).toBeNull();
  });
});

describe('buildVaultReport — time bounds', () => {
  it('computes earliest/latest evidence dates across all included sections', () => {
    const evidence = emptyEvidence();
    evidence.battery = {
      soh_pct: 90, capacity_wh: 70000, original_capacity_wh: 75000, equivalent_full_cycles: 100,
      fast_charge_ratio: 0.1, avg_charge_limit_pct: 80, health_grade: 'A', thermal_exposure: null,
      degradation_trend: [{ date: '2023-05-01', soh_pct: 95 }], recommendations: [],
      source_provenance_hash: null, issued_at: '2024-01-01', first_observed_at: '2022-01-01',
    };
    evidence.charging_history = {
      observed_session_count: 5, total_energy_added_wh: 10000, fast_charge_session_count: 1,
      avg_peak_power_w: 50000, total_cost: 10, earliest_session_at: '2023-01-01', latest_session_at: '2024-06-01',
    };
    const report = buildVaultReport({
      disclosure: { profileId: 'resale', sections: ALL_EVIDENCE_SECTIONS, sensitive: baseSelection.sensitive },
      evidence,
    });
    expect(report.time_bounds.earliest_evidence_at).toBe('2022-01-01');
    expect(report.time_bounds.latest_evidence_at).toBe('2024-06-01');
  });

  it('yields null time bounds when there is no dated evidence at all', () => {
    const report = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence() });
    expect(report.time_bounds.earliest_evidence_at).toBeNull();
    expect(report.time_bounds.latest_evidence_at).toBeNull();
  });

  it('reflects the selected precision (day vs exact) in time_bounds.precision', () => {
    const dayReport = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence() });
    expect(dayReport.time_bounds.precision).toBe('day');

    const exactSelection: DisclosureSelection = {
      ...baseSelection,
      sensitive: { ...baseSelection.sensitive, exactTimestamps: true },
    };
    const exactReport = buildVaultReport({ disclosure: exactSelection, evidence: emptyEvidence() });
    expect(exactReport.time_bounds.precision).toBe('exact');
  });

  it('generated_at is never coarsened, even under day precision (it describes the report, not the vehicle)', () => {
    const now = new Date('2024-06-15T13:45:30.123Z');
    const report = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence(), now });
    expect(report.time_bounds.generated_at).toBe('2024-06-15T13:45:30.123Z');
  });
});

describe('buildVaultReport — limitations', () => {
  it('always includes the local-only limitation', () => {
    const report = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence() });
    expect(report.limitations.some((l) => /not been reviewed, verified, or endorsed by Tesla/i.test(l))).toBe(true);
  });

  it('includes the maintenance fleet-wide-scope limitation only when maintenance evidence is present', () => {
    const withMaintenance = emptyEvidence();
    withMaintenance.maintenance = { scheduled_item_count: 1, service_record_count: 0, service_records: [], categories: [] };
    const report = buildVaultReport({ disclosure: baseSelection, evidence: withMaintenance });
    expect(report.limitations.some((l) => /fleet-wide backend endpoint/i.test(l))).toBe(true);

    const without = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence() });
    expect(without.limitations.some((l) => /fleet-wide backend endpoint/i.test(l))).toBe(false);
  });

  it('includes the warranty account-level-scope limitation only when warranty evidence is present', () => {
    const withWarranty = emptyEvidence();
    withWarranty.warranty = { fetched_at: '2024-01-01', data: {} };
    const report = buildVaultReport({ disclosure: baseSelection, evidence: withWarranty });
    expect(report.limitations.some((l) => /Tesla account level/i.test(l))).toBe(true);
  });

  it('includes the observed-window limitation when driving OR charging history is present', () => {
    const withDriving = emptyEvidence();
    withDriving.driving_history = {
      observed_drive_count: 1, total_distance_m: 1, total_duration_s: 1, avg_efficiency_wh_per_km: 1,
      regen_ratio: 0, co2_saved_kg: 0, score_overall: null, score_grade: null, earliest_drive_at: null, latest_drive_at: null,
    };
    const report = buildVaultReport({ disclosure: baseSelection, evidence: withDriving });
    expect(report.limitations.some((l) => /observed window/i.test(l))).toBe(true);
  });
});

describe('buildVaultReport — redaction manifest wiring', () => {
  it('always includes hard-excluded categories in the manifest regardless of profile', () => {
    const report = buildVaultReport({ disclosure: baseSelection, evidence: emptyEvidence() });
    expect(report.redaction_manifest.hard_excluded.length).toBeGreaterThan(0);
  });

  it('lists sections excluded by the current selection', () => {
    const customSelection: DisclosureSelection = {
      profileId: 'custom',
      sections: ['vehicle_identity'],
      sensitive: baseSelection.sensitive,
    };
    const report = buildVaultReport({ disclosure: customSelection, evidence: emptyEvidence() });
    expect(report.redaction_manifest.excluded_by_selection.length).toBe(ALL_EVIDENCE_SECTIONS.length - 1);
  });
});
