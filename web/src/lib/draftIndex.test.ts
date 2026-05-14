import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  registerDraft,
  unregisterDraft,
  clearDraft,
  discardDraftEnvelope,
  getDrafts,
  subscribeDraftIndex,
  __resetDraftIndexForTests,
  DRAFT_INDEX_KEY,
  type DraftEntry,
} from './draftIndex'

const ENV_KEY_RULE_42 = 'teslasync:draft:v1:alertstudio:rule:42'
const ENV_KEY_RULE_NEW = 'teslasync:draft:v1:alertstudio:rule:new'
const ENV_KEY_AUTOMATION = 'teslasync:draft:v1:automation:edit:7'
const ENV_KEY_GENERIC = 'teslasync:draft:v2:custom:thing:99'

function writeEnvelope(storageKey: string, savedAt: number, value: unknown = { x: 1 }): void {
  const versionMatch = /^teslasync:draft:v(\d+):/.exec(storageKey)
  const version = versionMatch ? Number.parseInt(versionMatch[1], 10) : 1
  localStorage.setItem(storageKey, JSON.stringify({ version, savedAt, value }))
}

function makeEntry(overrides: Partial<DraftEntry> = {}): DraftEntry {
  return {
    storageKey: ENV_KEY_RULE_42,
    key: 'alertstudio:rule:42',
    version: 1,
    label: 'Rule 42 draft',
    route: '/alert-studio?id=42',
    savedAt: Date.now(),
    ...overrides,
  }
}

