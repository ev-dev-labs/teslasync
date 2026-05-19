/**
 * Zod schemas for `/api/v1/system/status` and related health endpoints.
 *
 * Critical because the admin / system pages render directly from this
 * payload — any schema drift would either leave them blank or render
 * with stale labels until the next deploy.
 */
import { z } from 'zod'

const ServiceStatusSchema = z
  .object({
    name: z.string(),
    status: z.string(),
    message: z.string().nullable().optional(),
    last_check: z.string().nullable().optional(),
  })
  .passthrough()

export const SystemStatusSchema = z
  .object({
    version: z.string().optional(),
    uptime_seconds: z.number().optional(),
    services: z.array(ServiceStatusSchema).optional(),
    healthy: z.boolean().optional(),
  })
  .passthrough()

export type SystemStatusParsed = z.infer<typeof SystemStatusSchema>
