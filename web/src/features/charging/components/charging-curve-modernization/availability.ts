import type { ChargingSession } from '@/api/types';

/** Availability only: never filters query rows or changes the original averages. */
export function chargingAvailability(sessions: readonly ChargingSession[]) {
  const finite = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value);
  const energy = sessions.filter(session => finite(session.total_energy_added_wh)).length;
  const power = sessions.filter(session => finite(session.peak_power_w)).length;
  const cost = sessions.filter(session => finite(session.cost_decimal)).length;
  const soc = sessions.filter(session => finite(session.start_soc_pct) && finite(session.end_soc_pct)).length;
  const duration = sessions.filter(session => {
    if (!session.ended_at) return false;
    const start = new Date(session.started_at).getTime();
    const end = new Date(session.ended_at).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && end > start;
  }).length;
  const count = sessions.length;
  return {
    count, energy, power, cost, duration, soc,
    partial: count > 0 && [energy, power, cost, duration, soc].some(known => known < count),
  };
}

export type ChargingAvailability = ReturnType<typeof chargingAvailability>;
