import { describe, it, expect } from 'vitest'
import { cn } from './cn'
import { typography } from './tokens'
import { resolve } from 'node:path'
import postcss, { type Root } from 'postcss'
import tailwindcss from 'tailwindcss'
import loadConfig from 'tailwindcss/loadConfig'
import resolveConfig from 'tailwindcss/resolveConfig'
import { createHash } from 'node:crypto'

// `cn` is the app-wide className composer (clsx for conditional composition +
// tailwind-merge for last-wins conflict resolution). It is used in hundreds of
// components, so its two guarantees — (1) faithful clsx composition of
// strings/arrays/objects with falsy pruning, and (2) tailwind-merge conflict
// resolution where the *last* conflicting utility wins — are load-bearing.
// A regression here silently corrupts styling across the entire SPA.

/** Split a className string into an order-independent set of tokens. */
function tokens(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean))
}

const remainingGeometry = [
  ['zIndex', 'presentation-controls', 'z', '9999', 'z-[9999]', 'z-50', 'z-[9000]'],
  ['zIndex', 'presentation-dimmer', 'z', '9998', 'z-[9998]', 'z-50', 'z-[9000]'],
  ['zIndex', 'presentation-cursor', 'z', '9997', 'z-[9997]', 'z-50', 'z-[9000]'],
  ['zIndex', 'map-tile-control', 'z', '800', 'z-[800]', 'z-50', 'z-[9000]'],
  ['width', 'alerts-preview', 'w', 'min(92vw, 380px)', 'w-[min(92vw,380px)]', 'w-80', 'w-[400px]'],
  ['width', 'recent-pages', 'w', 'min(92vw, 360px)', 'w-[min(92vw,360px)]', 'w-full', 'w-[400px]'],
  ['maxWidth', 'background-summary', 'max-w', '180px', 'max-w-[180px]', 'max-w-sm', 'max-w-[300px]'],
  ['maxWidth', 'active-vehicle-label', 'max-w', '160px', 'max-w-[160px]', 'max-w-none', 'max-w-[300px]'],
  ['maxWidth', 'active-vehicle-compact-label', 'max-w', '140px', 'max-w-[140px]', 'max-w-sm', 'max-w-[300px]'],
  ['maxHeight', 'alerts-preview', 'max-h', '320px', 'max-h-[320px]', 'max-h-full', 'max-h-[500px]'],
  ['maxHeight', 'status-options', 'max-h', '280px', 'max-h-[280px]', 'max-h-80', 'max-h-[500px]'],
  ['maxHeight', 'table-filter-viewport', 'max-h', 'calc(100dvh - 2rem)', 'max-h-[calc(100dvh-2rem)]', 'max-h-full', 'max-h-[500px]'],
  ['minWidth', 'background-work', 'min-w', '260px', 'min-w-[260px]', 'min-w-0', 'min-w-[300px]'],
  ['minWidth', 'vehicle-options', 'min-w', '220px', 'min-w-[220px]', 'min-w-full', 'min-w-[300px]'],
  ['height', 'vehicle-grid', 'h', 'min(72vh, 56rem)', 'h-[min(72vh,56rem)]', 'h-full', 'h-[500px]'],
  ['minHeight', 'vehicle-grid', 'min-h', '28rem', 'min-h-[28rem]', 'min-h-0', 'min-h-[500px]'],
  ['gridTemplateColumns', 'replay-shortcuts', 'grid-cols', 'auto 1fr', 'grid-cols-[auto_1fr]', 'grid-cols-2', 'grid-cols-[1fr_2fr]'],
  ['gridTemplateColumns', 'page-actions-scope', 'grid-cols', 'minmax(0,1fr) auto', 'grid-cols-[minmax(0,1fr)_auto]', 'grid-cols-1', 'grid-cols-[1fr_2fr]'],
  ['flex', 'replay-scrubber', 'flex', '1 1 12rem', 'flex-[1_1_12rem]', 'flex-auto', 'flex-[2_2_10rem]'],
] as const

