import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import {
  useEditLease,
  getCurrentLease,
  EditConflictError,
  ELECTION_TIMEOUT_MS,
  __resetEditLeasesForTests,
  type OtherTabInfo,
} from '../useEditLease'
import {
  TAB_ID,
  __resetBroadcastForTests,
  type BroadcastMessage,
} from '@/lib/broadcast'

/**
 * Phase-46 / Prompt 66 — useEditLease contract.
 *
 * The election protocol is a same-origin handshake on the shared
 * BroadcastChannel `'teslasync'`. Tests simulate a "peer tab" by
 * constructing a second BroadcastChannel directly; the in-process bus
 * filters self-messages by `TAB_ID`, so a second hook instance in the
 * same module would see neither its own nor a sibling instance's
 * broadcasts. The peer-channel pattern matches `lib/__tests__/
 * broadcast.test.ts` and lets us assert the exact wire shape.
 */

const TEST_KEY = 'test-resource'

interface PeerEnvelope {
  _from: string
  _ts: number
  msg: BroadcastMessage
}

function postFromPeer(peer: BroadcastChannel, msg: BroadcastMessage, fromTabId = 'peer-tab-aaa'): void {
  const env: PeerEnvelope = { _from: fromTabId, _ts: Date.now(), msg }
  peer.postMessage(env)
}

async function flushBroadcast(): Promise<void> {
  // Allow the BroadcastChannel macrotask hop + any pending microtasks.
  await new Promise((r) => setTimeout(r, 5))
}

