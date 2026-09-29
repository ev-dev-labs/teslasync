import { createElement } from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeDeepLinks, nativeLinkToRoute } from './NativeDeepLinks'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/', search: '' }),
  useNavigate: () => navigate,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  navigate.mockReset()
})

describe('nativeLinkToRoute', () => {
  it.each([
    ['teslasync://', '/'],
    ['teslasync://glance', '/glance'],
    ['teslasync://vehicles', '/vehicles'],
    ['teslasync://notifications/inbox', '/notifications/inbox'],
    ['web+teslasync://vehicles', '/vehicles'],
    ['  teslasync://battery  ', '/battery'],
  ])('maps %q', (input, want) => {
    expect(nativeLinkToRoute(input)).toBe(want)
  })

  describe('NativeDeepLinks Capacitor listener', () => {
    it('accepts the synchronous handle returned by the native bridge and removes it on unmount', async () => {
      const remove = vi.fn()
      const addListener = vi.fn((_event: string, _cb: (data: { url: string }) => void) => ({ remove }))
      vi.stubGlobal('Capacitor', { Plugins: { App: { addListener } } })

      const { unmount } = render(createElement(NativeDeepLinks))
      await waitFor(() => expect(addListener).toHaveBeenCalledWith('appUrlOpen', expect.any(Function)))
      addListener.mock.calls[0][1]({ url: 'teslasync://vehicles' })
      expect(navigate).toHaveBeenCalledWith('/vehicles')

      unmount()
      await waitFor(() => expect(remove).toHaveBeenCalledOnce())
    })

    it('removes an asynchronous handle if the component unmounts before registration finishes', async () => {
      const remove = vi.fn()
      let resolveRegistration!: (handle: { remove: () => void }) => void
      const pending = new Promise<{ remove: () => void }>((resolve) => {
        resolveRegistration = resolve
      })
      const addListener = vi.fn(() => pending)
      vi.stubGlobal('Capacitor', { Plugins: { App: { addListener } } })

      const { unmount } = render(createElement(NativeDeepLinks))
      await waitFor(() => expect(addListener).toHaveBeenCalledOnce())
      unmount()
      resolveRegistration({ remove })
      await waitFor(() => expect(remove).toHaveBeenCalledOnce())
    })

    it('reports registration failures without crashing the app', async () => {
      const error = new Error('listener unavailable')
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.stubGlobal('Capacitor', {
        Plugins: { App: { addListener: () => { throw error } } },
      })

      const { unmount } = render(createElement(NativeDeepLinks))
      await waitFor(() => expect(log).toHaveBeenCalledWith('Failed to register native deep-link listener', error))
      unmount()
    })
  })

  it.each([
    ['https://teslasync.example.com/vehicles', 'foreign scheme'],
    ['teslasync://vehicles/7', 'parameterised route'],
    ['teslasync://settings/admin', 'non-allowlisted page'],
    ['web+teslasync://vehicles/7', 'non-allowlisted protocol target'],
    ['not a url', 'unparseable'],
    ['', 'empty'],
    [null, 'non-string'],
  ])('rejects %q (%s)', (input) => {
    expect(nativeLinkToRoute(input)).toBeNull()
  })

  it('drops query strings and fragments', () => {
    expect(nativeLinkToRoute('teslasync://drives?x=1#top')).toBe('/drives')
  })
})
