import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  queueTeslaMutation,
  drainQueuedTeslaMutations,
  notifyTeslaAuthRecovered,
  TESLA_AUTH_QUEUE_MAX,
  TESLA_AUTH_QUEUE_TTL_MS,
  _resetTeslaAuthRecoveryQueue,
  _peekTeslaAuthRecoveryQueueSize,
} from '../teslaAuthRecovery'

beforeEach(() => {
  _resetTeslaAuthRecoveryQueue()
})

afterEach(() => {
  _resetTeslaAuthRecoveryQueue()
  vi.useRealTimers()
})

describe('teslaAuthRecovery', () => {
  describe('queueTeslaMutation', () => {
    it('accepts a replay closure and increments the queue depth', () => {
      expect(_peekTeslaAuthRecoveryQueueSize()).toBe(0)
      queueTeslaMutation(async () => {})
      expect(_peekTeslaAuthRecoveryQueueSize()).toBe(1)
    })

    it('caps the queue at TESLA_AUTH_QUEUE_MAX (10) and drops further entries silently', () => {
      for (let i = 0; i < TESLA_AUTH_QUEUE_MAX + 5; i++) {
        queueTeslaMutation(async () => {})
      }
      expect(_peekTeslaAuthRecoveryQueueSize()).toBe(TESLA_AUTH_QUEUE_MAX)
    })
  })

  describe('drainQueuedTeslaMutations', () => {
    it('replays queued closures in FIFO order', async () => {
      const order: number[] = []
      queueTeslaMutation(async () => { order.push(1) })
      queueTeslaMutation(async () => { order.push(2) })
      queueTeslaMutation(async () => { order.push(3) })

      await drainQueuedTeslaMutations()

      expect(order).toEqual([1, 2, 3])
    })

    it('empties the queue after draining', async () => {
      queueTeslaMutation(async () => {})
      queueTeslaMutation(async () => {})
      expect(_peekTeslaAuthRecoveryQueueSize()).toBe(2)

      await drainQueuedTeslaMutations()

      expect(_peekTeslaAuthRecoveryQueueSize()).toBe(0)
    })

    it('drops entries older than TESLA_AUTH_QUEUE_TTL_MS (5 minutes) without replaying them', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

      const stale = vi.fn(async () => {})
      const fresh = vi.fn(async () => {})

      queueTeslaMutation(stale)
      // Advance 6 minutes — past the 5-minute TTL.
      vi.setSystemTime(new Date('2026-05-03T12:06:00Z'))
      queueTeslaMutation(fresh)

      await drainQueuedTeslaMutations()

      expect(stale).not.toHaveBeenCalled()
      expect(fresh).toHaveBeenCalledTimes(1)
    })

    it('keeps entries that are exactly at the TTL boundary (≤ TTL)', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

      const onEdge = vi.fn(async () => {})
      queueTeslaMutation(onEdge)
      // Advance exactly the TTL (5 minutes).
      vi.setSystemTime(new Date('2026-05-03T12:00:00Z').getTime() + TESLA_AUTH_QUEUE_TTL_MS)

      await drainQueuedTeslaMutations()

      expect(onEdge).toHaveBeenCalledTimes(1)
    })

    it('swallows replay errors — one failing replay does not block the others', async () => {
      const calls: string[] = []
      queueTeslaMutation(async () => { calls.push('a-ok') })
      queueTeslaMutation(async () => { calls.push('b-throws'); throw new Error('boom') })
      queueTeslaMutation(async () => { calls.push('c-ok') })

      await expect(drainQueuedTeslaMutations()).resolves.toBeUndefined()
      expect(calls).toEqual(['a-ok', 'b-throws', 'c-ok'])
    })

    it('is idempotent — draining an empty queue is a no-op', async () => {
      await expect(drainQueuedTeslaMutations()).resolves.toBeUndefined()
      expect(_peekTeslaAuthRecoveryQueueSize()).toBe(0)
    })
  })

  describe('notifyTeslaAuthRecovered', () => {
    it('dispatches the teslasync:tesla-auth-recovered CustomEvent on document', () => {
      const handler = vi.fn()
      document.addEventListener('teslasync:tesla-auth-recovered', handler)
      notifyTeslaAuthRecovered()
      document.removeEventListener('teslasync:tesla-auth-recovered', handler)

      expect(handler).toHaveBeenCalledTimes(1)
      const evt = handler.mock.calls[0][0]
      expect(evt).toBeInstanceOf(Event)
      expect(evt.type).toBe('teslasync:tesla-auth-recovered')
    })
  })
})
