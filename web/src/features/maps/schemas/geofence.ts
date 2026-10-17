/**
 * Zod schemas for the Geofence create/edit form.
 *
 * Validates the user-entered string form (lat/lng/radius come in as
 * `<input type="number">` strings) and produces a typed payload ready for
 * `POST /api/v1/geofences`.
 */

import { z } from 'zod'
import i18n from 'i18next'
import { GEOFENCE_CATEGORY_VALUES } from '../geofenceCategories'

interface NumericBounds {
  min: number
  max: number
}

interface NumericMessages {
  required: () => string
  number: () => string
  range: (bounds: NumericBounds) => string
}

// Resolve messages during parsing, not module loading, so language changes apply.
const numericString = (messages: NumericMessages, opts: NumericBounds) =>
  z
    .string({
      errorMap: (issue, ctx) => ({
        message: issue.code === z.ZodIssueCode.too_small ? messages.required() : ctx.defaultError,
      }),
    })
    .trim()
    .min(1)
    // A single superRefine (rather than two chained `.refine`s) so the range
    // check never runs on a non-numeric value: `Number('abc')` is `NaN` and
    // `Number('1e400')` is `Infinity`, both of which would otherwise slip past
    // an `!Number.isNaN` guard or produce a confusing "must be a number" AND
    // "must be between" pair for the same field. `Number.isFinite` rejects NaN
    // and ±Infinity together, and the early return stops the range comparison.
    .superRefine((value, ctx) => {
      const n = Number(value)
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: messages.number() })
        return
      }
      if (n < opts.min || n > opts.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages.range(opts),
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
    .string({
      errorMap: (issue, ctx) => ({
        message: issue.code === z.ZodIssueCode.too_small
          ? i18n.t('geofences.validation.nameRequired', 'Name is required')
          : issue.code === z.ZodIssueCode.too_big
            ? i18n.t('geofences.validation.nameMaxLength', 'Name must be {{max}} characters or fewer', { max: 120 })
            : ctx.defaultError,
      }),
    })
    .trim()
    .min(1)
    .max(120),
  latitude: numericString({
    required: () => i18n.t('geofences.validation.latitudeRequired', 'Latitude is required'),
    number: () => i18n.t('geofences.validation.latitudeNumber', 'Latitude must be a number'),
    range: ({ min, max }) => i18n.t(
      'geofences.validation.latitudeRange', 'Latitude must be between {{min}} and {{max}}', { min, max },
    ),
  }, { min: -90, max: 90 }),
  longitude: numericString({
    required: () => i18n.t('geofences.validation.longitudeRequired', 'Longitude is required'),
    number: () => i18n.t('geofences.validation.longitudeNumber', 'Longitude must be a number'),
    range: ({ min, max }) => i18n.t(
      'geofences.validation.longitudeRange', 'Longitude must be between {{min}} and {{max}}', { min, max },
    ),
  }, { min: -180, max: 180 }),
  radius: numericString({
    required: () => i18n.t('geofences.validation.radiusRequired', 'Radius is required'),
    number: () => i18n.t('geofences.validation.radiusNumber', 'Radius must be a number'),
    range: ({ min, max }) => i18n.t(
      'geofences.validation.radiusRange', 'Radius must be between {{min}} and {{max}}', { min, max },
    ),
  }, { min: 10, max: 50000 }),
  category: z.enum(GEOFENCE_CATEGORY_VALUES),
})

export type GeofenceFormData = z.infer<typeof geofenceFormSchema>

/** Payload shape posted to the backend (numeric coords + boolean flags). */
export interface GeofencePayload {
  name: string
  latitude: number
  longitude: number
  radius: number
  category: (typeof GEOFENCE_CATEGORY_VALUES)[number]
}

/** Converts a validated {@link GeofenceFormData} into the wire payload. */
export function toGeofencePayload(form: GeofenceFormData): GeofencePayload {
  return {
    name: form.name,
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
    radius: Number(form.radius),
    category: form.category,
  }
}
