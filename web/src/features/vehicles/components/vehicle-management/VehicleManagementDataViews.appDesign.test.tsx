import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import postcss from 'postcss'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs'
import {
  expectAppDesignDataMode, matchesAppDesignCss,
} from '@/components/feedback/appDesignCss.test-utils'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import { VehicleOptionsDataView } from './VehicleOptionsDataView'
import { WarrantyDataView } from './WarrantyDataView'
import { SubscriptionDataView } from './SubscriptionDataView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key,
      ),
    i18n: { language: 'en' },
  }),
}))

const options = { codes: [
  { displayName: 'Source option', code: 'OPTION-1', isActive: true, colorCode: 'PPSW' },
  { displayName: 'Unconfirmed option', code: 'OPTION-2', isActive: null },
] }
const warranty = {
  activeWarranty: [{ displayName: 'Original coverage', code: 'BASIC', coverageAgeInYears: 0, expirationOdometer: 0 }],
  upcomingWarranty: [{ displayName: 'Future coverage', coverageAgeInMonths: 12, expirationOdometer: 12345 }],
  expiredWarranty: [{ displayName: 'Past coverage' }],
}
const subscriptions = { country: 'US', eligible: [
  { product: 'SUBSCRIPTION_ONE', optionCode: 'OFFER-1', billingOptions: [
    { price: 0, total: 0, currencyCode: 'USD', billingPeriod: 'MONTHLY' },
    { price: -12.3456, total: null, currencyCode: '$', billingPeriod: 'CUSTOM_CYCLE' },
  ] },
  { product: 'SECOND_OFFER', optionCode: 'OFFER-2', billingOptions: [] },
] }

afterEach(() => {
  act(() => {
    setGlobalLocale('en-US')
    setGlobalPrecision(2)
  })
})

