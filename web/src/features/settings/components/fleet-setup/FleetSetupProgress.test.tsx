import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { FleetApiInfo } from '@/api/hooks/useFleetSetup'
import type { OnboardingStatus } from '@/api/hooks/useOnboarding'
import { FleetSetupProgress, buildFleetSetupSteps } from './FleetSetupProgress'

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

afterEach(() => vi.restoreAllMocks())

describe('FleetSetupProgress — retained specialist step policy', () => {
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
