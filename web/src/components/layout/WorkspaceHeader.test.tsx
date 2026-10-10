import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HTMLAttributes } from 'react'
import { resolve } from 'node:path'
import postcss, { type Root } from 'postcss'
import tailwindcss from 'tailwindcss'
import loadConfig from 'tailwindcss/loadConfig'
import { cn } from '@/lib/cn'
import { WorkspaceScopeProvider } from '@/hooks/useWorkspaceScope'
import { WorkspaceHeader } from './WorkspaceHeader'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}))

vi.mock('../ui/Typography', () => ({
  Caption: ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
}))

vi.mock('../ui/CommandPaletteTrigger', () => ({
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
  WorkspaceContextControl: ({ className, hidden }: { className?: string; hidden?: boolean }) => (
    <button type="button" className={className} hidden={hidden}>
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
      'grid-cols-workspace-header',
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

  it('lets the caption primitive own restrained context typography without changing header geometry', () => {
    render(<WorkspaceHeader />)

    const header = screen.getByRole('banner', { name: 'Workspace command bar' })
    const caption = within(header).getByText('Fleet operations')
    expect(caption).toHaveClass('mb-1', 'hidden', '3xl:block')
    expect(caption).not.toHaveClass('font-semibold', 'tracking-[0.1em]')
    expect(header).toHaveClass('h-workspace-header', 'gap-4', 'px-4', '2xl:px-6')
    expect(within(header).getAllByTestId('workspace-vehicle-picker')).toHaveLength(1)
    expect(within(header).getAllByRole('button', { name: 'Analysis window' })).toHaveLength(1)
  })

  it.each([
    { range: true, vehicle: true },
    { range: true, vehicle: false },
    { range: false, vehicle: true },
    { range: false, vehicle: false },
  ])('preserves managed workspace ownership for range=$range vehicle=$vehicle', (scope) => {
    render(
      <WorkspaceScopeProvider scope={scope}>
        <WorkspaceHeader
          notifications={<button type="button">Notifications</button>}
          themeControl={<button type="button">Theme</button>}
        />
      </WorkspaceScopeProvider>,
    )

    const header = screen.getByRole('banner', { name: 'Workspace command bar' })
    const rangeControl = within(header).getByText('Analysis window')
    expect(rangeControl.hasAttribute('hidden')).toBe(!scope.range)
    expect(within(header).queryByTestId('workspace-vehicle-picker') !== null).toBe(scope.vehicle)
    expect(within(header).getByRole('button', { name: 'Search workspace' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Theme' })).toBeInTheDocument()
  })
})

describe('WorkspaceHeader exact geometry naming', () => {
  const roles = [
    ['h-workspace-header', 'h-[4.5rem]', 'height', '4.5rem', ['h-16', 'h-[5rem]']],
    ['grid-cols-workspace-header', 'grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)_minmax(0,1fr)]',
      'grid-template-columns', 'minmax(0,1fr) minmax(18rem,22rem) minmax(0,1fr)',
      ['grid-cols-3', 'grid-cols-[1fr_2fr]']],
  ] as const
  const contexts = {
    '': [],
    'sm:': ['@media (min-width: 640px)'],
    'xl:': ['@media (min-width: 1280px)'],
    '@[26rem]/workspace:': ['@container workspace (min-width: 26rem)'],
    'motion-reduce:': ['@media (prefers-reduced-motion: reduce)'],
    'forced-colors:': ['@media (forced-colors: active)'],
  }

  it('retains both-order caller precedence and distinct responsive/container properties', () => {
    for (const variant of Object.keys(contexts)) {
      for (const [named, arbitrary, , , callers] of roles) {
        for (const caller of [arbitrary, ...callers]) {
          expect(cn(`${variant}${named}`, `${variant}${caller}`)).toBe(`${variant}${caller}`)
          expect(cn(`${variant}${caller}`, `${variant}${named}`)).toBe(`${variant}${named}`)
        }
        if (variant) {
          expect(cn(named, `${variant}${named}`)).toBe(`${named} ${variant}${named}`)
          expect(cn(`${variant}${named}`, named)).toBe(`${variant}${named} ${named}`)
        }
      }
      const distinct = roles.map(([named]) => `${variant}${named}`).join(' ')
      expect(cn(distinct)).toBe(distinct)
      expect(cn(distinct.split(' ').reverse().join(' '))).toBe(distinct.split(' ').reverse().join(' '))
    }
  })

  it('generates only the original declarations with identical media, container and importance', async () => {
    const config = loadConfig(resolve('tailwind.config.js'))
    const classes = Object.keys(contexts).flatMap(variant =>
      roles.flatMap(([named, arbitrary]) => [named, arbitrary].map(value => `${variant}${value}`)))
    const root = (await postcss([tailwindcss({
      ...config, content: [{ raw: classes.join(' '), extension: 'html' }],
    })]).process('@tailwind utilities;', { from: undefined })).root
    console.log('RAW WorkspaceHeader old/new generated CSS\n' + root.toString())

    function signature(className: string) {
      const matches: { declarations: [string, string, boolean][]; context: string[] }[] = []
      root.walkRules(rule => {
        const selector = rule.selector
          .replace(/\\([\da-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
          .replace(/\\(.)/g, '$1')
        if (selector !== `.${className}`) return
        const declarations: [string, string, boolean][] = []
        rule.walkDecls(decl => { declarations.push([decl.prop, decl.value, Boolean(decl.important)]) })
        const context: string[] = []
        let parent: typeof rule.parent | Root['parent'] = rule.parent
        while (parent) {
          if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`)
          parent = parent.parent
        }
        matches.push({ declarations, context })
      })
      expect(matches, className).toHaveLength(1)
      return matches[0]
    }

    for (const [variant, context] of Object.entries(contexts)) {
      for (const [named, arbitrary, property, value] of roles) {
        const expected = { declarations: [[property, value, false]], context }
        expect(signature(`${variant}${arbitrary}`)).toEqual(expected)
        expect(signature(`${variant}${named}`)).toEqual(expected)
      }
    }
  })

  it('keeps native discovery and utility focus targets in their original order', () => {
    render(<WorkspaceHeader
      notifications={<button type="button">Notifications</button>}
      themeControl={<button type="button">Theme</button>}
    />)
    const header = screen.getByRole('banner', { name: 'Workspace command bar' })
    const buttons = within(header).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([
      'Search workspace', 'Analysis window', 'Notifications', 'Theme',
    ])
    for (const button of buttons) {
      button.focus()
      expect(button).toHaveFocus()
    }
    expect(header.querySelector('[data-role="workspace-search"]')).toHaveClass(
      'w-full', 'min-w-0', 'justify-self-center',
    )
  })
})
