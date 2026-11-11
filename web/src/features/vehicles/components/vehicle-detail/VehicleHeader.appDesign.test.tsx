import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import postcss from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import {
  getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import { RecentChargesSection } from './RecentChargesSection'
import { RecentDrivesSection } from './RecentDrivesSection'
import { VehicleHeader } from './VehicleHeader'

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}))

const controls = postcss.parse(readFileSync(
  resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'controls.css'), 'utf8',
))

function content() {
  return <>
    <VehicleHeader vehicle={undefined} status="offline" waking onWake={vi.fn()} />
    <RecentDrivesSection drives={undefined} />
    <RecentChargesSection sessions={undefined} />
  </>
}

function NavigationLocation() {
  return <span data-testid="navigation-location">{useLocation().pathname}</span>
}

describe('vehicle-detail native navigation design adoption', () => {
  it.each(PACK_IDS)('%s owns the actual back/history anchors without changing destinations or source states', pack => {
    const view = render(<MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>{content()}</div>
    </MemoryRouter>)
    const host = view.container.firstElementChild!
    const release = observeAppDesignScopes(host)
    const identity = postcss.parse(readFileSync(
      resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'packs', `${pack}.css`), 'utf8',
    ))
    try {
      const links = within(host as HTMLElement).getAllByRole('link')
      expect(links.map(link => link.getAttribute('href'))).toEqual(['/vehicles', '/drives', '/charging'])
      for (const link of links) {
        expect(link).toHaveAttribute('data-app-part', 'button')
        expect(link).toHaveAttribute('data-app-variant', 'ghost')
        expect(link).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`))
        expect(link).not.toHaveAttribute('role')
        expect(link).toHaveClass('min-h-11', 'min-w-11')
        expect(link.className).toContain('focus-visible:outline')
        const selected: string[] = []
        identity.walkRules(rule => {
          for (const selector of rule.selectors) {
            if (selector.includes('[data-app-part~="button"]') && link.matches(selector)) selected.push(selector)
          }
        })
        expect(selected.length).toBeGreaterThan(0)
        const common: string[] = []
        controls.walkRules(rule => {
          if (rule.nodes.some(node => node.type === 'decl' && node.prop === 'touch-action')) {
            common.push(...rule.selectors.filter(selector => link.matches(selector)))
          }
        })
        expect(common.length).toBeGreaterThan(0)
      }
      expect(screen.getByRole('button', { name: 'Wake up' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Wake up' })).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByText('No drives recorded yet')).toBeInTheDocument()
      expect(screen.getByText('No charging sessions recorded yet')).toBeInTheDocument()
    } finally {
      release()
      view.unmount()
    }
  })

  it('keeps native keyboard navigation and anchor destinations active under the selected design', async () => {
    const user = userEvent.setup()
    const view = render(<MemoryRouter initialEntries={['/vehicles/7']}>
      <div data-app-design-preview="" {...getAppDesignAttributes('v1')}>
        {content()}
        <NavigationLocation />
      </div>
    </MemoryRouter>)
    const release = observeAppDesignScopes(view.container.firstElementChild!)
    try {
      for (const [name, destination] of [
        ['Back', '/vehicles'],
        ['View all', '/drives'],
        ['View all', '/charging'],
      ]) {
        await user.tab()
        const link = document.activeElement
        expect(link).toHaveRole('link')
        expect(link).toHaveAccessibleName(name)
        expect(link).toHaveAttribute('href', destination)
        await user.keyboard('{Enter}')
        expect(screen.getByTestId('navigation-location')).toHaveTextContent(destination)
        expect(link).toHaveFocus()
      }
      expect(screen.getByRole('button', { name: 'Wake up' })).toBeDisabled()
    } finally {
      release()
      view.unmount()
    }
  })

  it('leaves default and incomplete-preview anchors outside app design ownership', () => {
    const view = render(<MemoryRouter>
      <div data-testid="default">{content()}</div>
      <div data-app-design-preview="" data-app-design-pack="v1">{content()}</div>
    </MemoryRouter>)
    const release = observeAppDesignScopes(view.container)
    try {
      for (const link of screen.getAllByRole('link')) {
        expect(link).not.toHaveAttribute('data-app-design-owner')
        const selected: string[] = []
        controls.walkRules(rule => selected.push(...rule.selectors.filter(selector => link.matches(selector))))
        expect(selected).toEqual([])
      }
    } finally {
      release()
      view.unmount()
    }
  })
})
