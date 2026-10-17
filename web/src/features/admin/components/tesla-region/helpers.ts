/**
 * Pure helpers for the Tesla Region & Fleet API endpoint page.
 *
 * Framework-free and i18n-free on purpose: components translate the returned
 * zone keys so this module stays trivially unit-testable. The Fleet API base
 * URL Tesla resolves for an account encodes the regional datacenter zone in
 * its host (`fleet-api.prd.<zone>.vn.cloud.tesla.com`); we match that so the UI can show
 * a compact region badge alongside the full descriptive region string.
 */

export interface TeslaRegionData {
  region: string
  fleet_api_base_url: string
}

/** Known Tesla Fleet API region groupings, keyed by the datacenter segment. */
export const REGION_ZONE_KEYS = ['na', 'eu', 'cn'] as const
export type RegionZoneKey = (typeof REGION_ZONE_KEYS)[number]

/** English fallbacks for each zone label. Kept here so the page and the About
 *  panel share one source of truth while still using literal i18n keys. */
export const REGION_ZONE_FALLBACK: Record<RegionZoneKey, string> = {
  na: 'North America & Asia-Pacific (excl. China)',
  eu: 'Europe, Middle East & Africa',
  cn: 'China',
}

export interface EndpointParts {
  host: string | null
  scheme: string | null
  regionKey: RegionZoneKey | null
}

/**
 * Recognize only the Fleet API hosts documented in docs/guide/tesla-fleet-api.md.
 * Unknown identities remain unknown; this does not validate endpoint security.
 */
export function regionKeyFromHost(host: string | null | undefined): RegionZoneKey | null {
  if (!host) return null
  switch (host.toLowerCase()) {
    case 'fleet-api.prd.na.vn.cloud.tesla.com': return 'na'
    case 'fleet-api.prd.eu.vn.cloud.tesla.com': return 'eu'
    case 'fleet-api.prd.cn.vn.cloud.tesla.com': return 'cn'
    default: return null
  }
}

/**
 * Parse a Fleet API base URL into display-ready parts. Fully null-safe: returns
 * all-null for empty input and never throws on a malformed URL.
 */
export function parseEndpoint(baseUrl: string | null | undefined): EndpointParts {
  if (!baseUrl) return { host: null, scheme: null, regionKey: null }
  try {
    const url = new URL(baseUrl)
    const host = url.host || null
    const scheme = url.protocol ? url.protocol.replace(/:$/, '') : null
    return { host, scheme, regionKey: regionKeyFromHost(url.hostname) }
  } catch {
    return { host: null, scheme: null, regionKey: null }
  }
}

/** True when the account has a resolved region or Fleet API endpoint on record. */
export function hasEndpoint(data: Partial<TeslaRegionData> | null | undefined): boolean {
  return Boolean(data?.region || data?.fleet_api_base_url)
}
