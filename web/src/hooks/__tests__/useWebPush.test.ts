import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Contract for `useWebPush` — the browser Notification + Web Push (VAPID)
 * lifecycle hook. The three server-side TanStack Query hooks it composes
 * (`usePushPublicKey` / `useSubscribePush` / `useUnsubscribePush`) are
 * mocked directly, mirroring the repo convention in `useAiEnabled.test.tsx`,
 * so no QueryClient/transport plumbing is needed.
 *
 * `useWebPush` derives `isSupported` / `isPushAPISupported` from
 * module-scope global feature detection evaluated at import time. To exercise
 * both the supported and unsupported worlds we install the fake globals FIRST
 * and then `vi.resetModules()` + dynamic-import the hook (and a fresh copy of
 * @testing-library/react from the same registry, so the renderer and the hook
 * share one React instance).
 */

type GlobalWithPush = typeof globalThis & {
  Notification?: unknown
  PushManager?: unknown
}

type NotificationCtorMock = ReturnType<typeof vi.fn> & {
  permission: NotificationPermission
  requestPermission: ReturnType<typeof vi.fn>
}

type NotifInstance = { onclick: () => void; close: ReturnType<typeof vi.fn> }
type MockNotificationInstance = { onclick: (() => void) | null; close: ReturnType<typeof vi.fn> }

type Keys = { p256dh?: string; auth?: string }

interface SubMock {
  endpoint: string
  unsubscribe: ReturnType<typeof vi.fn>
  toJSON: ReturnType<typeof vi.fn>
}

interface RegMock {
  pushManager: {
    getSubscription: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
  }
}

// ── Stable, hoisted mocks for the composed server hooks ────────────────────
const mocks = vi.hoisted(() => ({
  subscribeMutateAsync: vi.fn(),
  unsubscribeMutateAsync: vi.fn(),
  state: { publicKey: null as string | null },
}))

vi.mock('@/api/hooks/usePush', () => ({
  usePushPublicKey: () => ({ data: mocks.state.publicKey }),
  useSubscribePush: () => ({ mutateAsync: mocks.subscribeMutateAsync }),
  useUnsubscribePush: () => ({ mutateAsync: mocks.unsubscribeMutateAsync }),
}))

// ── Fake PushSubscription / ServiceWorkerRegistration builders ─────────────
function makeSub(
  endpoint = 'https://push.example/ep',
  keys: Keys | undefined = { p256dh: 'p256-key', auth: 'auth-token' },
  opts: { unsubscribeRejects?: boolean } = {},
): SubMock {
  return {
    endpoint,
    unsubscribe: opts.unsubscribeRejects
      ? vi.fn().mockRejectedValue(new Error('browser unsubscribe failed'))
      : vi.fn().mockResolvedValue(true),
    toJSON: vi.fn(() => ({ endpoint, keys })),
  }
}

function makeReg(
  opts: { existing?: SubMock | null; created?: SubMock; subscribeRejects?: boolean } = {},
): RegMock {
  return {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(opts.existing ?? null),
      subscribe: opts.subscribeRejects
        ? vi.fn().mockRejectedValue(new Error('NotAllowedError'))
        : vi.fn().mockResolvedValue(opts.created ?? makeSub('https://push.example/created')),
    },
  }
}

// ── Environment install / teardown ─────────────────────────────────────────
interface EnvOpts {
  notificationSupported?: boolean
  permission?: NotificationPermission
  requestResult?: NotificationPermission
  pushSupported?: boolean
  getRegistration?: ReturnType<typeof vi.fn>
}

interface EnvHandles {
  NotificationMock?: NotificationCtorMock
  getRegistration?: ReturnType<typeof vi.fn>
}

function clearEnv() {
  const g = globalThis as GlobalWithPush
  delete g.Notification
  delete g.PushManager
  const d = Object.getOwnPropertyDescriptor(globalThis.navigator, 'serviceWorker')
  if (d?.configurable) {
    delete (globalThis.navigator as { serviceWorker?: unknown }).serviceWorker
  }
}

function installEnv(opts: EnvOpts = {}): EnvHandles {
  const {
    notificationSupported = true,
    permission = 'default',
    requestResult = 'granted',
    pushSupported = true,
    getRegistration,
  } = opts

  const handles: EnvHandles = {}
  const g = globalThis as GlobalWithPush

  if (notificationSupported) {
    const NotificationMock = vi.fn(function (this: MockNotificationInstance) {
      this.onclick = null
      this.close = vi.fn()
    }) as unknown as NotificationCtorMock
    NotificationMock.permission = permission
    NotificationMock.requestPermission = vi.fn().mockResolvedValue(requestResult)
    g.Notification = NotificationMock
    handles.NotificationMock = NotificationMock
  }

  if (pushSupported) {
    g.PushManager = class {}
    const getReg = getRegistration ?? vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: getReg },
    })
    handles.getRegistration = getReg
  }

  return handles
}

