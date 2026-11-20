import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const token = 'a'.repeat(43)
const origin = 'https://teslasync.example.test'
const handlers = new Map<string, (event: never) => void>()
const showNotification = vi.fn()
const openWindow = vi.fn()
const fetchMock = vi.fn()

interface ExtendableEvent {
  waitUntil: (promise: Promise<unknown>) => void
}

async function push(payload: unknown, malformed = false) {
  let pending: Promise<unknown> | undefined
  const event = {
    data: { json: () => { if (malformed) throw new Error('bad JSON'); return payload } },
    waitUntil: (promise: Promise<unknown>) => { pending = promise },
  }
  handlers.get('push')?.(event as never)
  await pending
}

async function click(url: unknown) {
  let pending: Promise<unknown> | undefined
  const close = vi.fn()
  const event = {
    notification: { close, data: { url } },
    waitUntil: (promise: Promise<unknown>) => { pending = promise },
  } satisfies ExtendableEvent & { notification: unknown }
  handlers.get('notificationclick')?.(event as never)
  await pending
  expect(close).toHaveBeenCalledOnce()
}

beforeEach(() => {
  handlers.clear()
  showNotification.mockReset().mockResolvedValue(undefined)
  openWindow.mockReset().mockResolvedValue(undefined)
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { title: 'Generic title', body: 'Generic body', url: '/action-center?vehicle_id=7' } }),
  })
  const source = readFileSync(join(process.cwd(), 'public', 'personal-delivery', 'sw.js'), 'utf8')
  runInNewContext(source, {
    self: {
      location: { origin },
      registration: { showNotification },
      clients: { openWindow },
      addEventListener: (type: string, handler: (event: never) => void) => handlers.set(type, handler),
    },
    fetch: fetchMock,
    URL,
  })
})

describe('personal delivery worker', () => {
  it.each([
    [{ kind: 'verify', device_id: 7, token }, '/api/v1/smart-delivery/devices/7/verify'],
    [{ kind: 'charging', token }, '/api/v1/smart-delivery/deliveries/claim'],
  ])('claims %s using the same-origin authenticated session', async (payload, path) => {
    await push(payload)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(path, {
      method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    })
    expect(showNotification).toHaveBeenCalledExactlyOnceWith('Generic title', {
      body: 'Generic body', badge: '/icons/badge-72.png', data: { url: '/action-center?vehicle_id=7' },
    })
  })

  it.each([
    [null, false], [{ kind: 'charging', token: 'bad' }, false],
    [{ kind: 'verify', device_id: 0, token }, false],
    [{ kind: 'verify', device_id: 1.5, token }, false],
    [{ kind: 'unexpected', token }, false], [{ kind: 'charging', token }, true],
  ])('ignores malformed or unrecognized payloads without a network request', async (payload, malformed) => {
    await push(payload, malformed)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(showNotification).not.toHaveBeenCalled()
  })

  it.each([
    { title: 'Generic', body: 'Generic', url: 'https://other.example/action-center' },
    { title: 'Generic', body: 'Generic', url: '/settings' },
    { title: 'Generic', body: null, url: '/action-center' },
  ])('does not display an invalid or unauthorized notification response', async (data) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data }) })
    await push({ kind: 'charging', token })
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('shows nothing if the authenticated claim fails or redirects', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false })
    await push({ kind: 'charging', token })
    fetchMock.mockRejectedValueOnce(new Error('redirect or expired session'))
    await push({ kind: 'verify', device_id: 7, token })
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('opens only approved same-origin notification destinations', async () => {
    await click('/settings/smart-charging?vehicle_id=7')
    await click('https://other.example/action-center')
    await click('/settings')
    expect(openWindow).toHaveBeenCalledExactlyOnceWith('/settings/smart-charging?vehicle_id=7')
  })
})
