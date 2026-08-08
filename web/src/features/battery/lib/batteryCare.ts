/**
 * Pure Battery Care evidence model.
 *
 * The model describes the bounded charging-session and drive history returned
 * by the existing APIs. It is not a battery-health or degradation model: the
 * available rows reveal session-end SoC, drive-arrival SoC, delivered energy,
 * charger labels, and timestamps, but not how long the pack remained at a
 * given SoC.
 */

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

export const BATTERY_CARE_HISTORY_LIMIT = 1_000;
export const CARE_BAND_MIN_PCT = 20;
export const CARE_BAND_MAX_PCT = 80;
export const FULL_CHARGE_PCT = 95;
export const DEEP_DISCHARGE_PCT = 10;
export const MIN_SCORE_SESSIONS = 5;
export const MIN_SCORE_DRIVES = 5;
export const MIN_SCORE_ENERGY_SESSIONS = 3;
export const MIN_ENERGY_CLASSIFICATION_COVERAGE = 0.8;
export const MIN_MONTHLY_SESSIONS = 3;
export const MIN_MONTHLY_DRIVES = 3;
export const MIN_MONTHLY_ENERGY_SESSIONS = 2;
export const CARE_TREND_MONTHS = 6;
export const MAX_CARE_TREND_MONTHS = 12;
export const DC_INFERENCE_POWER_W = 20_000;

const ACTION_THRESHOLDS: Record<CareRiskId, number> = {
  highFinish: 0.2,
  deepArrival: 0.2,
  dcEnergy: 0.4,
  outsideBand: 0.3,
};

const RISK_ORDER: readonly CareRiskId[] = [
  'highFinish',
  'deepArrival',
  'dcEnergy',
  'outsideBand',
];

export type ChargerCategory = 'ac' | 'dc' | 'unknown';
export type EndSocBucketId = 'belowBand' | 'careBand' | 'aboveBand' | 'highFinish';
export type ArrivalSocBucketId = 'below10' | '10to19' | '20to49' | '50plus';
export type CareRiskId = 'highFinish' | 'deepArrival' | 'dcEnergy' | 'outsideBand';

export interface EndSocBucket {
  id: EndSocBucketId;
  count: number;
  share: number | null;
}

export interface ArrivalSocBucket {
  id: ArrivalSocBucketId;
  count: number;
  share: number | null;
}

export interface EnergyMixBucket {
  category: ChargerCategory;
  sessions: number;
  energyWh: number;
  share: number | null;
}

export interface CareEnergyMix {
  buckets: EnergyMixBucket[];
  totalEnergyWh: number;
  classifiedEnergyWh: number;
  energySessions: number;
  classifiedSessions: number;
  classificationCoverage: number | null;
}

export interface CareRiskComponent {
  id: CareRiskId;
  maxPoints: number;
  observedShare: number | null;
  penaltyPoints: number | null;
  sampleCount: number;
  ready: boolean;
}

export interface CareOpportunity {
  id: CareRiskId;
  rank: number;
  observedShare: number;
  penaltyPoints: number;
  sampleCount: number;
}

export interface MonthlyCarePoint {
  month: string;
  score: number | null;
  scoreReady: boolean;
  sessionsAnalyzed: number;
  drivesAnalyzed: number;
  fullChargeShare: number | null;
  deepDischargeShare: number | null;
  dcEnergyShare: number | null;
  bandFinishShare: number | null;
}

export interface CareCoverage {
  returnedSessions: number;
  returnedDrives: number;
  excludedEndSocSessions: number;
  excludedArrivalDrives: number;
  excludedEnergySessions: number;
  unclassifiedEnergySessions: number;
  excludedSessionTimestamps: number;
  excludedDriveTimestamps: number;
  sessionWindowCapped: boolean;
  driveWindowCapped: boolean;
  observationStartMs: number | null;
  observationEndMs: number | null;
}

export interface CareBreakdown {
  fullChargePct: number;
  fullChargeShare: number | null;
  deepDischargeShare: number | null;
  dcEnergyShare: number | null;
  bandFinishShare: number | null;
  sessionsAnalyzed: number;
  drivesAnalyzed: number;
  medianEndSocPct: number | null;
  medianArrivalSocPct: number | null;
  endSocDistribution: EndSocBucket[];
  arrivalSocDistribution: ArrivalSocBucket[];
  energyMix: CareEnergyMix;
}

