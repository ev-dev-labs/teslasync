/**
 * Runtime validation helpers for API responses.
 *
 * TanStack Query's `select` option is the natural place to parse a
 * response through a Zod schema — it runs once per fetched payload
 * and the parsed value is what callers consume. We wrap that with
 * a soft-fail mode so a schema mismatch produces a console warning
 * + telemetry breadcrumb in production rather than tearing down the
 * page; in development it throws so contributors notice the drift
 * immediately.
 *
 * The wider goal is to catch the class of bug where the Go API
 * adds / renames / changes the type of a field and the frontend
 * silently keeps rendering stale data because TypeScript only knows
 * the compile-time shape.
 */
import type { ZodTypeAny, z } from 'zod'

const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true

export interface ValidationOptions {
  /**
   * Optional human-readable label used in error messages and
   * telemetry so the failure isn't anonymous (e.g. "useVehicles").
   */
  label?: string
}

/**
 * Parse `data` through `schema`. Returns the parsed (and type-narrowed)
 * value on success. On failure: in development, throw with the full
 * Zod issue list (loud feedback); in production, log a warning and
 * return the unparsed value cast to the schema's type (graceful — the
 * page keeps rendering, the breadcrumb tells us to fix it).
 */
export function validateResponse<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
  opts: ValidationOptions = {},
): z.infer<S> {
  const result = schema.safeParse(data)
  if (result.success) return result.data

  const label = opts.label ?? 'unknown'
  const issues = result.error.issues.slice(0, 5)
  const summary = issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')

  if (isDev) {
    console.error(`[validateResponse:${label}] ${result.error.issues.length} issue(s): ${summary}`)
    throw result.error
  }

  // Production: warn but don't blow up. Real-world API responses can
  // contain forward-compatible additions; the warning gives us a
  // signal without breaking the UI on a benign change.
  console.warn(`[validateResponse:${label}] schema drift detected (${result.error.issues.length} issues): ${summary}`)
  return data as z.infer<S>
}

/**
 * Helper that returns a `select` function suitable for TanStack Query.
 * Pass the schema and an optional label:
 *
 *   useQuery({
 *     queryKey,
 *     queryFn: () => request<Vehicle[]>('/vehicles'),
 *     select: validateSelect(VehicleArraySchema, { label: 'useVehicles' }),
 *   })
 */
export function validateSelect<S extends ZodTypeAny>(
  schema: S,
  opts: ValidationOptions = {},
) {
  return (data: unknown): z.infer<S> => validateResponse(schema, data, opts)
}
