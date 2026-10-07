import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * Per-device notification rules panel (PWA-05).
 *
 * Covers the four controls the task requires — categories, severity floor,
 * per-vehicle scope, quiet hours — plus test delivery, including the honest
 * "your own rule suppressed this" path that a silent no-op would hide.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
      const str = typeof fallback === 'string' ? fallback : key
      if (vars == null) return str
      return Object.entries(vars).reduce<string>(
        (acc, [k, v]) => acc.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
        str,
      )
    },
  }),
}))

const webPush = vi.hoisted(() => ({
  permission: 'granted' as NotificationPermission,
  isSupported: true,
}))

vi.mock('@/hooks/useWebPush', () => ({
  useWebPush: () => ({
    permission: webPush.permission,
    isSupported: webPush.isSupported,
    requestPermission: vi.fn(),
    sendNotification: vi.fn(),
    isPushSupported: true,
    isSubscribed: true,
    currentEndpoint: null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}))

const vehicles = vi.hoisted(() => ({
  data: [
    { id: 1, display_name: 'Roadster' },
    { id: 2, display_name: 'Cybertruck' },
  ] as Array<{ id: number; display_name: string }>,
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: vehicles.data, isLoading: false, isError: false }),
}))

const showNotification = vi.fn(async () => {})

import { DeviceNotificationPrefsPanel } from './DeviceNotificationPrefsPanel'
import { resetDeviceNotificationPrefs } from '@/hooks/useDeviceNotificationPrefs'

beforeEach(() => {
  window.localStorage.clear()
  showNotification.mockClear()
  webPush.permission = 'granted'
  webPush.isSupported = true
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value: {
      getRegistration: vi.fn(async () => ({ active: { postMessage: vi.fn() }, showNotification })),
      controller: { postMessage: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  })
  resetDeviceNotificationPrefs()
})

afterEach(() => {
  cleanup()
  resetDeviceNotificationPrefs()
  window.localStorage.clear()
})

describe('DeviceNotificationPrefsPanel', () => {
  it('starts in an unfiltered state and says so', () => {
    render(<DeviceNotificationPrefsPanel />)
    expect(screen.getByText('Everything delivered')).toBeInTheDocument()
    expect(screen.queryByTestId('device-prefs-filtered')).not.toBeInTheDocument()
  })

  it('renders a toggle for every category', () => {
    render(<DeviceNotificationPrefsPanel />)
    for (const label of [
      'Alerts',
      'Charging',
      'Drives',
      'Battery',
      'Security',
      'System health',
      'Exports',
      'Other',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('mutes a category and flags the panel as filtered', () => {
    render(<DeviceNotificationPrefsPanel />)
    fireEvent.click(screen.getByText('Charging'))
    expect(screen.getByTestId('device-prefs-filtered')).toBeInTheDocument()
  })

  it('exposes a severity floor', () => {
    render(<DeviceNotificationPrefsPanel />)
    const select = screen.getByLabelText('Minimum severity') as HTMLSelectElement
    expect(select.value).toBe('info')

    fireEvent.change(select, { target: { value: 'critical' } })
    expect(screen.getByTestId('device-prefs-filtered')).toBeInTheDocument()
  })

  it('reveals the vehicle list only when the scope is narrowed', () => {
    render(<DeviceNotificationPrefsPanel />)
    expect(screen.queryByText('Roadster')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Vehicle scope'), {
      target: { value: 'selected' },
    })

    expect(screen.getByText('Roadster')).toBeInTheDocument()
    expect(screen.getByText('Cybertruck')).toBeInTheDocument()
  })

  it('shows an empty state when no vehicles exist to scope to', () => {
    vehicles.data = []
    render(<DeviceNotificationPrefsPanel />)
    fireEvent.change(screen.getByLabelText('Vehicle scope'), {
      target: { value: 'selected' },
    })
    expect(
      screen.getByText('No vehicles are available to scope to yet.'),
    ).toBeInTheDocument()
    vehicles.data = [
      { id: 1, display_name: 'Roadster' },
      { id: 2, display_name: 'Cybertruck' },
    ]
  })

  it('reveals the quiet-hours window inputs when enabled', () => {
    render(<DeviceNotificationPrefsPanel />)
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Silence notifications overnight'))

    expect(screen.getByLabelText('From')).toHaveValue('22:00')
    expect(screen.getByLabelText('Until')).toHaveValue('07:00')
  })

  it('delivers a test notification through the real service worker', async () => {
    render(<DeviceNotificationPrefsPanel />)
    fireEvent.click(screen.getByTestId('device-prefs-test'))

    await waitFor(() => {
      expect(screen.getByTestId('device-prefs-test-result')).toHaveTextContent(
        'Test notification delivered.',
      )
    })
    expect(showNotification).toHaveBeenCalledTimes(1)
  })

  it('names the exact rule when the device policy suppresses the test', async () => {
    render(<DeviceNotificationPrefsPanel />)
    fireEvent.change(screen.getByLabelText('Minimum severity'), {
      target: { value: 'critical' },
    })

    fireEvent.click(screen.getByTestId('device-prefs-test'))

    await waitFor(() => {
      expect(screen.getByTestId('device-prefs-test-result')).toHaveTextContent(
        'below-min-severity',
      )
    })
    // A silent no-op here would be indistinguishable from a broken push
    // subscription, which is why the reason is surfaced instead.
    expect(showNotification).not.toHaveBeenCalled()
  })

  it('reports a missing OS permission instead of failing silently', async () => {
    webPush.permission = 'denied'
    render(<DeviceNotificationPrefsPanel />)

    fireEvent.click(screen.getByTestId('device-prefs-test'))

    await waitFor(() => {
      expect(screen.getByTestId('device-prefs-test-result')).toHaveTextContent(
        /permission has not been granted/i,
      )
    })
  })

  it('resets every device rule', () => {
    render(<DeviceNotificationPrefsPanel />)
    fireEvent.click(screen.getByText('Charging'))
    expect(screen.getByTestId('device-prefs-filtered')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('device-prefs-reset'))
    expect(screen.getByText('Everything delivered')).toBeInTheDocument()
  })

  it('states the honest caveat about device-side filtering', () => {
    render(<DeviceNotificationPrefsPanel />)
    expect(
      screen.getByText(/has still been delivered to the browser/i),
    ).toBeInTheDocument()
  })
})
