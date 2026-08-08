/**
 * Bundled synthetic sample telemetry used ONLY by the sandbox preview.
 *
 * This is deliberately NOT live vehicle data and is NEVER fetched over the
 * network — it is a fixed, deterministic array baked into the client
 * bundle. That is a hard security property of this feature (see
 * `docs/THREAT_MODEL.md`): a pack's formulas/dashboards can only ever see
 * this bundled sample, so even a fully-trusted, correctly-signed pack has
 * no way to exfiltrate real vehicle telemetry — there is nothing real to
 * read, and no network primitive available to send it anywhere even if
 * there were.
 *
 * Field names here are exactly `SAMPLE_ROW_FIELDS` from `manifestTypes.ts`.
 */

import type { SampleRowField } from './manifestTypes';

export type SampleRow = Record<SampleRowField, number>;

/** 14 synthetic "days" with plausible, deterministic (non-random) values. */
export const SAMPLE_TELEMETRY_ROWS: readonly SampleRow[] = Array.from({ length: 14 }, (_, i) => {
  const day = i + 1;
  // Simple deterministic waveforms — no RNG, so test fixtures/snapshots
  // never flake and every run of the sandbox produces identical output.
  const battery = 40 + ((day * 7) % 55);
  const chargeAdded = 5 + ((day * 3) % 20);
  const distance = 20 + ((day * 11) % 90);
  const efficiency = 140 + ((day * 5) % 60);
  const speed = 25 + ((day * 4) % 45);
  const cabin = 18 + ((day * 2) % 10);
  const ambient = 5 + ((day * 3) % 20);
  return {
    day_index: day,
    battery_level_pct: battery,
    charge_energy_added_kwh: chargeAdded,
    drive_distance_km: distance,
    drive_efficiency_wh_per_km: efficiency,
    avg_speed_kmh: speed,
    cabin_temp_c: cabin,
    ambient_temp_c: ambient,
  };
});

export const MAX_SANDBOX_ROWS = 90;
