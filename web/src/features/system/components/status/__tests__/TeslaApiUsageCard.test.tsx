import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TeslaApiUsageCard } from '../TeslaApiUsageCard'
import type { APIUsage } from '@/api/types'
import { TeslaUsageContractError } from '@/api/hooks/useTeslaUsage'
const settings = vi.hoisted(() => ({
  locale: 'en-US', decimal_precision: 2, currency_symbol: '$',
  tz_display_default: 'user', timezone_user: 'UTC',
}))
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings, locale: settings.locale, settingsUnavailable: false }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { timezone: 'Asia/Tokyo' } }),
}))

// The global timezone double drops the vehicle tz (it resolves with a bare
// render's undefined vehicle); restore the faithful vehicle-tz resolution
// this card's vehicle-mode dates require.
vi.mock('@/lib/timezone', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return {
    ...actual,
    useTimezone: (mode: Parameters<typeof actual.useTimezone>[0] = 'vehicle') =>
      actual.resolveTimezone(mode, 'Asia/Tokyo', settings.timezone_user),
  };
})

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => `${settings.currency_symbol}${value.toFixed(2)}` }),
}))

const usage: APIUsage = {
  current: {
    start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z',
    signals: 150000, commands: 1000, data_requests: 500, wakes: 50,
    estimated_usd: 4,
  },
  history: [{
    start: '2026-08-02T00:00:00Z', end: '2026-09-01T00:00:00Z',
    signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0,
  }],
  rate_source: 'https://developer.tesla.com/docs/fleet-api#pricing',
  disclaimer: 'Not an invoice.',
}
const renderCard = (value?: APIUsage, props: { loading?: boolean; error?: Error } = {}) =>
  render(<MemoryRouter><TeslaApiUsageCard apiUsage={value} now={Date.now()} {...props} /></MemoryRouter>)

describe('Tesla Fleet usage estimate', () => {
  beforeEach(() => {
    settings.currency_symbol = '$'
    settings.locale = 'en-US'
    settings.tz_display_default = 'user'
    settings.timezone_user = 'UTC'
  })

  it.each([false, true])('uses saved locale and timezone at UTC day boundaries (compact=%s)', compact => {
    settings.locale = 'de-DE'
    settings.timezone_user = 'America/Los_Angeles'
    const original = structuredClone(usage)
    render(<MemoryRouter><TeslaApiUsageCard apiUsage={usage} now={0} compact={compact} /></MemoryRouter>)

    assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Cycle usage evidence' }),
      '31. Aug. – 30. Sept. 2026')
    if (!compact) {
      expect(screen.getByText('30. Sept. 2026')).toBeInTheDocument()
      expect(screen.getByText('1.–31. Aug. 2026 · 0 events')).toBeInTheDocument()
    }
    expect(usage).toEqual(original)
  })

  it('reacts to saved timezone display mode changes without changing source instants', () => {
    settings.locale = 'ja-JP'
    settings.tz_display_default = 'vehicle'
    const boundaryUsage: APIUsage = {
      ...usage,
      current: { ...usage.current, end: '2026-09-30T23:30:00Z' },
    }
    const { rerender } = renderCard(boundaryUsage)
    expect(screen.getByText('2026年10月1日')).toBeInTheDocument()
    settings.tz_display_default = 'utc'
    rerender(<MemoryRouter><TeslaApiUsageCard apiUsage={boundaryUsage} now={0} /></MemoryRouter>)
    expect(screen.getByText('2026年9月30日')).toBeInTheDocument()
    expect(boundaryUsage.current.end).toBe('2026-09-30T23:30:00Z')
  })

  it.each(['not-a-date', '', null, undefined])('shows placeholders for invalid or missing cycle dates (%s)', value => {
    const brokenUsage: APIUsage = {
      ...usage,
      current: { ...usage.current, start: 'invalid', end: '' },
      history: [{ ...usage.history[0], start: 'invalid', end: '' }],
    }
    // Older or malformed responses can omit dates despite the API's declared string shape.
    Object.assign(brokenUsage.current, { start: value, end: value })
    Object.assign(brokenUsage.history[0], { start: value, end: value })
    renderCard(brokenUsage)
    assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Cycle usage evidence' }), '—')
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('— · 0 events')).toBeInTheDocument()
    expect(screen.queryByText(/Invalid Date|1970/)).not.toBeInTheDocument()
    expect(screen.getByText('$4.00')).toBeInTheDocument()
  })

  it.each([false, true])('keeps source USD costs when the preferred currency is EUR (compact=%s)', compact => {
    settings.currency_symbol = '€'
    render(<MemoryRouter><TeslaApiUsageCard apiUsage={{
      ...usage,
      history: [{
        ...usage.history[0],
        start: '2026-07-03T00:00:00Z', end: '2026-08-02T00:00:00Z', estimated_usd: 1.25,
      }, ...usage.history],
    }} now={0} compact={compact} /></MemoryRouter>)

    expect(within(screen.getByRole('region', { name: 'Cycle usage evidence' })).getByText('$4.00')).toBeInTheDocument()
    expect(screen.queryByText(/€/)).not.toBeInTheDocument()
    if (!compact) {
      expect(screen.getByText('$1.25')).toBeInTheDocument()
      expect(screen.getByText('$0.00')).toBeInTheDocument()
    }
  })

  it('handles loading, error and missing evidence separately', () => {
    const { rerender } = renderCard(undefined, { loading: true })
    expect(screen.getByText(/Loading Tesla usage/)).toBeInTheDocument()
    rerender(<MemoryRouter><TeslaApiUsageCard apiUsage={undefined} now={0} error={new Error('down')} /></MemoryRouter>)
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
    rerender(<MemoryRouter><TeslaApiUsageCard apiUsage={undefined} now={0} /></MemoryRouter>)
    expect(screen.getByText(/not available yet/)).toBeInTheDocument()
  })
  it('shows four billable categories and retained zero-cost history without claiming a bill', () => {
    renderCard(usage)
    expect(screen.getByText('$4.00')).toBeInTheDocument()
    expect(screen.getByText('Streaming signals')).toBeInTheDocument()
    expect(screen.getByText('Commands · 1,000 / $1')).toBeInTheDocument()
    expect(screen.getByText('Data requests · 500 / $1')).toBeInTheDocument()
    expect(screen.getByText('Wakes · 50 / $1')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Cycle usage evidence' }), 'not a Tesla invoice', { contains: true })
    expect(screen.queryByText(/monthly credit/)).not.toBeInTheDocument()
  })
  it('keeps status concise and links to the dedicated page, including when usage is unavailable', () => {
    const { rerender } = render(<MemoryRouter><TeslaApiUsageCard apiUsage={usage} now={0} compact /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Explore Tesla API usage' })).toHaveAttribute('href', '/tesla-api-usage')
    expect(screen.queryByText('Prior 30-day cycles')).not.toBeInTheDocument()
    assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Cycle usage evidence' }), 'not a Tesla invoice', { contains: true })
    rerender(<MemoryRouter><TeslaApiUsageCard apiUsage={undefined} now={0} compact error={new Error('offline')} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Explore Tesla API usage' })).toHaveAttribute('href', '/tesla-api-usage')
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
  })
  it('shows a specific upgrade notice when the API still returns the legacy usage shape', () => {
    renderCard(undefined, { error: new TeslaUsageContractError() })
    expect(screen.getByText(/requires a newer API service/)).toBeInTheDocument()
  })
})
