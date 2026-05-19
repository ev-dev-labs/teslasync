/**
 * a11y smoke tests for the most-used UI primitives.
 *
 * These are intentionally tiny — we just render each primitive in a
 * representative shape and assert axe finds zero violations. The goal
 * is a tripwire: any contributor who later introduces an a11y
 * regression in one of these primitives (missing label, role mismatch,
 * heading skip, list semantics broken) will see CI fail with a
 * specific axe-rule pointer.
 *
 * Add a new entry here any time a primitive ships that is used on
 * 10+ pages.
 */

import { describe, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { EmptyState } from '@/components/feedback/EmptyState'

import { expectNoA11yViolations } from '@/test-utils/a11y'

describe('a11y :: shared primitives', () => {
  it('Button passes WCAG 2.1 AA', async () => {
    const { container } = render(<Button>Save changes</Button>)
    await expectNoA11yViolations(container)
  })

  it('Button with icon uses aria-label', async () => {
    const { container } = render(
      <Button aria-label="Close dialog">
        <span aria-hidden="true">×</span>
      </Button>,
    )
    await expectNoA11yViolations(container)
  })

  it('Badge passes WCAG 2.1 AA', async () => {
    const { container } = render(<Badge>Online</Badge>)
    await expectNoA11yViolations(container)
  })

  it('GlassPanel passes WCAG 2.1 AA', async () => {
    const { container } = render(
      <GlassPanel>
        <h2>Section title</h2>
        <p>Section content lives here for the panel a11y check.</p>
      </GlassPanel>,
    )
    await expectNoA11yViolations(container)
  })

  it('EmptyState passes WCAG 2.1 AA', async () => {
    const { container } = render(
      <MemoryRouter>
        <EmptyState
          title="No data yet"
          message="Connect your Tesla to start collecting data."
        />
      </MemoryRouter>,
    )
    await expectNoA11yViolations(container)
  })
})
