/**
 * Zod schemas for the Geofence create/edit form.
 *
 * Validates the user-entered string form (lat/lng/radius come in as
 * `<input type="number">` strings) and produces a typed payload ready for
 * `POST /api/v1/geofences`.
 */

import { z } from 'zod'
import { GEOFENCE_CATEGORY_VALUES } from '../geofenceCategories'

export const GEOFENCE_ALERT_TYPES = ['entry', 'exit', 'both', 'none'] as const

export type GeofenceAlertType = (typeof GEOFENCE_ALERT_TYPES)[number]

const numericString = (label: string, opts: { min: number; max: number }) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    // A single superRefine (rather than two chained `.refine`s) so the range
    // check never runs on a non-numeric value: `Number('abc')` is `NaN` and
    // `Number('1e400')` is `Infinity`, both of which would otherwise slip past
    // an `!Number.isNaN` guard or produce a confusing "must be a number" AND
    // "must be between" pair for the same field. `Number.isFinite` rejects NaN
    // and ±Infinity together, and the early return stops the range comparison.
    .superRefine((value, ctx) => {
      const n = Number(value)
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be a number` })
        return
      }
      if (n < opts.min || n > opts.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be between ${opts.min} and ${opts.max}`,
        })
      }
    })

/**
 * Form schema — operates on the literal `string` values held in the modal's
 * controlled inputs. Convert to numeric payload via {@link toGeofencePayload}
 * after a successful parse.
 */
export const geofenceFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name must be 120 characters or fewer'),
  latitude: numericString('Latitude', { min: -90, max: 90 }),
  longitude: numericString('Longitude', { min: -180, max: 180 }),
  radius: numericString('Radius', { min: 10, max: 50000 }),
  category: z.enum(GEOFENCE_CATEGORY_VALUES),
  alertType: z.enum(GEOFENCE_ALERT_TYPES),
  enabled: z.boolean(),
})

export type GeofenceFormData = z.infer<typeof geofenceFormSchema>

/** Payload shape posted to the backend (numeric coords + boolean flags). */
export interface GeofencePayload {
  name: string
  latitude: number
  longitude: number
  radius: number
  category: (typeof GEOFENCE_CATEGORY_VALUES)[number]
  alertOnEntry: boolean
  alertOnExit: boolean
  enabled: boolean
}

/** Converts a validated {@link GeofenceFormData} into the wire payload. */
export function toGeofencePayload(form: GeofenceFormData): GeofencePayload {
  const alertOnEntry = form.alertType === 'entry' || form.alertType === 'both'
  const alertOnExit = form.alertType === 'exit' || form.alertType === 'both'
  return {
    name: form.name,
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    radius: Number(form.radius),
    category: form.category,
    alertOnEntry,
    alertOnExit,
    enabled: form.enabled,
  }
}