describe('cn — remaining nineteen geometry roles (MDC-043)', () => {
  const variants = ['', 'sm:', 'md:', 'xl:'] as const

  it('adds only nineteen collision-free entries to the complete accepted first-ten config', () => {
    const config = loadConfig(resolve('tailwind.config.js'))
    const prior = {
      ...config,
      theme: {
        ...config.theme,
        extend: {
          ...config.theme?.extend,
          zIndex: { ...config.theme?.extend?.zIndex },
          width: { ...config.theme?.extend?.width },
          maxWidth: { ...config.theme?.extend?.maxWidth },
          maxHeight: { ...config.theme?.extend?.maxHeight },
          minWidth: { ...config.theme?.extend?.minWidth },
          height: { ...config.theme?.extend?.height },
          minHeight: { ...config.theme?.extend?.minHeight },
          gridTemplateColumns: { ...config.theme?.extend?.gridTemplateColumns },
          flex: { ...config.theme?.extend?.flex },
        },
      },
    }
    for (const [group, name] of remainingGeometry) Reflect.deleteProperty(prior.theme.extend[group], name)
    const previous = resolveConfig(prior)
    const current = resolveConfig(config)
    const canonical = JSON.stringify(previous, (_, value: unknown) => {
      if (typeof value === 'function') return value.toString()
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entries = value as Record<string, unknown>
        return Object.fromEntries(Object.keys(entries).sort().map(key => [key, entries[key]]))
      }
      return value
    })
    expect(createHash('sha256').update(canonical).digest('hex'))
      .toBe('d0b5729843e62f070d56280b9e89f3df0e128c463ac1c38057945676aa14d1ad')
    const expected = {
      ...previous,
      theme: {
        ...previous.theme,
        zIndex: { ...previous.theme.zIndex },
        width: { ...previous.theme.width },
        maxWidth: { ...previous.theme.maxWidth },
        maxHeight: { ...previous.theme.maxHeight },
        minWidth: { ...previous.theme.minWidth },
        height: { ...previous.theme.height },
        minHeight: { ...previous.theme.minHeight },
        gridTemplateColumns: { ...previous.theme.gridTemplateColumns },
        flex: { ...previous.theme.flex },
      },
    }
    for (const [group, name, , value] of remainingGeometry) {
      expect(previous.theme[group]).not.toHaveProperty(name)
      expect(current.theme[group]).toHaveProperty(name, value)
      Reflect.set(expected.theme[group], name, value)
    }
    expect(current).toEqual(expected)
  })

  for (const [, name, prefix, , arbitrary, ordinary, alternate] of remainingGeometry) {
    const named = `${prefix}-${name}`
    for (const alternative of [arbitrary, ordinary, alternate]) {
      it.each(variants)(`${named} and ${alternative} resolve both caller orders for %s`, (variant) => {
        expect(cn(`${variant}${named}`, `${variant}${alternative}`)).toBe(`${variant}${alternative}`)
        expect(cn(`${variant}${alternative}`, `${variant}${named}`)).toBe(`${variant}${named}`)
        expect(cn([`${variant}${named}`, false], { [`${variant}${alternative}`]: true }))
          .toBe(`${variant}${alternative}`)
      })
    }
  }

  it('keeps different properties, variants, accepted tokens and outline semantics independent', () => {
    const independent = [
      'z-presentation-controls', 'sm:z-presentation-dimmer', 'md:z-presentation-cursor', 'xl:z-map-tile-control',
      'w-alerts-preview', 'max-w-background-summary', 'min-w-background-work',
      'h-vehicle-grid', 'max-h-status-options', 'min-h-vehicle-grid',
      'grid-cols-replay-shortcuts', 'sm:grid-cols-page-actions-scope', 'flex-replay-scrubber',
      'xl:w-theme-switcher', 'sm:max-w-shell-panel-viewport', 'md:max-h-workspace-context',
      'outline', 'outline-2', 'outline-offset-2', 'outline-[var(--focus-ring)]',
      'rounded-panel', 'shadow-e1', 'duration-fast', 'text-size-inherit', 'text-inherit',
    ]
    expect(tokens(cn(independent))).toEqual(new Set(independent))
    expect(tokens(cn([...independent].reverse()))).toEqual(new Set(independent))
    for (const left of remainingGeometry) {
      for (const right of remainingGeometry) {
        if (left === right || left[2] !== right[2]) continue
        const a = `${left[2]}-${left[1]}`
        const b = `${right[2]}-${right[1]}`
        expect(cn(a, b)).toBe(b)
        expect(cn(b, a)).toBe(a)
      }
    }
  })

  it('generates identical CSS for all 24 source assignments and matching responsive contexts', async () => {
    const contexts = [
      ...remainingGeometry,
      remainingGeometry[0], remainingGeometry[0], remainingGeometry[0],
      remainingGeometry[10],
      ['maxWidth', 'shell-panel-viewport', 'max-w', 'calc(100vw - 1rem)', 'max-w-[calc(100vw-1rem)]'],
    ] as const
    expect(remainingGeometry).toHaveLength(19)
    expect(contexts).toHaveLength(24)
    const config = loadConfig(resolve('tailwind.config.js'))
    const classes = variants.flatMap((variant) => [
      ...contexts.flatMap(([, name, prefix, , arbitrary]) =>
        [`${variant}${prefix}-${name}`, `${variant}${arbitrary}`]),
      ...remainingGeometry.flatMap(([, , , , , ordinary, alternate]) =>
        [`${variant}${ordinary}`, `${variant}${alternate}`]),
    ])
    const css = (await postcss([tailwindcss({
      ...config, content: [{ raw: classes.join(' '), extension: 'html' }],
    })]).process('@tailwind utilities;', { from: undefined })).root
    console.log('RAW GENERATED CSS: remaining19 + reused cap; 24 assignments x base/sm/md/xl\n' + css.toString())
    function signature(className: string) {
      const matches: { declarations: [string, string, boolean][]; media: string[] }[] = []
      css.walkRules((rule) => {
        const selector = rule.selector
          .replace(/\\([\da-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
          .replace(/\\(.)/g, '$1')
        if (selector !== `.${className}`) return
        const declarations: [string, string, boolean][] = []
        rule.walkDecls((decl) => { declarations.push([decl.prop, decl.value, Boolean(decl.important)]) })
        const media: string[] = []
        let parent: typeof rule.parent | Root['parent'] = rule.parent
        while (parent) {
          if (parent.type === 'atrule') media.unshift(`@${parent.name} ${parent.params}`)
          parent = parent.parent
        }
        matches.push({ declarations, media })
      })
      expect(matches, className).toHaveLength(1)
      return matches[0]
    }
    const properties = {
      z: 'z-index', w: 'width', 'max-w': 'max-width', 'min-w': 'min-width',
      h: 'height', 'max-h': 'max-height', 'min-h': 'min-height',
      'grid-cols': 'grid-template-columns', flex: 'flex',
    }
    const screens = { '': [], 'sm:': ['@media (min-width: 640px)'], 'md:': ['@media (min-width: 768px)'], 'xl:': ['@media (min-width: 1280px)'] }
    for (const variant of variants) {
      for (const [, name, prefix, value, arbitrary] of contexts) {
        const named = signature(`${variant}${prefix}-${name}`)
        expect(named).toEqual(signature(`${variant}${arbitrary}`))
        expect(named).toEqual({ declarations: [[properties[prefix], value, false]], media: screens[variant] })
      }
      for (const [, name, prefix, , arbitrary, ordinary, alternate] of remainingGeometry) {
        const named = `${variant}${prefix}-${name}`
        for (const alternative of [arbitrary, ordinary, alternate]) {
          const caller = `${variant}${alternative}`
          expect(signature(cn(named, caller))).toEqual(signature(caller))
          expect(signature(cn(caller, named))).toEqual(signature(named))
        }
      }
    }
    expect(signature('sm:grid-cols-page-actions-scope').media).toEqual(screens['sm:'])
    expect(signature('h-vehicle-grid').declarations).toEqual([['height', 'min(72vh, 56rem)', false]])
    expect(signature('min-h-vehicle-grid').declarations).toEqual([['min-height', '28rem', false]])
  })
})

describe('cn — approved shell overlay geometry (MDC-043)', () => {
  const roles = [
    ['zIndex', 'shell-panel', 'z', '80', 'z-[80]', ['z-10', 'z-[90]', 'z-map-control']],
    ['zIndex', 'map-control', 'z', '1000', 'z-[1000]', ['z-50', 'z-[999]', 'z-shell-panel']],
    ['width', 'theme-switcher', 'w', '22rem', 'w-[22rem]', ['w-80', 'w-full', 'w-[50vw]', 'w-workspace-context']],
    ['width', 'connection-diagnostics', 'w', 'min(92vw, 320px)', 'w-[min(92vw,320px)]', ['w-80', 'w-full', 'w-[400px]', 'w-theme-switcher']],
    ['width', 'presentation-menu', 'w', 'min(92vw, 340px)', 'w-[min(92vw,340px)]', ['w-80', 'w-full', 'w-[400px]', 'w-connection-diagnostics']],
    ['width', 'workspace-context', 'w', 'min(92vw, 27rem)', 'w-[min(92vw,27rem)]', ['w-80', 'w-full', 'w-[400px]', 'w-presentation-menu']],
    ['maxWidth', 'shell-panel-viewport', 'max-w', 'calc(100vw - 1rem)', 'max-w-[calc(100vw-1rem)]', ['max-w-sm', 'max-w-none', 'max-w-[500px]', 'max-w-breadcrumb-label']],
    ['maxWidth', 'breadcrumb-label', 'max-w', '200px', 'max-w-[200px]', ['max-w-sm', 'max-w-none', 'max-w-[300px]', 'max-w-shell-panel-viewport']],
    ['maxHeight', 'notification-panel', 'max-h', 'calc(100vh - 6rem)', 'max-h-[calc(100vh-6rem)]', ['max-h-80', 'max-h-full', 'max-h-[500px]', 'max-h-workspace-context']],
    ['maxHeight', 'workspace-context', 'max-h', 'min(80vh, 38rem)', 'max-h-[min(80vh,38rem)]', ['max-h-80', 'max-h-full', 'max-h-[500px]', 'max-h-notification-panel']],
  ] as const
  const variants = ['', 'sm:', 'md:', 'xl:'] as const

  it('adds exactly ten collision-free roles without changing previous resolved config or plugins', () => {
    const config = loadConfig(resolve('tailwind.config.js'))
    const prior = {
      ...config,
      theme: {
        ...config.theme,
        extend: {
          ...config.theme?.extend,
          zIndex: { ...config.theme?.extend?.zIndex },
          width: { ...config.theme?.extend?.width },
          maxWidth: { ...config.theme?.extend?.maxWidth },
          maxHeight: { ...config.theme?.extend?.maxHeight },
          minWidth: { ...config.theme?.extend?.minWidth },
          height: { ...config.theme?.extend?.height },
          minHeight: { ...config.theme?.extend?.minHeight },
          gridTemplateColumns: { ...config.theme?.extend?.gridTemplateColumns },
          flex: { ...config.theme?.extend?.flex },
        },
      },
    }
    for (const [group, name] of [...roles, ...remainingGeometry]) {
      Reflect.deleteProperty(prior.theme?.extend?.[group] ?? {}, name)
    }
    const previous = resolveConfig(prior)
    const current = resolveConfig(config)
    const canonical = JSON.stringify(previous, (_, value: unknown) => {
      if (typeof value === 'function') return value.toString()
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entries = value as Record<string, unknown>
        return Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]))
      }
      return value
    })
    expect(createHash('sha256').update(canonical).digest('hex'))
      .toBe('6429653abd11b06c328e4abe19051203bf9727eaf153ecbfc13a700508408d85')
    const expected = {
      ...previous,
      theme: {
        ...previous.theme,
        zIndex: { ...previous.theme.zIndex },
        width: { ...previous.theme.width },
        maxWidth: { ...previous.theme.maxWidth },
        maxHeight: { ...previous.theme.maxHeight },
        minWidth: { ...previous.theme.minWidth },
        height: { ...previous.theme.height },
        minHeight: { ...previous.theme.minHeight },
        gridTemplateColumns: { ...previous.theme.gridTemplateColumns },
        flex: { ...previous.theme.flex },
      },
    }
    for (const [group, name, , value] of [...roles, ...remainingGeometry]) {
      expect(previous.theme[group]).not.toHaveProperty(name)
      expect(current.theme[group]).toHaveProperty(name, value)
      Reflect.set(expected.theme[group], name, value)
    }
    expect(current).toEqual(expected)
  })

  for (const [, name, prefix, , arbitrary, alternatives] of roles) {
    const named = `${prefix}-${name}`
    for (const alternative of [arbitrary, ...alternatives]) {
      it.each(variants)(`${named} and ${alternative} honor both orders with variant %s`, (variant) => {
        expect(cn(`${variant}${named}`, `${variant}${alternative}`)).toBe(`${variant}${alternative}`)
        expect(cn(`${variant}${alternative}`, `${variant}${named}`)).toBe(`${variant}${named}`)
        expect(cn([`${variant}${named}`, false], { [`${variant}${alternative}`]: true }))
          .toBe(`${variant}${alternative}`)
      })
    }
  }

  it('preserves independent properties, variant scopes and existing outline/geometry tokens in both orders', () => {
    const classes = [
      'z-shell-panel', 'sm:z-map-control', 'md:z-[1000]', 'xl:z-50',
      'w-theme-switcher', 'sm:w-connection-diagnostics', 'md:w-presentation-menu', 'xl:w-workspace-context',
      'max-w-shell-panel-viewport', 'sm:max-w-breadcrumb-label', 'md:max-w-side-panel-viewport', 'xl:max-w-sm',
      'max-h-notification-panel', 'sm:max-h-workspace-context', 'md:max-h-[500px]', 'xl:max-h-80',
      'min-h-side-panel-header', 'min-w-0', 'h-full', 'shrink-0', 'px-4',
      'outline', 'outline-2', 'outline-offset-2', 'outline-[var(--focus-ring)]',
      'rounded-panel', 'shadow-e1', 'duration-fast', 'text-size-inherit', 'text-inherit',
    ]
    expect(tokens(cn(classes))).toEqual(new Set(classes))
    expect(tokens(cn([...classes].reverse()))).toEqual(new Set(classes))
  })

  it('generates exactly equivalent declarations, importance and media for all ten old/new pairs', async () => {
    const config = loadConfig(resolve('tailwind.config.js'))
    const generate = async (classes: string[]) => (await postcss([tailwindcss({
      ...config,
      content: [{ raw: classes.join(' '), extension: 'html' }],
    })]).process('@tailwind utilities;', { from: undefined })).root
    const namedClasses = variants.flatMap((variant) => roles.map(([, name, prefix]) => `${variant}${prefix}-${name}`))
    const arbitraryClasses = variants.flatMap((variant) => roles.map(([, , , , arbitrary]) => `${variant}${arbitrary}`))
    const namedCSS = await generate(namedClasses)
    const arbitraryCSS = await generate(arbitraryClasses)
    function ruleFor(root: Root, className: string) {
      const matches: { declarations: [string, string, boolean][]; media: string[] }[] = []
      root.walkRules((rule) => {
        const selector = rule.selector
          .replace(/\\([\da-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
          .replace(/\\(.)/g, '$1')
        if (selector !== `.${className}`) return
        const declarations: [string, string, boolean][] = []
        rule.walkDecls((declaration) => {
          declarations.push([declaration.prop, declaration.value, Boolean(declaration.important)])
        })
        const media: string[] = []
        let parent: typeof rule.parent | Root['parent'] = rule.parent
        while (parent) {
          if (parent.type === 'atrule') media.unshift(`@${parent.name} ${parent.params}`)
          parent = parent.parent
        }
        matches.push({ declarations, media })
      })
      expect(matches, className).toHaveLength(1)
      return matches[0]
    }
    const screens = { '': [], 'sm:': ['@media (min-width: 640px)'], 'md:': ['@media (min-width: 768px)'], 'xl:': ['@media (min-width: 1280px)'] }
    const properties = { z: 'z-index', w: 'width', 'max-w': 'max-width', 'max-h': 'max-height' }
    for (const variant of variants) {
      for (const [, name, prefix, value, arbitrary] of roles) {
        const named = ruleFor(namedCSS, `${variant}${prefix}-${name}`)
        expect(named).toEqual(ruleFor(arbitraryCSS, `${variant}${arbitrary}`))
        expect(named).toEqual({
          declarations: [[properties[prefix], value, false]],
          media: screens[variant],
        })
      }
    }
  })
})

describe('cn — Tailwind 3 outline property independence', () => {
  const variants = ['', 'focus-visible:', 'sm:', 'md:focus-visible:', 'forced-colors:focus-visible:']
  const properties = ['outline', 'outline-2', 'outline-offset-2', 'outline-[var(--focus-ring)]']

  it.each(variants)('keeps style, width, offset and color in both orders for %s', (variant) => {
    const classes = properties.map((className) => `${variant}${className}`)
    expect(cn(classes)).toBe(classes.join(' '))
    expect(cn([...classes].reverse())).toBe([...classes].reverse().join(' '))
  })

  for (const [base, alternatives] of [
    ['outline', ['outline-dashed', 'outline-dotted', 'outline-double', 'outline-none']],
    ['outline-2', ['outline-4', 'outline-[3px]', 'outline-[length:var(--outline-width)]', 'outline-(length:--outline-width)']],
    ['outline-offset-2', ['outline-offset-4', 'outline-offset-[3px]', 'outline-offset-(--outline-offset)']],
    ['outline-[var(--focus-ring)]', ['outline-red-500', 'outline-[Highlight]', 'outline-(--outline-color)']],
  ] as const) {
    for (const alternative of alternatives) {
      it.each(variants)(`${base} and ${alternative} resolve only their property for %s`, (variant) => {
        const independent = properties.filter((className) => className !== base)
          .map((className) => `${variant}${className}`)
        expect(tokens(cn(independent, `${variant}${base}`, `${variant}${alternative}`)))
          .toEqual(new Set([...independent, `${variant}${alternative}`]))
        expect(tokens(cn(independent, `${variant}${alternative}`, `${variant}${base}`)))
          .toEqual(new Set([...independent, `${variant}${base}`]))
      })
    }
  }

  it('keeps distinct variants and forced-colors Highlight independent in both orders', () => {
    const classes = variants.flatMap((variant) => properties.map((className) => `${variant}${className}`))
    classes.push('forced-colors:outline-[Highlight]', 'xl:outline-4', 'rounded-panel', 'px-4')
    expect(tokens(cn(classes))).toEqual(new Set(classes))
    expect(tokens(cn([...classes].reverse()))).toEqual(new Set(classes))
  })

  it('retains exact generated CSS declarations, importance and media in both authored orders', async () => {
    const config = loadConfig(resolve('tailwind.config.js'))
    const classes = variants.flatMap((variant) => properties.map((className) =>
      `${variant}${variant.startsWith('forced-colors:') && className === 'outline-[var(--focus-ring)]'
        ? 'outline-[Highlight]' : className}`))
    const generate = async (classNames: string) => (await postcss([tailwindcss({
      ...config,
      content: [{ raw: classNames, extension: 'html' }],
    })]).process('@tailwind utilities;', { from: undefined })).root

    function generatedRules(root: Root) {
      const rules: { selector: string; media: string[]; declarations: [string, string, boolean][] }[] = []
      root.walkRules((rule) => {
        const media: string[] = []
        let parent: typeof rule.parent | Root['parent'] = rule.parent
        while (parent) {
          if (parent.type === 'atrule') media.unshift(`@${parent.name} ${parent.params}`)
          parent = parent.parent
        }
        const declarations: [string, string, boolean][] = []
        rule.walkDecls((declaration) => {
          declarations.push([declaration.prop, declaration.value, Boolean(declaration.important)])
        })
        rules.push({ selector: rule.selector, media, declarations })
      })
      return rules
    }

    const authored = await generate(classes.join(' '))
    const expected = generatedRules(authored)
    for (const ordered of [classes, [...classes].reverse()]) {
      expect(generatedRules(await generate(cn(ordered)))).toEqual(expected)
    }

    for (const variant of variants) {
      for (const [className, property, value] of [
        ['outline', 'outline-style', 'solid'],
        ['outline-2', 'outline-width', '2px'],
        ['outline-offset-2', 'outline-offset', '2px'],
        variant.startsWith('forced-colors:')
          ? ['outline-[Highlight]', 'outline-color', 'Highlight']
          : ['outline-[var(--focus-ring)]', 'outline-color', 'var(--focus-ring)'],
      ]) {
        const selector = `.${variant}${className}${variant.includes('focus-visible:') ? ':focus-visible' : ''}`
        const matches = expected.filter((rule) => rule.selector
          .replace(/\\([\da-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
          .replace(/\\(.)/g, '$1') === selector)
        expect(matches, selector).toHaveLength(1)
        expect(matches[0].declarations).toEqual([[property, value, false]])
        expect(matches[0].media).toEqual(
          variant.startsWith('sm:') ? ['@media (min-width: 640px)']
            : variant.startsWith('md:') ? ['@media (min-width: 768px)']
              : variant.startsWith('forced-colors:') ? ['@media (forced-colors: active)'] : [],
        )
      }
    }
    expect(expected.find((rule) => rule.selector.includes('Highlight'))).toMatchObject({
      media: ['@media (forced-colors: active)'],
      declarations: [['outline-color', 'Highlight', false]],
    })
  })
})

describe('cn — clsx composition', () => {
  it('joins multiple string arguments with single spaces', () => {
    expect(cn('flex', 'items-center', 'gap-2')).toBe('flex items-center gap-2')
  })

  it('always returns a string, even for no / empty input', () => {
    expect(typeof cn()).toBe('string')
    expect(cn()).toBe('')
    expect(cn('')).toBe('')
    expect(cn(null, undefined, false)).toBe('')
  })

  it('prunes every falsy value (null, undefined, false, 0, empty string, NaN)', () => {
    expect(cn('a', null, undefined, false, 0, '', NaN, 'b')).toBe('a b')
  })

  it('supports the conditional object syntax, keeping only truthy keys', () => {
    expect(cn('btn', { active: true, disabled: false })).toBe('btn active')
    // Every key false → object contributes nothing.
    expect(cn('btn', { active: false, loading: false })).toBe('btn')
  })

  it('flattens array and deeply-nested array inputs', () => {
    expect(cn(['flex', 'p-2'], 'gap-1')).toBe('flex p-2 gap-1')
    expect(cn(['a', ['b', ['c']]])).toBe('a b c')
  })

  it('mixes strings, arrays and objects in a single call', () => {
    expect(cn('base', ['x', { y: true, z: false }], undefined, 'w')).toBe('base x y w')
  })

  it('supports the `condition && "class"` idiom', () => {
    const isActive = true
    const isDisabled = false
    expect(cn('tab', isActive && 'tab--active', isDisabled && 'tab--disabled')).toBe(
      'tab tab--active',
    )
  })
})

describe('cn — tailwind-merge conflict resolution (last wins)', () => {
  it('resolves conflicting padding utilities so the last one wins', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('lets an override class defeat a base class regardless of source shape', () => {
    // The canonical reason `cn` exists: a component's base classes plus a
    // caller-provided override, where the override must win.
    const result = cn('rounded bg-black px-2', 'px-6')
    expect(tokens(result).has('px-6')).toBe(true)
    expect(tokens(result).has('px-2')).toBe(false)
    // Non-conflicting base classes survive.
    expect(tokens(result).has('rounded')).toBe(true)
    expect(tokens(result).has('bg-black')).toBe(true)
  })

  it('resolves conflicting text-color utilities to the last value', () => {
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('preserves non-conflicting utilities from different class groups', () => {
    const result = cn('flex', 'items-center', 'justify-between')
    expect(tokens(result)).toEqual(new Set(['flex', 'items-center', 'justify-between']))
  })

  it('collapses an exact duplicate utility to a single occurrence', () => {
    expect(cn('flex', 'flex')).toBe('flex')
  })

  it('applies conflict resolution across conditional / falsy-pruned inputs', () => {
    const useLargePadding = true
    const result = cn('p-2', useLargePadding && 'p-8', false && 'p-0')
    expect(result).toBe('p-8')
  })

  /**
   * Every token-backed scale declared in tailwind.config.js uses a custom
   * (non-numeric, non-keyword) key, which twMerge does NOT recognise out of
   * the box — both classes survive and CSS source order silently decides the
   * winner. Each scale must therefore be registered in cn.ts. This test is
   * the guard: adding a new custom scale to tailwind.config.js without
   * registering it here will fail.
   */
  describe('token-backed custom scales resolve last-wins', () => {
    it.each([
      ['duration-fast', 'duration-normal'],
      ['duration-fast', 'duration-200'],
      ['ease-standard', 'ease-linear'],
      ['ease-accelerate', 'ease-decelerate'],
      ['rounded-panel', 'rounded-lg'],
      ['rounded-shape-md', 'rounded-full'],
      ['shadow-panel', 'shadow-e1'],
      ['shadow-e2', 'shadow-none'],
    ])('%s then %s keeps only the last', (base, override) => {
      expect(cn(base, override)).toBe(override)
    })
  })

  describe('docked side-panel geometry resolves last-wins', () => {
    const geometry = [
      ['w-side-panel', ['w-80', 'w-full', 'w-[420px]', 'w-[50vw]']],
      ['max-w-side-panel-viewport', ['max-w-sm', 'max-w-none', 'max-w-[40vw]', 'max-w-[500px]']],
      ['min-h-side-panel-header', ['min-h-16', 'min-h-full', 'min-h-[4.5rem]', 'min-h-[100px]']],
    ] as const

    for (const [named, alternatives] of geometry) {
      for (const alternative of alternatives) {
        it.each(['', 'sm:', 'xl:', '2xl:'])(
          `${named} and ${alternative} honor both orders with variant %s`,
          (variant) => {
            expect(cn(`${variant}${named}`, `${variant}${alternative}`)).toBe(`${variant}${alternative}`)
            expect(cn(`${variant}${alternative}`, `${variant}${named}`)).toBe(`${variant}${named}`)
          },
        )
      }
    }

    it('keeps independent dimensions, unrelated utilities and distinct variants', () => {
      const classes = [
        'w-side-panel', 'max-w-side-panel-viewport', 'min-h-side-panel-header',
        'min-w-0', 'h-full', 'shrink-0', 'pb-7',
        'sm:w-80', 'xl:w-side-panel', '2xl:w-[500px]',
        'sm:max-w-sm', 'xl:max-w-side-panel-viewport',
        'sm:min-h-16', 'xl:min-h-side-panel-header',
      ]
      expect(tokens(cn(classes))).toEqual(new Set(classes))
      expect(tokens(cn([...classes].reverse()))).toEqual(new Set(classes))
    })

    describe('font-size inheritance resolves independently of foreground colors', () => {
      const inherited = typography.size.inherit

      for (const alternative of [
        'text-sm', 'text-base', 'text-2xl',
        'text-[length:inherit]', 'text-[18px]', 'text-[length:var(--custom-size)]',
        'text-sm/6',
      ]) {
        it.each(['', 'sm:', 'md:', 'xl:', 'forced-colors:'])(
          `${alternative} and inheritance honor both orders with variant %s`,
          (variant) => {
            expect(cn(`${variant}${alternative}`, `${variant}${inherited}`)).toBe(`${variant}${inherited}`)
            expect(cn(`${variant}${inherited}`, `${variant}${alternative}`)).toBe(`${variant}${alternative}`)
          },
        )
      }

      it.each([
        'text-inherit', 'text-red-500', typography.color.primary,
        'text-[color:var(--text-secondary)]', 'forced-colors:text-[ButtonText]',
        'forced-colors:hover:text-[HighlightText]',
      ])('preserves foreground %s in either order', (foreground) => {
        expect(tokens(cn(inherited, foreground))).toEqual(new Set([inherited, foreground]))
        expect(tokens(cn(foreground, inherited))).toEqual(new Set([inherited, foreground]))
        expect(tokens(cn('text-sm', foreground, inherited))).toEqual(new Set([foreground, inherited]))
        expect(tokens(cn(inherited, foreground, 'text-sm'))).toEqual(new Set([foreground, 'text-sm']))
      })

      it('keeps matching forced-colors foreground independent of font-size overrides', () => {
        expect(cn('forced-colors:text-sm', 'forced-colors:text-[ButtonText]', `forced-colors:${inherited}`))
          .toBe(`forced-colors:text-[ButtonText] forced-colors:${inherited}`)
        expect(cn(`forced-colors:${inherited}`, 'forced-colors:text-[ButtonText]', 'forced-colors:text-sm'))
          .toBe('forced-colors:text-[ButtonText] forced-colors:text-sm')
      })

      it('preserves distinct variants, other typography properties and caller composition', () => {
        const classes = [
          inherited, 'sm:text-sm', 'md:text-[18px]', `xl:${inherited}`,
          'font-medium', 'font-sans', 'tracking-wide',
          typography.color.primary, 'forced-colors:text-[ButtonText]',
        ]
        expect(tokens(cn(classes))).toEqual(new Set(classes))
        expect(tokens(cn([...classes].reverse()))).toEqual(new Set(classes))
        expect(cn(['text-sm', { [inherited]: true }], false, 'text-lg')).toBe('text-lg')
      })
    })
  })
})
