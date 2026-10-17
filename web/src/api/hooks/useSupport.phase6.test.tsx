import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { DataStateSource } from '@/api/dataState'
import type { VersionInfo } from '@/api/types'
import type { SystemHealth } from '@/types/admin'
import { findForbiddenContent } from '@/lib/supportBundle'
import { useSupportBundle } from './useSupport'

const fixtures = vi.hoisted(() => ({
  version: {} as DataStateSource<VersionInfo>,
  health: {} as DataStateSource<SystemHealth>,
  online: true,
  request: vi.fn(),
}))

vi.mock('./useSettings', () => ({ useVersionInfo: () => fixtures.version }))
vi.mock('./useAdmin', () => ({ useSystemHealth: () => fixtures.health }))
vi.mock('./_toastHelpers', () => ({ useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../client', () => ({ request: fixtures.request }))
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => fixtures.online }))
vi.mock('@/lib/browserCompat', () => ({ detectMissingFeatures: () => ['fixture-feature'] }))
vi.mock('@/lib/errorReporter', () => ({
  getRecentReportsForFeedback: () => [{
    name: 'Error',
    message: 'Driver owner@example.com VIN 5YJ3E1EA7KF123456',
    route: '/vehicles/123?token=private',
    occurred_at: '2026-10-14T07:00:00Z',
  }],
}))
vi.mock('@/lib/demoMode', () => ({ isDemoModeEnabled: () => false }))

const version: VersionInfo = {
  app_version: '2.0.0', chart_version: 'stable', go_version: '1.25',
  os: 'linux', arch: 'amd64', uptime_seconds: 1, goroutines: 1,
}
const health: SystemHealth = {
  status: 'degraded',
  components: {
    database: { status: 'healthy', consecutiveFailures: 0, lastError: null, details: {} },
  },
  databaseSize: 'unknown', tableCount: 0,
}
const receipt = Date.parse('2026-10-14T07:00:00Z')