export interface CareScore extends CareBreakdown {
  /**
   * Descriptive 0–100 index. It is withheld until every component clears its
   * sample and charger-classification guard.
   */
  score: number | null;
  scoreReady: boolean;
  riskComponents: CareRiskComponent[];
  opportunities: CareOpportunity[];
  monthly: MonthlyCarePoint[];
  coverage: CareCoverage;
}

export interface BatteryCareOptions {
  fullChargePct?: number;
  nowMs?: number;
  trendMonths?: number;
  sessionLimit?: number;
  driveLimit?: number;
}

interface ScoreThresholds {
  sessions: number;
  drives: number;
  energySessions: number;
}

interface CoreEvidence extends CareBreakdown {
  score: number | null;
  scoreReady: boolean;
  riskComponents: CareRiskComponent[];
}

interface MonthGroup {
  sessions: ChargingSession[];
  drives: Drive[];
}

/**
 * The hexagonal `/charging-sessions` handler currently emits these
 * SI-equivalent camel-case domain keys. The request client preserves original
 * keys, so accept them at the model boundary without changing the shared hook.
 */
interface ChargingSessionRuntimeAliases {
  chargerType?: string | null;
  endBatteryLevel?: number | null;
  energyAddedWh?: number | null;
  maxPowerW?: number | null;
}

/** Conservative classification from the fields already present on a session. */
export function classifyCharger(
  chargerType: string | null | undefined,
  peakPowerW?: number | null,
): ChargerCategory {
  const normalized = chargerType?.trim().toLowerCase() ?? '';
  if (
    normalized.includes('wall') ||
    normalized.includes('home') ||
    normalized.includes('destination') ||
    normalized.includes('mobile') ||
    normalized.includes('j1772') ||
    normalized.includes('type 2') ||
    normalized.includes('type2') ||
    normalized.includes('level 1') ||
    normalized.includes('level 2') ||
    /(^|[\s/_-])ac($|[\s/_-])/.test(normalized)
  ) {
    return 'ac';
  }
  if (
    normalized.includes('super') ||
    normalized.includes('tesla') ||
    normalized.includes('ccs') ||
    normalized.includes('chademo') ||
    normalized.includes('fast') ||
    /(^|[\s/_-])dc($|[\s/_-])/.test(normalized)
  ) {
    return 'dc';
  }
  if (
    !normalized &&
    typeof peakPowerW === 'number' &&
    Number.isFinite(peakPowerW) &&
    peakPowerW > DC_INFERENCE_POWER_W
  ) {
    return 'dc';
  }
  return 'unknown';
}

/** Backward-compatible charger-label predicate used by existing model tests. */
export function isDcSession(chargerType: string | null): boolean {
  return classifyCharger(chargerType) === 'dc';
}

