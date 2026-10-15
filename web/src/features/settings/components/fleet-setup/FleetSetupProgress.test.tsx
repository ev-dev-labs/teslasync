import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { FleetApiInfo } from '@/api/hooks/useFleetSetup'
import type { OnboardingStatus } from '@/api/hooks/useOnboarding'
import { deriveDataState } from '@/api/dataState'
import { FleetSetupProgress, buildFleetSetupSteps, type FleetSetupProgressProps } from './FleetSetupProgress'

const motionPreference = vi.hoisted(() => ({ reduce: false }))
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({
    reduce: motionPreference.reduce,
    durationMs: motionPreference.reduce ? 0 : 250,
  }),
}))

const apiInfo: FleetApiInfo = {
  base_url: 'https://example.test',
  client_id: 'client',
  has_valid_token: true,
  public_key_url: 'https://example.test/key.pem',
}

const onboarding: OnboardingStatus = {
  tesla_connected: true,
  vehicle_count: 1,
  data_flowing: true,
  last_telemetry_at: '2026-01-01T00:00:00Z',
  telemetry_health: 'healthy',
  setup_required: false,
  setup_complete: true,
  is_complete: true,
}

afterEach(() => {
  cleanup()
  motionPreference.reduce = false
  vi.restoreAllMocks()
})

