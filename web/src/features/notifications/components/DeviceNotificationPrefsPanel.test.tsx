import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

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
  ] as Array<{ id: number; display_name: string }> | undefined,
  error: null as Error | null,
  isLoading: false,
  isFetching: false,
  isPending: false,
  fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  refetch: vi.fn(),
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: vehicles.data, isLoading: vehicles.isLoading, isError: vehicles.error != null,
    error: vehicles.error, refetch: vehicles.refetch,
    isFetching: vehicles.isFetching, isPending: vehicles.isPending, fetchStatus: vehicles.fetchStatus,
  }),
}))

const showNotification = vi.fn(async () => {})

import { DeviceNotificationPrefsPanel } from './DeviceNotificationPrefsPanel'
import {
  DEVICE_NOTIFICATION_PREFS_STORAGE_KEY,
  getDeviceNotificationPrefs,
  resetDeviceNotificationPrefs,
  updateDeviceNotificationPrefs,
} from '@/hooks/useDeviceNotificationPrefs'

beforeEach(() => {
  window.localStorage.clear()
  showNotification.mockClear()
  webPush.permission = 'granted'
  webPush.isSupported = true
  vehicles.data = [
    { id: 1, display_name: 'Roadster' },
    { id: 2, display_name: 'Cybertruck' },
  ]
  vehicles.error = null
  vehicles.isLoading = false
  vehicles.isFetching = false
  vehicles.isPending = false
  vehicles.fetchStatus = 'idle'
  vehicles.refetch.mockReset()
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
  it('keeps device switches and reset operable from the keyboard', async () => {
    const user = userEvent.setup()
    render(<DeviceNotificationPrefsPanel />)
    screen.getByRole('switch', { name: 'Show notifications on this device' }).focus()
    await user.keyboard(' ')
    expect(getDeviceNotificationPrefs().enabled).toBe(false)
    expect(screen.getByLabelText('Minimum severity')).toBeDisabled()
    screen.getByTestId('device-prefs-reset').focus()
    await user.keyboard('{Enter}')
    expect(getDeviceNotificationPrefs().enabled).toBe(true)
    expect(screen.getByLabelText('Minimum severity')).toBeEnabled()
  })

  it('keeps all revealed fields and actions mobile-sized with compact desktop roles', () => {
    render(<DeviceNotificationPrefsPanel />)
    fireEvent.change(screen.getByLabelText('Vehicle scope'), { target: { value: 'selected' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Silence notifications overnight' }))
    for (const label of ['From', 'Until']) {
      expect(screen.getByLabelText(label)).toHaveClass('min-h-11', 'md:min-h-10')
    }
    for (const label of ['Minimum severity', 'Vehicle scope']) {
      expect(screen.getByLabelText(label)).toHaveClass('min-h-11', 'md:min-h-9')
    }
    for (const control of screen.getAllByRole('switch')) {
      expect(control).toHaveClass('h-11', 'min-w-11', 'md:h-6', 'md:min-w-0')
      expect(control).toBeEnabled()
    }
    for (const id of ['device-prefs-test', 'device-prefs-reset']) {
      const control = screen.getByTestId(id)
      expect(control).toHaveClass('min-h-11', 'md:min-h-9', 'focus-visible:outline-2')
      control.focus()
      expect(control).toHaveFocus()
    }
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '21:30' } })
    fireEvent.change(screen.getByLabelText('Until'), { target: { value: '06:30' } })
    expect(getDeviceNotificationPrefs().quietHours).toMatchObject({
      startLocal: '21:30', endLocal: '06:30',
    })
  })

  it('uses neutral header icon roles without resetting device rules', () => {
    const { container, rerender } = render(<DeviceNotificationPrefsPanel />)
    fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'warn' } })
    const saved = getDeviceNotificationPrefs()
    rerender(<DeviceNotificationPrefsPanel />)
    expect(container.querySelector('svg')?.parentElement).toHaveClass(
      'text-[var(--text-secondary)]',
      'bg-[var(--surface-2)]',
      'ring-[var(--border-default)]',
    )
    expect(getDeviceNotificationPrefs()).toEqual(saved)
  })

  it('shows active vehicle loading without an empty fleet or unknown notice', () => {
    vehicles.data = undefined
    vehicles.isLoading = true
    vehicles.isPending = true
    vehicles.isFetching = true
    vehicles.fetchStatus = 'fetching'
    const { container } = render(<DeviceNotificationPrefsPanel />)
    fireEvent.change(screen.getByLabelText('Vehicle scope'), { target: { value: 'selected' } })
    expect(container.querySelector('[class~="bg-[var(--skeleton-bg)]"]')).not.toBeNull()
    expect(screen.queryByText('No vehicles are available to scope to yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No requested source has returned usable data yet.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Minimum severity')).toBeEnabled()
  })

  it.each(['paused', 'idle'] as const)('notices a %s source without vehicle data and retries only vehicles', (fetchStatus) => {
    vehicles.data = undefined
    vehicles.isPending = true
    vehicles.fetchStatus = fetchStatus
    const view = render(<DeviceNotificationPrefsPanel />)
    fireEvent.change(screen.getByLabelText('Vehicle scope'), { target: { value: 'selected' } })
    expect(screen.getByText(fetchStatus === 'paused' ? 'Refresh paused' : 'Pending')).toBeInTheDocument()
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument()
    expect(screen.queryByText('No vehicles are available to scope to yet.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Minimum severity')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('min-h-11', 'md:min-h-9')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(vehicles.refetch).toHaveBeenCalledOnce()
    expect(showNotification).not.toHaveBeenCalled()
    vehicles.data = []
    vehicles.isPending = false
    vehicles.fetchStatus = 'idle'
    view.rerender(<DeviceNotificationPrefsPanel />)
    expect(screen.getByText('No vehicles are available to scope to yet.')).toBeInTheDocument()
    expect(screen.queryByText('No requested source has returned usable data yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('retains scoped vehicle choices on refresh failure without sending a notification', () => {
    const view = render(<DeviceNotificationPrefsPanel />)
    fireEvent.change(screen.getByLabelText('Vehicle scope'), { target: { value: 'selected' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Roadster' }))
    vehicles.error = new Error('vehicles refresh offline')
    view.rerender(<DeviceNotificationPrefsPanel />)
    expect(screen.getByRole('switch', { name: 'Roadster' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(showNotification).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(vehicles.refetch).toHaveBeenCalledOnce()
    expect(showNotification).not.toHaveBeenCalled()
    vehicles.error = null
    view.rerender(<DeviceNotificationPrefsPanel />)
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Roadster' })).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps selected IDs visible and saved when vehicle details disappear', () => {
    const view = render(<DeviceNotificationPrefsPanel />)
    fireEvent.change(screen.getByLabelText('Vehicle scope'), { target: { value: 'selected' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Roadster' }))
    vehicles.data = []
    view.rerender(<DeviceNotificationPrefsPanel />)
    expect(screen.getByText(/Selected vehicle IDs remain saved.*1/)).toBeInTheDocument()
    expect(showNotification).not.toHaveBeenCalled()
    vehicles.data = [{ id: 1, display_name: 'Roadster' }]
    view.rerender(<DeviceNotificationPrefsPanel />)
    expect(screen.getByRole('switch', { name: 'Roadster' })).toHaveAttribute('aria-checked', 'true')
  })

  it('distinguishes an initial vehicle error from an empty fleet and retries only that source', () => {
    vehicles.data = undefined
    vehicles.error = new Error('vehicles unavailable')
    render(<MemoryRouter><DeviceNotificationPrefsPanel /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Vehicle scope'), { target: { value: 'selected' } })
    expect(screen.queryByText('No vehicles are available to scope to yet.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(vehicles.refetch).toHaveBeenCalledOnce()
    expect(showNotification).not.toHaveBeenCalled()
  })
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

  it('describes vehicle-less system notifications as exempt only from the vehicle filter', () => {
    render(<DeviceNotificationPrefsPanel />)
    expect(screen.getByText(/System notifications with no vehicle attached/)).toHaveTextContent(
      'are exempt from the vehicle filter. The device switch, category, and minimum severity rules still apply.',
    )
    expect(screen.queryByText(/Fleet-wide notifications.*always delivered/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Vehicle scope'), { target: { value: 'selected' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Roadster' }))
    fireEvent.click(screen.getByRole('switch', { name: 'System health' }))
    fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'critical' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Show notifications on this device' }))

    expect(getDeviceNotificationPrefs()).toMatchObject({
      enabled: false,
      categories: { system: false },
      minSeverity: 'critical',
      vehicleScope: 'selected',
      vehicleIds: [1],
    })
    expect(screen.getByRole('switch', { name: 'Roadster' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Cybertruck' })).toHaveAttribute('aria-checked', 'false')
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

  it.each(Array.from({ length: 128 }, (_, weekdays) => weekdays))(
    'preserves saved weekday mask %i and other rules when toggling quiet hours',
    (weekdays) => {
      updateDeviceNotificationPrefs({
        categories: { charging: false },
        minSeverity: 'warn',
        vehicleScope: 'selected',
        vehicleIds: [1],
        quietHours: {
          enabled: false,
          startLocal: '21:30',
          endLocal: '06:30',
          weekdays,
          bypassSeverities: ['warn'],
        },
      })
      const saved = getDeviceNotificationPrefs()
      const view = render(<DeviceNotificationPrefsPanel />)
      const toggle = screen.getByRole('switch', { name: 'Silence notifications overnight' })

      for (const enabled of [true, false, true]) {
        fireEvent.click(toggle)
        const expected = { ...saved, quietHours: { ...saved.quietHours, enabled } }
        expect(getDeviceNotificationPrefs()).toEqual(expected)
        expect(window.localStorage.getItem(DEVICE_NOTIFICATION_PREFS_STORAGE_KEY)).toBe(JSON.stringify(expected))
        expect(toggle).toHaveAttribute('aria-checked', String(enabled))
      }

      view.unmount()
      render(<DeviceNotificationPrefsPanel />)
      expect(screen.getByLabelText('From')).toHaveValue('21:30')
      expect(screen.getByLabelText('Until')).toHaveValue('06:30')
      expect(screen.getByRole('switch', { name: 'Roadster' })).toHaveAttribute('aria-checked', 'true')
      expect(getDeviceNotificationPrefs().quietHours.weekdays).toBe(weekdays)
    },
  )

  it('describes selected bypasses without promising critical delivery and retains choices across toggles', () => {
    render(<DeviceNotificationPrefsPanel />)
    expect(screen.queryByText(/Critical alerts still ring/)).not.toBeInTheDocument()
    expect(screen.getByText(/Only severities selected below ring through/)).toHaveTextContent(
      'device, category, minimum severity, and vehicle filters still apply.',
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Charging' }))
    fireEvent.change(screen.getByLabelText('Minimum severity'), { target: { value: 'warn' } })
    fireEvent.change(screen.getByLabelText('Vehicle scope'), { target: { value: 'selected' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Roadster' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Silence notifications overnight' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Ring through: critical' }))
    expect(getDeviceNotificationPrefs().quietHours.bypassSeverities).toEqual([])
    fireEvent.click(screen.getByRole('switch', { name: 'Ring through: warnings' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Silence notifications overnight' }))
    expect(screen.getByRole('switch', { name: 'Ring through: warnings' })).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: 'Silence notifications overnight' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Show notifications on this device' }))
    expect(screen.getByRole('switch', { name: 'Ring through: warnings' })).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: 'Show notifications on this device' }))
    expect(screen.getByRole('switch', { name: 'Ring through: warnings' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Ring through: critical' })).toHaveAttribute('aria-checked', 'false')
    expect(getDeviceNotificationPrefs()).toMatchObject({
      enabled: true,
      categories: { charging: false },
      minSeverity: 'warn',
      vehicleScope: 'selected',
      vehicleIds: [1],
      quietHours: { enabled: true, bypassSeverities: ['warn'] },
    })
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
