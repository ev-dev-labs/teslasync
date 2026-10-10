import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
      i18n: { language: 'en' },
    }),
  }
})

import { FleetSetupGuide } from './FleetSetupGuide'

describe('FleetSetupGuide shared instructions', () => {
  it('preserves the Tesla order, every prerequisite explanation and a heading-named passive list', () => {
    render(<FleetSetupGuide />)
    const heading = screen.getByRole('heading', { name: 'How fleet setup works' })
    const list = screen.getByRole('list', { name: 'How fleet setup works' })
    expect(list).toHaveAttribute('aria-labelledby', heading.id)
    const steps = within(list).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    const titles = ['Connect Tesla', 'Point Tesla at this host', 'Subscribe the vehicle', 'Wait for the car to wake']
    const ids = ['connect', 'domain', 'subscribe', 'stream']
    steps.forEach((step, index) => {
      expect(step).toHaveTextContent(titles[index])
      expect(step).toHaveAttribute('data-step-id', ids[index])
      expect(within(step).getByText(String(index + 1))).toBeInTheDocument()
      expect(step).not.toHaveAttribute('aria-current')
      expect(step).not.toHaveAttribute('data-state')
    })
    expect(list).toHaveTextContent('you should not paste tokens by hand')
    expect(list).toHaveTextContent('Let’s Encrypt')
    expect(list).toHaveTextContent('/.well-known/appspecific/com.tesla.3p.public-key.pem')
    expect(list).toHaveTextContent('fleet_telemetry_config')
    expect(list).toHaveTextContent('Virtual key pairing is for commands, not this stream.')
    expect(within(list).queryByRole('button')).toBeNull()
  })
})
