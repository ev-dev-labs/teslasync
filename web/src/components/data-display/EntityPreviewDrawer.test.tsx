import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { EntityPreviewDrawer } from './EntityPreviewDrawer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}))

describe('EntityPreviewDrawer', () => {
  it('renders evidence and continues to the full workflow', () => {
    const onClose = vi.fn()
    const onOpenDetails = vi.fn()

    render(
      <EntityPreviewDrawer
        open
        onClose={onClose}
        eyebrow="Drive preview"
        title="Home to Office"
        description="Completed drive"
        statusLabel="Completed"
        statusTone="success"
        fields={[
          { key: 'distance', label: 'Distance', value: '42 km' },
          { key: 'energy', label: 'Energy', value: '7.8 kWh' },
        ]}
        primaryAction={{
          label: 'Open drive details',
          onClick: onOpenDetails,
        }}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Home to Office' })).toBeInTheDocument()
    expect(screen.getByText('42 km')).toBeInTheDocument()
    expect(screen.getByText('7.8 kWh')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open drive details' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpenDetails).toHaveBeenCalledOnce()
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenDetails.mock.invocationCallOrder[0],
    )
  })

  it('closes after opening a related context link', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()

    render(
      <MemoryRouter>
        <EntityPreviewDrawer
          open
          onClose={onClose}
          eyebrow="Drive preview"
          title="Home to Office"
          fields={[]}
          relatedActions={[
            {
              key: 'telemetry',
              label: 'Telemetry evidence',
              to: '/signals?from=2026-08-20&to=2026-08-20',
              onNavigate,
            },
          ]}
        />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: 'Telemetry evidence' })
    expect(link).toHaveAttribute(
      'href',
      '/signals?from=2026-08-20&to=2026-08-20',
    )
    fireEvent.click(link)
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(onNavigate.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0],
    )
  })

  it('keeps long metadata, source details and actions reachable without truncation', () => {
    const label = 'Open the complete telemetry evidence and source history for this selected vehicle'
    const detail = 'Historical source: vehicle signal history\nLast successful refresh: 2026-10-07'
    render(
      <MemoryRouter>
        <EntityPreviewDrawer
          open
          onClose={vi.fn()}
          eyebrow="Selected vehicle preview"
          title="Long selected vehicle title"
          description="Preview metadata remains available"
          statusLabel="Stale retained historical evidence"
          statusTone="warning"
          fields={[
            { key: 'zero', label: 'Measured zero', value: 0, detail },
            { key: 'unknown', label: 'Unknown reading', value: null },
          ]}
          primaryAction={{ label, onClick: vi.fn() }}
          relatedActions={[{ key: 'history', label, to: '/signals', icon: <span>↗</span> }]}
        >
          <p>Source-owned retained preview body</p>
        </EntityPreviewDrawer>
      </MemoryRouter>,
    )

    expect(screen.getByText('Selected vehicle preview')).toBeInTheDocument()
    expect(screen.getByText('Preview metadata remains available')).toBeInTheDocument()
    expect(screen.getByText('Stale retained historical evidence')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('Unknown reading').closest('dt')?.nextElementSibling).toBeEmptyDOMElement()
    expect(screen.getByText(/Historical source:/)).toHaveTextContent(
      'Last successful refresh: 2026-10-07',
    )
    expect(screen.getByText(/Historical source:/)).toHaveClass('break-words', 'whitespace-pre-wrap')
    expect(screen.getByText('Source-owned retained preview body').closest('[data-drawer-body]')).not.toBeNull()
    const link = screen.getByRole('link', { name: `↗${label}` })
    expect(link).toHaveAttribute('href', '/signals')
    expect(link).toHaveClass('min-h-11', 'whitespace-normal', 'text-start')
    expect(screen.getByRole('button', { name: label })).toHaveClass('min-h-11', 'whitespace-normal')
    expect(screen.getByRole('button', { name: label }).closest('[data-drawer-footer]')).not.toBeNull()
  })

  it.each(['Loading source evidence', 'Stale retained evidence', 'Refresh error with retained evidence'])(
    'preserves source-owned body state: %s',
    (state) => {
      render(
        <EntityPreviewDrawer
          open
          onClose={vi.fn()}
          eyebrow="Source preview"
          title="Source evidence"
          fields={[]}
        >
          <p>{state}</p>
        </EntityPreviewDrawer>,
      )
      expect(screen.getByText(state)).toBeInTheDocument()
      expect(screen.getByText('Evidence')).toBeInTheDocument()
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    },
  )

  it('delegates focus, Escape, selection updates and close restoration to Drawer', () => {
    const onClose = vi.fn()
    const trigger = document.createElement('a')
    trigger.href = '#preview'
    trigger.textContent = 'Preview trigger'
    document.body.append(trigger)
    trigger.focus()
    const { rerender, unmount } = render(
      <EntityPreviewDrawer open onClose={onClose} eyebrow="Drive preview" title="First selection" fields={[]} />,
    )
    const close = screen.getAllByRole('button', { name: 'Close' })[0]
    expect(close).toHaveFocus()
    rerender(
      <EntityPreviewDrawer open onClose={onClose} eyebrow="Drive preview" title="Second selection" fields={[]} />,
    )
    expect(screen.getByRole('dialog', { name: 'Second selection' })).toBeInTheDocument()
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    rerender(
      <EntityPreviewDrawer open={false} onClose={onClose} eyebrow="Drive preview" title="Second selection" fields={[]} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    unmount()
    trigger.remove()
  })
})
