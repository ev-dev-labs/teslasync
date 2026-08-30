import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HTMLAttributes } from 'react'
import { WorkspaceHeader } from './WorkspaceHeader'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}))

vi.mock('@/components/ui/runtime', () => ({
  Caption: ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
  CommandPaletteTrigger: () => <button type="button">Search workspace</button>,
}))

vi.mock('./LayoutBreadcrumbs', () => ({
  LayoutBreadcrumbs: ({ variant }: { variant?: string }) => (
    <div data-testid="workspace-breadcrumbs" data-variant={variant} />
  ),
}))

vi.mock('./VehiclePicker', () => ({
  VehiclePicker: ({ className }: { className?: string }) => (
    <div data-testid="workspace-vehicle-picker" className={className} />
  ),
}))

vi.mock('./WorkspaceContextControl', () => ({
  WorkspaceContextControl: ({ className }: { className?: string }) => (
    <button type="button" className={className}>
      Analysis window
    </button>
  ),
}))

describe('WorkspaceHeader', () => {
  it('groups context, discovery, vehicle scope, and utilities in one desktop command plane', () => {
    render(
      <WorkspaceHeader
        notifications={<button type="button">Notifications</button>}
        themeControl={<button type="button">Theme</button>}
      />,
    )

    const header = screen.getByRole('banner', { name: 'Workspace command bar' })
    expect(header).toHaveClass(
      'hidden',
      'xl:grid',
      'grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)_minmax(0,1fr)]',
    )
    expect(header).toHaveAttribute('data-layout', 'balanced-three-track')
    expect(within(header).getByText('Fleet operations')).toBeInTheDocument()
    expect(within(header).getByTestId('workspace-breadcrumbs')).toHaveAttribute(
      'data-variant',
      'workspace',
    )
    expect(within(header).getByRole('button', { name: 'Search workspace' })).toBeInTheDocument()
    const rangeControl = within(header).getByRole('button', {
      name: 'Analysis window',
    })
    expect(rangeControl).toHaveClass('max-w-32')
    expect(rangeControl.getAttribute('class')).not.toContain('[&>span]:hidden')
    expect(within(header).getByTestId('workspace-vehicle-picker')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Theme' })).toBeInTheDocument()
  })
})