beforeEach(() => {
  fixtures.version = { isPending: true, isLoading: true, fetchStatus: 'fetching' }
  fixtures.health = { isPending: true, isLoading: true, fetchStatus: 'fetching' }
  fixtures.online = true
  fixtures.request.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useSupportBundle phase6 independent source trust', () => {
  it('keeps a redacted, serializable partial bundle while both initial sources load', () => {
    const { result } = renderHook(() => useSupportBundle())
    expect(result.current.isLoading).toBe(true)
    expect(result.current.sources.version).toMatchObject({
      hasData: false, status: 'initial', isLoading: true, isPending: true, updatedAt: null, observedAt: null,
    })
    expect(result.current.sources.health.status).toBe('initial')
    expect(result.current.bundle.health.overall).toBe('unknown')
    expect(result.current.bundle.errors).toHaveLength(1)
    expect(findForbiddenContent(result.current.json)).toEqual([])
    expect(JSON.parse(result.current.json)).toEqual(result.current.bundle)
    expect(fixtures.request).not.toHaveBeenCalled()
  })

  it('does not convert initial idle/paused queries into ready, healthy or offline', () => {
    fixtures.version = { isPending: true, isLoading: false, fetchStatus: 'idle' }
    fixtures.health = { isPending: true, isLoading: false, fetchStatus: 'paused' }
    const { result } = renderHook(() => useSupportBundle())
    expect(result.current.isLoading).toBe(false)
    expect(result.current.sources.version.status).toBe('initial')
    expect(result.current.sources.health).toMatchObject({
      status: 'initial', hasData: false, isRefreshBlocked: true, fatalError: null,
    })
    expect(result.current.bundle.health.overall).toBe('unknown')
    expect(result.current.bundle.browser.online).toBe(true)
  })

  it.each(['version', 'health'] as const)('isolates initial %s failure from the resolved neighbor', key => {
    fixtures.version = { data: version, dataUpdatedAt: receipt, isSuccess: true }
    fixtures.health = { data: health, dataUpdatedAt: receipt, isSuccess: true }
    const retry = vi.fn()
    const error = new Error('Source fixture failed')
    fixtures[key] = { error, isError: true, isLoading: false, refetch: retry }
    const { result } = renderHook(() => useSupportBundle())
    expect(result.current.sources[key]).toMatchObject({
      status: 'initialFailure', hasData: false, fatalError: error, refreshError: null,
    })
    const neighbor = key === 'version' ? 'health' : 'version'
    expect(result.current.sources[neighbor]).toMatchObject({ status: 'ok', hasData: true })
    result.current.sources[key].retry?.()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(result.current.bundle.health.overall).toBe(key === 'health' ? 'unknown' : 'degraded')
    expect(result.current.json).not.toContain('Source fixture failed')
  })

  it('retains exact redacted fields, last-success receipts and separate retries after refresh failure', () => {
    const versionRetry = vi.fn()
    const healthRetry = vi.fn()
    fixtures.version = { data: version, dataUpdatedAt: receipt, refetch: versionRetry }
    fixtures.health = { data: health, dataUpdatedAt: receipt - 1000, refetch: healthRetry }
    const { result, rerender } = renderHook(() => useSupportBundle())
    const previousBundle = result.current.json
    fixtures.health = {
      ...fixtures.health, error: new Error('owner@example.com'), isError: true,
    }
    rerender()
    expect(result.current.json).toBe(previousBundle)
    expect(result.current.sources.health).toMatchObject({
      status: 'stale', hasData: true, updatedAt: receipt - 1000, fatalError: null,
    })
    expect(result.current.sources.health.refreshError).toBeInstanceOf(Error)
    expect(result.current.sources.version.status).toBe('ok')
    result.current.sources.health.retry?.()
    expect(healthRetry).toHaveBeenCalledTimes(1)
    expect(versionRetry).not.toHaveBeenCalled()
    expect(findForbiddenContent(result.current.json)).toEqual([])
    expect(result.current.sources.health).not.toHaveProperty('data')
  })

  it('projects retained paused, refreshing and query-stale sources without erasing payloads', () => {
    fixtures.version = { data: version, dataUpdatedAt: receipt, isFetching: true, fetchStatus: 'fetching' }
    fixtures.health = { data: health, dataUpdatedAt: receipt, fetchStatus: 'paused' }
    const { result, rerender } = renderHook(() => useSupportBundle())
    expect(result.current.sources.version.isRefreshing).toBe(true)
    expect(result.current.sources.health).toMatchObject({
      status: 'stale', isRefreshBlocked: true, refreshError: null, fatalError: null,
    })
    fixtures.version = { ...fixtures.version, isStale: true, isFetching: false }
    rerender()
    expect(result.current.sources.version.status).toBe('stale')
    expect(result.current.bundle.app.version).toBe('2.0.0')
    expect(result.current.bundle.health.overall).toBe('degraded')
    expect(result.current.bundle.browser.online).toBe(true)
  })

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])('keeps invalid/unknown receipt %s unknown', time => {
    fixtures.health = { data: health, dataUpdatedAt: time }
    const { result } = renderHook(() => useSupportBundle())
    expect(result.current.sources.health.updatedAt).toBeNull()
    expect(result.current.sources.health.ageMs).toBeNull()
    expect(result.current.bundle.health.overall).toBe('degraded')
  })

  it('downloads the exact partial redacted JSON locally and revokes the object URL', () => {
    vi.useFakeTimers()
    const create = vi.fn((_blob: Blob | MediaSource) => 'blob:phase6-fixture')
    const revoke = vi.fn()
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create
      static revokeObjectURL = revoke
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { result } = renderHook(() => useSupportBundle())
    result.current.download()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledTimes(1)
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe(result.current.filename)
    expect(anchor.rel).toBe('noopener')
    expect(anchor.isConnected).toBe(false)
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:phase6-fixture')
    expect(fixtures.request).not.toHaveBeenCalled()
  })
})
