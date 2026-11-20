import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPersonalBrowser,
  getPersonalSubscription,
  personalPushSupported,
  refreshPersonalDeliveryWorker,
  subscribePersonalBrowser,
} from './personalPush'

const api = vi.hoisted(() => ({ url: vi.fn() }))
vi.mock('@/api/client', () => ({ apiUrl: api.url }))

const permission = {
  permission: 'granted',
  requestPermission: vi.fn(),
}
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')

function installServiceWorkers(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value })
}

function registration(path: string, existing: unknown = null) {
  return {
    scope: new URL(path, window.location.origin).href,
    active: { state: 'activated' },
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(existing),
      subscribe: vi.fn(),
    },
    unregister: vi.fn().mockResolvedValue(true),
  }
}

beforeEach(() => {
  api.url.mockReset().mockReturnValue('/api/v1/smart-delivery/devices')
  permission.permission = 'granted'
  permission.requestPermission.mockReset().mockResolvedValue('granted')
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('Notification', permission)
  vi.stubGlobal('PushManager', class {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalServiceWorker) Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker)
  else delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

describe('personal browser push', () => {
  it('does not access subscriptions on insecure or cross-origin connections', async () => {
    const getRegistration = vi.fn()
    installServiceWorkers({ getRegistration })
    api.url.mockReturnValue('https://other.example/api/v1/smart-delivery/devices')
    expect(personalPushSupported()).toBe(false)
    expect(await getPersonalSubscription()).toBeNull()
    await clearPersonalBrowser()
    expect(getRegistration).not.toHaveBeenCalled()

    api.url.mockReturnValue('/api/v1/smart-delivery/devices')
    vi.stubGlobal('isSecureContext', false)
    expect(personalPushSupported()).toBe(false)
    await expect(subscribePersonalBrowser('AQ')).rejects.toThrow('unavailable')
    expect(getRegistration).not.toHaveBeenCalled()
  })

  it('never reads or removes the existing root PWA subscription', async () => {
    const rootSubscription = { unsubscribe: vi.fn() }
    const root = registration('/', rootSubscription)
    const getRegistration = vi.fn().mockResolvedValue(root)
    installServiceWorkers({ getRegistration })

    expect(await getPersonalSubscription()).toBeNull()
    await clearPersonalBrowser()
    expect(getRegistration).toHaveBeenCalledWith('/personal-delivery/')
    expect(root.pushManager.getSubscription).not.toHaveBeenCalled()
    expect(rootSubscription.unsubscribe).not.toHaveBeenCalled()
    expect(root.unregister).not.toHaveBeenCalled()
  })

  it('requests permission only on explicit enrollment and registers the narrow worker', async () => {
    permission.permission = 'default'
    const subscription = { endpoint: 'https://push.example.test/device' }
    const personal = registration('/personal-delivery/')
    personal.pushManager.subscribe.mockResolvedValue(subscription)
    const register = vi.fn().mockResolvedValue(personal)
    installServiceWorkers({ getRegistration: vi.fn().mockResolvedValue(undefined), register })

    expect(await getPersonalSubscription()).toBeNull()
    expect(permission.requestPermission).not.toHaveBeenCalled()
    expect(await subscribePersonalBrowser('AQID')).toBe(subscription)
    expect(permission.requestPermission).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith('/personal-delivery/sw.js', { scope: '/personal-delivery/' })
    expect(personal.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]),
    })
  })

  it('does not register a worker when permission is denied', async () => {
    permission.permission = 'default'
    permission.requestPermission.mockResolvedValue('denied')
    const register = vi.fn()
    installServiceWorkers({ getRegistration: vi.fn(), register })
    await expect(subscribePersonalBrowser('AQ')).rejects.toThrow('permission')
    expect(register).not.toHaveBeenCalled()
  })

  it('waits for the updated worker rather than the previous active worker', async () => {
    const personal = registration('/personal-delivery/')
    const installing = Object.assign(new EventTarget(), { state: 'installing' })
    const listening = vi.spyOn(installing, 'addEventListener')
    const update = vi.fn().mockResolvedValue({ ...personal, installing })
    installServiceWorkers({ getRegistration: vi.fn().mockResolvedValue({ ...personal, update }) })
    const ready = vi.fn()
    const result = refreshPersonalDeliveryWorker().then(ready)
    await vi.waitFor(() => expect(listening).toHaveBeenCalledWith('statechange', expect.any(Function)))
    expect(ready).not.toHaveBeenCalled()
    installing.state = 'activated'
    installing.dispatchEvent(new Event('statechange'))
    await result
    expect(update).toHaveBeenCalledOnce()
    expect(ready).toHaveBeenCalledOnce()
  })

  it('unsubscribes and unregisters only the dedicated worker, reporting failures', async () => {
    const subscription = { unsubscribe: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) }
    const personal = registration('/personal-delivery/', subscription)
    installServiceWorkers({ getRegistration: vi.fn().mockResolvedValue(personal) })

    expect(await getPersonalSubscription()).toBe(subscription)
    await expect(clearPersonalBrowser()).rejects.toThrow('unsubscribe failed')
    expect(personal.unregister).not.toHaveBeenCalled()
    await clearPersonalBrowser()
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(2)
    expect(personal.unregister).toHaveBeenCalledOnce()
  })
})
