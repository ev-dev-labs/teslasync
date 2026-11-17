import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, type Rule } from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import { FleetSetupReadiness } from './FleetSetupReadiness'

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const controlRules: Rule[] = []
parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'controls.css'), 'utf8'))
  .walkRules(rule => { controlRules.push(rule) })

function LocationReadout() {
  const location = useLocation()
  return <output aria-label="Location">{location.pathname}{location.search}</output>
}

describe('FleetSetupReadiness native navigation ownership', () => {
  it.each(PACK_IDS)('%s owns the real tools link while failed readiness remains unknown', async pack => {
    const retry = vi.fn()
    const view = render(
      <MemoryRouter initialEntries={['/settings/fleet-setup']}>
        <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
          <FleetSetupReadiness publicKey={undefined} state="error" error={new Error('Unavailable')} onRetry={retry} />
        </div>
        <LocationReadout />
      </MemoryRouter>,
    )
    const release = observeAppDesignScopes(view.container)
    try {
      const link = screen.getByRole('link', { name: 'Open Fleet API tools' })
      expect(link).toHaveAttribute('data-app-part', 'button')
      expect(link).toHaveAttribute('data-app-variant', 'secondary')
      expect(link).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`))
      expect(controlRules.some(rule => rule.selector.includes('[data-app-part~="button"]')
        && rule.nodes.some(node => node.type === 'decl' && node.prop === 'border-radius')
        && link.matches(rule.selector))).toBe(true)
      expect(link.tagName).toBe('A')
      expect(link).not.toHaveAttribute('role')
      expect(link).toHaveAttribute('href', '/dev-tools?tab=fleet-api')
      expect(link).toHaveClass('min-h-11', 'whitespace-normal', 'break-words')
      expect(screen.getByText('Partner public-key status unavailable.')).toBeInTheDocument()
      expect(screen.queryByText('Public key not stored')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(retry).toHaveBeenCalledTimes(1)
      link.focus()
      await userEvent.setup().keyboard('{Enter}')
      expect(screen.getByLabelText('Location')).toHaveTextContent('/dev-tools?tab=fleet-api')
    } finally { release() }
  })
})