describe('FleetSetupProgress — retained specialist step policy', () => {
  it.each(['fetching', 'paused', 'failed', 'idle'] as const)(
    'keeps unresolved %s sources unknown and preserves the recovery action',
    status => {
      const source = {
        ...deriveDataState({
          fetchStatus: status === 'fetching' || status === 'paused' ? status : 'idle',
          error: status === 'failed' ? new Error('Read failed') : undefined,
        }),
        isLoading: status === 'fetching',
      }
      const { container } = render(
        <FleetSetupProgress authenticated={undefined} apiInfo={undefined} onboarding={undefined}
          sources={{ account: source, token: source, telemetry: source }} />,
      )
      expect(screen.getAllByRole('listitem')).toHaveLength(4)
      expect(screen.getAllByText('Unknown')).toHaveLength(5)
      expect(screen.queryByText('Completed')).toBeNull()
      expect(screen.queryByText('Not started')).toBeNull()
      expect(screen.queryByText('0 / 4 complete')).toBeNull()
      expect(screen.getByRole('button', { name: 'Connect now' })).toBeEnabled()
      expect(container.querySelector('[aria-busy="true"]') !== null).toBe(status === 'fetching')
      const description = within(screen.getAllByRole('listitem')[0]!).getByText(/Authorize TeslaSync/)
      expect(description).toHaveTextContent(
        status === 'fetching' ? 'Loading' : status === 'paused' ? 'Refresh paused' : status === 'failed' ? 'Failed' : 'Unknown',
      )
      expect(description).not.toHaveTextContent(/offline/i)
    },
  )

  it('keeps successful zero/empty telemetry distinct from missing reads and unknown health', () => {
    const empty = { ...onboarding, vehicle_count: 0, data_flowing: false, last_telemetry_at: null, telemetry_health: 'unknown' as const }
    const { container } = render(
      <FleetSetupProgress authenticated={false} apiInfo={{ ...apiInfo, has_valid_token: false }} onboarding={empty} />,
    )
    expect(within(container.querySelector<HTMLElement>('#onboarding-step-connect')!).getByText('In progress')).toBeInTheDocument()
    expect(within(container.querySelector<HTMLElement>('#onboarding-step-subscribe')!).getByText('Not started')).toBeInTheDocument()
    expect(within(container.querySelector<HTMLElement>('#onboarding-step-stream')!).getByText('Unknown')).toBeInTheDocument()
    expect(screen.queryByText('Completed')).toBeNull()
  })

  it('retains completion through refresh failure and removes the annotation after recovery', () => {
    const ready = deriveDataState({ data: apiInfo })
    const failed = deriveDataState({ data: apiInfo, error: new Error('Refresh failed') })
    const telemetry = deriveDataState({ data: onboarding })
    const account = deriveDataState({ data: true })
    const { rerender } = render(
      <FleetSetupProgress authenticated apiInfo={apiInfo} onboarding={onboarding}
        sources={{ account, token: failed, telemetry }} />,
    )
    expect(screen.getAllByText('Completed')).toHaveLength(4)
    expect(screen.getByText(/Data may be stale/)).toBeInTheDocument()
    rerender(
      <FleetSetupProgress authenticated apiInfo={apiInfo} onboarding={onboarding}
        sources={{ account, token: ready, telemetry }} />,
    )
    expect(screen.getAllByText('Completed')).toHaveLength(4)
    expect(screen.queryByText(/Data may be stale/)).toBeNull()
  })

  it('keeps retained paused checks complete without marking the panel busy', () => {
    const source = { ...deriveDataState({ data: true, fetchStatus: 'paused' }), isLoading: false }
    const { container } = render(
      <FleetSetupProgress authenticated apiInfo={apiInfo} onboarding={onboarding}
        sources={{ account: source, token: source, telemetry: source }} />,
    )
    expect(screen.getAllByText('Completed')).toHaveLength(4)
    expect(screen.getAllByText(/Refresh paused/)).toHaveLength(4)
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('does not enable subscription using an unknown token', () => {
    const steps = buildFleetSetupSteps({
      authenticated: true, tokenValid: null, subscribed: null, streaming: null,
      t: (_key, fallback) => fallback,
    })
    expect(steps.map(step => step.done)).toEqual([true, null, null, null])
    expect(steps[2].cta?.disabled).toBe(true)
  })

  it.each(['healthy', 'stale'] as const)('labels populated %s telemetry as fleet evidence rather than selected-VIN confirmation', health => {
    const { container } = render(
      <FleetSetupProgress authenticated apiInfo={apiInfo} onboarding={{ ...onboarding, telemetry_health: health }} />,
    )
    const history = container.querySelector<HTMLElement>('#onboarding-step-subscribe')!
    expect(within(history).getByText('Fleet telemetry observed')).toBeInTheDocument()
    expect(within(history).getByText(
      'Telemetry has been received from the fleet. This historical check does not confirm the selected VIN has a telemetry configuration.',
    )).toBeInTheDocument()
    expect(within(history).getByText('Completed')).toBeInTheDocument()
    const stream = container.querySelector<HTMLElement>('#onboarding-step-stream')!
    expect(within(stream).getByText('Confirm fleet telemetry health')).toBeInTheDocument()
    expect(within(stream).getByText(
      'Healthy means fleet telemetry arrived in the last 24 hours, not that the selected VIN is streaming now.',
    )).toBeInTheDocument()
    expect(within(stream).queryByText('Completed') !== null).toBe(health === 'healthy')
  })

  it.each([false, true])('uses the shared motion preference (%s) and focuses each destination heading', (reduce) => {
    motionPreference.reduce = reduce
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const scroll = vi.fn()
    const targets = ['fleet-setup-account', 'fleet-setup-subscribe', 'fleet-setup-stream']
    const findTarget = document.getElementById.bind(document)
    vi.spyOn(document, 'getElementById').mockImplementation(id => {
      const target = findTarget(id)
      if (target && targets.includes(id)) target.scrollIntoView = scroll
      return target
    })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const { rerender } = render(
      <>
        <FleetSetupProgress authenticated={false} apiInfo={undefined} onboarding={undefined} />
        <section id="fleet-setup-account"><h2>Account destination</h2></section>
        <section id="fleet-setup-subscribe"><h2>Subscribe destination</h2></section>
        <section id="fleet-setup-stream"><h2>Stream destination</h2></section>
      </>,
    )
    const cases: (FleetSetupProgressProps & { action: string; heading: string })[] = [
      { authenticated: false, apiInfo: undefined, onboarding: undefined, action: 'Connect now', heading: 'Account destination' },
      { authenticated: true, apiInfo: undefined, onboarding: undefined, action: 'Refresh token', heading: 'Account destination' },
      { authenticated: true, apiInfo, onboarding: undefined, action: 'Choose a vehicle', heading: 'Subscribe destination' },
      { authenticated: true, apiInfo, onboarding: { ...onboarding, telemetry_health: 'stale' }, action: 'Check stream', heading: 'Stream destination' },
    ]
    for (const item of cases) {
      rerender(
        <>
          <FleetSetupProgress authenticated={item.authenticated} apiInfo={item.apiInfo} onboarding={item.onboarding} />
          <section id="fleet-setup-account"><h2>Account destination</h2></section>
          <section id="fleet-setup-subscribe"><h2>Subscribe destination</h2></section>
          <section id="fleet-setup-stream"><h2>Stream destination</h2></section>
        </>,
      )
      fireEvent.click(screen.getByRole('button', { name: item.action }))
      const heading = screen.getByRole('heading', { name: item.heading })
      expect(heading).toHaveFocus()
      expect(heading).toHaveAttribute('tabindex', '-1')
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
      expect(scroll).toHaveBeenLastCalledWith({ behavior: reduce ? 'instant' : 'smooth', block: 'start' })
    }
  })

  it('focuses the destination itself when there is no heading, without adding a tab stop', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(
      <>
        <FleetSetupProgress authenticated={false} apiInfo={undefined} onboarding={undefined} />
        <section id="fleet-setup-account" tabIndex={-1}>Account destination</section>
      </>,
    )
    const target = screen.getByText('Account destination')
    target.scrollIntoView = vi.fn()
    fireEvent.click(screen.getByRole('button', { name: 'Connect now' }))
    expect(target).toHaveFocus()
    expect(target).toHaveAttribute('tabindex', '-1')
  })

  it.each(['background', 'dialog', 'text-entry'])('respects the shared focus guard for %s', (guard) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(guard !== 'background')
    render(
      <>
        <FleetSetupProgress authenticated={false} apiInfo={undefined} onboarding={undefined} />
        <section id="fleet-setup-account"><h2>Account destination</h2></section>
        <div role={guard === 'dialog' ? 'dialog' : undefined}>
          <div tabIndex={0} role={guard === 'text-entry' ? 'searchbox' : undefined}>Focus owner</div>
        </div>
      </>,
    )
    const target = document.getElementById('fleet-setup-account')!
    target.scrollIntoView = vi.fn()
    const owner = screen.getByText('Focus owner')
    owner.focus()
    fireEvent.click(screen.getByRole('button', { name: 'Connect now' }))
    expect(owner).toHaveFocus()
    expect(target.scrollIntoView).toHaveBeenCalled()
  })

  it('leaves focus unchanged when the destination is absent', () => {
    render(<FleetSetupProgress authenticated={false} apiInfo={undefined} onboarding={undefined} />)
    const action = screen.getByRole('button', { name: 'Connect now' })
    action.focus()
    fireEvent.click(action)
    expect(action).toHaveFocus()
  })

  it('keeps exact step identities, destinations and token-dependent subscribe disablement', () => {
    const steps = buildFleetSetupSteps({
      authenticated: true,
      tokenValid: false,
      subscribed: false,
      streaming: false,
      t: (_key, fallback) => fallback,
    })
    expect(steps.map(step => step.key)).toEqual(['connect', 'token', 'subscribe', 'stream'])
    expect(steps.map(step => step.done)).toEqual([true, false, false, false])
    expect(steps[2].cta?.disabled).toBe(true)
    const targets = ['fleet-setup-account', 'fleet-setup-account', 'fleet-setup-subscribe', 'fleet-setup-stream']
    const elements = new Map<string, HTMLElement>()
    for (const id of new Set(targets)) {
      const element = document.createElement('div')
      element.scrollIntoView = vi.fn()
      elements.set(id, element)
    }
    const findTarget = vi.spyOn(document, 'getElementById').mockImplementation(id => elements.get(id) ?? null)

    for (const [index, step] of steps.entries()) {
      step.cta?.onClick?.()
      expect(findTarget).toHaveBeenLastCalledWith(targets[index])
      expect(elements.get(targets[index])?.scrollIntoView).toHaveBeenLastCalledWith({
        behavior: 'smooth',
        block: 'start',
      })
    }
  })

  it('uses a valid token to enable subscription without changing caller-prepared completion', () => {
    const steps = buildFleetSetupSteps({
      authenticated: false,
      tokenValid: true,
      subscribed: true,
      streaming: false,
      t: (_key, fallback) => fallback,
    })
    expect(steps.map(step => step.done)).toEqual([false, true, true, false])
    expect(steps[2].cta?.disabled).toBe(false)
  })

  it('keeps only streaming current when subscribed evidence exists but health is stale', () => {
    const { container } = render(
      <FleetSetupProgress
        authenticated
        apiInfo={apiInfo}
        onboarding={{ ...onboarding, telemetry_health: 'stale' }}
      />,
    )
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute('id', 'onboarding-step-stream')
    expect(screen.getAllByText('Completed')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Check stream' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Connect now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh token' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Choose a vehicle' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Setup progress' })).toBeInTheDocument()
  })

  it('keeps the connect row current even when later anchors are independently complete', () => {
    const { container } = render(
      <FleetSetupProgress authenticated={false} apiInfo={apiInfo} onboarding={onboarding} />,
    )
    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute('id', 'onboarding-step-connect')
    expect(screen.getAllByText('Completed')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Connect now' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Check stream' })).toBeNull()
  })

  it('renders all four completed LI rows without any action when every anchor is satisfied', () => {
    const { container } = render(
      <FleetSetupProgress authenticated apiInfo={apiInfo} onboarding={onboarding} />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getAllByText('Completed')).toHaveLength(4)
    expect(container.querySelector('[aria-current="step"]')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    for (const key of ['connect', 'token', 'subscribe', 'stream']) {
      expect(container.querySelector(`#onboarding-step-${key}`)?.tagName).toBe('LI')
    }
  })
})
