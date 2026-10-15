import type { ParkTruth, VampireSplit } from '@/types/teslaPhysics';
import { deriveDataState, type DataState } from '@/api/dataState';

export type VampireCulpritId =
  | 'sentry'
  | 'cabin_overheat'
  | 'precondition'
  | 'plugged_complete'
  | 'unplugged_leak'
  | 'unknown';

export type VampireEvidence = 'live' | 'historical' | 'stale' | 'guessed' | 'missing';
export type VampireCulpritStatus = 'on' | 'off' | 'not-counted' | 'unconfirmed' | 'measured' | 'missing';
export type VampireAttribution = 'counted' | 'not-counted' | 'unconfirmed' | 'measured' | 'missing';

export interface VampireCulprit {
  id: VampireCulpritId;
  active: boolean;
  evidence: VampireEvidence;
  drainPct: number | null;
  reported: boolean | null;
  parkEligible: boolean | null;
  attribution: VampireAttribution;
  status: VampireCulpritStatus;
  source: DataState<unknown>;
}

export interface VampireCulpritReport {
  culprits: VampireCulprit[];
  tonight: VampireCulpritId;
  honesty: {
    key: 'vampireDrain.culprit.honesty';
    args: Record<string, never>;
  };
  externalHonesty: string[];
}

function drain(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sourceState<T extends ParkTruth | VampireSplit>(
  input: T | DataState<T> | undefined,
  provenance: 'live' | 'historical',
): DataState<T> {
  return input != null && 'status' in input && 'hasData' in input
    ? input
    : deriveDataState<T>({ data: input }, { provenance });
}

function evidence(source: DataState<unknown>, known: boolean): VampireEvidence {
  if (!known) return 'missing';
  if (source.status !== 'ok') return 'stale';
  if (source.provenance === 'live') return 'live';
  if (source.provenance === 'historical') return 'historical';
  return source.provenance === 'inferred' ? 'guessed' : 'stale';
}

/** Raw payload callers remain supported; trust-aware callers pass their existing DataState. */
export function deriveVampireCulprits(
  parkInput: ParkTruth | DataState<ParkTruth> | undefined,
  splitInput: VampireSplit | DataState<VampireSplit> | undefined,
): VampireCulpritReport {
  const parkSource = sourceState(parkInput, 'live');
  const splitSource = sourceState(splitInput, 'historical');
  const park = parkSource.data;
  const split = splitSource.data;
  const parkEligible = park == null || typeof park.confirmed_park !== 'boolean'
    || typeof park.neutral_rolling !== 'boolean'
    ? null
    : park.confirmed_park && !park.neutral_rolling;
  const plugged = drain(split?.complete_plugged_drain_pct);
  const unplugged = drain(split?.unplugged_drain_pct);

  const feature = (
    id: VampireCulpritId,
    reportedValue: boolean | undefined,
    countedValue: boolean | undefined,
  ): VampireCulprit => {
    const reported = typeof reportedValue === 'boolean' ? reportedValue : null;
    const counted = typeof countedValue === 'boolean' ? countedValue : null;
    const active = reported === true && parkEligible === true && counted === true;
    const attribution: VampireAttribution = active ? 'counted'
      : parkEligible !== true || reported == null || counted == null ? 'unconfirmed'
      : 'not-counted';
    const status: VampireCulpritStatus = attribution === 'unconfirmed' ? 'unconfirmed'
      : active ? 'on'
      : reported === false ? 'off' : 'not-counted';
    return {
      id, active, reported, parkEligible, attribution, status,
      evidence: evidence(parkSource, reported != null),
      drainPct: null,
      source: parkSource,
    };
  };

  const measurement = (id: VampireCulpritId, drainPct: number | null): VampireCulprit => ({
    id,
    active: drainPct != null && drainPct > 0,
    evidence: evidence(splitSource, drainPct != null),
    drainPct,
    reported: null,
    parkEligible: null,
    attribution: drainPct == null ? 'missing' : 'measured',
    status: drainPct == null ? 'missing' : 'measured',
    source: splitSource,
  });

  const culprits: VampireCulprit[] = [
    feature('sentry', park?.sentry_reported, park?.sentry_counted),
    feature('cabin_overheat', park?.cabin_overheat_reported, park?.cabin_overheat_counted),
    feature('precondition', park?.preconditioning_reported, park?.preconditioning_counted),
    measurement('plugged_complete', plugged),
    measurement('unplugged_leak', unplugged),
  ];

  const tonight =
    culprits.find((row) => row.active
      && row.source.status === 'ok'
      && (row.evidence === 'live' || row.evidence === 'historical'))?.id
    ?? 'unknown';

  const externalHonesty = [
    park?.honesty,
    split?.honesty,
  ].filter((text): text is string => typeof text === 'string' && text.length > 0);
  const honesty: VampireCulpritReport['honesty'] = {
    key: 'vampireDrain.culprit.honesty',
    args: {},
  };

  return { culprits, tonight, honesty, externalHonesty };
}
