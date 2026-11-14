import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HTMLAttributes } from 'react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import postcss, { type Root } from 'postcss'
import tailwindcss from 'tailwindcss'
import loadConfig from 'tailwindcss/loadConfig'
import { cn } from '@/lib/cn'
import { WorkspaceScopeProvider } from '@/hooks/useWorkspaceScope'
import {
  getWorkspaceQuickRangePresets,
  getWorkspaceRouteScope,
  isWorkspaceRangePresetAvailable,
} from '@/lib/workspaceScope'
import { WorkspaceHeader } from './WorkspaceHeader'
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '../ui/app-designs/designs'

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
  it('marks existing context, discovery and control owners without changing their DOM order', () => {
    render(<WorkspaceHeader
      notifications={<button type="button">Notifications</button>}
      themeControl={<button type="button">Theme</button>}
    />)
    const header = screen.getByRole('banner', { name: 'Workspace command bar' })
    expect(header).toHaveAttribute('data-app-part', 'workspace-header')
    expect(Array.from(header.children).map(child => child.getAttribute('data-app-header-slot')))
      .toEqual(['context', 'discovery', 'controls'])
    expect(within(header).getAllByRole('button').map(button => button.textContent))
      .toEqual(['Search workspace', 'Analysis window', 'Notifications', 'Theme'])
    expect(within(header).getAllByTestId('workspace-vehicle-picker')).toHaveLength(1)
  })

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

