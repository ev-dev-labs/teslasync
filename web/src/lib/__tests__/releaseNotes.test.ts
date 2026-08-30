import { describe, it, expect } from 'vitest'

import {
  AUDIENCE_ORDER,
  buildReleaseNotes,
  releaseNoteForVersion,
  summarizeReleaseNote,
  toReleaseNote,
} from '../releaseNotes'
import { CHANGELOG, type ChangelogEntry } from '@/generated/changelog'

/**
 * HELP-07. The derivation is keyword-based, so these tests pin the direction
 * of its bias: it must over-report "action needed" rather than under-report
 * it. A missed migration is an outage; a false alarm is thirty seconds.
 */

function entry(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  return {
    version: '1.0.0',
    date: '2026-01-01',
    badge: 'latest',
    changes: [{ type: 'added', text: 'A new chart.' }],
    ...overrides,
  }
}

describe('toReleaseNote — version and date', () => {
  it('carries the version and date through verbatim', () => {
    const note = toReleaseNote(entry({ version: '2.3.4', date: '2025-12-24' }))
    expect(note.version).toBe('2.3.4')
    expect(note.date).toBe('2025-12-24')
  })

  it('handles an entry with no changes without throwing', () => {
    const note = toReleaseNote(entry({ changes: [] }))
    expect(note.items).toEqual([])
    expect(note.actionRequired).toBe(false)
    expect(note.audiences).toEqual([])
    expect(note.impact).toBe('maintenance')
  })
})

describe('toReleaseNote — audiences', () => {
  it('defaults to all users when nothing operator-specific is mentioned', () => {
    const note = toReleaseNote(entry({ changes: [{ type: 'fixed', text: 'Fixed a chart.' }] }))
    expect(note.items[0].audiences).toEqual(['all_users'])
  })

  it('detects administrators from deployment and migration language', () => {
    const note = toReleaseNote(
      entry({ changes: [{ type: 'changed', text: 'New DB migration 000018 required.' }] }),
    )
    expect(note.items[0].audiences).toContain('administrators')
  })

  it('detects fleet operators', () => {
    const note = toReleaseNote(
      entry({ changes: [{ type: 'added', text: 'Fleet utilisation report.' }] }),
    )
    expect(note.items[0].audiences).toContain('fleet_operators')
  })

  it('detects API consumers', () => {
    const note = toReleaseNote(
      entry({ changes: [{ type: 'changed', text: 'The /drives endpoint schema changed.' }] }),
    )
    expect(note.items[0].audiences).toContain('developers')
  })

  it('orders audiences canonically regardless of match order', () => {
    const note = toReleaseNote(
      entry({
        changes: [
          { type: 'changed', text: 'API schema changed.' },
          { type: 'changed', text: 'Fleet dispatch view.' },
          { type: 'changed', text: 'Requires a config change.' },
        ],
      }),
    )
    const expected = AUDIENCE_ORDER.filter((audience) => note.audiences.includes(audience))
    expect(note.audiences).toEqual(expected)
  })

  it('never produces an empty audience list for a real change', () => {
    for (const note of buildReleaseNotes()) {
      if (note.items.length > 0) expect(note.audiences.length).toBeGreaterThan(0)
    }
  })
})

describe('toReleaseNote — action needed', () => {
  it('flags an explicit migration', () => {
    const note = toReleaseNote(
      entry({ changes: [{ type: 'changed', text: 'Run the new DB migration before upgrading.' }] }),
    )
    expect(note.actionRequired).toBe(true)
    expect(note.hasMigration).toBe(true)
    expect(note.impact).toBe('breaking')
  })

  it('flags removals even when the wording is neutral', () => {
    const note = toReleaseNote(
      entry({ changes: [{ type: 'removed', text: 'The legacy widget.' }] }),
    )
    expect(note.actionRequired).toBe(true)
  })

  it('flags deprecations and security changes by type alone', () => {
    expect(
      toReleaseNote(entry({ changes: [{ type: 'deprecated', text: 'Old thing.' }] }))
        .actionRequired,
    ).toBe(true)
    const security = toReleaseNote(
      entry({ changes: [{ type: 'security', text: 'Patched a dependency.' }] }),
    )
    expect(security.actionRequired).toBe(true)
    expect(security.impact).toBe('security')
  })

  it('flags re-authorisation and restarts', () => {
    expect(
      toReleaseNote(
        entry({ changes: [{ type: 'changed', text: 'You must re-authorize your Tesla account.' }] }),
      ).actionRequired,
    ).toBe(true)
  })

  it('does not flag an ordinary feature addition', () => {
    const note = toReleaseNote(
      entry({ changes: [{ type: 'added', text: 'A new efficiency chart.' }] }),
    )
    expect(note.actionRequired).toBe(false)
    expect(note.impact).toBe('feature')
  })

  it('collects action items separately from the full list', () => {
    const note = toReleaseNote(
      entry({
        changes: [
          { type: 'added', text: 'A new chart.' },
          { type: 'changed', text: 'Requires a migration.' },
        ],
      }),
    )
    expect(note.items).toHaveLength(2)
    expect(note.actionItems).toHaveLength(1)
    expect(note.actionItems[0].text).toContain('migration')
  })
})

describe('summarizeReleaseNote', () => {
  it('hoists action items above everything else', () => {
    const note = toReleaseNote(
      entry({
        changes: [
          { type: 'added', text: 'Feature one.' },
          { type: 'added', text: 'Feature two.' },
          { type: 'changed', text: 'Requires a migration.' },
        ],
      }),
    )
    expect(summarizeReleaseNote(note, 3)[0].text).toContain('migration')
  })

  it('respects the cap', () => {
    const note = toReleaseNote(
      entry({
        changes: Array.from({ length: 20 }, (_, i) => ({
          type: 'added' as const,
          text: `Feature ${i}.`,
        })),
      }),
    )
    expect(summarizeReleaseNote(note, 5)).toHaveLength(5)
    expect(summarizeReleaseNote(note, 0)).toHaveLength(0)
  })
})

describe('buildReleaseNotes — against the real changelog', () => {
  it('derives one note per changelog entry, newest first', () => {
    const notes = buildReleaseNotes()
    expect(notes).toHaveLength(CHANGELOG.length)
    expect(notes[0]?.version).toBe(CHANGELOG[0]?.version)
  })

  it('produces an ISO date for every release', () => {
    for (const note of buildReleaseNotes()) {
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('is deterministic', () => {
    expect(JSON.stringify(buildReleaseNotes())).toBe(JSON.stringify(buildReleaseNotes()))
  })

  it('tolerates a null entry list', () => {
    // `undefined` intentionally falls through to the default parameter (the
    // real changelog); an explicit `null` is the "no data" case.
    expect(buildReleaseNotes(null as unknown as ChangelogEntry[])).toEqual([])
  })
})

describe('releaseNoteForVersion', () => {
  it('finds a known version', () => {
    const version = CHANGELOG[0]?.version
    expect(releaseNoteForVersion(version)?.version).toBe(version)
  })

  it('returns null for an unknown version', () => {
    expect(releaseNoteForVersion('0.0.0-nope')).toBeNull()
  })
})
