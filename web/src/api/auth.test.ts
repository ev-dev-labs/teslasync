// Auth API-module coverage.
//
// Exercises EVERY export of api/auth.ts through its public surface:
//   - getAuthStatus  — GET /auth/status, response passthrough, error surfacing.
//   - getAuthURL     — GET /auth/login, returns the Tesla OAuth URL + CSRF
//                      state, error surfacing.
//   - disconnectAuth — POST /auth/disconnect, status-envelope passthrough, and
//                      the sudo/cancel rejection propagating to the caller.
//
// These are thin wrappers over the resilient `request()` client, so the point
// of the suite is to LOCK the request contract every hook and page is built on:
// exact path, exact HTTP method, no `/api/v1` double-prefix (prohibited pattern
// #7), no camelCase query params (#8), and faithful pass-through of both the
// resolved value and any thrown `ApiError` (no swallowing).
//
// Network is stubbed at the `request()` boundary — the repo convention (see
// useVehicles.test.tsx / useAlerts.test.tsx). Nothing hits the real network.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Hoisted so the (also-hoisted) mock factory closes over the SAME spy the
// assertions read.
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('./client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

import { ApiError } from '@/lib/resilience'
import type { AuthStatus } from './types'
import { getAuthStatus, getAuthURL, disconnectAuth } from './auth'

beforeEach(() => {
  requestMock.mockReset()
})

describe('getAuthStatus', () => {
  it('requests GET /auth/status with no options and passes the response through', async () => {
    const status: AuthStatus = {
      authenticated: true,
      expires_at: '2026-01-01T00:00:00Z',
      expired: false,
    }
    requestMock.mockResolvedValue(status)

    await expect(getAuthStatus()).resolves.toEqual(status)

    expect(requestMock).toHaveBeenCalledTimes(1)
    // Single argument → no method override → implicit GET. Path carries no
    // `/api/v1` prefix (the client adds it exactly once).
    expect(requestMock).toHaveBeenCalledWith('/auth/status')
    expect(requestMock.mock.calls[0][1]).toBeUndefined()
  })

  it('surfaces an ApiError from the client unchanged (no swallowing)', async () => {
    const err = new ApiError('service unavailable', 503)
    requestMock.mockRejectedValue(err)

    await expect(getAuthStatus()).rejects.toBe(err)
  })
})

describe('getAuthURL', () => {
  it('requests GET /auth/login and returns the Tesla OAuth URL + CSRF state', async () => {
    const payload = {
      auth_url: 'https://auth.tesla.com/oauth2/v3/authorize?client_id=teslasync',
      state: 'csrf-abc-123',
    }
    requestMock.mockResolvedValue(payload)

    const res = await getAuthURL()

    expect(res.auth_url).toBe(payload.auth_url)
    expect(res.state).toBe('csrf-abc-123')
    expect(requestMock).toHaveBeenCalledWith('/auth/login')
    // A GET must not carry a body/method override.
    expect(requestMock.mock.calls[0][1]).toBeUndefined()
  })

  it('propagates a rejection from the client', async () => {
    requestMock.mockRejectedValue(new ApiError('rate limited', 429))

    await expect(getAuthURL()).rejects.toThrow('rate limited')
  })
})

describe('disconnectAuth', () => {
  it('issues a POST to /auth/disconnect and returns the status envelope', async () => {
    requestMock.mockResolvedValue({ status: 'disconnected' })

    await expect(disconnectAuth()).resolves.toEqual({ status: 'disconnected' })

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith('/auth/disconnect', { method: 'POST' })
    // Method must be exactly POST — the backend route is POST-only and
    // sudo-gated; a stray GET would 405.
    expect(requestMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })

  it('propagates the SUDO_REQUIRED rejection to the caller (dialog/cancel path)', async () => {
    const err = new ApiError('reauth required', 401, 'SUDO_REQUIRED')
    requestMock.mockRejectedValue(err)

    await expect(disconnectAuth()).rejects.toBe(err)
    await expect(disconnectAuth().catch((e: ApiError) => e.code)).resolves.toBe('SUDO_REQUIRED')
  })
})

describe('auth request contract (regression guards)', () => {
  it('targets /auth/* with no /api/v1 prefix and no camelCase query params', async () => {
    requestMock.mockResolvedValue({})

    await getAuthStatus()
    await getAuthURL()
    await disconnectAuth()

    const paths = requestMock.mock.calls.map((call) => call[0] as string)
    expect(paths).toEqual(['/auth/status', '/auth/login', '/auth/disconnect'])

    for (const path of paths) {
      expect(path.startsWith('/auth/')).toBe(true)
      // Prohibited pattern #7: the client auto-adds /api/v1 — hooks/modules must not.
      expect(path).not.toContain('/api/v1')
      // Prohibited pattern #8: query params are snake_case; there should be no
      // uppercase (camelCase) characters anywhere in these fixed paths.
      expect(path).not.toMatch(/[A-Z]/)
    }
  })
})