describe('draftIndex', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetDraftIndexForTests()
  })

  afterEach(() => {
    localStorage.clear()
    __resetDraftIndexForTests()
  })

  describe('registerDraft', () => {
    it('writes a fresh entry to the index slot', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft(makeEntry({ savedAt: 1000 }))

      const raw = localStorage.getItem(DRAFT_INDEX_KEY)
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!)
      expect(parsed.drafts[ENV_KEY_RULE_42]).toMatchObject({
        storageKey: ENV_KEY_RULE_42,
        key: 'alertstudio:rule:42',
        label: 'Rule 42 draft',
        route: '/alert-studio?id=42',
        savedAt: 1000,
      })
    })

    it('replaces an existing entry when re-registered (idempotent)', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft(makeEntry({ savedAt: 1000, label: 'Old' }))
      registerDraft(makeEntry({ savedAt: 2000, label: 'New' }))

      const drafts = getDrafts()
      expect(drafts).toHaveLength(1)
      expect(drafts[0].label).toBe('New')
      expect(drafts[0].savedAt).toBe(2000)
    })

    it('ignores entries that fail validation (missing fields)', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft({
        storageKey: ENV_KEY_RULE_42,
        // missing required fields
      } as unknown as DraftEntry)

      expect(localStorage.getItem(DRAFT_INDEX_KEY)).toBeNull()
    })
  })

  describe('unregisterDraft / clearDraft', () => {
    it('removes the entry without touching the envelope', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft(makeEntry({ savedAt: 1000 }))

      unregisterDraft(ENV_KEY_RULE_42)

      const raw = localStorage.getItem(DRAFT_INDEX_KEY)
      const parsed = JSON.parse(raw!)
      expect(parsed.drafts[ENV_KEY_RULE_42]).toBeUndefined()
      // Envelope still present.
      expect(localStorage.getItem(ENV_KEY_RULE_42)).not.toBeNull()
    })

    it('is a no-op when the entry does not exist', () => {
      expect(() => unregisterDraft(ENV_KEY_RULE_42)).not.toThrow()
    })

    it('clearDraft alias behaves identically (removes index entry only)', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft(makeEntry({ savedAt: 1000 }))

      clearDraft(ENV_KEY_RULE_42)

      // Index entry is gone …
      const raw = localStorage.getItem(DRAFT_INDEX_KEY)
      const parsed = JSON.parse(raw!)
      expect(parsed.drafts[ENV_KEY_RULE_42]).toBeUndefined()
      // … but the envelope still exists, so getDrafts surfaces it as a
      // fallback entry. clearDraft is index-only by contract.
      const drafts = getDrafts()
      const surviving = drafts.find(d => d.storageKey === ENV_KEY_RULE_42)
      expect(surviving?.fallback).toBe(true)
    })
  })

  describe('discardDraftEnvelope', () => {
    it('removes both envelope and index entry', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft(makeEntry({ savedAt: 1000 }))

      discardDraftEnvelope(ENV_KEY_RULE_42)

      expect(localStorage.getItem(ENV_KEY_RULE_42)).toBeNull()
      expect(getDrafts()).toEqual([])
    })

    it('handles unregistered envelopes (still removes envelope)', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      // No registration.

      discardDraftEnvelope(ENV_KEY_RULE_42)

      expect(localStorage.getItem(ENV_KEY_RULE_42)).toBeNull()
    })
  })

  describe('getDrafts', () => {
    it('returns empty when no drafts exist', () => {
      expect(getDrafts()).toEqual([])
    })

    it('returns registered drafts sorted most-recent first', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      writeEnvelope(ENV_KEY_AUTOMATION, 2000)
      registerDraft(makeEntry({ storageKey: ENV_KEY_RULE_42, key: 'alertstudio:rule:42', savedAt: 1000 }))
      registerDraft(makeEntry({
        storageKey: ENV_KEY_AUTOMATION,
        key: 'automation:edit:7',
        label: 'Automation 7',
        route: '/automations/7',
        savedAt: 2000,
      }))

      const drafts = getDrafts()
      expect(drafts.map(d => d.storageKey)).toEqual([ENV_KEY_AUTOMATION, ENV_KEY_RULE_42])
      expect(drafts.every(d => d.fallback === false)).toBe(true)
    })

    it('synthesises fallback entries for unregistered envelopes', () => {
      writeEnvelope(ENV_KEY_RULE_NEW, 5000)

      const drafts = getDrafts()
      expect(drafts).toHaveLength(1)
      expect(drafts[0]).toMatchObject({
        storageKey: ENV_KEY_RULE_NEW,
        key: 'alertstudio:rule:new',
        version: 1,
        label: 'Alert rule draft',
        route: '/notifications/studio',
        savedAt: 5000,
        fallback: true,
      })
    })

    it('uses the default fallback for unknown key prefixes', () => {
      writeEnvelope(ENV_KEY_GENERIC, 7000)

      const drafts = getDrafts()
      const generic = drafts.find(d => d.storageKey === ENV_KEY_GENERIC)
      expect(generic).toMatchObject({
        label: 'Unsaved draft',
        route: '/',
        fallback: true,
      })
    })

    it('prunes index entries whose envelope no longer exists', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft(makeEntry({ savedAt: 1000 }))
      // Simulate envelope deletion in another tab.
      localStorage.removeItem(ENV_KEY_RULE_42)

      const drafts = getDrafts()
      expect(drafts).toEqual([])

      // Re-read directly from storage to verify the index was actually
      // pruned (not just filtered in memory).
      const raw = localStorage.getItem(DRAFT_INDEX_KEY)
      const parsed = JSON.parse(raw!)
      expect(parsed.drafts[ENV_KEY_RULE_42]).toBeUndefined()
    })

    it('prefers the envelope savedAt when the registry is stale', () => {
      writeEnvelope(ENV_KEY_RULE_42, 9000) // newer envelope
      registerDraft(makeEntry({ savedAt: 1000 })) // older registry

      const drafts = getDrafts()
      expect(drafts[0].savedAt).toBe(9000)
    })

    it('returns the union of registered + scanned entries', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      writeEnvelope(ENV_KEY_RULE_NEW, 2000) // not registered
      registerDraft(makeEntry({ savedAt: 1000 }))

      const drafts = getDrafts()
      expect(drafts.map(d => d.storageKey).sort()).toEqual(
        [ENV_KEY_RULE_42, ENV_KEY_RULE_NEW].sort(),
      )
      const fallbackEntry = drafts.find(d => d.storageKey === ENV_KEY_RULE_NEW)
      expect(fallbackEntry?.fallback).toBe(true)
      const registeredEntry = drafts.find(d => d.storageKey === ENV_KEY_RULE_42)
      expect(registeredEntry?.fallback).toBe(false)
    })

    it('skips non-draft localStorage keys', () => {
      writeEnvelope(ENV_KEY_RULE_42, 1000)
      localStorage.setItem('teslasync:settings', 'unrelated')
      localStorage.setItem('something-else', 'noise')

      const drafts = getDrafts()
      expect(drafts).toHaveLength(1)
      expect(drafts[0].storageKey).toBe(ENV_KEY_RULE_42)
    })

    it('skips envelopes whose JSON cannot be parsed', () => {
      localStorage.setItem(ENV_KEY_RULE_42, 'not-valid-json{')

      const drafts = getDrafts()
      expect(drafts).toEqual([])
    })

    it('survives a corrupt index payload (resets it on read)', () => {
      localStorage.setItem(DRAFT_INDEX_KEY, '{not-valid-json')
      writeEnvelope(ENV_KEY_RULE_42, 1000)

      const drafts = getDrafts()
      // Falls back to scan-based discovery after the corrupt index is wiped.
      expect(drafts).toHaveLength(1)
      expect(drafts[0].fallback).toBe(true)
      expect(localStorage.getItem(DRAFT_INDEX_KEY)).toBeNull()
    })
  })

  describe('subscribeDraftIndex', () => {
    it('fires for same-tab writes via the synthetic event', () => {
      const handler = vi.fn()
      const off = subscribeDraftIndex(handler)

      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft(makeEntry({ savedAt: 1000 }))

      expect(handler).toHaveBeenCalled()
      off()
    })

    it('fires for cross-tab storage events on the index key', () => {
      const handler = vi.fn()
      const off = subscribeDraftIndex(handler)

      // Simulate a storage event from another tab.
      const event = new StorageEvent('storage', {
        key: DRAFT_INDEX_KEY,
        newValue: '{"drafts":{}}',
        oldValue: null,
        storageArea: localStorage,
      })
      window.dispatchEvent(event)

      expect(handler).toHaveBeenCalled()
      off()
    })

    it('fires for cross-tab storage events on envelope keys', () => {
      const handler = vi.fn()
      const off = subscribeDraftIndex(handler)

      const event = new StorageEvent('storage', {
        key: ENV_KEY_RULE_42,
        newValue: '{}',
        storageArea: localStorage,
      })
      window.dispatchEvent(event)

      expect(handler).toHaveBeenCalled()
      off()
    })

    it('ignores storage events for unrelated keys', () => {
      const handler = vi.fn()
      const off = subscribeDraftIndex(handler)

      const event = new StorageEvent('storage', {
        key: 'teslasync:something-else',
        newValue: 'x',
        storageArea: localStorage,
      })
      window.dispatchEvent(event)

      expect(handler).not.toHaveBeenCalled()
      off()
    })

    it('unsubscribe stops further notifications', () => {
      const handler = vi.fn()
      const off = subscribeDraftIndex(handler)
      off()

      writeEnvelope(ENV_KEY_RULE_42, 1000)
      registerDraft(makeEntry({ savedAt: 1000 }))

      expect(handler).not.toHaveBeenCalled()
    })
  })
})
