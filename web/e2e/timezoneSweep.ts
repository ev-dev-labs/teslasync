import type { Page } from '@playwright/test'

export interface TzHit { text: string; inSvg: boolean; context: string }
export interface TzSweep { iso: TzHit[]; zones: TzHit[]; dupes: string[] }

function collectTimezoneSweep(): TzSweep {
  const iso: TzHit[] = []
  const zones: TzHit[] = []
  const candidates: string[] = []
  const ISO_RE = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g
  const IANA_CANDIDATE_RE = /[A-Za-z][\w+.-]*\/[\w+.-]+(?:\/[\w+.-]+)*/g
  const UTC_RE = /\bUTC\b/g
  const GMT_RE = /GMT[+-]\d{1,2}\b/g
  const UTC_OFF_RE = /UTC[+-]\d/g
  const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'
  const FRIENDLY_RE = new RegExp(
    `\\b(?:${MONTHS})[a-z]*\\s+\\d{1,2},\\s+\\d{4}(?:,?\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:AM|PM)?)?`
    + `|\\b\\d{1,2}\\/\\d{1,2}\\/\\d{4}(?:,?\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:AM|PM)?)?`,
    'g',
  )
  let iana: Set<string> | null = null
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof sv === 'function') iana = new Set(sv.call(Intl, 'timeZone'))
  } catch {
    iana = null
  }
  const CONTINENTS = /^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//
  const hidden = new WeakMap<Element, boolean>()
  const isHidden = (element: Element): boolean => {
    const cached = hidden.get(element)
    if (cached != null) return cached
    const style = getComputedStyle(element)
    // Screen-reader chart tables retain full descendant bounds even when
    // their ancestor is clipped. Inspect computed clipping, not a class name,
    // because forced-colors mode can make the same fallback table visible.
    const clip = style.clip.match(/^rect\(([^)]+)\)$/)
    const edges = clip?.[1].trim().split(/[,\s]+/).map(Number.parseFloat)
    const clipped = (style.position === 'absolute' || style.position === 'fixed')
      && edges?.length === 4 && edges.every(Number.isFinite)
      && (edges[1] <= edges[3] || edges[2] <= edges[0])
    const invisible = style.display === 'none' || style.visibility === 'hidden'
      || style.visibility === 'collapse'
      || Boolean(clipped) || style.clipPath.replace(/\s+/g, '') === 'inset(50%)'
      || (element.parentElement != null && isHidden(element.parentElement))
    hidden.set(element, invisible)
    return invisible
  }
  const els = document.querySelectorAll(
    'p,span,div,h1,h2,h3,h4,h5,h6,li,td,th,a,button,label,dt,dd,time,text',
  )
  for (const el of els) {
    const html = el as HTMLElement
    if (html.closest('script,style,noscript,template,input,textarea,select,option,.leaflet-container')) continue
    const rect = html.getBoundingClientRect?.()
    if (!rect || (rect.width === 0 && rect.height === 0) || isHidden(html)) continue
    const own = Array.from(el.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? '')
      .join(' ')
    if (!own.trim()) continue
    const inSvg = html.closest('svg') != null
    const context = (html.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
    for (const m of own.matchAll(ISO_RE)) {
      if (iso.length < 20) iso.push({ text: m[0].slice(0, 80), inSvg, context })
      if (candidates.length < 400) candidates.push(m[0])
    }
    for (const m of own.matchAll(IANA_CANDIDATE_RE)) {
      const v = m[0]
      if ((iana ? iana.has(v) : CONTINENTS.test(v)) && zones.length < 20) {
        zones.push({ text: v.slice(0, 80), inSvg, context })
      }
    }
    for (const m of own.matchAll(UTC_RE)) {
      if (zones.length < 20) zones.push({ text: m[0], inSvg, context })
    }
    for (const m of own.matchAll(GMT_RE)) {
      if (zones.length < 20) zones.push({ text: m[0], inSvg, context })
    }
    for (const m of own.matchAll(UTC_OFF_RE)) {
      if (zones.length < 20) zones.push({ text: m[0], inSvg, context })
    }
    for (const m of own.matchAll(FRIENDLY_RE)) {
      if (candidates.length < 400) candidates.push(m[0])
    }
  }
  const byEpoch = new Map<number, Set<string>>()
  for (const c of candidates) {
    const ms = Date.parse(c)
    if (!Number.isFinite(ms)) continue
    let set = byEpoch.get(ms)
    if (!set) {
      set = new Set()
      byEpoch.set(ms, set)
    }
    set.add(c.trim().slice(0, 80))
  }
  const dupes: string[] = []
  for (const set of byEpoch.values()) {
    if (set.size >= 2 && dupes.length < 10) dupes.push([...set].join('  <>  '))
  }
  return { iso, zones, dupes }
}

export async function measureTz(page: Page): Promise<TzSweep> {
  return page.evaluate(collectTimezoneSweep)
}
