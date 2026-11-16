import type { RateLimitPolicy } from '@/lib/rateLimit'

export const TEST_RATE_BUCKET = 'a'.repeat(32)

export function ratePolicyHeaders(
  policy: Partial<RateLimitPolicy> = {},
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-RateLimit-Bucket': policy.bucket ?? TEST_RATE_BUCKET,
    'X-RateLimit-Scope': policy.scope ?? '/vehicles/{vehicleID}/refresh',
    'X-RateLimit-Methods': policy.methods ?? 'POST',
    'X-RateLimit-Source': policy.source ?? 'teslasync',
    'X-RateLimit-Enforcement': policy.enforcement ?? 'process',
    'X-RateLimit-Limited': 'true',
    'Retry-After': '10',
    ...extra,
  }
}
