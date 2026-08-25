import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import {
  getProductPreferencesSnapshot,
  resetProductPreferences,
} from '@/lib/productPreferences'
import {
  WORKSPACE_RANGE_EVENT,
  type WorkspaceRangePreset,
} from '@/lib/workspacePreferences'
import { WorkspacePreferencesSettings } from './WorkspacePreferencesSettings'

const { setVehicleIdMock } = vi.hoisted(() => ({
  setVehicleIdMock: vi.fn(),
}))

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicle: null,
    vehicles: [
      { id: 7, display_name: 'Roadrunner' },
      { id: 12, display_name: 'Fleet Two' },
    ],
    setVehicleId: setVehicleIdMock,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      const fallback =
        typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : typeof fallbackOrOptions?.defaultValue === 'string'
            ? fallbackOrOptions.defaultValue
            : key
      const values =
        typeof fallbackOrOptions === 'object'
          ? fallbackOrOptions
          : options
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replace(`{{${name}}}`, String(value)),
        fallback,
      )
    },
  }),
}))

function renderPanel() {
  return render(
    <ToastProvider>
      <WorkspacePreferencesSettings />
    </ToastProvider>,
  )
}

describe('WorkspacePreferencesSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetProductPreferences()
    setVehicleIdMock.mockReset()
  })

  it('explains the device-local, presentation-only preference boundary', () => {
    renderPanel()
    expect(
      screen.getByRole('heading', { name: 'Workspace preferences' }),
    ).toBeInTheDocument()
    expect(screen.getByText('This browser')).toBeInTheDocument()
    expect(
      screen.getByText(/never change permissions or backend authorization/i),
    ).toBeInTheDocument()
  })

  it('persists persona, landing, vehicle, and analysis defaults', () => {
    let appliedRange: WorkspaceRangePreset | undefined
    const handleRange = (event: Event) => {
      appliedRange = (
        event as CustomEvent<{ preset: WorkspaceRangePreset }>
      ).detail.preset
    }
    window.addEventListener(WORKSPACE_RANGE_EVENT, handleRange)

    renderPanel()
    fireEvent.change(screen.getByLabelText('Workspace profile'), {
      target: { value: 'analyst' },
    })
    fireEvent.change(screen.getByLabelText('Preferred landing page'), {
      target: { value: '/analytics' },
    })
    fireEvent.change(screen.getByLabelText('Default active vehicle'), {
      target: { value: '12' },
    })
    fireEvent.change(screen.getByLabelText('Default analysis window'), {
      target: { value: '30d' },
    })

    expect(getProductPreferencesSnapshot()).toMatchObject({
      persona: 'analyst',
      landingPage: '/analytics',
      defaultVehicleId: 12,
      defaultAnalysisRange: '30d',
    })
    expect(setVehicleIdMock).toHaveBeenCalledWith(12)
    expect(appliedRange).toBe('30d')

    window.removeEventListener(WORKSPACE_RANGE_EVENT, handleRange)
  })

  it('lets users independently disable inline help and release highlights', () => {
    renderPanel()

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Contextual inline help',
      }),
    )
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Contextual release highlights',
      }),
    )

    expect(getProductPreferencesSnapshot()).toMatchObject({
      contextualHelp: false,
      releaseHighlights: false,
    })
  })

  it('restores the full preference contract atomically', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Workspace profile'), {
      target: { value: 'administrator' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset defaults' }),
    )

    expect(getProductPreferencesSnapshot()).toMatchObject({
      persona: 'owner',
      landingPage: '/',
      defaultVehicleId: null,
      defaultAnalysisRange: '7d',
      contextualHelp: true,
      releaseHighlights: true,
    })
  })
})
