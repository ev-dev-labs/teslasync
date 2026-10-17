import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'

import type { AppSettings } from '@/api/types'
import { deriveDataState } from '@/api/dataState'
import canonicalEnglish from '@/i18n/en.json'
import { useSettings } from '@/hooks/useSettings'
import SafetyPage from './SafetyPage'

vi.unmock('react-i18next')
vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }))
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/components/ai', () => ({ AISafetySettingExplainer: () => null }))

const listingCopy = 'Each tile shows the current value on this install and links to its configuration documentation.'
const pageCopy = 'Notification quiet hours, alert digest mode, critical-flash signalling, tab-badge signalling, and the API kill-switch. Use the links on each card to review its configuration documentation.'
const originalListingCopy = 'Each row shows the current value on this install and links to the canonical Settings page where you can change it.'
const originalPageCopy = 'Notification quiet hours, alert digest mode, critical-flash signalling, tab-badge signalling, and the API kill-switch. Use the links below each row to change a value.'

const settings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'hourly',
  critical_flash_enabled: false,
  tab_badge_enabled: true,
}

const cards = [
  { key: 'quietHoursEnabled', title: 'Quiet hours', value: 'On', href: '/docs/notifications/quiet-hours.md' },
  { key: 'quietHoursStart', title: 'Quiet-hours window start', value: '22:00', href: '/docs/notifications/quiet-hours.md' },
  { key: 'quietHoursEnd', title: 'Quiet-hours window end', value: '07:00', href: '/docs/notifications/quiet-hours.md' },
  { key: 'alertDigestMode', title: 'Alert digest mode', value: 'hourly', href: '/docs/notifications/digest.md' },
  { key: 'criticalFlashEnabled', title: 'Critical-alert tab flash', value: 'Off', href: '/docs/notifications/tab-signalling.md' },
  { key: 'tabBadgeEnabled', title: 'Unread tab badge', value: 'On', href: '/docs/notifications/tab-signalling.md' },
  { key: 'apiSuspended', title: 'API kill-switch', value: 'Active', href: '/docs/operations/api-suspended.md' },
] as const

let translations = createInstance()
const refetch = vi.fn(() => Promise.resolve())

beforeEach(async () => {
  translations = createInstance()
  await translations.init({
    lng: 'en',
    fallbackLng: false,
    resources: { en: { translation: canonicalEnglish } },
    interpolation: { escapeValue: false },
  })
  vi.mocked(useSettings).mockReset()
  refetch.mockClear()
  vi.mocked(useSettings).mockReturnValue({
    settings,
    settingsState: deriveDataState({ data: settings }),
    settingsUnavailable: false,
    refetch,
  } as ReturnType<typeof useSettings>)
})

function mountPage() {
  return render(
    <I18nextProvider i18n={translations}>
      <MemoryRouter>
        <SafetyPage />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

function expectCardLinks() {
  const grid = screen.getByTestId('safety-settings-rows')
  expect(within(grid).getAllByRole('listitem')).toHaveLength(cards.length)
  for (const card of cards) {
    const tile = screen.getByTestId(`safety-settings-row-safetySettings.rows.${card.key}.title`)
    const link = within(tile).getByRole('link', { name: `Open documentation for ${card.title}` })
    expect(link).toHaveAttribute('href', card.href)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  }
}

describe('SafetyPage — canonical card copy', () => {
  it('uses canonical documentation copy and preserves every card value and exact docs destination', () => {
    // Require the parent-owned catalog leaf; a page fallback alone must not pass.
    expect(translations.getResource('en', 'translation', 'safetySettings.listing.cardsSubtitle')).toBe(listingCopy)
    mountPage()

    expect(within(screen.getByTestId('safety-settings-listing')).getByText(listingCopy)).toBeInTheDocument()
    expect(screen.queryByText(originalListingCopy)).not.toBeInTheDocument()
    expectCardLinks()
    for (const card of cards) {
      expect(screen.getByTestId(`safety-settings-value-safetySettings.rows.${card.key}.title`)).toHaveTextContent(card.value)
    }
  })

  it('describes card links as documentation while preserving their destinations and both original row-copy leaves', () => {
    expect(translations.getResource('en', 'translation', 'safetySettings.cardsPageSubtitle')).toBe(pageCopy)
    expect(translations.getResource('en', 'translation', 'safetySettings.pageSubtitle')).toBe(originalPageCopy)
    expect(translations.getResource('en', 'translation', 'safetySettings.listing.subtitle')).toBe(originalListingCopy)
    mountPage()

    expect(screen.getByText(pageCopy)).toBeInTheDocument()
    expect(screen.queryByText(originalPageCopy)).not.toBeInTheDocument()
    expect(screen.getByText(canonicalEnglish.safetySettings.listing.changeHint)).toBeInTheDocument()
    expectCardLinks()
  })

  it('retains documentation copy, exact docs destinations, unknown values and retry when settings are unavailable', () => {
    vi.mocked(useSettings).mockReturnValue({
      settings,
      settingsState: deriveDataState({ error: new Error('Read failed'), isError: true }),
      settingsUnavailable: true,
      refetch,
    } as ReturnType<typeof useSettings>)
    mountPage()

    expect(screen.getByText(listingCopy)).toBeInTheDocument()
    expectCardLinks()
    for (const card of cards) {
      expect(screen.getByTestId(`safety-settings-value-safetySettings.rows.${card.key}.title`)).toHaveTextContent('—')
    }
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(refetch).toHaveBeenCalledOnce()
  })
})
