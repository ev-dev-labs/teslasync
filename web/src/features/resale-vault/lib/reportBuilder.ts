/**
 * Report builder.
 *
 * Pure assembly of a `VaultReport` from already-normalized evidence (see
 * `evidenceNormalizers.ts`) plus the user's `DisclosureSelection`. This is
 * the single place that:
 *
 *   - Re-applies section filtering as a defense-in-depth measure: even if
 *     a caller accidentally passes evidence for a section the user did
 *     NOT select, `buildVaultReport()` blanks it back out to `null`. The
 *     disclosure selection is the source of truth for what leaves the
 *     browser, not whatever happened to be in memory.
 *   - Computes the report's overall time bounds from whatever evidence
 *     dates survived filtering/redaction.
 *   - Attaches the fixed, honest limitations that apply given which
 *     sections are present (e.g. the fleet-wide, non-vehicle-scoped
 *     maintenance/warranty backend endpoints), plus the general
 *     "observed window, not lifetime" caveat already documented on the
 *     underlying `useDriveHistory`/`useChargingHistory` hooks.
 *   - Is fully deterministic given an injected `now`/`reportId` (both
 *     optional; production callers omit them and get real values),
 *     which is what makes canonical-stability tests possible.
 */
import { ALL_EVIDENCE_SECTIONS, type EvidenceSectionId, VAULT_APP_VERSION, VAULT_SCHEMA_VERSION } from './constants';
import { buildRedactionManifest } from './redaction';
import type { DisclosureSelection, VaultEvidence, VaultReport, VaultTimeBounds } from './types';

function newReportId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
  return `report_${b64}`;
}

/** Blanks out any evidence section the disclosure selection did not include, regardless of what the caller passed in. */
function filterEvidenceBySelection(evidence: VaultEvidence, sections: readonly EvidenceSectionId[]): VaultEvidence {
  const selected = new Set(sections);
  return {
    vehicle_identity: selected.has('vehicle_identity') ? evidence.vehicle_identity : null,
    battery: selected.has('battery') ? evidence.battery : null,
    maintenance: selected.has('maintenance') ? evidence.maintenance : null,
    software_updates: selected.has('software_updates') ? evidence.software_updates : null,
    warranty: selected.has('warranty') ? evidence.warranty : null,
    driving_history: selected.has('driving_history') ? evidence.driving_history : null,
    charging_history: selected.has('charging_history') ? evidence.charging_history : null,
    security_incidents: selected.has('security_incidents') ? evidence.security_incidents : null,
  };
}

function collectEvidenceDates(evidence: VaultEvidence): string[] {
  const dates: Array<string | null | undefined> = [];
  if (evidence.battery) {
    dates.push(evidence.battery.issued_at, evidence.battery.first_observed_at);
    for (const point of evidence.battery.degradation_trend) dates.push(point.date);
  }
  if (evidence.maintenance) {
    for (const record of evidence.maintenance.service_records) dates.push(record.date);
  }
  if (evidence.software_updates) {
    for (const v of evidence.software_updates.installed_versions) dates.push(v.installed_at);
  }
  if (evidence.warranty) dates.push(evidence.warranty.fetched_at);
  if (evidence.driving_history) dates.push(evidence.driving_history.earliest_drive_at, evidence.driving_history.latest_drive_at);
  if (evidence.charging_history) dates.push(evidence.charging_history.earliest_session_at, evidence.charging_history.latest_session_at);
  if (evidence.security_incidents) dates.push(evidence.security_incidents.earliest_event_at, evidence.security_incidents.latest_event_at);
  return dates.filter((d): d is string => typeof d === 'string' && d.length > 0);
}

function buildTimeBounds(evidence: VaultEvidence, generatedAt: string, exactTimestamps: boolean): VaultTimeBounds {
  const dates = collectEvidenceDates(evidence).sort();
  return {
    generated_at: generatedAt,
    earliest_evidence_at: dates[0] ?? null,
    latest_evidence_at: dates[dates.length - 1] ?? null,
    precision: exactTimestamps ? 'exact' : 'day',
  };
}

/** Fixed limitation strings, included whenever the corresponding evidence section is present in the final (filtered) report. */
const MAINTENANCE_SCOPE_LIMITATION =
  'Maintenance schedule and service records are read from a fleet-wide backend endpoint that is not filtered per ' +
  'vehicle. If this TeslaSync account has more than one vehicle, some entries may not belong to the vehicle this ' +
  'report is otherwise about.';

const WARRANTY_SCOPE_LIMITATION =
  'Warranty details are fetched at the Tesla account level, not scoped to an individual vehicle. If this account ' +
  'has more than one vehicle, this data may not correspond 1:1 with the vehicle this report is otherwise about.';

const OBSERVED_WINDOW_LIMITATION =
  'Driving and charging history reflect an observed window of up to the most recent 1,000 records per category, ' +
  'as returned by the backend — not a guaranteed complete lifetime history of the vehicle.';

const LOCAL_ONLY_LIMITATION =
  'This report was assembled entirely in your browser from data already synced to your TeslaSync account. It has ' +
  'not been reviewed, verified, or endorsed by Tesla or any government/regulatory authority.';

function buildLimitations(evidence: VaultEvidence): string[] {
  const limitations = [LOCAL_ONLY_LIMITATION];
  if (evidence.maintenance) limitations.push(MAINTENANCE_SCOPE_LIMITATION);
  if (evidence.warranty) limitations.push(WARRANTY_SCOPE_LIMITATION);
  if (evidence.driving_history || evidence.charging_history) limitations.push(OBSERVED_WINDOW_LIMITATION);
  return limitations;
}

const ATTESTATION_STATEMENT =
  'This report attests only that the enclosed vehicle history data was assembled, at the stated time, by the ' +
  'TeslaSync application running in a web browser, and — once signed — that the signed content has not been ' +
  'altered since signing. It is a local, self-attested record, not a certification by Tesla, a dealer, an ' +
  'inspector, or any government authority.';

export interface BuildVaultReportInput {
  disclosure: DisclosureSelection;
  evidence: VaultEvidence;
  /** Injectable for deterministic tests; omit in production to use the real current time. */
  now?: Date;
  /** Injectable for deterministic tests; omit in production to generate a random id. */
  reportId?: string;
}

/** Assembles the final, redacted `VaultReport` ready for canonicalization/signing. */
export function buildVaultReport({ disclosure, evidence, now, reportId }: BuildVaultReportInput): VaultReport {
  const filteredEvidence = filterEvidenceBySelection(evidence, disclosure.sections);
  const generatedAt = (now ?? new Date()).toISOString();

  return {
    schema_version: VAULT_SCHEMA_VERSION,
    app_version: VAULT_APP_VERSION,
    report_id: reportId ?? newReportId(),
    disclosure,
    time_bounds: buildTimeBounds(filteredEvidence, generatedAt, disclosure.sensitive.exactTimestamps),
    evidence: filteredEvidence,
    redaction_manifest: buildRedactionManifest(ALL_EVIDENCE_SECTIONS, disclosure.sections, disclosure.sensitive),
    limitations: buildLimitations(filteredEvidence),
    attestation_statement: ATTESTATION_STATEMENT,
  };
}
