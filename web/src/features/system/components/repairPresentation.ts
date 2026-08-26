import type {
  RepairConfidence,
  RepairEvidenceSource,
  RepairRule,
  RepairSessionKind,
} from '@/api/hooks/useDataRepair';

/**
 * Presentation mapping for the evidence-based repair worklist.
 *
 * The backend emits stable machine tokens (rule / confidence / evidence
 * source / blocked reason) and never localized prose, so every user-visible
 * string is produced here through `t()`. Keeping the mapping in a pure module
 * makes the exhaustiveness testable without rendering React.
 */

/** Minimal `t` shape: key + English fallback. Matches react-i18next's `t`. */
export type RepairTFunc = (key: string, fallback: string) => string;

const rfc3339BoundaryPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isRFC3339Boundary(value: string): boolean {
  const trimmed = value.trim();
  return rfc3339BoundaryPattern.test(trimmed) && Number.isFinite(Date.parse(trimmed));
}

/** Short, scannable title for a rule — what happened. */
export function ruleLabel(t: RepairTFunc, rule: RepairRule): string {
  switch (rule) {
    case 'drive_open_charging_started':
      return t('dataRepair.rule.driveOpenChargingStarted.label', 'Drive left open, then charging started');
    case 'drive_open_park_observed':
      return t('dataRepair.rule.driveOpenParkObserved.label', 'Drive left open after the car parked');
    case 'drive_end_after_contradiction':
      return t('dataRepair.rule.driveEndAfterContradiction.label', 'Drive ends long after it really finished');
    case 'charging_open_charge_ended':
      return t('dataRepair.rule.chargingOpenChargeEnded.label', 'Charging left open after it stopped');
    case 'charging_open_drive_started':
      return t('dataRepair.rule.chargingOpenDriveStarted.label', 'Charging left open, then the car drove away');
    case 'charging_end_after_contradiction':
      return t('dataRepair.rule.chargingEndAfterContradiction.label', 'Charging ends long after it really finished');
    default:
      return t('dataRepair.rule.unknown.label', 'Session boundary looks wrong');
  }
}

/** One sentence explaining the contradiction — why we think it is broken. */
export function ruleExplanation(t: RepairTFunc, rule: RepairRule): string {
  switch (rule) {
    case 'drive_open_charging_started':
      return t(
        'dataRepair.rule.driveOpenChargingStarted.why',
        'The car was last seen driving, and the next durable event is a charging session starting. A car cannot drive and charge at once, so the Park signal that should have ended this drive was never recorded.',
      );
    case 'drive_open_park_observed':
      return t(
        'dataRepair.rule.driveOpenParkObserved.why',
        'Drive telemetry recorded the car shifting into Park after this drive started, but the drive was never closed. The signal arrived; the completion write did not.',
      );
    case 'drive_end_after_contradiction':
      return t(
        'dataRepair.rule.driveEndAfterContradiction.why',
        'This drive is already closed, but its end time is well after durable evidence shows the drive had finished — so it swallowed time that belongs to another session.',
      );
    case 'charging_open_charge_ended':
      return t(
        'dataRepair.rule.chargingOpenChargeEnded.why',
        'A later charge-state observation shows charging had stopped, but the session is still recorded as in progress.',
      );
    case 'charging_open_drive_started':
      return t(
        'dataRepair.rule.chargingOpenDriveStarted.why',
        'The car shifted into a driving gear (or a drive was recorded) while this charging session was still open. Charging and driving are mutually exclusive.',
      );
    case 'charging_end_after_contradiction':
      return t(
        'dataRepair.rule.chargingEndAfterContradiction.why',
        'This charging session is already closed, but its end time is well after durable evidence shows charging had finished.',
      );
    default:
      return t(
        'dataRepair.rule.unknown.why',
        'Stored session state contradicts later durable evidence.',
      );
  }
}

export function confidenceLabel(t: RepairTFunc, confidence: RepairConfidence): string {
  switch (confidence) {
    case 'high':
      return t('dataRepair.confidence.high', 'High confidence');
    case 'medium':
      return t('dataRepair.confidence.medium', 'Medium confidence');
    default:
      return t('dataRepair.confidence.unknown', 'Unrated confidence');
  }
}

/** Badge variant for a confidence grade. Never `success` — nothing is proven. */
export function confidenceVariant(confidence: RepairConfidence): 'info' | 'warning' | 'neutral' {
  switch (confidence) {
    case 'high':
      return 'info';
    case 'medium':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Which durable table an observation came from. */
export function evidenceSourceLabel(t: RepairTFunc, source: RepairEvidenceSource): string {
  switch (source) {
    case 'signal_log':
      return t('dataRepair.source.signalLog', 'Signal history');
    case 'drive_telemetry':
      return t('dataRepair.source.driveTelemetry', 'Drive telemetry');
    case 'charging_telemetry':
      return t('dataRepair.source.chargingTelemetry', 'Charging telemetry');
    case 'drives':
      return t('dataRepair.source.drives', 'Drive record');
    case 'charging_sessions':
      return t('dataRepair.source.chargingSessions', 'Charging record');
    default:
      return t('dataRepair.source.unknown', 'Durable history');
  }
}

/** Why an otherwise-valid suggestion cannot be applied right now. */
export function blockedReasonLabel(t: RepairTFunc, reason: string | undefined): string {
  if (reason === 'overlaps_next_session') {
    return t(
      'dataRepair.blocked.overlapsNextSession',
      'Applying this would still leave the session overlapping the next one for this vehicle. Fix the neighbouring session first.',
    );
  }
  return t('dataRepair.blocked.unknown', 'This suggestion cannot be applied right now.');
}

export function sessionKindLabel(t: RepairTFunc, kind: RepairSessionKind): string {
  return kind === 'drive'
    ? t('dataRepair.kind.drive', 'Drive')
    : t('dataRepair.kind.charging', 'Charging session');
}
