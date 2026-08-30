import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import '@/i18n'

import { ErrorHelpLinks } from '../ErrorHelpLinks'
import { PermissionGuidanceNotice } from '../PermissionGuidanceNotice'
import { DemoModeBanner } from '../DemoModeBanner'
import { ApiError } from '@/lib/resilience'

function renderIn(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

/** HELP-05 */
describe('ErrorHelpLinks', () => {
  it('renders nothing without an error or kind', () => {
    const { container } = renderIn(<ErrorHelpLinks />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers status and diagnostics destinations for a dependency failure', () => {
    renderIn(<ErrorHelpLinks error={new ApiError('down', 503)} />)
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', '/system-status')
  })

  it('gives every destination a reason, not just a label', () => {
    renderIn(<ErrorHelpLinks kind="unavailable" />)
    expect(screen.getByText(/already known to be degraded/i)).toBeInTheDocument()
  })

  it('routes a permission failure to access guidance and the audit log', () => {
    renderIn(<ErrorHelpLinks error={new ApiError('nope', 403)} />)
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/help')
    expect(hrefs).toContain('/admin/audit-log')
  })

  it('renders no external runbook link when no docs base URL is configured', () => {
    renderIn(<ErrorHelpLinks kind="server" />)
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('target', '_blank')
    }
  })

  it('accepts a custom heading and can render bare', () => {
    const { rerender } = renderIn(<ErrorHelpLinks kind="network" title="Try these" />)
    expect(screen.getByText('Try these')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <ErrorHelpLinks kind="network" title={null} />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/where to look next/i)).not.toBeInTheDocument()
  })
})

/** HELP-10 */
describe('PermissionGuidanceNotice', () => {
  it('renders nothing when the evidence shows no access block', () => {
    const { container } = renderIn(<PermissionGuidanceNotice evidence={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('explains a 403 without blaming the user and names who grants access', () => {
    renderIn(<PermissionGuidanceNotice evidence={{ error: new ApiError('nope', 403) }} />)
    expect(screen.getByText(/not entitled to this/i)).toBeInTheDocument()
    expect(screen.getByText(/who can grant this/i)).toBeInTheDocument()
    expect(screen.getByText(/administrator of this TeslaSync install/i)).toBeInTheDocument()
  })

  it('renders the request-access steps as an ordered procedure', () => {
    renderIn(<PermissionGuidanceNotice kind="forbidden" />)
    const list = screen.getByRole('list')
    expect(list.tagName).toBe('OL')
    expect(list.querySelectorAll('li').length).toBeGreaterThan(1)
  })

  it('drops the steps in compact mode but keeps the explanation', () => {
    renderIn(<PermissionGuidanceNotice kind="forbidden" compact />)
    expect(screen.getByText(/not entitled to this/i)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('tags the block kind for auditing', () => {
    renderIn(<PermissionGuidanceNotice kind="open_mode" />)
    expect(screen.getByTestId('permission-guidance')).toHaveAttribute(
      'data-access-block',
      'open_mode',
    )
  })

  it('exposes one canonical next step', () => {
    renderIn(<PermissionGuidanceNotice kind="read_only" />)
    expect(screen.getByTestId('permission-guidance-action')).toHaveAttribute(
      'href',
      '/system-status',
    )
  })
})

/** HELP-12 */
describe('DemoModeBanner', () => {
  it('renders nothing by default — demo mode is never on unless configured', () => {
    const { container } = renderIn(<DemoModeBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an unmistakable, non-dismissible label when enabled', () => {
    renderIn(<DemoModeBanner enabled />)
    const banner = screen.getByTestId('demo-mode-banner')
    expect(banner).toHaveTextContent(/demo data/i)
    expect(banner).toHaveTextContent(/not your vehicle/i)
    // No dismiss affordance: a dismissed warning is an absent warning.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('announces itself to assistive tech', () => {
    renderIn(<DemoModeBanner enabled />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })
})
