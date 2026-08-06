import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  TAB_ID,
  __resetBroadcastForTests,
  broadcast,
  subscribe,
  useBroadcast,
  type BroadcastMessage,
} from '../broadcast'

const ORIGINAL_BROADCAST_CHANNEL = (globalThis as unknown as { BroadcastChannel?: typeof BroadcastChannel })
  .BroadcastChannel

function restoreBroadcastChannel() {
  if (ORIGINAL_BROADCAST_CHANNEL == null) {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      value: undefined,
      configurable: true,
      writable: true,
    })
  } else {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      value: ORIGINAL_BROADCAST_CHANNEL,
      configurable: true,
      writable: true,
    })
  }
}

function disableBroadcastChannel() {
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    value: undefined,
    configurable: true,
    writable: true,
  })
}

// BroadcastChannel delivery is asynchronous with no guaranteed tick budget, so a
// single `setTimeout(0)` hop drops messages under CPU load. Poll for the expected
// state instead — this returns as soon as delivery lands.
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: timed out waiting for channel delivery')
    await new Promise((r) => setTimeout(r, 1))
  }
}

// Drains any already-queued delivery, for assertions that a message did NOT arrive.
// There is nothing to poll for, so this bounds how long an erroneous delivery has
// to show up; more hops make the negative assertion stronger, never flakier.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 1))
}

describe('broadcast bus', () => {
  beforeEach(() => {
    __resetBroadcastForTests()
    window.localStorage.clear()
    restoreBroadcastChannel()
  })

  afterEach(() => {
    __resetBroadcastForTests()
    window.localStorage.clear()
    restoreBroadcastChannel()
  })

  it('TAB_ID is a non-empty stable string', () => {
    expect(TAB_ID).toMatch(/.+/)
  })

  describe('BroadcastChannel transport', () => {
    it('delivers to a peer channel listening on the same name', async () => {
      // Skip if jsdom doesn't ship BroadcastChannel.
      if (typeof BroadcastChannel === 'undefined') return

      const peer = new BroadcastChannel('teslasync')
      const received: unknown[] = []
      peer.addEventListener('message', (e: MessageEvent) => received.push(e.data))

      broadcast({ type: 'auth.logout' })
      await waitFor(() => received.length === 1)
      peer.close()

      expect(received).toHaveLength(1)
      const env = received[0] as { msg: BroadcastMessage; _from: string }
      expect(env.msg).toEqual({ type: 'auth.logout' })
      expect(env._from).toBe(TAB_ID)
    })

    it('subscribe() filters messages emitted by the same tab', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const handler = vi.fn()
      const off = subscribe(handler)
      // Emitting from this same tab — handler must NOT fire.
      broadcast({ type: 'auth.logout' })
      await settle()
      expect(handler).not.toHaveBeenCalled()

      // Emit from a peer (different _from) by hand-rolling an envelope.
      const peer = new BroadcastChannel('teslasync')
      peer.postMessage({ _from: 'other-tab', _ts: Date.now(), msg: { type: 'auth.logout' } })
      await waitFor(() => handler.mock.calls.length === 1)
      peer.close()
      off()

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ type: 'auth.logout' })
    })

    it('malformed envelopes are silently ignored', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const handler = vi.fn()
      const off = subscribe(handler)
      const peer = new BroadcastChannel('teslasync')
      peer.postMessage(null)
      peer.postMessage('not-an-envelope')
      peer.postMessage({ _from: 'x', _ts: 0 }) // no msg
      await settle()
      peer.close()
      off()
      expect(handler).not.toHaveBeenCalled()
    })

    it('a thrown handler does not break sibling handlers or the bus', async () => {
      if (typeof BroadcastChannel === 'undefined') return

      const failing = vi.fn(() => { throw new Error('boom') })
      const ok = vi.fn()
      const offA = subscribe(failing)
      const offB = subscribe(ok)
      const peer = new BroadcastChannel('teslasync')
      peer.postMessage({ _from: 'other-tab', _ts: Date.now(), msg: { type: 'auth.logout' } })
      await waitFor(() => ok.mock.calls.length === 1)
      peer.close()
      offA()
      offB()
      expect(failing).toHaveBeenCalled()
      expect(ok).toHaveBeenCalledTimes(1)
    })
  })

  describe('storage-event fallback', () => {
    beforeEach(() => {
      disableBroadcastChannel()
      __resetBroadcastForTests()
    })

    it('broadcast() writes a __teslasync_bus_ key + immediately removes it', () => {
      const setSpy = vi.spyOn(Storage.prototype, 'setItem')
      const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')

      broadcast({ type: 'onboarded' })

      const setCalls = setSpy.mock.calls.filter(([k]) => typeof k === 'string' && k.startsWith('__teslasync_bus_'))
      const removeCalls = removeSpy.mock.calls.filter(([k]) => typeof k === 'string' && k.startsWith('__teslasync_bus_'))
      expect(setCalls).toHaveLength(1)
      expect(removeCalls).toHaveLength(1)

      // Envelope contents
      const [, raw] = setCalls[0]
      const env = JSON.parse(raw as string) as { msg: BroadcastMessage; _from: string }
      expect(env.msg).toEqual({ type: 'onboarded' })
      expect(env._from).toBe(TAB_ID)

      setSpy.mockRestore()
      removeSpy.mockRestore()
    })

    it('subscribe() picks up envelopes from synthetic storage events', () => {
      const handler = vi.fn()
      const off = subscribe(handler)

      // Simulate a peer tab writing the same key.
      const env = {
        _from: 'other-tab',
        _ts: Date.now(),
        msg: { type: 'install.dismissed' as const },
      }
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: '__teslasync_bus_123_abc',
          newValue: JSON.stringify(env),
          oldValue: null,
          storageArea: window.localStorage,
        }),
      )

      off()
      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ type: 'install.dismissed' })
    })

    it('storage events for unrelated keys are ignored', () => {
      const handler = vi.fn()
      const off = subscribe(handler)
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'some-other-key',
          newValue: 'whatever',
          storageArea: window.localStorage,
        }),
      )
      off()
      expect(handler).not.toHaveBeenCalled()
    })

    it('storage events with the current TAB_ID are filtered out', () => {
      const handler = vi.fn()
      const off = subscribe(handler)
      const env = { _from: TAB_ID, _ts: Date.now(), msg: { type: 'onboarded' as const } }
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: '__teslasync_bus_self_xyz',
          newValue: JSON.stringify(env),
          storageArea: window.localStorage,
        }),
      )
      off()
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('useBroadcast hook', () => {
    it('subscribes on mount and unsubscribes on unmount', async () => {
      const handler = vi.fn()
      const { unmount } = renderHook(({ h }) => useBroadcast(h), {
        initialProps: { h: handler },
      })

      const env = {
        _from: 'other-tab',
        _ts: Date.now(),
        msg: { type: 'onboarded' as const },
      }
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: '__teslasync_bus_99_xyz',
            newValue: JSON.stringify(env),
            storageArea: window.localStorage,
          }),
        )
      })
      expect(handler).toHaveBeenCalledTimes(1)

      unmount()
      handler.mockClear()
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: '__teslasync_bus_100_abc',
            newValue: JSON.stringify(env),
            storageArea: window.localStorage,
          }),
        )
      })
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
