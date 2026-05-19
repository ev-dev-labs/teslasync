/**
 * Zod schemas for `Vehicle` and related vehicle-list responses.
 *
 * These are the runtime contract for `useVehicles()`. When the Go
 * `/api/v1/vehicles` endpoint changes shape, these schemas should
 * change in the same PR so the next CI run catches the regression
 * before a frontend deploy.
 *
 * Convention:
 *   - snake_case is canonical (matches Go JSON tags).
 *   - camelCase aliases populated by the `camelCaseKeys` transform are
 *     declared as optional so we don't fail validation on the duplicate.
 *   - nullable backend fields use `.nullable()` not `.optional()` —
 *     pgx scans NULL columns to JSON null, not missing keys.
 *   - timestamps stay as ISO strings; date parsing is a render-layer
 *     concern via `dateFormat.ts`.
 */
import { z } from 'zod'

export const VehicleSchema = z
  .object({
    id: z.number(),
    vehicle_id: z.number(),
    vin: z.string(),
    display_name: z.string(),
    model: z.string(),
    trim_badging: z.string(),
    exterior_color: z.string(),
    wheel_type: z.string(),
    state: z.string(),
    healthy: z.boolean(),
    timezone: z.string().optional(),
    created_at: z.string(),
    updated_at: z.string(),

    // Extended fields populated by the detail / state endpoints — present
    // on the list response when state was recently merged, absent otherwise.
    battery_level: z.number().optional(),
    battery_range: z.number().optional(),
    odometer: z.number().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    charging_state: z.string().optional(),

    // camelCaseKeys duplicates — strict mode is OFF (passthrough below)
    // so an unknown key never fails. These declarations exist for type
    // narrowing only.
    vehicleId: z.number().optional(),
    displayName: z.string().optional(),
    trimBadging: z.string().optional(),
    exteriorColor: z.string().optional(),
    wheelType: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    batteryLevel: z.number().optional(),
    batteryRange: z.number().optional(),
    chargingState: z.string().optional(),
  })
  // Backend can add new fields without breaking the frontend — strip
  // them silently rather than rejecting the entire response.
  .passthrough()

export const VehicleArraySchema = z.array(VehicleSchema)

export type VehicleParsed = z.infer<typeof VehicleSchema>