async function loadHook(env: EnvOpts = {}) {
  vi.resetModules()
  clearEnv()
  const handles = installEnv(env)
  const rtl = await import('@testing-library/react')
  const mod = await import('../useWebPush')
  return {
    renderHook: rtl.renderHook,
    act: rtl.act,
    waitFor: rtl.waitFor,
    NotificationMock: handles.NotificationMock,
    getRegistration: handles.getRegistration,
    useWebPush: mod.useWebPush,
  }
}

type Flusher = Awaited<ReturnType<typeof loadHook>>['act']
async function flush(act: Flusher) {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  mocks.subscribeMutateAsync.mockReset().mockResolvedValue({})
  mocks.unsubscribeMutateAsync.mockReset().mockResolvedValue(undefined)
  mocks.state.publicKey = null
})

afterEach(() => {
  clearEnv()
  vi.restoreAllMocks()
})

describe('useWebPush — feature detection & permission', () => {
  it('reports unsupported and no-ops when the Notification API is absent', async () => {
    const { renderHook, act, useWebPush } = await loadHook({
      notificationSupported: false,
      pushSupported: false,
    })
    const { result } = renderHook(() => useWebPush())

    expect(result.current.isSupported).toBe(false)
    expect(result.current.permission).toBe('denied')
    expect(result.current.isPushSupported).toBe(false)
    expect(result.current.sendNotification('Hi')).toBeNull()

    let perm: NotificationPermission = 'granted'
    await act(async () => {
      perm = await result.current.requestPermission()
    })
    expect(perm).toBe('denied')
  })

  it('mirrors the browser Notification.permission on mount when supported', async () => {
    const { renderHook, useWebPush } = await loadHook({
      notificationSupported: true,
      permission: 'granted',
      pushSupported: false,
    })
    const { result } = renderHook(() => useWebPush())

    expect(result.current.isSupported).toBe(true)
    expect(result.current.permission).toBe('granted')
  })

  it('requestPermission delegates to Notification.requestPermission and updates state', async () => {
    const { renderHook, act, useWebPush, NotificationMock } = await loadHook({
      notificationSupported: true,
      permission: 'default',
      requestResult: 'granted',
      pushSupported: false,
    })
    const { result } = renderHook(() => useWebPush())
    expect(result.current.permission).toBe('default')

    let perm: NotificationPermission = 'denied'
    await act(async () => {
      perm = await result.current.requestPermission()
    })

    expect(perm).toBe('granted')
    expect(NotificationMock?.requestPermission).toHaveBeenCalledTimes(1)
    expect(result.current.permission).toBe('granted')
  })
})

