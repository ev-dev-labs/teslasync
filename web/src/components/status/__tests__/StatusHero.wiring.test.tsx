/**
 * StatusHero i18n wiring — the five default headlines resolve through the
 * `statusHero.headline.*` catalog keys instead of hardcoded English.
 *
 * The key-echoing `t` mock makes the wiring observable: with hardcoded
 * headlines this file renders English and every case below fails; with the
 * catalog lookup it renders the keys. The sibling StatusHero.test.tsx keeps
 * the real-i18n behavioral pins (English defaults, variants, overrides).
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StatusHero, type HeroStatus } from '../StatusHero'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `[${key}]` }),
}))

describe('StatusHero catalog wiring', () => {
  it.each([
    ['healthy', 'statusHero.headline.healthy'],
    ['degraded', 'statusHero.headline.degraded'],
    ['unhealthy', 'statusHero.headline.unhealthy'],
    ['unknown', 'statusHero.headline.unknown'],
    ['maintenance', 'statusHero.headline.maintenance'],
  ] as const)('looks up the %s headline by catalog key', (status: HeroStatus, key) => {
    render(<StatusHero status={status} />)
    expect(screen.getByRole('heading', { name: `[${key}]` })).toBeInTheDocument()
  })

  it('still prefers a caller headline override over the catalog lookup', () => {
    render(<StatusHero status="healthy" headline="Custom headline" />)
    expect(screen.getByRole('heading', { name: 'Custom headline' })).toBeInTheDocument()
    expect(screen.queryByText('[statusHero.headline.healthy]')).not.toBeInTheDocument()
  })
})
