import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusManager, onlineManager, QueryObserver, type QueryClient } from '@tanstack/react-query'
import { createQueryClient } from './queryClient'
import { deriveDataState } from './dataState'
import { ApiError, RateLimitError } from '@/lib/resilience'
import { rateLimitContext, resetRateLimits } from '@/lib/rateLimit'
import { __resetBroadcastForTests } from '@/lib/broadcast'
import { TEST_RATE_BUCKET } from '@/test/rateLimit'

const clients: QueryClient[] = []
const unsubscribes: (() => void)[] = []

function limited(method = 'GET') {
  return new RateLimitError('limited', 1, '/vehicles', {
    bucket: TEST_RATE_BUCKET, scope: '/vehicles', methods: method, requestMethod: method,
    source: 'teslasync', enforcement: 'process', expiresAt: Date.now() + 1000, retryAfterSec: 1,
  })
}

function client() {
  const qc = createQueryClient()
  clients.push(qc)
  return qc
}

function observe(qc: QueryClient, queryKey: string[], queryFn: () => Promise<string>) {
  const observer = new QueryObserver(qc, { queryKey, queryFn })
  const unsubscribe = observer.subscribe(() => undefined)
  unsubscribes.push(unsubscribe)
  return { observer, unsubscribe }
}

async function settleRecovery() {
  await vi.advanceTimersByTimeAsync(0)
  await vi.dynamicImportSettled()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  focusManager.setFocused(true)
  onlineManager.setOnline(true)
})

afterEach(async () => {
  await vi.dynamicImportSettled()
  unsubscribes.splice(0).forEach((unsubscribe) => unsubscribe())
  clients.splice(0).forEach((qc) => qc.clear())
  resetRateLimits()
  __resetBroadcastForTests()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('bounded quota read recovery', () => {
  it('waits for Retry-After plus jitter and recovers only the affected active read', async () => {
    const qc = client()
    const affected = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(limited()).mockResolvedValue('fresh')
    const unrelated = vi.fn<() => Promise<string>>().mockResolvedValue('unrelated')
    const { observer } = observe(qc, ['affected'], affected)
    observe(qc, ['unrelated'], unrelated)
    await settleRecovery()
    expect(affected).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(affected).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(affected).toHaveBeenCalledTimes(2)
    expect(unrelated).toHaveBeenCalledTimes(1)
    expect(observer.getCurrentResult().data).toBe('fresh')
  })

  it('retains cached values and reports stale, not a fatal page failure, during cooldown', async () => {
    const qc = client()
    qc.setQueryData(['cached'], 'previous')
    const { observer } = observe(qc, ['cached'], async () => { throw limited() })
    await observer.refetch()
    const state = deriveDataState(observer.getCurrentResult())
    expect(state.data).toBe('previous')
    expect(state.status).toBe('stale')
    expect(state.fatalError).toBeNull()
    expect(state.refreshError).toBeInstanceOf(RateLimitError)
  })

  it('pauses recovery while hidden/offline and staggers it after focus and connectivity return', async () => {
    const qc = client()
    const read = vi.fn<() => Promise<string>>().mockRejectedValueOnce(limited()).mockResolvedValue('fresh')
    observe(qc, ['hidden'], read)
    await settleRecovery()
    focusManager.setFocused(false)
    onlineManager.setOnline(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(1)
    focusManager.setFocused(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(read).toHaveBeenCalledTimes(1)
    onlineManager.setOnline(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('cancels work when the page drops its observer or the connection context changes', async () => {
    const qc = client()
    const obsolete = vi.fn<() => Promise<string>>().mockRejectedValue(limited())
    const changing = vi.fn<() => Promise<string>>().mockRejectedValue(limited())
    const first = observe(qc, ['obsolete'], obsolete)
    observe(qc, ['changing'], changing)
    await settleRecovery()
    first.unsubscribe()
    document.dispatchEvent(new Event('teslasync:rate-limits-reset'))
    await vi.advanceTimersByTimeAsync(5000)
    expect(obsolete).toHaveBeenCalledTimes(1)
    expect(changing).toHaveBeenCalledTimes(1)
  })

  it('does not revive an obsolete connection failure when recovery loads', async () => {
    const generation = rateLimitContext('https://first.example/api/v1/vehicles')
    const stale = limited()
    stale.generation = generation
    resetRateLimits()
    const qc = client()
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(stale)
    observe(qc, ['obsolete-before-load'], read)
    await settleRecovery()
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('bounds repeated automatic recoveries instead of retrying forever', async () => {
    const qc = client()
    const read = vi.fn<() => Promise<string>>().mockImplementation(async () => { throw limited() })
    observe(qc, ['still-limited'], read)
    await settleRecovery()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('caps pending automatic work when more than 64 active reads fail together', async () => {
    const qc = client()
    const read = vi.fn<() => Promise<string>>().mockImplementation(async () => { throw limited() })
    for (let i = 0; i < 65; i++) observe(qc, [`read-${i}`], read)
    await settleRecovery()
    expect(read).toHaveBeenCalledTimes(65)
    await vi.advanceTimersByTimeAsync(2000)
    expect(read).toHaveBeenCalledTimes(129)
  })

  it('never retries or schedules a failed mutation, including a rate-limited command', async () => {
    const qc = client()
    const command = vi.fn().mockRejectedValue(limited('POST'))
    const mutation = qc.getMutationCache().build(qc, { mutationFn: command })
    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(RateLimitError)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('respects a query that explicitly opts out of automatic retries', async () => {
    const qc = client()
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(limited())
    const observer = new QueryObserver(qc, { queryKey: ['manual-only'], queryFn: read, retry: false })
    unsubscribes.push(observer.subscribe(() => undefined))
    await settleRecovery()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not retry terminal HTTP errors but permits one jittered transient-read retry', async () => {
    const qc = client()
    const denied = vi.fn<() => Promise<string>>().mockRejectedValue(new ApiError('denied', 403))
    const transient = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError('temporary', 500)).mockResolvedValue('fresh')
    observe(qc, ['denied'], denied)
    observe(qc, ['transient'], transient)
    await vi.advanceTimersByTimeAsync(3000)
    expect(denied).toHaveBeenCalledTimes(1)
    expect(transient).toHaveBeenCalledTimes(2)
  })
})
