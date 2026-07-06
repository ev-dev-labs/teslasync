import { describe, it, expect } from 'vitest'
import { TOPICS, FORMATTER_AFFECTING_TOPICS, type Topic } from './broadcastTopics'
import type { BroadcastMessage } from './broadcast'

/**
 * The registry's entire purpose is to mirror the `type` discriminators of
 * {@link BroadcastMessage} 1:1 so publishers/subscribers reference a constant
 * instead of an inline string. This golden list enumerates every discriminator
 * declared in `broadcast.ts`; the tests below assert `TOPICS` neither drifts
 * from it nor under-covers it.
 *
 * The list is typed as `BroadcastMessage['type'][]`, so a bogus entry is a
 * compile error in an IDE/`tsc` run — but the *runtime* checks below are what
 * the CI gate executes (test files are excluded from the project `tsconfig`),
 * so the coupling is enforced even without type-checking this file. When you
 * add a `BroadcastMessage` variant you MUST add both a `TOPICS` entry and a
 * line here — that friction is intentional.
 */
const ALL_BROADCAST_TYPES: ReadonlyArray<BroadcastMessage['type']> = [
  'theme.changed',
  'theme.customColors',
  'font.changed',
  'auth.logout',
  'notifications.read',
  'notifications.cleared',
  'snooze.changed',
  'changelog.seen',
  'tour.completed',
  'tour.reset',
  'tour.replay-requested',
  'checklist.dismissed',
  'onboarded',
  'onboarding.skip.changed',
  'install.dismissed',
  'vehicle.paint.changed',
  'dashboard.layout',
  'savedView.changed',
  'formDraft.acquired',
  'formDraft.released',
  'formDraft.committed',
  'lease.request',
  'lease.granted',
  'lease.released',
  'queryInvalidate',
  'settings.changed',
]

const topicKeys = Object.keys(TOPICS) as Array<keyof typeof TOPICS>
const topicValues = Object.values(TOPICS)

describe('TOPICS registry — value hygiene', () => {
  it('every topic value is a non-empty, trimmed string', () => {
    const bad = topicValues.filter(
      (v) => typeof v !== 'string' || v.length === 0 || v.trim() !== v,
    )
    expect(bad).toEqual([])
  })

  it('topic values are globally unique (no two keys share a wire string)', () => {
    // A duplicate would silently cross-wire two features onto one topic.
    expect(new Set(topicValues).size).toBe(topicValues.length)
  })

  it('topic values use the dotted / kebab wire format (no spaces or slashes)', () => {
    // Segments of ASCII letters joined by '.' or '-' — e.g. 'tour.replay-requested'.
    const wireFormat = /^[A-Za-z]+([.-][A-Za-z]+)*$/
    const invalid = topicValues.filter((v) => !wireFormat.test(v))
    expect(invalid).toEqual([])
  })

  it('registry keys are SCREAMING_SNAKE_CASE identifiers', () => {
    const invalid = topicKeys.filter((k) => !/^[A-Z][A-Z0-9_]*$/.test(k))
    expect(invalid).toEqual([])
  })
})

describe('TOPICS registry — canonical wire strings are pinned', () => {
  it('pins the theme, settings, font and query topics to their exact strings', () => {
    expect(TOPICS.THEME_CHANGED).toBe('theme.changed')
    expect(TOPICS.THEME_CUSTOM_COLORS).toBe('theme.customColors')
    expect(TOPICS.SETTINGS_CHANGED).toBe('settings.changed')
    expect(TOPICS.FONT_CHANGED).toBe('font.changed')
    expect(TOPICS.QUERY_INVALIDATE).toBe('queryInvalidate')
  })

  it('pins the edit-lease protocol trio', () => {
    expect(TOPICS.LEASE_REQUEST).toBe('lease.request')
    expect(TOPICS.LEASE_GRANTED).toBe('lease.granted')
    expect(TOPICS.LEASE_RELEASED).toBe('lease.released')
  })
})

describe('TOPICS registry — mirrors BroadcastMessage 1:1', () => {
  it('registers a constant for EVERY BroadcastMessage discriminator', () => {
    const registered = new Set<string>(topicValues)
    const missing = ALL_BROADCAST_TYPES.filter((t) => !registered.has(t))
    // If this fails, a BroadcastMessage variant has no TOPICS constant, so a
    // publisher/subscriber is forced to inline the raw string (the exact
    // anti-pattern this registry exists to prevent). `font.changed` was such
    // a gap until it was registered as TOPICS.FONT_CHANGED.
    expect(missing).toEqual([])
  })

  it('does NOT register any string that is not a real discriminator', () => {
    const known = new Set<string>(ALL_BROADCAST_TYPES)
    const stray = topicValues.filter((v) => !known.has(v))
    expect(stray).toEqual([])
  })

  it('has exactly one topic per discriminator (same cardinality + set)', () => {
    expect(topicValues.length).toBe(ALL_BROADCAST_TYPES.length)
    expect([...topicValues].sort()).toEqual([...ALL_BROADCAST_TYPES].sort())
  })
})

describe('FORMATTER_AFFECTING_TOPICS', () => {
  it('contains only strings that are registered in TOPICS', () => {
    const registered = new Set<string>(topicValues)
    const foreign = FORMATTER_AFFECTING_TOPICS.filter((t) => !registered.has(t))
    expect(foreign).toEqual([])
  })

  it('is exactly the settings + theme trio the formatter bridge cares about', () => {
    expect([...FORMATTER_AFFECTING_TOPICS].sort()).toEqual(
      [TOPICS.SETTINGS_CHANGED, TOPICS.THEME_CHANGED, TOPICS.THEME_CUSTOM_COLORS].sort(),
    )
  })

  it('has no duplicate entries', () => {
    expect(new Set(FORMATTER_AFFECTING_TOPICS).size).toBe(FORMATTER_AFFECTING_TOPICS.length)
  })

  it('excludes font.changed — font sync is owned by FontProvider, not the bridge', () => {
    expect(FORMATTER_AFFECTING_TOPICS).not.toContain(TOPICS.FONT_CHANGED)
  })
})

describe('Topic type usage', () => {
  it('accepts any TOPICS value wherever a Topic is required and round-trips it', () => {
    const identity = (t: Topic): Topic => t
    expect(identity(TOPICS.SETTINGS_CHANGED)).toBe('settings.changed')
    expect(identity(TOPICS.FONT_CHANGED)).toBe('font.changed')
    expect(identity(TOPICS.VEHICLE_PAINT_CHANGED)).toBe('vehicle.paint.changed')
  })
})
