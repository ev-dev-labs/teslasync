import { afterEach, describe, it, expect, vi } from 'vitest'
import { ApiError, getApiBase, resilientFetch } from './resilience'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ApiError', () => {
  it('creates error with status', () => {
    const err = new ApiError('test error', 404)
    expect(err.status).toBe(404)
    expect(err.message).toBe('test error')
    expect(err.name).toBe('ApiError')
  })

  describe('getApiBase', () => {
    it('reads the CSP-safe Nginx meta configuration before the legacy window value', () => {
      const meta = document.createElement('meta')
      meta.name = 'teslasync-api-base'
      meta.content = 'https://api.example.test///'
      document.head.appendChild(meta)
      const previous = window.__TESLASYNC_API_BASE__
      window.__TESLASYNC_API_BASE__ = 'https://legacy.example.test'

      expect(getApiBase()).toBe('https://api.example.test')

      meta.remove()
      window.__TESLASYNC_API_BASE__ = previous
    })
  })

  describe('resilientFetch accepted statuses', () => {
    it('parses an explicitly accepted 503 health snapshot as data', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'degraded',
            database_pool: { acquired_conns: 2 },
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )

      const result = await resilientFetch<Record<string, unknown>>(
        '/system/health',
        {
          retries: 0,
          acceptedStatuses: [503],
        },
      )

      expect(result.status).toBe('degraded')
      expect(result.databasePool).toEqual({
        acquired_conns: 2,
        acquiredConns: 2,
      })
    })
  })

  it('stores various status codes', () => {
    expect(new ApiError('', 500).status).toBe(500)
    expect(new ApiError('', 502).status).toBe(502)
    expect(new ApiError('', 400).status).toBe(400)
    expect(new ApiError('', 408).status).toBe(408)
  })

  it('extends Error', () => {
    const err = new ApiError('msg', 500)
    expect(err).toBeInstanceOf(Error)
  })
})
