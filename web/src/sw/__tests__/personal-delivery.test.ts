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

  it('claims a commute token and opens only its occurrence-specific destination', async () => {
    const destination = `/settings/smart-commute?vehicle_id=7&traffic_occurrence_id=${'b'.repeat(32)}`
    fetchMock.mockResolvedValueOnce({
      ok: true, json: async () => ({ data: { title: 'Smart Commute', body: 'Open TeslaSync', url: destination } }),
    })
    await push({ kind: 'commute', token })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/smart-delivery/deliveries/claim', {
      method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, kind: 'commute' }),
    })
    expect(showNotification).toHaveBeenCalledExactlyOnceWith('Smart Commute', {
      body: 'Open TeslaSync', badge: '/icons/badge-72.png', data: { url: destination },
    })
    await click('/settings/smart-commute?vehicle_id=7')
    await click(destination)
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(destination)
  })

  it('opens only approved same-origin notification destinations', async () => {
    await click('/settings/smart-charging?vehicle_id=7')
    await click('https://other.example/action-center')
    await click('/settings')
    expect(openWindow).toHaveBeenCalledExactlyOnceWith('/settings/smart-charging?vehicle_id=7')
  })

  it('requires the cabin estimate notification to keep its original vehicle and review anchor', async () => {
    const destination = '/preconditioning-effectiveness?vehicle_id=7&cabin_vehicle_id=7#cabin-prep-reminder'
    const mismatched = destination.replace('cabin_vehicle_id=7', 'cabin_vehicle_id=8')
    for (const url of [mismatched, destination]) {
      fetchMock.mockResolvedValueOnce({
        ok: true, json: async () => ({ data: { title: 'Cabin prep', body: 'Review the estimate', url } }),
      })
      await push({ kind: 'cabin-prep', token })
      await click(url)
    }
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/smart-delivery/deliveries/claim',
      expect.objectContaining({ body: JSON.stringify({ token, kind: 'cabin-prep' }) }))
    expect(showNotification).toHaveBeenCalledExactlyOnceWith('Cabin prep', {
      body: 'Review the estimate', badge: '/icons/badge-72.png', data: { url: destination },
    })
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(destination)
  })

  it('only displays and opens a same-vehicle Park Reserve notification with a plan revision', async () => {
    const destination = '/vampire-drain?vehicle_id=7&park_vehicle_id=7&park_plan_id=42#park-reserve'
    for (const url of [destination.replace('park_vehicle_id=7', 'park_vehicle_id=8'),
      destination.replace('&park_plan_id=42', ''), `https://other.example${destination}`, destination]) {
      fetchMock.mockResolvedValueOnce({
        ok: true, json: async () => ({ data: { title: 'Park reserve', body: 'Review the estimate', url } }),
      })
      await push({ kind: 'park-reserve', token })
      await click(url)
    }
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/smart-delivery/deliveries/claim',
      expect.objectContaining({ body: JSON.stringify({ token, kind: 'park-reserve' }) }))
    expect(showNotification).toHaveBeenCalledExactlyOnceWith('Park reserve', {
      body: 'Review the estimate', badge: '/icons/badge-72.png', data: { url: destination },
    })
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(destination)
  })

  it('only displays a window rain alert for the exact watch and vehicle, after a private claim', async () => {
    const destination = '/security-access?vehicle_id=7&rain_vehicle_id=7&rain_plan_id=42#window-rain'
    fetchMock.mockResolvedValueOnce({ ok: false })
    await push({ kind: 'window-rain', token })
    expect(showNotification).not.toHaveBeenCalled()
    for (const url of [destination.replace('rain_vehicle_id=7', 'rain_vehicle_id=8'),
      destination.replace('&rain_plan_id=42', ''), destination.replace('#window-rain', '#other'), destination]) {
      fetchMock.mockResolvedValueOnce({
        ok: true, json: async () => ({ data: { title: 'Check the window', body: 'Possible rain nearby', url } }),
      })
      await push({ kind: 'window-rain', token })
      await click(url)
    }
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/smart-delivery/deliveries/claim',
      expect.objectContaining({ body: JSON.stringify({ token, kind: 'window-rain' }) }))
    expect(showNotification).toHaveBeenCalledExactlyOnceWith('Check the window', {
      body: 'Possible rain nearby', badge: '/icons/badge-72.png', data: { url: destination },
    })
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(destination)
  })

  it.each(['closure', 'unlock'])('only displays and opens a scoped parked %s alert', async (family) => {
    const kind = `parked-${family}`
    const destination = `/security-access?vehicle_id=7&${family}_vehicle_id=7&${family}_plan_id=42&${family}_park_id=19#${kind}`
    for (const url of [destination.replace(`${family}_vehicle_id=7`, `${family}_vehicle_id=8`),
      destination.replace(`&${family}_park_id=19`, ''), destination.replace(`&${family}_plan_id=42`, ''),
      `https://other.example${destination}`, destination]) {
      fetchMock.mockResolvedValueOnce({
        ok: true, json: async () => ({ data: { title: 'Check the parked vehicle', body: 'Review TeslaSync', url } }),
      })
      await push({ kind, token })
      await click(url)
    }
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/smart-delivery/deliveries/claim',
      expect.objectContaining({ body: JSON.stringify({ token, kind }) }))
    expect(showNotification).toHaveBeenCalledExactlyOnceWith('Check the parked vehicle', {
      body: 'Review TeslaSync', badge: '/icons/badge-72.png', data: { url: destination },
    })
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(destination)
  })
})