function finitePct(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function share(hits: number, total: number): number | null {
  return total > 0 ? hits / total : null;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sessionTimestamp(session: ChargingSession): number | null {
  const candidates = [session.started_at, session.start_ts, session.startedAt];
  for (const candidate of candidates) {
    const timestamp = parseTimestamp(candidate);
    if (timestamp != null) return timestamp;
  }
  return null;
}

function driveTimestamp(drive: Drive): number | null {
  return parseTimestamp(drive.startTs);
}

function sessionAliases(
  session: ChargingSession,
): ChargingSession & ChargingSessionRuntimeAliases {
  return session;
}

function sessionEndSoc(session: ChargingSession): number | null | undefined {
  const aliases = sessionAliases(session);
  return session.end_soc_pct ?? aliases.endBatteryLevel;
}

function sessionEnergyWh(session: ChargingSession): number | null | undefined {
  const aliases = sessionAliases(session);
  return session.total_energy_added_wh ?? aliases.energyAddedWh;
}

function sessionChargerType(
  session: ChargingSession,
): string | null | undefined {
  const aliases = sessionAliases(session);
  return session.charger_type ?? aliases.chargerType;
}

function sessionPeakPowerW(
  session: ChargingSession,
): number | null | undefined {
  const aliases = sessionAliases(session);
  return session.peak_power_w ?? aliases.maxPowerW;
}

function buildEndSocDistribution(values: readonly number[]): EndSocBucket[] {
  const total = values.length;
  const counts: Record<EndSocBucketId, number> = {
    belowBand: 0,
    careBand: 0,
    aboveBand: 0,
    highFinish: 0,
  };
  for (const value of values) {
    if (value < CARE_BAND_MIN_PCT) counts.belowBand += 1;
    else if (value <= CARE_BAND_MAX_PCT) counts.careBand += 1;
    else if (value < FULL_CHARGE_PCT) counts.aboveBand += 1;
    else counts.highFinish += 1;
  }
  return (Object.keys(counts) as EndSocBucketId[]).map((id) => ({
    id,
    count: counts[id],
    share: share(counts[id], total),
  }));
}

function buildArrivalDistribution(values: readonly number[]): ArrivalSocBucket[] {
  const total = values.length;
  const counts: Record<ArrivalSocBucketId, number> = {
    below10: 0,
    '10to19': 0,
    '20to49': 0,
    '50plus': 0,
  };
  for (const value of values) {
    if (value < DEEP_DISCHARGE_PCT) counts.below10 += 1;
    else if (value < CARE_BAND_MIN_PCT) counts['10to19'] += 1;
    else if (value < 50) counts['20to49'] += 1;
    else counts['50plus'] += 1;
  }
  return (Object.keys(counts) as ArrivalSocBucketId[]).map((id) => ({
    id,
    count: counts[id],
    share: share(counts[id], total),
  }));
}

function buildEnergyMix(sessions: readonly ChargingSession[]): CareEnergyMix {
  const totals: Record<ChargerCategory, { sessions: number; energyWh: number }> = {
    ac: { sessions: 0, energyWh: 0 },
    dc: { sessions: 0, energyWh: 0 },
    unknown: { sessions: 0, energyWh: 0 },
  };
  let totalEnergyWh = 0;
  let energySessions = 0;

  for (const session of sessions) {
    const energyWh = sessionEnergyWh(session);
    if (!positiveFinite(energyWh)) continue;
    const category = classifyCharger(
      sessionChargerType(session),
      sessionPeakPowerW(session),
    );
    totals[category].sessions += 1;
    totals[category].energyWh += energyWh;
    totalEnergyWh += energyWh;
    energySessions += 1;
  }

  const classifiedEnergyWh = totals.ac.energyWh + totals.dc.energyWh;
  const classifiedSessions = totals.ac.sessions + totals.dc.sessions;
  const categories: readonly ChargerCategory[] = ['ac', 'dc', 'unknown'];
  return {
    buckets: categories.map((category) => ({
      category,
      sessions: totals[category].sessions,
      energyWh: totals[category].energyWh,
      share: totalEnergyWh > 0 ? totals[category].energyWh / totalEnergyWh : null,
    })),
    totalEnergyWh,
    classifiedEnergyWh,
    energySessions,
    classifiedSessions,
    classificationCoverage:
      totalEnergyWh > 0 ? classifiedEnergyWh / totalEnergyWh : null,
  };
}

function riskComponent(
  id: CareRiskId,
  maxPoints: number,
  observedShare: number | null,
  sampleCount: number,
  ready: boolean,
): CareRiskComponent {
  return {
    id,
    maxPoints,
    observedShare,
    sampleCount,
    ready,
    penaltyPoints:
      ready && observedShare != null ? roundOne(maxPoints * observedShare) : null,
  };
}

function buildCoreEvidence(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  fullChargePct: number,
  thresholds: ScoreThresholds,
): CoreEvidence {
  const endSocs = sessions
    .map(sessionEndSoc)
    .filter(finitePct);
  const arrivalSocs = drives
    .map((drive) => drive.endBatteryPct)
    .filter(finitePct);
  const energyMix = buildEnergyMix(sessions);

  const fullChargeShare = share(
    endSocs.filter((value) => value >= fullChargePct).length,
    endSocs.length,
  );
  const bandFinishShare = share(
    endSocs.filter(
      (value) => value >= CARE_BAND_MIN_PCT && value <= CARE_BAND_MAX_PCT,
    ).length,
    endSocs.length,
  );
  const deepDischargeShare = share(
    arrivalSocs.filter((value) => value < DEEP_DISCHARGE_PCT).length,
    arrivalSocs.length,
  );
  const dcBucket = energyMix.buckets.find((bucket) => bucket.category === 'dc');
  const dcEnergyShare =
    energyMix.classifiedEnergyWh > 0 && dcBucket
      ? dcBucket.energyWh / energyMix.classifiedEnergyWh
      : null;
  const energyReady =
    energyMix.classifiedSessions >= thresholds.energySessions &&
    energyMix.classificationCoverage != null &&
    energyMix.classificationCoverage >= MIN_ENERGY_CLASSIFICATION_COVERAGE &&
    dcEnergyShare != null;

  const riskComponents = [
    riskComponent(
      'highFinish',
      30,
      fullChargeShare,
      endSocs.length,
      endSocs.length >= thresholds.sessions,
    ),
    riskComponent(
      'deepArrival',
      30,
      deepDischargeShare,
      arrivalSocs.length,
      arrivalSocs.length >= thresholds.drives,
    ),
    riskComponent(
      'dcEnergy',
      20,
      dcEnergyShare,
      energyMix.classifiedSessions,
      energyReady,
    ),
    riskComponent(
      'outsideBand',
      20,
      bandFinishShare != null ? 1 - bandFinishShare : null,
      endSocs.length,
      endSocs.length >= thresholds.sessions,
    ),
  ];
  const scoreReady = riskComponents.every((component) => component.ready);
  const totalPenalty = riskComponents.reduce(
    (total, component) => total + (component.penaltyPoints ?? 0),
    0,
  );
  const score = scoreReady
    ? Math.round(Math.min(100, Math.max(0, 100 - totalPenalty)))
    : null;

  return {
    fullChargePct,
    fullChargeShare,
    deepDischargeShare,
    dcEnergyShare,
    bandFinishShare,
    sessionsAnalyzed: endSocs.length,
    drivesAnalyzed: arrivalSocs.length,
    medianEndSocPct: median(endSocs),
    medianArrivalSocPct: median(arrivalSocs),
    endSocDistribution: buildEndSocDistribution(endSocs),
    arrivalSocDistribution: buildArrivalDistribution(arrivalSocs),
    energyMix,
    riskComponents,
    scoreReady,
    score,
  };
}

function buildOpportunities(
  components: readonly CareRiskComponent[],
): CareOpportunity[] {
  return components
    .filter(
      (
        component,
      ): component is CareRiskComponent & {
        observedShare: number;
        penaltyPoints: number;
      } =>
        component.ready &&
        component.observedShare != null &&
        component.penaltyPoints != null &&
        component.observedShare >= ACTION_THRESHOLDS[component.id],
    )
    .sort((a, b) => {
      const penaltyDelta = b.penaltyPoints - a.penaltyPoints;
      return penaltyDelta !== 0
        ? penaltyDelta
        : RISK_ORDER.indexOf(a.id) - RISK_ORDER.indexOf(b.id);
    })
    .map((component, index) => ({
      id: component.id,
      rank: index + 1,
      observedShare: component.observedShare,
      penaltyPoints: component.penaltyPoints,
      sampleCount: component.sampleCount,
    }));
}

function resolveNowMs(
  requestedNowMs: number | undefined,
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
): number {
  if (typeof requestedNowMs === 'number' && Number.isFinite(requestedNowMs)) {
    return requestedNowMs;
  }
  const timestamps = [
    ...sessions.map(sessionTimestamp),
    ...drives.map(driveTimestamp),
  ].filter((value): value is number => value != null);
  return timestamps.length > 0 ? Math.max(...timestamps) : Date.UTC(1970, 0, 1);
}

function monthKeys(nowMs: number, count: number): string[] {
  const now = new Date(nowMs);
  const endYear = now.getUTCFullYear();
  const endMonth = now.getUTCMonth();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(endYear, endMonth - (count - index - 1), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function buildMonthlyCare(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  fullChargePct: number,
  nowMs: number,
  count: number,
): MonthlyCarePoint[] {
  const keys = monthKeys(nowMs, count);
  const groups = new Map<string, MonthGroup>(
    keys.map((key) => [key, { sessions: [], drives: [] }]),
  );

  for (const session of sessions) {
    const timestamp = sessionTimestamp(session);
    if (timestamp == null || timestamp > nowMs) continue;
    groups.get(monthKey(timestamp))?.sessions.push(session);
  }
  for (const drive of drives) {
    const timestamp = driveTimestamp(drive);
    if (timestamp == null || timestamp > nowMs) continue;
    groups.get(monthKey(timestamp))?.drives.push(drive);
  }

  return keys.map((month) => {
    const group = groups.get(month)!;
    const evidence = buildCoreEvidence(
      group.sessions,
      group.drives,
      fullChargePct,
      {
        sessions: MIN_MONTHLY_SESSIONS,
        drives: MIN_MONTHLY_DRIVES,
        energySessions: MIN_MONTHLY_ENERGY_SESSIONS,
      },
    );
    return {
      month,
      score: evidence.score,
      scoreReady: evidence.scoreReady,
      sessionsAnalyzed: evidence.sessionsAnalyzed,
      drivesAnalyzed: evidence.drivesAnalyzed,
      fullChargeShare: evidence.fullChargeShare,
      deepDischargeShare: evidence.deepDischargeShare,
      dcEnergyShare: evidence.dcEnergyShare,
      bandFinishShare: evidence.bandFinishShare,
    };
  });
}

function buildCoverage(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  evidence: CoreEvidence,
  nowMs: number,
  sessionLimit: number,
  driveLimit: number,
): CareCoverage {
  const sessionTimes = sessions
    .map(sessionTimestamp)
    .filter((value): value is number => value != null && value <= nowMs);
  const driveTimes = drives
    .map(driveTimestamp)
    .filter((value): value is number => value != null && value <= nowMs);
  const observedTimes = [...sessionTimes, ...driveTimes];

  return {
    returnedSessions: sessions.length,
    returnedDrives: drives.length,
    excludedEndSocSessions: sessions.length - evidence.sessionsAnalyzed,
    excludedArrivalDrives: drives.length - evidence.drivesAnalyzed,
    excludedEnergySessions: sessions.length - evidence.energyMix.energySessions,
    unclassifiedEnergySessions:
      evidence.energyMix.energySessions - evidence.energyMix.classifiedSessions,
    excludedSessionTimestamps: sessions.length - sessionTimes.length,
    excludedDriveTimestamps: drives.length - driveTimes.length,
    sessionWindowCapped: sessions.length >= sessionLimit,
    driveWindowCapped: drives.length >= driveLimit,
    observationStartMs:
      observedTimes.length > 0 ? Math.min(...observedTimes) : null,
    observationEndMs:
      observedTimes.length > 0 ? Math.max(...observedTimes) : null,
  };
}

export function computeBatteryCare(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  optionsOrFullChargePct: BatteryCareOptions | number = {},
): CareScore {
  const options =
    typeof optionsOrFullChargePct === 'number'
      ? { fullChargePct: optionsOrFullChargePct }
      : optionsOrFullChargePct;
  const fullChargePct = finitePct(options.fullChargePct)
    ? options.fullChargePct
    : FULL_CHARGE_PCT;
  const sessionLimit = boundedInteger(
    options.sessionLimit,
    BATTERY_CARE_HISTORY_LIMIT,
    BATTERY_CARE_HISTORY_LIMIT,
  );
  const driveLimit = boundedInteger(
    options.driveLimit,
    BATTERY_CARE_HISTORY_LIMIT,
    BATTERY_CARE_HISTORY_LIMIT,
  );
  const trendMonths = boundedInteger(
    options.trendMonths,
    CARE_TREND_MONTHS,
    MAX_CARE_TREND_MONTHS,
  );
  const nowMs = resolveNowMs(options.nowMs, sessions, drives);
  const evidence = buildCoreEvidence(
    sessions,
    drives,
    fullChargePct,
    {
      sessions: MIN_SCORE_SESSIONS,
      drives: MIN_SCORE_DRIVES,
      energySessions: MIN_SCORE_ENERGY_SESSIONS,
    },
  );

  return {
    ...evidence,
    opportunities: buildOpportunities(evidence.riskComponents),
    monthly: buildMonthlyCare(
      sessions,
      drives,
      fullChargePct,
      nowMs,
      trendMonths,
    ),
    coverage: buildCoverage(
      sessions,
      drives,
      evidence,
      nowMs,
      sessionLimit,
      driveLimit,
    ),
  };
}