describe('WorkspaceHeader route-specific scope corrections', () => {
  it.each([
    ['/notifications', false, false],
    ['/notifications/inbox', true, false],
    ['/notifications/archived', true, false],
    ['/notifications/rules', false, false],
    ['/notifications/channels', false, false],
    ['/power/dashboards', false, false],
    ['/power/dashboards/7', false, true],
    ['/power/sql', false, false],
    ['/power/grafana', false, true],
    ['/power-flow', true, false],
    ['/drives', true, true],
    ['/vehicles/42', false, true],
    ['/settings', false, false],
  ] as const)('keeps route %s range=%s vehicle=%s in the shared command plane', (path, range, vehicle) => {
    const scope = getWorkspaceRouteScope(path)
    expect(scope).toEqual({ range, vehicle })
    render(
      <WorkspaceScopeProvider scope={scope}>
        <WorkspaceHeader />
      </WorkspaceScopeProvider>,
    )

    const header = screen.getByRole('banner', { name: 'Workspace command bar' })
    expect(within(header).getByText('Analysis window').hasAttribute('hidden')).toBe(!range)
    expect(within(header).queryByTestId('workspace-vehicle-picker') !== null).toBe(vehicle)
    expect(within(header).getByRole('button', { name: 'Search workspace' })).toBeInTheDocument()
    expect(within(header).getByTestId('workspace-breadcrumbs')).toBeInTheDocument()
  })

  it.each(['/notifications', '/notifications/inbox', '/power/dashboards'])(
    'preserves normalized scope and standard quick presets for %s',
    (path) => {
      const scope = getWorkspaceRouteScope(path)
      for (const variant of [`${path}/`, `${path}?from=2026-10-01&to=2026-10-02`, `${path}#top`, path.slice(1)]) {
        expect(getWorkspaceRouteScope(variant), variant).toEqual(scope)
        expect(getWorkspaceQuickRangePresets(variant), variant).toEqual(['24h', '7d', '30d', '90d'])
        expect(isWorkspaceRangePresetAvailable(variant, '24h'), variant).toBe(true)
        expect(isWorkspaceRangePresetAvailable(variant, '1y'), variant).toBe(false)
      }
    },
  )
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

describe('application shell composition CSS contracts (not mounted browser geometry)', () => {
  const styles = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'shell.css'), 'utf8'))
  const familyRules = (attribute: string, value: string) => {
    const rules: import('postcss').Rule[] = []
    const token = `${attribute.replace('data-app-', '')}-${value}`
    styles.walkRules(rule => {
      if (rule.selector.includes(`[data-app-design-owner~="${token}"]`)) rules.push(rule)
    })
    return rules
  }
  const geometry = (rules: import('postcss').Rule[]) => {
    const values: string[] = []
    for (const rule of rules) rule.walkDecls(declaration => {
      if (/^(display|grid-template-|flex-|inline-size|block-size|min-block-size|padding-|gap|border-block)/.test(declaration.prop)) {
        values.push(`${declaration.prop}:${declaration.value}`)
      }
    })
    return values.sort().join(';')
  }

  it('covers every configured navigation/header/content family with distinct geometry rather than color-only changes', () => {
    const families = [
      ['data-app-navigation', 'navigation'],
      ['data-app-header', 'header'],
      ['data-app-content', 'content'],
    ] as const
    for (const [attribute, property] of families) {
      const modes = new Set(Object.values(APPLICATION_DESIGNS).map(design => design[property]))
      const signatures = [...modes].map(mode => {
        const rules = familyRules(attribute, mode)
        expect(rules.length, `${attribute}=${mode}`).toBeGreaterThan(0)
        const signature = geometry(rules)
        expect(signature, `${attribute}=${mode} has real layout declarations`).not.toBe('')
        return signature
      })
      expect(new Set(signatures).size, `${attribute} has distinct composition geometry`).toBe(modes.size)
    }
  })

  it('guards every final target with verified ownership without requiring native scope or CSS nesting', () => {
    styles.walkAtRules(rule => { expect(rule.name).not.toBe('scope') })
    styles.walkRules(rule => {
      expect(rule.selector).not.toContain('&')
      expect(rule.selector).not.toContain(':scope')
      for (const selector of rule.selectors) {
        expect(selector, 'ownership must be on the target, not an ancestor')
          .toMatch(/\[data-app-design-owner(?:~="[^"]+")?\]$/)
      }
      let owner: typeof rule.parent | Root['parent'] = rule.parent
      let screenGuard = false
      while (owner) {
        expect(owner.type).not.toBe('rule')
        if (owner.type === 'atrule' && owner.name === 'media' &&
          owner.params.includes('screen') && owner.params.includes('(forced-colors: none)')) screenGuard = true
        owner = owner.parent
      }
      expect(screenGuard, rule.selector).toBe(true)
    })
  })

  it('preserves source/tab order, all content, independent fonts/density and measured chart/grid ownership', () => {
    styles.walkDecls(declaration => {
      expect(declaration.prop).not.toBe('order')
      expect(declaration.prop).not.toMatch(/^(?:font-family|--font-(scale|family)|--density-)/)
      expect(`${declaration.prop}:${declaration.value}`).not.toMatch(
        /display:none|visibility:hidden|grid-auto-flow:.*dense|flex-direction:.*reverse/,
      )
      if (declaration.prop === 'grid-template-columns') {
        const selector = declaration.parent?.type === 'rule' ? declaration.parent.selector : ''
        expect(selector).not.toMatch(/data-app-part~="grid"|data-card-grid|data-metric-grid|data-flow-grid|data-chart|leaflet|recharts/)
      }
    })
    expect(styles.toString()).not.toMatch(/contain:\s*(size|strict)|content-visibility|overflow:\s*hidden|!important/)
  })

  it('changes desktop navigation only at the existing 1280px shell breakpoint and keeps the assistant dock alongside main', () => {
    for (const mode of ['rail', 'sidebar', 'top', 'hybrid']) {
      for (const rule of familyRules('data-app-navigation', mode)) {
        let parent: typeof rule.parent | Root['parent'] = rule.parent
        let desktop = false
        while (parent) {
          if (parent.type === 'atrule' && parent.name === 'media' && parent.params.includes('(min-width: 1280px)')) desktop = true
          parent = parent.parent
        }
        expect(desktop, mode).toBe(true)
        expect(rule.selector).toContain('[data-presentation-mode="standard"]')
      }
    }
    for (const mode of ['top', 'hybrid']) {
      expect(familyRules('data-app-navigation', mode).some(rule =>
        rule.toString().includes('#helix-dock-slot > [data-role="helix-side-panel"]'))).toBe(true)
    }
  })

  it('keeps owner rows shrinkable/wrapping while leaving arbitrary page workflows and caller spacing overrides intact', () => {
    const css = styles.toString()
    expect(css).toContain('[data-action-zone="commands"]')
    expect(css).toContain('flex-shrink: 1')
    expect(css).toContain('flex-wrap: wrap')
    expect(css).toContain('[data-app-part~="page"]:where(.space-y-3, .space-y-6)')
    expect(css).toContain('@container (min-width: 48rem)')
    expect(css).toContain('minmax(12rem, 1fr) minmax(0, 4fr)')
    expect(css).toContain('[data-presentation-mode="report"]')
    expect(css).toContain('[data-presentation-mode="kiosk"]')
    expect(css).toContain('(prefers-reduced-motion: reduce)')
    expect(css).not.toContain('grid-auto-flow')
  })

  it.each(Object.keys(APPLICATION_DESIGNS) as (keyof typeof APPLICATION_DESIGNS)[])(
    'keeps nested Quiet/Motorsport/Editorial rule matches unchanged under the live %s pack without native scope',
    async rootPack => {
      const root = document.documentElement
      const attributes = Object.keys(getAppDesignAttributes('classic'))
      const previous = attributes.map(name => [name, root.getAttribute(name)] as const)
      const fixture = document.createElement('div')
      const markup = `
        <div data-app-part="shell" data-presentation-mode="standard" data-fixture-target>
          <div class="sidenav-rail-column" data-fixture-target><span class="sidenav-short-label" data-fixture-target>Vehicles</span></div>
          <header data-app-part="workspace-header" data-fixture-target>
            <div data-app-header-slot="context" data-fixture-target>Context</div>
            <div data-app-header-slot="controls" data-fixture-target>Workspace controls</div>
          </header>
          <div data-app-part="page page-content" class="space-y-3">
            <header data-app-part="page-header" data-fixture-target>
              <div data-app-part="page-title" data-fixture-target>Evidence</div>
              <div data-app-part="page-actions" data-fixture-target><div data-action-zone="commands" data-fixture-target>Commands</div></div>
            </header>
            <div data-layout-reference data-app-part="page-content" data-fixture-target>
              <section data-app-part="section" data-fixture-target><header data-fixture-target><p data-fixture-target>Source description</p></header><div data-fixture-target>Retained data</div></section>
            </div>
          </div>
        </div>`
      const hosts = (['quiet', 'motorsport', 'editorial'] as const).map(pack => {
        const host = document.createElement('div')
        host.setAttribute('data-app-design-preview', '')
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value)
        host.innerHTML = markup
        return host
      })
      hosts[0].append(hosts[1])
      hosts[1].append(hosts[2])
      const neutral = document.createElement('div')
      neutral.setAttribute('data-app-design-preview', '')
      neutral.innerHTML = markup
      hosts[0].append(neutral)
      fixture.append(hosts[0])
      const matches = (host: HTMLElement) => {
        const shell = host.firstElementChild!
        const targets = [shell, ...shell.querySelectorAll('[data-fixture-target]')]
        return targets.map(target => {
          const declarations: string[] = []
          styles.walkRules(rule => {
            if (rule.selectors.some(selector => target.matches(selector))) {
              rule.walkDecls(declaration => {
                declarations.push(`${declaration.prop}:${declaration.value}`)
              })
            }
          })
          return declarations
        })
      }
      let release = () => {}
      try {
        for (const name of attributes) root.removeAttribute(name)
        document.body.append(fixture)
        release = observeAppDesignScopes(root)
        const expected = hosts.map(matches)
        for (const signature of expected) expect(signature.flat().length).toBeGreaterThan(0)
        expect(matches(neutral).flat()).toEqual([])

        for (const [name, value] of Object.entries(getAppDesignAttributes(rootPack))) root.setAttribute(name, value)
        await vi.waitFor(() => {
          expect(root.getAttribute('data-app-design-owner')).toContain(`pack-${rootPack}`)
        })
        expect(hosts.map(matches)).toEqual(expected)
        expect(matches(neutral).flat()).toEqual([])

        hosts[0].removeAttribute('data-app-header')
        await vi.waitFor(() => expect(hosts[0].firstElementChild).not.toHaveAttribute('data-app-design-owner'))
        expect(matches(hosts[0]).flat()).toEqual([])
        expect(matches(hosts[1])).toEqual(expected[1])
        expect(matches(hosts[2])).toEqual(expected[2])
      } finally {
        release()
        fixture.remove()
        for (const [name, value] of previous) {
          if (value === null) root.removeAttribute(name)
          else root.setAttribute(name, value)
        }
      }
    },
  )

  describe('conversation composition rule-matching contracts', () => {
    const modes = ['cards', 'editorial', 'workbench', 'canvas', 'ledger'] as const
    type ContentMode = typeof modes[number]
    const rules: import('postcss').Rule[] = []
    styles.walkRules(rule => {
      if (/data-app-part~="conversation(?:-|")/.test(rule.selector)) rules.push(rule)
    })
    const declarations = (target: Element) => {
      const entries: [string, string][] = []
      for (const rule of rules) {
        if (rule.selectors.some(selector => target.matches(selector))) {
          rule.walkDecls(declaration => { entries.push([declaration.prop, declaration.value]) })
        }
      }
      return Object.fromEntries(entries)
    }
    const profile = (mode: ContentMode) => {
      const entry = Object.entries(APPLICATION_DESIGNS).find(([, design]) => design.content === mode)
      if (!entry) throw new Error(`Missing ${mode} conversation profile`)
      return getAppDesignAttributes(entry[0] as keyof typeof APPLICATION_DESIGNS)
    }
    const mount = (mode: ContentMode | null) => {
      const host = document.createElement('div')
      host.setAttribute('data-app-design-preview', '')
      if (mode) {
        for (const [name, value] of Object.entries(profile(mode))) host.setAttribute(name, value)
      }
      host.innerHTML = `
        <section data-app-part="conversation-workspace" data-app-sessions-presentation="dock">
          <div data-app-part="conversation-layout" data-conversation-contract="layout">
            <div data-conversation-contract="dock-wrapper">
              <div data-app-part="panel conversation-sessions" role="complementary" data-conversation-contract="dock">
                <div data-app-part="list conversation-session-list" data-app-list="sessions">
                  <div data-app-part="list-row conversation-session" data-app-session-state="editing" data-conversation-contract="session">Session navigation</div>
                </div>
              </div>
            </div>
            <div data-app-part="panel conversation" data-conversation-contract="conversation">
              <div role="log" data-app-part="list conversation-log" data-app-list="conversation" aria-live="polite" aria-relevant="additions" data-conversation-contract="log">
                <div class="flex min-h-full flex-col items-center">
                  <div data-app-part="conversation-transcript" data-conversation-contract="transcript">
                    <div data-app-part="conversation-message" data-role="assistant" data-app-message-state="error" data-conversation-contract="message">
                      <div data-app-part="card conversation-bubble" data-app-card-kind="conversation" data-conversation-contract="bubble">
                        <div data-app-part="conversation-answer" data-conversation-contract="answer">
                          <div class="prose-chat" data-conversation-contract="prose">
                            <div role="group" data-app-part="panel" data-conversation-contract="code-panel"><pre data-conversation-contract="code"><code>unbroken_code_or_identifier</code></pre></div>
                          </div>
                          <div data-app-part="feedback conversation-outcome" role="status">Partial response retained</div>
                          <section data-app-part="conversation-sources" data-conversation-contract="sources">
                            <div data-app-part="list conversation-source-list" data-app-list="sources" data-conversation-contract="source-list">
                              <div data-app-part="list-row conversation-source" data-conversation-contract="source">Long retrieved documentation excerpt</div>
                            </div>
                          </section>
                        </div>
                        <p data-app-part="conversation-timestamp" data-conversation-contract="timestamp">12:34</p>
                        <div data-app-part="conversation-actions" data-conversation-contract="actions">Copy or regenerate</div>
                      </div>
                    </div>
                    <div data-app-part="conversation-message" data-role="user" data-app-revision-state="pending">
                      <div data-app-part="card conversation-bubble" data-app-card-kind="conversation">
                        <div data-app-part="field conversation-revision" data-conversation-contract="revision">Retained multiline revision</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <form data-app-part="conversation-composer" data-app-form-section data-app-composer-state="waiting" data-conversation-contract="composer">
                <div data-app-form-body data-conversation-contract="composer-body">
                  <div data-conversation-contract="draft">Editable next-turn draft</div>
                  <div data-app-part="conversation-composer-actions" data-conversation-contract="send">Send or stop</div>
                </div>
              </form>
            </div>
          </div>
        </section>`
      document.body.append(host)
      const targets = [...host.querySelectorAll('[data-conversation-contract]')]
      const release = observeAppDesignScopes(host)
      return {
        host,
        targets,
        get: (name: string) => {
          const target = host.querySelector<HTMLElement>(`[data-conversation-contract="${name}"]`)
          if (!target) throw new Error(`Missing conversation target ${name}`)
          return target
        },
        dispose: () => { release(); host.remove() },
      }
    }

    it.each(modes)('activates shrinkable scrolling and a persistent wrapping composer in %s without styling session DATA rows', mode => {
      const fixture = mount(mode)
      try {
        const get = (name: string) => declarations(fixture.get(name))
        expect(get('layout')).toMatchObject({ display: 'flex', 'min-inline-size': '0', 'min-block-size': '0' })
        expect(get('dock-wrapper')).toMatchObject({ 'min-inline-size': '0', 'max-inline-size': '40%' })
        expect(get('conversation')).toMatchObject({ 'flex-direction': 'column', flex: '1 1 0%', 'min-block-size': '0' })
        expect(get('log')).toMatchObject({ flex: '1 1 0%', 'min-inline-size': '0', 'min-block-size': '0', 'overflow-y': 'auto', 'overscroll-behavior': 'contain' })
        expect(get('composer')).toMatchObject({ flex: '0 0 auto', 'min-inline-size': '0' })
        expect(get('composer-body')).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'flex-end' })
        expect(get('draft')).toMatchObject({ flex: '1 1 12rem', 'min-inline-size': '0' })
        expect(get('send')).toMatchObject({ flex: '0 0 auto', 'max-inline-size': '100%', 'margin-inline-start': 'auto' })
        for (const name of ['source', 'source-list', 'code-panel', 'code']) {
          expect(get(name)).toMatchObject({ 'min-inline-size': '0', 'max-inline-size': '100%' })
        }
        expect(get('code')).toMatchObject({ 'overflow-x': 'auto' })
        expect(get('revision')).toMatchObject({ 'min-inline-size': '0', 'overflow-wrap': 'anywhere' })
        expect(get('session')).toEqual({})
        switch (mode) {
          case 'cards':
            expect(get('transcript')).toMatchObject({ 'max-inline-size': '56rem', gap: 'var(--density-gap)' })
            expect(get('bubble')).toMatchObject({ 'background-color': 'var(--app-conversation-surface, var(--surface-2))', 'padding-inline': 'var(--density-pad-x)' })
            break
          case 'editorial':
            expect(get('transcript')).toMatchObject({ 'max-inline-size': '72ch', gap: 'calc(var(--density-gap) * 1.5)' })
            expect(get('composer-body')).toMatchObject({ 'max-inline-size': '72ch' })
            break
          case 'workbench':
            expect(get('layout')).toMatchObject({ padding: 'var(--density-pad-y)', border: '1px solid var(--border-default)' })
            expect(get('dock')).toMatchObject({ 'border-inline-end': '2px solid var(--border-default)' })
            expect(get('transcript')).toMatchObject({ 'max-inline-size': 'none' })
            break
          case 'canvas':
            expect(get('transcript')).toMatchObject({ 'padding-inline': 'clamp(0.25rem, 1.5vw, var(--density-pad-x))', gap: 'calc(var(--density-gap) * 2)' })
            expect(get('composer')).toMatchObject({ margin: 'var(--density-gap)' })
            expect(get('composer-body')).toMatchObject({ 'max-inline-size': 'none' })
            break
          case 'ledger':
            expect(get('transcript')).toMatchObject({ gap: '0' })
            expect(get('message')).toMatchObject({ 'border-block-end': '1px solid var(--border-default)' })
            expect(get('bubble')).toMatchObject({ 'border-width': '0', 'border-radius': '0' })
            expect(get('timestamp')).toMatchObject({ 'font-variant-numeric': 'tabular-nums' })
            expect(get('actions')).toMatchObject({ opacity: '1' })
        }
      } finally {
        fixture.dispose()
      }
    })

    it('isolates all five nested content modes, neutral boundaries and live profile changes on actual final targets', async () => {
      const fixtures = modes.map(mount)
      const neutral = mount(null)
      try {
        const signatures = fixtures.map(fixture => fixture.targets.map(declarations))
        for (let index = 1; index < fixtures.length; index += 1) {
          fixtures[index - 1].get('answer').append(fixtures[index].host)
        }
        fixtures[0].get('answer').append(neutral.host)
        expect(fixtures.map(fixture => fixture.targets.map(declarations))).toEqual(signatures)
        expect(neutral.targets.every(target => Object.keys(declarations(target)).length === 0)).toBe(true)

        for (const [name, value] of Object.entries(profile('cards'))) fixtures[4].host.setAttribute(name, value)
        await vi.waitFor(() => expect(fixtures[4].get('bubble').getAttribute('data-app-design-owner')).toContain('content-cards'))
        expect(declarations(fixtures[4].get('bubble'))).toMatchObject({ border: '1px solid var(--border-default)', 'background-color': 'var(--app-conversation-surface, var(--surface-2))' })
        expect(declarations(fixtures[4].get('actions'))).not.toHaveProperty('opacity')

        fixtures[1].host.removeAttribute('data-app-header')
        await vi.waitFor(() => expect(fixtures[1].get('log')).not.toHaveAttribute('data-app-design-owner'))
        expect(fixtures[1].targets.every(target => Object.keys(declarations(target)).length === 0)).toBe(true)
        expect(fixtures[2].targets.map(declarations)).toEqual(signatures[2])
      } finally {
        for (const fixture of [...fixtures, neutral]) fixture.dispose()
      }
    })

    it('does not apply desktop dock framing or width constraints to a portaled mobile history panel', async () => {
      const fixture = mount('workbench')
      const drawerDock = document.createElement('div')
      drawerDock.setAttribute('data-app-part', 'panel conversation-sessions')
      fixture.host.append(drawerDock)
      try {
        await vi.waitFor(() => expect(drawerDock.getAttribute('data-app-design-owner')).toContain('content-workbench'))
        expect(declarations(drawerDock)).toEqual({ 'max-inline-size': '100%' })
        expect(declarations(fixture.get('dock'))).toHaveProperty('border-inline-end')
      } finally {
        fixture.dispose()
      }
    })

    it.each(['report', 'kiosk'])('leaves %s conversation rendering untouched even before owner tokens are removed', presentation => {
      const fixture = mount('ledger')
      try {
        fixture.host.setAttribute('data-presentation-mode', presentation)
        expect(fixture.get('log')).toHaveAttribute('data-app-design-owner')
        expect(fixture.targets.every(target => Object.keys(declarations(target)).length === 0)).toBe(true)
      } finally {
        fixture.dispose()
      }
    })

    it('leaves fixed viewport sizing, code whitespace, source order and overlay ownership to existing engines', () => {
      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) {
        rule.walkDecls(declaration => {
          expect(declaration.prop).not.toMatch(/^(?:height|max-height|block-size|max-block-size|position|order|grid-.+|columns|column-count|white-space)$/)
          expect(`${declaration.prop}:${declaration.value}`).not.toMatch(/display:none|visibility:hidden|flex-direction:.*reverse|overflow.*:hidden/)
        })
      }
    })
  })
})
