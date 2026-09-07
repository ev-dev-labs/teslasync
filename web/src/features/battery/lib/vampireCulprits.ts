import type { ParkTruth, VampireSplit } from '@/types/teslaPhysics';

export type VampireCulpritId =
  | 'sentry'
  | 'cabin_overheat'
  | 'precondition'
  | 'plugged_complete'
  | 'unplugged_leak'
  | 'unknown';

export type VampireEvidence = 'live' | 'stale' | 'guessed' | 'missing';

export interface VampireCulprit {
  id: VampireCulpritId;
  active: boolean;
  evidence: VampireEvidence;
  drainPct: number | null;
}

export interface VampireCulpritReport {
  culprits: VampireCulprit[];
  tonight: VampireCulpritId;
  honesty: string;
}

function drain(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function deriveVampireCulprits(
  park: ParkTruth | undefined,
  split: VampireSplit | undefined,
): VampireCulpritReport {
  const sentryOn = Boolean(park?.sentry_counted);
  const overheatOn = Boolean(park?.cabin_overheat_counted);
  const preconditionOn = Boolean(park?.preconditioning_counted);
  const plugged = drain(split?.complete_plugged_drain_pct);
  const unplugged = drain(split?.unplugged_drain_pct);
  const parkKnown = park != null;
  const splitKnown = split != null;

  const culprits: VampireCulprit[] = [
    {
      id: 'sentry',
      active: sentryOn,
      evidence: parkKnown ? (sentryOn || park.sentry_reported ? 'live' : 'live') : 'missing',
      drainPct: null,
    },
    {
      id: 'cabin_overheat',
      active: overheatOn,
      evidence: parkKnown ? 'live' : 'missing',
      drainPct: null,
    },
    {
      id: 'precondition',
      active: preconditionOn,
      evidence: parkKnown ? 'live' : 'missing',
      drainPct: null,
    },
    {
      id: 'plugged_complete',
      active: plugged != null && plugged > 0,
      evidence: splitKnown ? (plugged == null ? 'missing' : 'stale') : 'missing',
      drainPct: plugged,
    },
    {
      id: 'unplugged_leak',
      active: unplugged != null && unplugged > 0,
      evidence: splitKnown ? (unplugged == null ? 'missing' : 'stale') : 'missing',
      drainPct: unplugged,
    },
  ];

  const tonight =
    culprits.find((row) => row.active)?.id
    ?? (parkKnown || splitKnown ? 'unknown' : 'unknown');

  const honesty = [
    park?.honesty,
    split?.honesty,
    'Sentry, cabin overheat, and preconditioning only count after confirmed Park. Drain percentages are parked windows, not invented watt-hours.',
  ].filter(Boolean).join(' ');

  return { culprits, tonight, honesty };
}
