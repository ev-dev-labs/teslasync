import { createRef } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MaybeLink } from './_MaybeLink'
import { ErrorHelpLinks } from './ErrorHelpLinks'
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '../ui/app-designs/designs'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'

const rules: Rule[] = []
for (const file of ['feedback.css', 'controls.css']) {
  postcss.parse(readFileSync(resolve(
    process.cwd(), 'src', 'components', 'ui', 'app-designs', file,
  ), 'utf8')).walkRules(rule => { rules.push(rule) })
}

beforeEach(() => { vi.stubEnv('VITE_DOCS_BASE_URL', '') })
afterEach(() => { vi.unstubAllEnvs() })

describe('MaybeLink native contract forwarding', () => {
  it.each([false, true])('preserves the same ref, destination, click, focus and explicit contract with Router=%s', inRouter => {
    const ref = createRef<HTMLAnchorElement>()
    const onClick = vi.fn()
    const link = <MaybeLink
      ref={ref} to="/help?reason=network" onClick={onClick}
      data-testid="recovery" data-error-help-link="status"
      data-app-part="feedback button" data-app-variant="ghost"
      data-app-feedback-kind="notice" data-app-tone="neutral" className="retained-link"
    >Recovery destination</MaybeLink>
    const view = render(inRouter ? <MemoryRouter>
      <Routes>
        <Route path="/" element={link} />
        <Route path="/help" element={<p>Destination reached</p>} />
      </Routes>
    </MemoryRouter> : link)
    const anchor = screen.getByRole('link', { name: 'Recovery destination' })
    expect(ref.current).toBe(anchor)
    expect(anchor.tagName).toBe('A')
    expect(anchor).toHaveAttribute('href', '/help?reason=network')
    expect(anchor).toHaveAttribute('data-app-part', 'feedback button')
    expect(anchor).toHaveAttribute('data-app-variant', 'ghost')
    expect(anchor).toHaveAttribute('data-app-feedback-kind', 'notice')
    expect(anchor).toHaveAttribute('data-error-help-link', 'status')
    expect(anchor).toHaveClass('retained-link')
    expect(anchor.querySelector('button')).toBeNull()
    anchor.focus()
    expect(anchor).toHaveFocus()
    if (!inRouter) anchor.addEventListener('click', event => event.preventDefault())
    fireEvent.click(anchor)
    expect(onClick).toHaveBeenCalledOnce()
    if (inRouter) expect(screen.getByText('Destination reached')).toBeInTheDocument()
    view.unmount()
    expect(ref.current).toBeNull()
  })

  it('does not retag plain supporting links as controls or notices', () => {
    render(<MaybeLink to="/help">Plain help</MaybeLink>)
    const link = screen.getByRole('link', { name: 'Plain help' })
    expect(link).not.toHaveAttribute('data-app-part')
    expect(link).not.toHaveAttribute('data-app-feedback-kind')
  })

  it.each(PACK_IDS)('%s retains ranked actual routerless recovery records and safe configured external links', pack => {
    vi.stubEnv('VITE_DOCS_BASE_URL', 'https://docs.example.test')
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <ErrorHelpLinks kind="server" />
    </div>)
    const release = observeAppDesignScopes(view.container.firstElementChild!)
    try {
      const links = screen.getAllByRole('link')
      expect(links.map(link => link.getAttribute('href'))).toEqual([
        '/system-status', '/help', 'https://docs.example.test/docs/runbooks/phase-44-debug-from-trace.md',
      ])
      expect(links[2]).toHaveAttribute('target', '_blank')
      expect(links[2]).toHaveAttribute('rel', 'noopener noreferrer')
      for (const link of links) {
        const mode = APPLICATION_DESIGNS[pack].feedback
        const selected = rules.flatMap(rule => rule.selectors.filter(selector =>
          selector.includes('[data-app-feedback-kind="notice"]')
          && selector.includes(`[data-app-feedback="${mode}"]`)
          && [...document.querySelectorAll(selector)].includes(link),
        ))
        expect(selected.length).toBeGreaterThan(0)
        expect(link).toHaveAttribute('data-app-part', 'feedback button')
        expect(link).toHaveAttribute('data-app-variant', 'ghost')
        expect(link.querySelector('[data-app-part="feedback-message"]')?.textContent?.length).toBeGreaterThan(0)
      }
    } finally {
      release()
    }
  })

  it('omits runbooks without a configured docs base', () => {
    render(<ErrorHelpLinks kind="server" />)
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/system-status', '/help'])
  })
})
