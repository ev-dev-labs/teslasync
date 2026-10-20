import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';

// Unknown readings are omitted from the brief face; the Review-details
// drawer counts them. Pins the exact hidden-count sentence.
function expectHiddenCount(brief: HTMLElement, text: string) {
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }))
  const drawer = screen.getByRole('dialog')
  try {
    expect(within(drawer).getByText(text)).toBeInTheDocument()
  } finally {
    fireEvent.keyDown(drawer, { key: 'Escape' })
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
}
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsSummaryBrief } from './SettingsSummaryBrief'
import { SessionsSummaryCards } from '../sessions/SessionsSummaryCards'
import { TotpKpiBand } from '../twofactor/TotpKpiBand'
import { FleetSetupKpiBand } from '../fleet-setup/FleetSetupKpiBand'

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  } }),
}))
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '€' }),
}))
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string) => `date:${value}`,
    formatRelativeTime: (value: string) => `relative:${value}`,
  }),
}))

describe('settings summaries use the real compact Brief and raw bridge', () => {
  it('wraps the complete overview heading rather than clipping scaled narrow-screen text', () => {
    render(<SettingsSummaryBrief title="Preferences at a glance"
      description="Configuration choices" source="Saved settings" scope="Current preferences"
      metrics={[]} />)
    const heading = screen.getByRole('heading', { name: 'Preferences at a glance', exact: true })
    expect(heading).toHaveClass('min-w-0', 'whitespace-normal', 'break-words')
    expect(heading).not.toHaveClass('truncate')
    expect(heading).toHaveTextContent('Preferences at a glance')
  })

  it('renders an embedded brief without adding a second surface inside its host card', () => {
    const { container } = render(<MemoryRouter><SettingsSummaryBrief title="Configuration"
      description="Independent settings sources" source="Saved settings" scope="Latest configuration"
      metrics={[{ metricId: 'count', occurrenceId: 'setting-count', rawValue: 1, label: 'Enabled' }]}
      variant="embedded" /></MemoryRouter>)
    expect(container.querySelector('[data-operational-brief-surface="embedded"]')).toBeInTheDocument()
    expect(container.querySelector('[data-operational-brief-surface="standalone"]')).toBeNull()
  })

  it('retains raw numeric values, explicit count totals, source units and rich drawer context', () => {
    const costFormatter = vi.fn((raw: number) => ({ value: `€${raw.toFixed(4)}`, unit: '/ kWh' }))
    const { container } = render(<MemoryRouter>
      <SettingsSummaryBrief title="Configuration" description="Independent settings sources"
        source="Saved settings" scope="Latest configuration; no historical range"
        metrics={[
          { metricId: 'count', occurrenceId: 'safeguards', rawValue: 2, label: 'Safeguards',
            display: { countTotal: 3, formatter: raw => ({ value: `${raw} / 3`, unit: '' }) }, context: 'Two of three protections enabled' },
          { metricId: 'rate', occurrenceId: 'cost', rawValue: 0.1234, label: 'Comparison cost',
            display: { formatter: costFormatter },
            context: <a href="/settings#general">Edit comparison cost</a> },
        ]} />
    </MemoryRouter>)
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(2)
    const cost = container.querySelector('[data-operational-metric="cost"]')
    expect(cost).toHaveAttribute('data-value-state', 'value')
    expect(cost).toHaveTextContent('€0.1234 / kWh')
    expect(costFormatter).toHaveBeenCalledWith(0.1234, expect.objectContaining({ currency: { kind: 'symbol', value: '€' } }))
    expect(container.querySelector('[data-operational-metric="safeguards"]')).toHaveTextContent('2 / 3')
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText('Two of three protections enabled')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: 'Edit comparison cost' })).toHaveAttribute('href', '/settings#general')
  })

  describe('SettingsSummaryBrief independent metric loading', () => {
    it('bridges local loading overrides without changing remote defaults, source metadata or rich captions', () => {
      const { container } = render(<SettingsSummaryBrief title="Mixed settings" description="Independent source states"
        source="Saved settings and browser font preferences" scope="Browser font is independently available"
        freshness="Remote source not confirmed" loading
        metrics={[
          { metricId: 'rate', occurrenceId: 'remote', label: 'Remote cost', rawValue: null },
          { metricId: 'text', occurrenceId: 'font', label: 'Browser typography', rawValue: 'Atkinson',
            context: <strong>125% browser scale</strong>, loading: false },
        ]} />)
      expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(1)
      expect(container.querySelector('[data-operational-metric="remote"]')).toHaveAttribute('data-value-state', 'missing')
      expect(container.querySelector('[data-operational-metric="font"]')).toHaveAttribute('data-value-state', 'value')
      expect(screen.getByText('Atkinson')).toBeVisible()
      assertOperationalBriefDisclosure(container, 'Loading source')
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
      const drawer = screen.getByRole('dialog')
      expect(within(drawer).getByText('Atkinson')).toBeVisible()
      expect(within(drawer).getByText('Atkinson')).not.toHaveAttribute('aria-busy')
      expect(within(drawer).getByText('125% browser scale').tagName).toBe('STRONG')
      expect(within(drawer).getByText('Remote source not confirmed')).toBeVisible()
      expect(within(drawer).getByText('Browser font is independently available')).toBeVisible()
      expect(drawer.querySelectorAll('[aria-busy="true"]')).toHaveLength(1)
    })

    it('does not convert resolved missing or invalid local inputs into a successful zero or bypass validation', () => {
      const formatter = vi.fn((raw: number) => ({ value: String(raw), unit: '' }))
      const { container } = render(<SettingsSummaryBrief title="Validated settings" description="Raw source validation"
        source="Independent sources" scope="Local results resolved" loading
        metrics={[
          { metricId: 'count', occurrenceId: 'missing-local', label: 'Missing local', rawValue: null, loading: false,
            display: { formatter } },
          { metricId: 'count', occurrenceId: 'invalid-local', label: 'Invalid local', rawValue: Number.NaN, loading: false,
            display: { formatter } },
          { metricId: 'count', occurrenceId: 'zero-local', label: 'Measured local zero', rawValue: 0, loading: false },
        ]} />)
      assertOperationalMetricUnavailable(container, 'Missing local')
      assertOperationalMetricUnavailable(container, 'Invalid local')
      expectHiddenCount(container, '2 empty fields are hidden.')
      expect(container.querySelector('[data-operational-metric="zero-local"] [data-operational-value]')).toHaveTextContent('0')
      expect(formatter).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
      const drawer = screen.getByRole('dialog')
      expect(within(drawer).getByText('0', { exact: true })).toBeVisible()
      expect(drawer.querySelector('[aria-busy="true"]')).toBeNull()
    })
  })

  it('distinguishes unavailable and invalid counts from measured zero while retaining source context', () => {
    const { container } = render(<SettingsSummaryBrief title="Reading" description="Latest source readings"
      source="Independent sources" scope="No common time range" retained
      metrics={[
        { metricId: 'count', occurrenceId: 'zero', rawValue: 0, label: 'Measured empty' },
        { metricId: 'count', occurrenceId: 'missing', rawValue: null, label: 'Unavailable' },
        { metricId: 'count', occurrenceId: 'invalid', rawValue: Number.NaN, label: 'Invalid source' },
      ]} />)
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveAttribute('data-value-state', 'value')
    expect(container.querySelector('[data-operational-metric="zero"] [data-operational-value]')).toHaveTextContent('0')
    assertOperationalMetricUnavailable(container, 'Unavailable')
    assertOperationalMetricUnavailable(container, 'Invalid source')
    expectHiddenCount(container, '2 empty fields are hidden.')
    assertOperationalBriefDisclosure(document.body, 'Retained source')
  })

  it('marks the loading Brief busy without asserting default source values', () => {
    const { container } = render(<SettingsSummaryBrief title="Reading" description="Loading the source"
      source="Source" scope="Latest source" loading
      metrics={[{ metricId: 'count', occurrenceId: 'loading-count', rawValue: null, label: 'Count' }]} />)
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0)
    expect(screen.getByText('Count')).toBeInTheDocument()
  })

  it('retains session counts, relative/absolute activity and current-device context in the drawer', () => {
    const { container } = render(<MemoryRouter><SessionsSummaryCards total={2} otherCount={1}
      current={{ id: 'this', current: true, ip: '192.0.2.1',
        user_agent: 'Mozilla/5.0 Chrome/120.0 Windows NT 10.0', created_at: '2026-10-01T00:00:00Z',
        last_seen_at: '2026-10-06T12:00:00Z' }}
      lastActive="2026-10-06T12:00:00Z" isLoading={false} isError={false} retained /></MemoryRouter>)
    expect(container.querySelector('[data-operational-metric="sessions-total"]')).toHaveAttribute('data-value-state', 'value')
    expect(container.querySelector('[data-operational-metric="sessions-other"]')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText('192.0.2.1')).toBeInTheDocument()
    expect(within(drawer).getByText('date:2026-10-06T12:00:00Z')).toBeInTheDocument()
    expect(within(drawer).getByText('relative:2026-10-06T12:00:00Z')).toBeInTheDocument()
  })

  it('does not turn an unavailable session list into a successful empty list', () => {
    const { container } = render(<SessionsSummaryCards total={0} otherCount={0} current={null}
      lastActive={null} sourceAvailable={false} isLoading={false} isError={false} />)
    for (const label of ['Active sessions', 'This device', 'Other devices', 'Last active']) {
      assertOperationalMetricUnavailable(container, label)
    }
    expectHiddenCount(container, '4 empty fields are hidden.')
    expect(screen.queryByText('0')).toBeNull()
  })

  it('keeps exhausted recovery codes measured and preserves RFC context without credential actions', () => {
    const { container } = render(<TotpKpiBand data={{ mode: 'session', activated: true, backup_codes_remaining: 0 }}
      isLoading={false} retained />)
    expect(container.querySelector('[data-operational-metric="totp-backup"]')).toHaveAttribute('data-value-state', 'value')
    expect(container.querySelector('[data-operational-metric="totp-backup"] [data-operational-value]')).toHaveTextContent('0')
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    expect(within(screen.getByRole('dialog')).getByText('RFC 6238')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable two-factor' })).toBeNull()
  })

  it('keeps resolved Fleet sources while an independent source is still loading', () => {
    const { container } = render(<FleetSetupKpiBand authenticated
      apiInfo={{ has_valid_token: true, base_url: '', client_id: '', public_key_url: '' }}
      publicKey={undefined} onboarding={undefined} isLoading
      sourceLoading={{ domain: true, stream: true, account: false, token: false }} />)
    expect(container.querySelector('[data-operational-metric="fleet-setup-token"]')).toHaveTextContent('Auto-refresh on')
    assertOperationalMetricUnavailable(container, 'Partner public key')
    assertOperationalMetricUnavailable(container, 'Telemetry')
    expectHiddenCount(container, '2 empty fields are hidden.')
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    expect(within(screen.getByRole('dialog')).getByText('TeslaSync refreshes the Fleet token before it expires.')).toBeInTheDocument()
  })
})