describe('typed vehicle-management source surfaces', () => {
  it.each(PACK_IDS)('%s composes actual returned option, warranty and billing records with their original meanings', pack => {
    const original = structuredClone({ options, warranty, subscriptions })
    const view = render(<MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <VehicleOptionsDataView data={options} />
        <WarrantyDataView data={warranty} />
        <SubscriptionDataView data={subscriptions} />
      </div>
    </MemoryRouter>)
    const host = view.container.firstElementChild!
    const release = observeAppDesignScopes(host)
    const mode = APPLICATION_DESIGNS[pack].data
    try {
      const identity = postcss.parse(readFileSync(
        resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8',
      ))
      const cards = host.querySelectorAll('[data-app-part="card"][data-surface-variant="standalone"]')
      expect(cards).toHaveLength(7)
      for (const card of cards) {
        const selected: string[] = []
        identity.walkRules(rule => selected.push(...rule.selectors.filter(selector =>
          selector.includes('[data-app-part~="card"]') && card.matches(selector))))
        expect(selected.length).toBeGreaterThan(0)
      }
      expect(screen.getByText('Unknown active of 2 options returned')).toBeInTheDocument()
      expect(screen.getByText('Status unknown')).toBeInTheDocument()
      expect(screen.getByText('Paint PPSW')).toBeInTheDocument()
      const coverageCards = [...host.querySelectorAll('dl[data-app-list="definitions"]')]
      expect(coverageCards).toHaveLength(3)
      for (const list of coverageCards) {
        expect([...list.children].map(row => row.querySelector('dt')?.textContent))
          .toEqual(['Coverage term', 'Odometer limit', 'Expiration'])
        for (const row of list.children) {
          expectAppDesignDataMode(row, mode, '[data-app-list="definitions"]')
          const reading = row.querySelector(':scope > [data-app-part="metric-reading"]')!
          expectAppDesignDataMode(reading, mode, '[data-app-part~="metric-reading"]')
          expect(reading.querySelector('[data-app-part="metric-value"]')).not.toBeNull()
        }
      }
      expect(coverageCards[0].children[0]).toHaveTextContent('0 years')
      expect(coverageCards[0].children[1]).toHaveTextContent('0')
      expect(coverageCards[1].children[0]).toHaveTextContent('12 months')
      expect(coverageCards[2].children[0]).toHaveTextContent('Not provided')
      expect(screen.getByText(/Odometer limits are shown exactly as Tesla reports them/)).toBeInTheDocument()
      const billing = host.querySelectorAll('[data-app-metric="tile"]')
      expect(billing).toHaveLength(2)
      for (const reading of billing) {
        expectAppDesignDataMode(reading, mode, '[data-app-metric="tile"]')
        expect(reading.querySelector(':scope > [data-app-part="metric-label"]')).not.toBeNull()
        expect(reading.querySelector(':scope > [data-app-part="metric-reading"] > [data-app-part="metric-value"]')).not.toBeNull()
      }
      expect(billing[0].querySelector('[data-app-part="metric-value"]')).toHaveTextContent('$0.00')
      expect(billing[0].querySelector('[data-app-part="metric-unit"]')).toHaveTextContent('/ month')
      expect(billing[0].querySelector('[data-app-part="metric-context"]')).toHaveTextContent('Total $0.00')
      expect(billing[1].querySelector('[data-app-part="metric-value"]')).toHaveTextContent('$ -12.35')
      expect(billing[1].querySelector('[data-app-part="metric-unit"]')).toBeNull()
      expect(billing[1].querySelector('[data-app-part="metric-context"]')).toBeNull()
      expect(screen.getByText('Custom cycle')).toBeInTheDocument()
      expect(screen.getByText('Tesla returned no billing options for this offer.')).toBeInTheDocument()
      expect(host.querySelector('[role="progressbar"], [data-metric-track]')).toBeNull()
      expect({ options, warranty, subscriptions }).toEqual(original)
    } finally {
      release()
      view.unmount()
    }
  })

  it('keeps returned unknown warranty status and source precision through the real raw disclosure', () => {
    const view = render(<MemoryRouter>
      <WarrantyDataView data={{ displayName: 'Unclassified coverage', expirationOdometer: -12.5 }} />
      <SubscriptionDataView data={{ eligible: [{ product: 'PRECISE_PRICE', billingOptions: [
        { price: 12.345678, currencyCode: null, billingPeriod: null },
        { price: null, total: null },
      ] }] }} />
    </MemoryRouter>)
    const unknownCoverage = screen.getByRole('heading', { name: 'Unclassified coverage' })
      .closest('[data-app-part="card"]')!
    expect(within(unknownCoverage as HTMLElement).getByText('Unknown')).toBeInTheDocument()
    expect(unknownCoverage).toHaveTextContent('-13')
    act(() => {
      setGlobalLocale('de-DE')
      setGlobalPrecision(4)
    })
    expect(screen.getByText('12,3457')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    const rawButtons = screen.getAllByRole('button', { name: 'Technical response details' })
    fireEvent.click(rawButtons[1])
    const raw = screen.getByTestId('management-structured-data')
    expect(within(raw).getByText('12.345678')).toBeInTheDocument()
    expect(within(raw).getAllByText('No value')).toHaveLength(4)
    view.unmount()
  })

  it('owns newly opened recursive raw records without leaking into a neutral nested result or changing source data', async () => {
    const response = { ...subscriptions, api_key: 'private-response-value' }
    const original = structuredClone(response)
    const view = render(<MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes('v1')}>
        <SubscriptionDataView data={response} />
        <div data-app-design-preview="" data-testid="neutral-options">
          <VehicleOptionsDataView data={options} />
        </div>
      </div>
    </MemoryRouter>)
    const host = view.container.firstElementChild!
    const release = observeAppDesignScopes(host)
    try {
      fireEvent.click(screen.getAllByRole('button', { name: 'Technical response details' })[0])
      const raw = screen.getByTestId('management-structured-data')
      const rows = [...raw.querySelectorAll('[data-app-part="list-row"]')]
      expect(rows.length).toBeGreaterThan(0)
      await waitFor(() => {
        for (const row of rows) {
          expect(row).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-v1'))
        }
      })
      for (const row of rows) {
        expectAppDesignDataMode(row, 'instrument', '[data-app-list="definitions"]')
        expectAppDesignDataMode(
          row.querySelector(':scope > [data-app-part="metric-reading"]')!,
          'instrument', '[data-app-part~="metric-reading"]',
        )
      }
      expect(within(raw).getByText('-12.3456')).toBeInTheDocument()
      expect(within(raw).getByText('Redacted')).toBeInTheDocument()
      expect(screen.queryByText('private-response-value')).not.toBeInTheDocument()
      const neutral = screen.getByTestId('neutral-options')
      expect(within(neutral).getByText('Status unknown')).toBeInTheDocument()
      for (const card of neutral.querySelectorAll('[data-app-part="card"]')) {
        expect(card).not.toHaveAttribute('data-app-design-owner')
        expect(matchesAppDesignCss(card)).toEqual([])
      }
      for (const name of Object.keys(getAppDesignAttributes('v1'))) host.removeAttribute(name)
      await waitFor(() => expect(rows[0]).not.toHaveAttribute('data-app-design-owner'))
      for (const row of rows) expect(matchesAppDesignCss(row)).toEqual([])
      expect(within(raw).getByText('-12.3456')).toBeInTheDocument()
      expect(response).toEqual(original)
    } finally {
      release()
      view.unmount()
    }
  })

  it('keeps each empty response and its raw disclosure without fabricated result cards', () => {
    const view = render(<MemoryRouter>
      <VehicleOptionsDataView data={{ codes: [] }} />
      <WarrantyDataView data={{ activeWarranty: [], upcomingWarranty: [], expiredWarranty: [] }} />
      <SubscriptionDataView data={{ eligible: [] }} />
    </MemoryRouter>)
    expect(screen.getByText('No vehicle options returned')).toBeInTheDocument()
    expect(screen.getByText('No warranty coverage returned')).toBeInTheDocument()
    expect(screen.getByText('No eligible subscriptions returned')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Technical response details' })).toHaveLength(3)
    expect(view.container.querySelector('[data-app-part="card"], [data-app-metric="tile"]')).toBeNull()
    for (const row of view.container.querySelectorAll('[data-app-part]')) {
      expect(row).not.toHaveAttribute('data-app-design-owner')
      expect(matchesAppDesignCss(row)).toEqual([])
    }
  })
})