describe('useWebPush — sendNotification (in-app toast path)', () => {
  it('renders a Notification with default icon/badge and wires focus + close on click', async () => {
    const { renderHook, useWebPush, NotificationMock } = await loadHook({
      notificationSupported: true,
      permission: 'granted',
      pushSupported: false,
    })
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {})
    const onClick = vi.fn()
    const { result } = renderHook(() => useWebPush())

    const n = result.current.sendNotification('Charge complete', { body: '80%' }, onClick)

    expect(NotificationMock).toHaveBeenCalledWith('Charge complete', {
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      body: '80%',
    })
    expect(n).not.toBeNull()

    const inst = n as unknown as NotifInstance
    inst.onclick()
    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(inst.close).toHaveBeenCalledTimes(1)
  })

  it('is a no-op returning null when permission is not granted', async () => {
    const { renderHook, useWebPush, NotificationMock } = await loadHook({
      notificationSupported: true,
      permission: 'default',
      pushSupported: false,
    })
    const { result } = renderHook(() => useWebPush())

    expect(result.current.sendNotification('Nope')).toBeNull()
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('swallows a throwing onClick handler and still closes the toast', async () => {
    const { renderHook, useWebPush } = await loadHook({
      notificationSupported: true,
      permission: 'granted',
      pushSupported: false,
    })
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    const onClick = vi.fn(() => {
      throw new Error('navigation blew up')
    })
    const { result } = renderHook(() => useWebPush())

    const inst = result.current.sendNotification('Boom', undefined, onClick) as unknown as NotifInstance
    expect(() => inst.onclick()).not.toThrow()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(inst.close).toHaveBeenCalledTimes(1)
  })
})

describe('useWebPush — mount reflection of existing subscription', () => {
  it('reflects an existing browser subscription into state on mount', async () => {
    const existing = makeSub('https://push.example/existing')
    const getRegistration = vi.fn().mockResolvedValue(makeReg({ existing }))
    const { renderHook, waitFor, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    const { result } = renderHook(() => useWebPush())

    await waitFor(() => expect(result.current.isSubscribed).toBe(true))
    expect(result.current.currentEndpoint).toBe('https://push.example/existing')
  })

  it('leaves state unsubscribed when there is no service-worker registration', async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined)
    const { renderHook, act, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    expect(result.current.isSubscribed).toBe(false)
    expect(result.current.currentEndpoint).toBeNull()
    expect(getRegistration).toHaveBeenCalledTimes(1)
  })

  it('swallows a rejected getRegistration on mount without crashing', async () => {
    const getRegistration = vi.fn().mockRejectedValue(new Error('SW registration boom'))
    const { renderHook, act, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    expect(result.current.isSubscribed).toBe(false)
    expect(result.current.currentEndpoint).toBeNull()
    expect(getRegistration).toHaveBeenCalledTimes(1)
  })
})

describe('useWebPush — subscribe()', () => {
  it('subscribes via PushManager and POSTs the subscription to the server', async () => {
    const created = makeSub('https://push.example/new-device', { p256dh: 'PK', auth: 'AK' })
    const reg = makeReg({ existing: null, created })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    mocks.state.publicKey = 'AQIDBA' // base64url → bytes [1,2,3,4]
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    let ok = false
    await act(async () => {
      ok = await result.current.subscribe()
    })

    expect(ok).toBe(true)
    expect(reg.pushManager.subscribe).toHaveBeenCalledTimes(1)
    const arg = reg.pushManager.subscribe.mock.calls[0][0]
    expect(arg.userVisibleOnly).toBe(true)
    expect(Array.from(arg.applicationServerKey as Uint8Array)).toEqual([1, 2, 3, 4])
    expect(mocks.subscribeMutateAsync).toHaveBeenCalledWith({
      endpoint: 'https://push.example/new-device',
      keys: { p256dh: 'PK', auth: 'AK' },
    })
    expect(result.current.isSubscribed).toBe(true)
    expect(result.current.currentEndpoint).toBe('https://push.example/new-device')
  })

  it('returns false when Push is unsupported', async () => {
    const { renderHook, act, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: false,
    })
    mocks.state.publicKey = 'AQIDBA'
    const { result } = renderHook(() => useWebPush())

    expect(result.current.isPushSupported).toBe(false)
    let ok = true
    await act(async () => {
      ok = await result.current.subscribe()
    })
    expect(ok).toBe(false)
    expect(mocks.subscribeMutateAsync).not.toHaveBeenCalled()
  })

  it('returns false when the VAPID public key is unavailable', async () => {
    const reg = makeReg()
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    mocks.state.publicKey = null
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    expect(result.current.isPushSupported).toBe(false)
    let ok = true
    await act(async () => {
      ok = await result.current.subscribe()
    })
    expect(ok).toBe(false)
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('requests permission when not granted and aborts on denial', async () => {
    const reg = makeReg()
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, useWebPush, NotificationMock } = await loadHook({
      permission: 'default',
      requestResult: 'denied',
      pushSupported: true,
      getRegistration,
    })
    mocks.state.publicKey = 'AQIDBA'
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    let ok = true
    await act(async () => {
      ok = await result.current.subscribe()
    })

    expect(ok).toBe(false)
    expect(NotificationMock?.requestPermission).toHaveBeenCalledTimes(1)
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
    expect(mocks.subscribeMutateAsync).not.toHaveBeenCalled()
  })

  it('reuses an existing browser subscription instead of re-subscribing', async () => {
    const existing = makeSub('https://push.example/reused', { p256dh: 'RP', auth: 'RA' })
    const reg = makeReg({ existing })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, waitFor, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    mocks.state.publicKey = 'AQIDBA'
    const { result } = renderHook(() => useWebPush())
    await waitFor(() => expect(result.current.isSubscribed).toBe(true))

    let ok = false
    await act(async () => {
      ok = await result.current.subscribe()
    })

    expect(ok).toBe(true)
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
    expect(mocks.subscribeMutateAsync).toHaveBeenCalledWith({
      endpoint: 'https://push.example/reused',
      keys: { p256dh: 'RP', auth: 'RA' },
    })
  })

  it('returns false when the subscription JSON is missing keys', async () => {
    const created = makeSub('https://push.example/incomplete', { p256dh: 'only-p' }) // no auth
    const reg = makeReg({ existing: null, created })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    mocks.state.publicKey = 'AQIDBA'
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    let ok = true
    await act(async () => {
      ok = await result.current.subscribe()
    })

    expect(ok).toBe(false)
    expect(mocks.subscribeMutateAsync).not.toHaveBeenCalled()
    expect(result.current.isSubscribed).toBe(false)
  })

  it('returns false and does not mark subscribed when the server POST fails', async () => {
    const created = makeSub('https://push.example/server-fail')
    const reg = makeReg({ existing: null, created })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    mocks.state.publicKey = 'AQIDBA'
    mocks.subscribeMutateAsync.mockRejectedValue(new Error('500'))
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    let ok = true
    await act(async () => {
      ok = await result.current.subscribe()
    })

    expect(ok).toBe(false)
    expect(mocks.subscribeMutateAsync).toHaveBeenCalledTimes(1)
    expect(result.current.isSubscribed).toBe(false)
  })

  it('returns false (never throws) when PushManager.subscribe rejects', async () => {
    const reg = makeReg({ existing: null, subscribeRejects: true })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    mocks.state.publicKey = 'AQIDBA'
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    let ok: boolean | undefined
    let threw = false
    await act(async () => {
      try {
        ok = await result.current.subscribe()
      } catch {
        threw = true
      }
    })

    expect(threw).toBe(false)
    expect(ok).toBe(false)
    expect(mocks.subscribeMutateAsync).not.toHaveBeenCalled()
    expect(result.current.isSubscribed).toBe(false)
  })
})

describe('useWebPush — unsubscribe()', () => {
  it('removes on the server, unsubscribes the browser, and clears state', async () => {
    const existing = makeSub('https://push.example/to-remove')
    const reg = makeReg({ existing })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, waitFor, useWebPush } = await loadHook({
      permission: 'granted',
      pushSupported: true,
      getRegistration,
    })
    const { result } = renderHook(() => useWebPush())
    await waitFor(() => expect(result.current.isSubscribed).toBe(true))

    let ok = false
    await act(async () => {
      ok = await result.current.unsubscribe()
    })

    expect(ok).toBe(true)
    expect(mocks.unsubscribeMutateAsync).toHaveBeenCalledWith('https://push.example/to-remove')
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
    expect(result.current.isSubscribed).toBe(false)
    expect(result.current.currentEndpoint).toBeNull()
  })

  it('returns false when Push is unsupported', async () => {
    const { renderHook, act, useWebPush } = await loadHook({ pushSupported: false })
    const { result } = renderHook(() => useWebPush())

    let ok = true
    await act(async () => {
      ok = await result.current.unsubscribe()
    })
    expect(ok).toBe(false)
    expect(mocks.unsubscribeMutateAsync).not.toHaveBeenCalled()
  })

  it('clears state and returns true when no browser subscription exists', async () => {
    const reg = makeReg({ existing: null })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, useWebPush } = await loadHook({
      pushSupported: true,
      getRegistration,
    })
    const { result } = renderHook(() => useWebPush())
    await flush(act)

    let ok = false
    await act(async () => {
      ok = await result.current.unsubscribe()
    })

    expect(ok).toBe(true)
    expect(mocks.unsubscribeMutateAsync).not.toHaveBeenCalled()
    expect(result.current.isSubscribed).toBe(false)
  })

  it('still tears down the browser subscription when the server call fails', async () => {
    const existing = makeSub('https://push.example/server-500')
    const reg = makeReg({ existing })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    mocks.unsubscribeMutateAsync.mockRejectedValue(new Error('500'))
    const { renderHook, act, waitFor, useWebPush } = await loadHook({
      pushSupported: true,
      getRegistration,
    })
    const { result } = renderHook(() => useWebPush())
    await waitFor(() => expect(result.current.isSubscribed).toBe(true))

    let ok = false
    await act(async () => {
      ok = await result.current.unsubscribe()
    })

    expect(ok).toBe(true)
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
    expect(result.current.isSubscribed).toBe(false)
  })

  it('clears state and returns true even when the browser unsubscribe rejects', async () => {
    const existing = makeSub(
      'https://push.example/browser-fail',
      { p256dh: 'p', auth: 'a' },
      { unsubscribeRejects: true },
    )
    const reg = makeReg({ existing })
    const getRegistration = vi.fn().mockResolvedValue(reg)
    const { renderHook, act, waitFor, useWebPush } = await loadHook({
      pushSupported: true,
      getRegistration,
    })
    const { result } = renderHook(() => useWebPush())
    await waitFor(() => expect(result.current.isSubscribed).toBe(true))

    let ok: boolean | undefined
    let threw = false
    await act(async () => {
      try {
        ok = await result.current.unsubscribe()
      } catch {
        threw = true
      }
    })

    expect(threw).toBe(false)
    expect(ok).toBe(true)
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1)
    expect(result.current.isSubscribed).toBe(false)
    expect(result.current.currentEndpoint).toBeNull()
  })
})
