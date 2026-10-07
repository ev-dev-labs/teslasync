import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import english from '@/i18n/en.json'
import {
  getTourStatus,
  markTourCompleted,
  TOUR_OPEN_LAUNCHER_EVENT,
  TOUR_START_EVENT,
} from '@/lib/tourRegistry'

vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/components/ui/FontProvider', async (importActual) => ({
  ...await importActual<typeof import('@/components/ui/FontProvider')>(),
  useFont: () => ({ prefs: { sans: 'inter', scale: 1 } }),
}))

vi.mock('@/hooks/useEditLease', () => ({
  useEditLease: vi.fn(),
}))

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}))

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: unknown) => String(value),
    precision: 2,
    locale: 'en',
  }),
}))

vi.mock('@/components/feedback/Toast', async (importActual) => ({
  ...await importActual<typeof import('@/components/feedback/Toast')>(),
  useToast: () => ({ success: vi.fn() }),
}))

vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/feedback', async (importActual) => ({
  ...await importActual<typeof import('@/components/feedback')>(),
  EditConflictBanner: () => null,
}))

vi.mock('../components', async () => {
  const { SettingsActionCard } = await vi.importActual<
    typeof import('../components/SettingsActionCard')
  >('../components/SettingsActionCard')
  return {
    SettingsActionCard,
    SettingsSearch: () => null,
    GeneralSettings: () => null,
    WorkspacePreferencesSettings: () => null,
    AppearanceSettings: () => null,
    TypographySettings: () => null,
    AdvancedSettings: () => null,
  }
})

vi.mock('../components/ResetSection', () => ({ ResetSection: () => null }))
vi.mock('../components/ServerSection', () => ({ ServerSection: () => null }))
vi.mock('../components/operationalbrief-all/SettingsSummaryBrief', () => ({
  SettingsSummaryBrief: () => null,
}))

import SettingsPage from './SettingsPage'

describe('SettingsPage canonical tour-launcher copy', () => {
  it('names the launcher action without restarting or clearing completed tours', async () => {
    const i18n = createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      ns: ['settings', 'translation'],
      defaultNS: 'translation',
      fallbackNS: 'translation',
      resources: { en: { translation: english } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })

    // Exercise the canonical catalog, not a fallback-only translator mock.
    expect(i18n.getFixedT('en', 'settings')('tour.openLauncher')).toBe('Show tours')
    expect(i18n.getFixedT('en', 'settings')('tour.restart')).toBe('Restart tour')

    const launcherOpened = vi.fn()
    const tourStarted = vi.fn()
    const completedKey = 'teslasync:tour:v1:main'
    const previousCompletion = localStorage.getItem(completedKey)
    markTourCompleted('main', 1)
    window.addEventListener(TOUR_OPEN_LAUNCHER_EVENT, launcherOpened)
    window.addEventListener(TOUR_START_EVENT, tourStarted)

    try {
      render(
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/settings']}>
            <SettingsPage />
          </MemoryRouter>
        </I18nextProvider>,
      )

      const button = screen.getByRole('button', { name: 'Show tours', exact: true })
      expect(button).toHaveAccessibleName('Show tours')
      expect(screen.queryByRole('button', { name: 'Restart tour', exact: true })).not.toBeInTheDocument()

      fireEvent.click(button)

      expect(launcherOpened).toHaveBeenCalledTimes(1)
      expect(launcherOpened.mock.calls[0][0]).toBeInstanceOf(CustomEvent)
      expect(tourStarted).not.toHaveBeenCalled()
      expect(getTourStatus('main', 1)).toBe('completed')
      expect(screen.getByRole('link', { name: /Data export/i })).toHaveAttribute('href', '/data-export')
    } finally {
      window.removeEventListener(TOUR_OPEN_LAUNCHER_EVENT, launcherOpened)
      window.removeEventListener(TOUR_START_EVENT, tourStarted)
      if (previousCompletion === null) localStorage.removeItem(completedKey)
      else localStorage.setItem(completedKey, previousCompletion)
    }
  })
})
