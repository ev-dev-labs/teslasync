/**
 * User-agent heuristics for the Active Sessions surface.
 *
 * Dependency-free: a small `match` ladder covers the major browsers + OSes
 * correctly enough to populate a "Firefox · Windows" label and drive the
 * per-device breakdown panels. A full ua-parser library would be ~30 KB of
 * bundle for marginal accuracy on this low-stakes surface.
 *
 * `parseUserAgent` returns proper-noun tokens (`'Chrome'`, `'macOS'`) or
 * `null` when a component can't be identified — proper nouns are
 * language-neutral data, so they never need i18n. `describeDevice` joins the
 * two with a middot separator (also language-neutral) and falls back to an
 * em-dash when nothing is recognised.
 */

export interface ParsedDevice {
  browser: string | null
  os: string | null
}

/** Best-effort {browser, os} extraction. Both fields are `null` on a miss. */
export function parseUserAgent(userAgent: string | null | undefined): ParsedDevice {
  const ua = (userAgent ?? '').trim()
  if (!ua) return { browser: null, os: null }

  let browser: string | null = null
  if (/Edg\//.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
  else if (/Chromium/.test(ua)) browser = 'Chromium'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari'

  let os: string | null = null
  // Order matters: iOS UAs carry the literal "like Mac OS X" token, so the
  // iPhone/iPad/iPod probe MUST precede the macOS probe or every Apple mobile
  // device is misbucketed as macOS. Likewise Android UAs also contain "Linux",
  // so Android precedes the generic Linux probe.
  if (/Windows NT/.test(ua)) os = 'Windows'
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
  else if (/Mac OS X/.test(ua) || /Macintosh/.test(ua)) os = 'macOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/Linux/.test(ua)) os = 'Linux'

  return { browser, os }
}

/**
 * Human-readable device label, e.g. `"Chrome · macOS"`. Language-neutral:
 * proper nouns joined by a middot, em-dash when nothing is recognised. Safe
 * to render directly without i18n.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const { browser, os } = parseUserAgent(userAgent)
  if (browser && os) return `${browser} · ${os}`
  return browser ?? os ?? '—'
}
