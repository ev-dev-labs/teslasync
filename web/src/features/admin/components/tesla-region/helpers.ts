/**
 * Pure helpers for the Tesla Region & Fleet API endpoint page.
 *
 * Framework-free and i18n-free on purpose: components translate the returned
 * zone keys so this module stays trivially unit-testable. The Fleet API base
 * URL Tesla resolves for an account encodes the regional datacenter zone in
 * its host (`…prd.<zone>.vn.cloud.tesla.com`); we sniff that so the UI can show
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
 * Sniff the na/eu/cn Fleet API zone from a host (or raw URL) string. Anchors on
 * the dotted datacenter segment for precision; returns null when no recognised
 * zone is present so the UI degrades to a neutral placeholder.
 */
export function regionKeyFromHost(host: string | null | undefined): RegionZoneKey | null {
  if (!host) return null
  const dotted = host.toLowerCase().match(/\.(na|eu|cn)\./)
  return (dotted?.[1] as RegionZoneKey | undefined) ?? null
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
    return { host, scheme, regionKey: regionKeyFromHost(host) }
  } catch {
    // Not a well-formed URL — still try to sniff a zone from the raw string.
    return { host: null, scheme: null, regionKey: regionKeyFromHost(baseUrl) }
  }
}

/** True when the account has a resolved region or Fleet API endpoint on record. */
export function hasEndpoint(data: Partial<TeslaRegionData> | null | undefined): boolean {
  return Boolean(data?.region || data?.fleet_api_base_url)
}
