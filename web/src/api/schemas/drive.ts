/**
 * Zod schemas for `/api/v1/drives` and friends.
 *
 * Drive history is one of the highest-traffic surfaces in the SPA and
 * sits directly on top of the SI canonical migration (Phase-48), so
 * a runtime mismatch between Go field names (distance_m, energy_used_wh)
 * and TypeScript expectations is the most common drift class.
 */
import { z } from 'zod'

export const DriveSchema = z
  .object({
    id: z.number(),
    vehicle_id: z.number(),

    // Time bounds. `end_ts` is null while a drive is in progress.
    start_ts: z.string(),
    end_ts: z.string().nullable().optional(),

    // SI canonical numerics from migration 000185_drives_si. Pointer in
    // Go → nullable here. Legacy unit-suffixed siblings (distance_mi,
    // duration_min, etc.) are forbidden by Phase-48 — schema MUST NOT
    // accept them so a regression to the old shape fails loudly.
    distance_m: z.number().nullable().optional(),
    duration_s: z.number().nullable().optional(),
    energy_used_wh: z.number().nullable().optional(),
    avg_speed_mps: z.number().nullable().optional(),
    max_speed_mps: z.number().nullable().optional(),
    avg_power_w: z.number().nullable().optional(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),

    // Geo bounds — every drive has start position, end is null if in progress.
    start_lat: z.number().nullable().optional(),
    start_lng: z.number().nullable().optional(),
    end_lat: z.number().nullable().optional(),
    end_lng: z.number().nullable().optional(),

    // Display-only fields populated by the handler from reverse-geocoded
    // address store; absent on the list endpoint when geocoding lags.
    start_address: z.string().nullable().optional(),
    end_address: z.string().nullable().optional(),
  })
  .passthrough()

export const DriveArraySchema = z.array(DriveSchema)

export type DriveParsed = z.infer<typeof DriveSchema>
