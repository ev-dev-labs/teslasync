import type {
  FsdAttributionConfidence,
  FsdCommuteIdentity,
  FsdFirmwareRouteSpotlight,
  FsdFirmwareSpotlight,
  FsdInsights,
  FsdInsightsQuality,
} from '@/types/fsd';

export type ExperimentVerdict = 'changed' | 'unchanged' | 'unknown' | 'underpowered';

export interface CommuteExperimentRow {
  key: string;
  label: string;
  windowLabel: string;
  fromLabel: string;
  toLabel: string;
  fromSharePct: number | null;
  toSharePct: number | null;
  changePts: number | null;
  fromDrives: number;
  toDrives: number;
  unknownDays: number;
  confidence: FsdAttributionConfidence;
  verdict: ExperimentVerdict;
  resetAffected: boolean;
}

export interface FsdCommuteExperiment {
  firmwarePair: { from: string; to: string } | null;
  firmware: CommuteExperimentRow[];
  commutes: CommuteExperimentRow[];
  unknownDayCount: number;
  resetCount: number;
}

const MIN_DRIVES = 2;
const CHANGE_PTS = 3;

function shareConfidence(
  fromShare: number | null,
  toShare: number | null,
  fromDrives: number,
  toDrives: number,
  unknownDays: number,
  resetAffected: boolean,
  left: FsdAttributionConfidence | null,
  right: FsdAttributionConfidence | null,
): { confidence: FsdAttributionConfidence; verdict: ExperimentVerdict } {
  if (fromShare == null || toShare == null) {
    return { confidence: 'unknown', verdict: 'unknown' };
  }
  const thin = fromDrives < MIN_DRIVES || toDrives < MIN_DRIVES || unknownDays > 0 || resetAffected;
  const sides = [left, right];
  const confidence: FsdAttributionConfidence = thin
    ? 'estimated'
    : sides.includes('unknown') || sides.includes('ambiguous')
      ? 'estimated'
      : 'high';
  const change = Math.abs(toShare - fromShare);
  if (thin) return { confidence, verdict: 'underpowered' };
  if (change < CHANGE_PTS) return { confidence, verdict: 'unchanged' };
  return { confidence, verdict: 'changed' };
}

function firmwareRows(spotlight: FsdFirmwareSpotlight | undefined, resetCount: number): CommuteExperimentRow[] {
  if (!spotlight) return [];
  return (spotlight.routes ?? []).map((row: FsdFirmwareRouteSpotlight) => {
    const unknownDays = 0;
    const resetAffected = resetCount > 0;
    const { confidence, verdict } = shareConfidence(
      row.before_fsd_share_pct,
      row.after_fsd_share_pct,
      row.before_drive_count,
      row.after_drive_count,
      unknownDays,
      resetAffected,
      'high',
      'high',
    );
    return {
      key: row.route_key,
      label: row.route_label,
      windowLabel: spotlight.changed_at ?? '',
      fromLabel: spotlight.from_version,
      toLabel: spotlight.to_version,
      fromSharePct: row.before_fsd_share_pct,
      toSharePct: row.after_fsd_share_pct,
      changePts: row.share_change_pct_points,
      fromDrives: row.before_drive_count,
      toDrives: row.after_drive_count,
      unknownDays,
      confidence,
      verdict,
      resetAffected,
    };
  });
}

function commuteRows(rows: FsdCommuteIdentity[] | undefined, resetCount: number): CommuteExperimentRow[] {
  return (rows ?? []).map((row) => {
    const unknownDays = (row.this_month.unknown_days ?? 0) + (row.last_month.unknown_days ?? 0);
    const resetAffected = resetCount > 0;
    const { confidence, verdict } = shareConfidence(
      row.last_month.fsd_share_pct,
      row.this_month.fsd_share_pct,
      row.last_month.drive_count,
      row.this_month.drive_count,
      unknownDays,
      resetAffected,
      row.last_month.confidence,
      row.this_month.confidence,
    );
    return {
      key: `${row.route_key}|${row.window_key}`,
      label: row.route_label,
      windowLabel: row.window_label,
      fromLabel: row.last_month.month,
      toLabel: row.this_month.month,
      fromSharePct: row.last_month.fsd_share_pct,
      toSharePct: row.this_month.fsd_share_pct,
      changePts: row.share_change_pct_points,
      fromDrives: row.last_month.drive_count,
      toDrives: row.this_month.drive_count,
      unknownDays,
      confidence,
      verdict,
      resetAffected,
    };
  });
}

export function buildFsdCommuteExperiment(insights: FsdInsights | undefined): FsdCommuteExperiment {
  const quality: FsdInsightsQuality | undefined = insights?.quality;
  const spotlight = insights?.drive_analytics?.firmware_spotlight;
  const resetCount = (quality?.fsd_reset_count ?? 0) + (quality?.driving_reset_count ?? 0);
  return {
    firmwarePair: spotlight?.from_version && spotlight?.to_version
      ? { from: spotlight.from_version, to: spotlight.to_version }
      : null,
    firmware: firmwareRows(spotlight, resetCount),
    commutes: commuteRows(insights?.drive_analytics?.commute_identities, resetCount),
    unknownDayCount: quality?.days_without_counter_observation ?? 0,
    resetCount,
  };
}
