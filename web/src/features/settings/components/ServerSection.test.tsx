import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ServerSection } from './ServerSection'

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.localStorage.setItem('teslasync-server-base-url', 'https://saved.example.com')
  window.localStorage.setItem('teslasync-server-token-required', '1')
  window.localStorage.setItem('teslasync-native-connection', '1')
  window.sessionStorage.setItem('teslasync-access-token', 'ts_test_only')
  Object.defineProperty(window, 'location', {
    value: { href: 'http://localhost/settings' },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function nativeStorage(clear: () => Promise<void>) {
  vi.stubGlobal('Capacitor', {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { ServerConnection: { clear, load: vi.fn(), save: vi.fn() } },
  })
}

describe('Android server disconnect', () => {
  it('waits for native credential deletion before navigating away', async () => {
    let finishClear: () => void = () => { throw new Error('Deletion not started') }
    const clear = vi.fn(() => new Promise<void>((resolve) => { finishClear = resolve }))
    nativeStorage(clear)
    render(<ServerSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(clear).toHaveBeenCalledOnce())
    expect(window.location.href).toBe('http://localhost/settings')
    expect(screen.getByRole('button', { name: 'Change server' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeDisabled()

    finishClear()

    await waitFor(() => expect(window.location.href).toBe('/'))
    expect(window.localStorage.getItem('teslasync-server-base-url')).toBeNull()
    expect(window.sessionStorage.getItem('teslasync-access-token')).toBeNull()
  })

  it('keeps deletion errors recoverable without restoring the rejected saved credentials', async () => {
    nativeStorage(vi.fn().mockRejectedValue(new Error('Keystore unavailable')))
    render(<ServerSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not forget this server.')
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled()
    expect(window.location.href).toBe('http://localhost/settings')
    expect(window.localStorage.getItem('teslasync-native-connection')).toBeNull()
  })
})