describe('useEditLease', () => {
  beforeEach(() => {
    vi.useRealTimers()
    __resetEditLeasesForTests()
    __resetBroadcastForTests()
  })

  afterEach(() => {
    __resetEditLeasesForTests()
    __resetBroadcastForTests()
  })

  describe('module-level API', () => {
    it('exports the election timeout constant', () => {
      expect(ELECTION_TIMEOUT_MS).toBe(250)
    })

    it('EditConflictError carries resourceKey + otherTab snapshot', () => {
      const otherTab: OtherTabInfo = { tabId: 'peer', claimedAt: 100 }
      const err = new EditConflictError('foo', otherTab)
      expect(err.name).toBe('EditConflictError')
      expect(err.resourceKey).toBe('foo')
      expect(err.otherTab).toEqual(otherTab)
      expect(err).toBeInstanceOf(Error)
    })

    it('getCurrentLease returns null when no hook is mounted on the key', () => {
      expect(getCurrentLease('does-not-exist')).toBeNull()
    })
  })

  describe('mount + election', () => {
    it('a fresh tab with no peer becomes owner after the election timeout', async () => {
      const { result } = renderHook(() => useEditLease(TEST_KEY))

      // Synchronous mount snapshot — election is in-flight so neither
      // owner nor otherTab is set yet.
      expect(result.current.isOwner).toBe(false)
      expect(result.current.otherTab).toBeNull()

      // Wait past the election timeout + buffer for the timer to fire.
      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })

      expect(result.current.isOwner).toBe(true)
      expect(result.current.otherTab).toBeNull()
      expect(getCurrentLease(TEST_KEY)?.isOwner).toBe(true)
    })

    it('responds to a peer lease.request with a lease.granted assertion when owner', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const peerInbox: BroadcastMessage[] = []
      peer.addEventListener('message', (e: MessageEvent) => {
        const env = e.data as PeerEnvelope
        if (env && env.msg && env._from === TAB_ID) {
          peerInbox.push(env.msg)
        }
      })

      renderHook(() => useEditLease(TEST_KEY))

      // Wait for self-grant to settle.
      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })
      peerInbox.length = 0

      // Peer asks who owns it — owner should reply.
      postFromPeer(peer, {
        type: 'lease.request',
        resourceKey: TEST_KEY,
        tabId: 'peer-tab-aaa',
      })
      await flushBroadcast()

      const granted = peerInbox.find(
        (m): m is Extract<BroadcastMessage, { type: 'lease.granted' }> =>
          m.type === 'lease.granted',
      )
      expect(granted).toBeDefined()
      expect(granted?.resourceKey).toBe(TEST_KEY)
      expect(granted?.tabId).toBe(TAB_ID)
      peer.close()
    })
  })

  describe('peer collisions', () => {
    it('a peer lease.granted received during the election window sets otherTab', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const { result } = renderHook(() => useEditLease(TEST_KEY))

      // Inject a peer's grant before the 250ms election timer fires.
      postFromPeer(peer, {
        type: 'lease.granted',
        resourceKey: TEST_KEY,
        tabId: 'peer-tab-aaa',
        claimedAt: Date.now(),
      })
      await act(async () => {
        await flushBroadcast()
      })

      expect(result.current.isOwner).toBe(false)
      expect(result.current.otherTab).not.toBeNull()
      expect(result.current.otherTab?.tabId).toBe('peer-tab-aaa')

      // Even after the election timeout fires, we must NOT promote
      // ourselves because a peer is owner.
      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })
      expect(result.current.isOwner).toBe(false)
      expect(result.current.otherTab?.tabId).toBe('peer-tab-aaa')
      peer.close()
    })

    it('a different resourceKey does not interfere with our state', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const { result } = renderHook(() => useEditLease(TEST_KEY))

      // Peer grants for an UNRELATED key — we must ignore it.
      postFromPeer(peer, {
        type: 'lease.granted',
        resourceKey: 'some-other-resource',
        tabId: 'peer-tab-bbb',
        claimedAt: Date.now(),
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })

      expect(result.current.isOwner).toBe(true)
      expect(result.current.otherTab).toBeNull()
      peer.close()
    })

    it('claim() bumps claimedAt and sets isOwner=true', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const peerInbox: BroadcastMessage[] = []
      peer.addEventListener('message', (e: MessageEvent) => {
        const env = e.data as PeerEnvelope
        if (env && env.msg && env._from === TAB_ID) {
          peerInbox.push(env.msg)
        }
      })

      const { result } = renderHook(() => useEditLease(TEST_KEY))

      // Peer is the active owner.
      postFromPeer(peer, {
        type: 'lease.granted',
        resourceKey: TEST_KEY,
        tabId: 'peer-tab-aaa',
        claimedAt: Date.now(),
      })
      await act(async () => {
        await flushBroadcast()
      })
      expect(result.current.isOwner).toBe(false)
      expect(result.current.otherTab).not.toBeNull()
      peerInbox.length = 0

      // Take over.
      act(() => {
        result.current.claim()
      })
      await flushBroadcast()

      expect(result.current.isOwner).toBe(true)
      expect(result.current.otherTab).toBeNull()
      const granted = peerInbox.find(
        (m): m is Extract<BroadcastMessage, { type: 'lease.granted' }> =>
          m.type === 'lease.granted',
      )
      expect(granted).toBeDefined()
      expect(granted?.tabId).toBe(TAB_ID)
      peer.close()
    })

    it('a peer with newer claimedAt forces us to yield ownership', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const { result } = renderHook(() => useEditLease(TEST_KEY))

      // Become owner first.
      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })
      expect(result.current.isOwner).toBe(true)

      // Peer claims with a strictly later timestamp — newer claim wins.
      const peerClaim = Date.now() + 5000
      postFromPeer(peer, {
        type: 'lease.granted',
        resourceKey: TEST_KEY,
        tabId: 'peer-tab-newer',
        claimedAt: peerClaim,
      })
      await act(async () => {
        await flushBroadcast()
      })

      expect(result.current.isOwner).toBe(false)
      expect(result.current.otherTab?.tabId).toBe('peer-tab-newer')
      peer.close()
    })

    it('clears otherTab and re-elects when the active peer releases', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const { result } = renderHook(() => useEditLease(TEST_KEY))

      // Peer is owner first.
      postFromPeer(peer, {
        type: 'lease.granted',
        resourceKey: TEST_KEY,
        tabId: 'peer-tab-aaa',
        claimedAt: Date.now(),
      })
      await act(async () => {
        await flushBroadcast()
      })
      expect(result.current.isOwner).toBe(false)
      expect(result.current.otherTab?.tabId).toBe('peer-tab-aaa')

      // Peer closes its tab.
      postFromPeer(peer, {
        type: 'lease.released',
        resourceKey: TEST_KEY,
        tabId: 'peer-tab-aaa',
      })
      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })

      // We promote ourselves smoothly.
      expect(result.current.otherTab).toBeNull()
      expect(result.current.isOwner).toBe(true)
      peer.close()
    })
  })

  describe('shared registry across multiple subscribers', () => {
    it('two components on the same key share one lease state', async () => {
      const a = renderHook(() => useEditLease(TEST_KEY))
      const b = renderHook(() => useEditLease(TEST_KEY))

      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })

      // Both subscribers see the same state.
      expect(a.result.current.isOwner).toBe(true)
      expect(b.result.current.isOwner).toBe(true)
      expect(a.result.current.otherTab).toBeNull()
      expect(b.result.current.otherTab).toBeNull()
    })

    it('different keys are independent', async () => {
      const a = renderHook(() => useEditLease('resource/a'))
      const b = renderHook(() => useEditLease('resource/b'))

      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })

      expect(a.result.current.isOwner).toBe(true)
      expect(b.result.current.isOwner).toBe(true)
      expect(getCurrentLease('resource/a')?.isOwner).toBe(true)
      expect(getCurrentLease('resource/b')?.isOwner).toBe(true)
    })

    it('empty resourceKey opts out — no broadcasts, no state', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const peerInbox: BroadcastMessage[] = []
      peer.addEventListener('message', (e: MessageEvent) => {
        const env = e.data as PeerEnvelope
        if (env && env.msg && env._from === TAB_ID) {
          peerInbox.push(env.msg)
        }
      })

      const { result } = renderHook(() => useEditLease(''))
      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })

      expect(result.current.isOwner).toBe(false)
      expect(result.current.otherTab).toBeNull()
      // Calling claim() on the no-op lease must be safe.
      expect(() => result.current.claim()).not.toThrow()
      // No lease.* messages were emitted.
      const leaseMessages = peerInbox.filter((m) =>
        m.type === 'lease.request' || m.type === 'lease.granted' || m.type === 'lease.released',
      )
      expect(leaseMessages).toHaveLength(0)
      peer.close()
    })
  })

  describe('unmount cleanup', () => {
    it('unmounting the last subscriber broadcasts lease.released and clears the registry', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const peerInbox: BroadcastMessage[] = []
      peer.addEventListener('message', (e: MessageEvent) => {
        const env = e.data as PeerEnvelope
        if (env && env.msg && env._from === TAB_ID) {
          peerInbox.push(env.msg)
        }
      })

      const { unmount } = renderHook(() => useEditLease(TEST_KEY))
      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })
      peerInbox.length = 0

      unmount()
      await flushBroadcast()

      const released = peerInbox.find(
        (m): m is Extract<BroadcastMessage, { type: 'lease.released' }> =>
          m.type === 'lease.released',
      )
      expect(released).toBeDefined()
      expect(released?.resourceKey).toBe(TEST_KEY)
      expect(getCurrentLease(TEST_KEY)).toBeNull()
      peer.close()
    })

    it('unmounting one of two subscribers keeps the registry alive', async () => {
      const a = renderHook(() => useEditLease(TEST_KEY))
      const b = renderHook(() => useEditLease(TEST_KEY))

      await act(async () => {
        await new Promise((r) => setTimeout(r, ELECTION_TIMEOUT_MS + 100))
      })
      expect(a.result.current.isOwner).toBe(true)

      a.unmount()
      // Registry entry survives because B still subscribes.
      expect(getCurrentLease(TEST_KEY)?.isOwner).toBe(true)
      expect(b.result.current.isOwner).toBe(true)

      b.unmount()
      // Now both unmounted — registry is gone.
      expect(getCurrentLease(TEST_KEY)).toBeNull()
    })
  })
})
