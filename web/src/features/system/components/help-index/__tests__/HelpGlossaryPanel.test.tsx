import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { GLOSSARY } from '@/lib/helpGlossary'
import { HelpGlossaryPanel } from '../HelpGlossaryPanel'
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs'
import type { PackId } from '@/features/dashboard/widgets/designPacks/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

describe('HelpGlossaryPanel native definitions', () => {
  it('owns each semantic term/value pair without dropping provenance or changing context destinations', () => {
    render(<MemoryRouter><HelpGlossaryPanel /></MemoryRouter>)
    const panel = screen.getByTestId('help-glossary')
    const list = panel.querySelector('dl[data-app-list="definitions"]')
    expect(list).toHaveAttribute('data-app-part', 'list')
    const rows = list?.querySelectorAll(':scope > [data-app-part="list-row"]')
    expect(rows).toHaveLength(GLOSSARY.length)
    GLOSSARY.forEach((term, index) => {
      const row = rows?.[index] as HTMLElement
      expect(row).toHaveAttribute('data-glossary-entry', term.id)
      const label = row.querySelector('dt[data-app-part="metric-label"]')
      const value = row.querySelector('dd[data-app-part="metric-value"]') as HTMLElement
      expect(label).toHaveTextContent(term.termFallback)
      expect(within(value).getByText(term.definitionFallback)).toBeVisible()
      expect(value).toHaveTextContent(term.howMeasuredFallback)
      if (term.learnMoreTo) {
        expect(within(value).getByRole('link', { name: 'See it in context' }))
          .toHaveAttribute('href', term.learnMoreTo)
      } else {
        expect(within(value).queryByRole('link')).not.toBeInTheDocument()
      }
      expect(row.querySelector('[data-app-part~="metric-unit"]')).not.toBeInTheDocument()
    })
  })

  it('reaches the real definitions consumers for all27 and stops at an incomplete nested preview', () => {
      const sheet = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
      const { container } = render(
        <MemoryRouter>
          <div data-app-design-preview {...getAppDesignAttributes('classic')}>
            <div data-testid="glossary-profile" data-app-design-preview {...getAppDesignAttributes('blueprint')}>
              <HelpGlossaryPanel />
            </div>
          </div>
        </MemoryRouter>,
      )
      const profile = screen.getByTestId('glossary-profile')
      const row = profile.querySelector('[data-app-list="definitions"] > [data-app-part="list-row"]') as HTMLElement
      for (const pack of Object.keys(APPLICATION_DESIGNS) as PackId[]) {
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) profile.setAttribute(name, value)
        const release = observeAppDesignScopes(container)
        try {
          expect(row).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`))
          const consumers: string[] = []
          sheet.walkRules(rule => {
            if (rule.selector.includes('[data-app-list="definitions"] > [data-app-part~="list-row"]') && row.matches(rule.selector)) {
              consumers.push(rule.selector)
            }
          })
          expect(consumers, `${pack} must compose the actual definition row`).not.toHaveLength(0)
        } finally {
          release()
        }
      }

      profile.removeAttribute('data-app-data')
      const release = observeAppDesignScopes(container)
      try {
        expect(container.firstElementChild).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-classic'))
        expect(row).not.toHaveAttribute('data-app-design-owner')
        expect(row.querySelector('dt')).toHaveTextContent(GLOSSARY[0].termFallback)
        expect(row.querySelector('dd')).toHaveTextContent(GLOSSARY[0].definitionFallback)
      } finally {
        release()
      }
  })
})
