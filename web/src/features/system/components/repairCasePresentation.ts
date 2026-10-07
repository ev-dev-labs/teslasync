import type {
  RepairCaseStatus,
} from '@/api/hooks/useDataRepair';
import type { TFunction } from 'i18next';

export const REPAIR_STATUS_COLORS: Record<RepairCaseStatus, string> = {
  open: 'bg-amber-400',
  in_review: 'bg-cyan-400',
  applied: 'bg-emerald-400',
  dismissed: 'bg-slate-400',
  quarantined: 'bg-rose-400',
  restored: 'bg-indigo-400',
  resolved: 'bg-emerald-400',
};

export const REPAIR_STATUS_BADGE_VARIANTS: Record<
  RepairCaseStatus,
  'neutral' | 'info' | 'warning' | 'success' | 'danger'
> = {
  open: 'danger',
  in_review: 'warning',
  applied: 'success',
  dismissed: 'neutral',
  quarantined: 'danger',
  restored: 'info',
  resolved: 'success',
};

const REPAIR_CODE_LABELS: Record<string, { key: string; fallback: string }> = {
  drive_open_charging_started: {
    key: 'dataRepair.rule.driveOpenChargingStarted.label',
    fallback: 'Drive left open, then charging started',
  },
  drive_open_park_observed: {
    key: 'dataRepair.rule.driveOpenParkObserved.label',
    fallback: 'Drive left open after the car parked',
  },
  drive_end_after_contradiction: {
    key: 'dataRepair.rule.driveEndAfterContradiction.label',
    fallback: 'Drive ends long after it really finished',
  },
  charging_open_charge_ended: {
    key: 'dataRepair.rule.chargingOpenChargeEnded.label',
    fallback: 'Charging left open after it stopped',
  },
  charging_open_drive_started: {
    key: 'dataRepair.rule.chargingOpenDriveStarted.label',
    fallback: 'Charging left open, then the car drove away',
  },
  charging_end_after_contradiction: {
    key: 'dataRepair.rule.chargingEndAfterContradiction.label',
    fallback: 'Charging ends long after it really finished',
  },
  ended_before_started: {
    key: 'dataRepair.cases.findings.endedBeforeStarted',
    fallback: 'Session ends before it starts',
  },
  duration_mismatch: {
    key: 'dataRepair.cases.findings.durationMismatch',
    fallback: 'Stored duration does not match the session window',
  },
  same_kind_overlap_drive: {
    key: 'dataRepair.cases.findings.driveOverlap',
    fallback: 'Drive overlaps another drive',
  },
  same_kind_overlap_charging: {
    key: 'dataRepair.cases.findings.chargingOverlap',
    fallback: 'Charging session overlaps another charging session',
  },
  cross_kind_overlap_drive_charging: {
    key: 'dataRepair.cases.findings.driveChargingOverlap',
    fallback: 'Drive and charging windows overlap',
  },
  duplicate_session_window: {
    key: 'dataRepair.cases.findings.duplicateWindow',
    fallback: 'Duplicate session window',
  },
  odometer_rollback: {
    key: 'dataRepair.cases.findings.odometerRollback',
    fallback: 'Odometer moves backwards during the session',
  },
  soc_inconsistent: {
    key: 'dataRepair.cases.findings.socInconsistent',
    fallback: 'State of charge changes in the wrong direction',
  },
  negative_aggregate_distance_m: {
    key: 'dataRepair.cases.findings.negativeDistance',
    fallback: 'Distance is negative',
  },
  negative_aggregate_duration_s: {
    key: 'dataRepair.cases.findings.negativeDuration',
    fallback: 'Duration is negative',
  },
  negative_aggregate_energy_used_wh: {
    key: 'dataRepair.cases.findings.negativeEnergyUsed',
    fallback: 'Energy used is negative',
  },
  negative_aggregate_regen_energy_wh: {
    key: 'dataRepair.cases.findings.negativeRegenEnergy',
    fallback: 'Regenerated energy is negative',
  },
  negative_aggregate_total_energy_added_wh: {
    key: 'dataRepair.cases.findings.negativeEnergyAdded',
    fallback: 'Energy added is negative',
  },
  operator_manual_quarantine: {
    key: 'dataRepair.cases.findings.manualQuarantine',
    fallback: 'Operator-requested quarantine',
  },
  overlaps_next_session: {
    key: 'dataRepair.blocked.overlapsNextSession',
    fallback: 'The proposed boundary overlaps the next session',
  },
  structural_anomaly_requires_manual_correction: {
    key: 'dataRepair.cases.blockedReasons.structuralCorrection',
    fallback: 'This structural anomaly requires a manual correction',
  },
  operator_manual_action: {
    key: 'dataRepair.cases.blockedReasons.operatorAction',
    fallback: 'This case records an explicit operator action',
  },
  repair_not_applicable: {
    key: 'dataRepair.cases.blockedReasons.notApplicable',
    fallback: 'No safe automatic boundary is available',
  },
};

export function humanizeRepairCode(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function repairCodeLabel(t: TFunction, value: string): string {
  const presentation = REPAIR_CODE_LABELS[value];
  if (!presentation) return humanizeRepairCode(value);
  return t(presentation.key, presentation.fallback);
}

export function repairStatusLabel(t: TFunction, status: RepairCaseStatus): string {
  const labels: Record<RepairCaseStatus, string> = {
    open: t('dataRepair.cases.status.open', 'Open'),
    in_review: t('dataRepair.cases.status.inReview', 'In review'),
    applied: t('dataRepair.cases.status.applied', 'Applied'),
    dismissed: t('dataRepair.cases.status.dismissed', 'Dismissed'),
    quarantined: t('dataRepair.cases.status.quarantined', 'Quarantined'),
    restored: t('dataRepair.cases.status.restored', 'Restored'),
    resolved: t('dataRepair.cases.status.resolved', 'Resolved'),
  };
  return labels[status];
}
