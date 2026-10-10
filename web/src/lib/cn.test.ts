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

const newGeometry = [
  ['height', 'workspace-header', 'h', '4.5rem', 'h-[4.5rem]', 'h-16', 'h-[5rem]'],
  ['gridTemplateColumns', 'workspace-header', 'grid-cols', 'minmax(0,1fr) minmax(18rem,22rem) minmax(0,1fr)', 'grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)_minmax(0,1fr)]', 'grid-cols-3', 'grid-cols-[1fr_2fr]'],
  ['zIndex', 'command-palette-backdrop', 'z', '200', 'z-[200]', 'z-50', 'z-[300]'],
  ['zIndex', 'command-palette-positioner', 'z', '201', 'z-[201]', 'z-50', 'z-[301]'],
  ['padding', 'command-palette-viewport', 'py', 'max(2rem,8vh)', 'py-[max(2rem,8vh)]', 'py-8', 'py-[3rem]'],
  ['maxHeight', 'command-palette', 'max-h', '84vh', 'max-h-[84vh]', 'max-h-screen', 'max-h-[90vh]'],
] as const

function newGeometryPredecessor() {
  const current = finalShellPredecessor()
  const extend = {
    ...current.theme?.extend,
    height: { ...current.theme?.extend?.height },
    gridTemplateColumns: { ...current.theme?.extend?.gridTemplateColumns },
    zIndex: { ...current.theme?.extend?.zIndex },
    padding: { ...current.theme?.extend?.padding },
    maxHeight: { ...current.theme?.extend?.maxHeight },
  }
  expect(newGeometry).toHaveLength(6)
  for (const [group, name, , value] of newGeometry) {
    expect(extend[group]).toHaveProperty(name, value)
    Reflect.deleteProperty(extend[group], name)
  }
  expect(extend.padding).toEqual({})
  Reflect.deleteProperty(extend, 'padding')
  return { ...current, theme: { ...current.theme, extend } }
}

const finalShellGeometry = [
  ['width', 'help-menu', 'w', 'min(92vw,260px)', 'w-[min(92vw,260px)]', 'w-64', 'w-[300px]'],
  ['zIndex', 'shell-status-bar', 'z', '55', 'z-[55]', 'z-50', 'z-[70]'],
] as const

function finalShellPredecessor(): ReturnType<typeof loadConfig> {
  const current = moreMenuPredecessor()
  const extend = {
    ...current.theme?.extend,
    width: { ...current.theme?.extend?.width },
    zIndex: { ...current.theme?.extend?.zIndex },
  }
  expect(finalShellGeometry).toHaveLength(2)
  for (const [group, name, , value] of finalShellGeometry) {
    expect(extend[group]).toHaveProperty(name, value)
    Reflect.deleteProperty(extend[group], name)
  }
  return { ...current, theme: { ...current.theme, extend } }
}

function moreMenuPredecessor(): ReturnType<typeof loadConfig> {
  const current = loadConfig(resolve('tailwind.config.js'))
  const maxHeight = { ...current.theme?.extend?.maxHeight }
  expect(maxHeight).toHaveProperty('more-menu', 'min(70vh,520px)')
  Reflect.deleteProperty(maxHeight, 'more-menu')
  return { ...current, theme: { ...current.theme, extend: { ...current.theme?.extend, maxHeight } } }
}

describe('cn — More menu exact naming and reused width', () => {
  const variants = ['', '!', 'sm:', 'sm:!', 'md:', 'md:!', 'xl:', 'xl:!'] as const
  const pairs = [
    ['max-h-more-menu', 'max-h-[min(70vh,520px)]', 'max-height', 'min(70vh,520px)', ['max-h-80', 'max-h-full', 'max-h-[500px]', 'max-h-status-options']],
    ['w-connection-diagnostics', 'w-[min(92vw,320px)]', 'width', 'min(92vw,320px)', ['w-80', 'w-full', 'w-[400px]', 'w-theme-switcher']],
  ] as const

  for (const [named, arbitrary, , , alternatives] of pairs) {
    for (const caller of [arbitrary, ...alternatives]) {
      it.each(variants)(`${named} versus ${caller} is last-conflict-wins for %s`, variant => {
        expect(cn(`${variant}${named}`, `${variant}${caller}`)).toBe(`${variant}${caller}`)
        expect(cn(`${variant}${caller}`, `${variant}${named}`)).toBe(`${variant}${named}`)
      })
    }
  }

  it('preserves every distinct breakpoint and importance context in both orders', () => {
    for (const [named, arbitrary] of pairs) {
      for (const left of variants) {
        for (const right of variants) {
          if (left === right) continue
          const classes = [`${left}${named}`, `${right}${arbitrary}`]
          expect(tokens(cn(classes))).toEqual(new Set(classes))
          expect(tokens(cn([...classes].reverse()))).toEqual(new Set(classes))
        }
      }
    }
  })

  it.each(variants)('keeps width, min/max-width and max-height independent for %s', variant => {
    const classes = ['w-connection-diagnostics', 'min-w-64', 'max-w-sm', 'max-h-more-menu']
      .map(value => `${variant}${value}`)
    expect(tokens(cn(classes))).toEqual(new Set(classes))
    expect(tokens(cn([...classes].reverse()))).toEqual(new Set(classes))
  })

  it('proves real installed CSS selector, specificity, context, values and importance parity', async () => {
    const current = loadConfig(resolve('tailwind.config.js'))
    const oldClasses = variants.flatMap(variant => pairs.flatMap(([, old, , , alternatives]) =>
      [old, ...alternatives].map(value => `${variant}${value}`)))
    const newClasses = variants.flatMap(variant => pairs.map(([named]) => `${variant}${named}`))
    const generate = async (config: typeof current, classes: string[]) =>
      (await postcss([tailwindcss({ ...config, content: [{ raw: classes.join(' '), extension: 'html' }] })])
        .process('@tailwind utilities;', { from: undefined })).root
    const before = await generate(moreMenuPredecessor(), oldClasses)
    const after = await generate(current, [...oldClasses, ...newClasses])
    console.log('RAW MORE BEFORE CSS\n' + before.toString())
    console.log('RAW MORE AFTER CSS\n' + after.toString())
    function signature(root: Root, className: string) {
      const matches: { selector: string; specificity: number[]; declarations: [string, string, boolean][]; context: string[] }[] = []
      root.walkRules(rule => {
        const selector = rule.selector.replace(/\\([\da-f]{1,6})\s?/gi,
          (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/\\(.)/g, '$1')
        if (selector !== `.${className}`) return
        const declarations: [string, string, boolean][] = []
        // Tailwind inserts comma whitespace into arbitrary min(); no numeric normalization.
        rule.walkDecls(decl => { declarations.push([decl.prop, decl.value.replace(/,\s*/g, ','), Boolean(decl.important)]) })
        const context: string[] = []
        let parent: typeof rule.parent | Root['parent'] = rule.parent
        while (parent) {
          if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`)
          parent = parent.parent
        }
        // Exact single-class selectors above have specificity (0,1,0).
        matches.push({ selector: '.ROLE', specificity: [0, 1, 0], declarations, context })
      })
      expect(matches, className).toHaveLength(1)
      return matches[0]
    }
    for (const variant of variants) {
      for (const [named, old, property, value, alternatives] of pairs) {
        const actual = signature(after, `${variant}${named}`)
        expect(actual).toEqual(signature(before, `${variant}${old}`))
        const breakpoint = variant.split(':')[0]
        const media = { sm: '640px', md: '768px', xl: '1280px' }[breakpoint as 'sm' | 'md' | 'xl']
        expect(actual).toEqual({
          selector: '.ROLE', specificity: [0, 1, 0],
          declarations: [[property, value, variant.includes('!')]],
          context: media ? [`@media (min-width: ${media})`] : [],
        })
        for (const alternative of [old, ...alternatives]) {
          const caller = `${variant}${alternative}`
          expect(signature(after, caller)).toEqual(signature(before, caller))
          expect(signature(after, cn(`${variant}${named}`, caller))).toEqual(signature(before, caller))
          expect(signature(after, cn(caller, `${variant}${named}`))).toEqual(actual)
        }
      }
    }
  })
})

describe('cn — exact two final shell naming roles', () => {
  const variants = ['', 'md:', '!', 'md:!'] as const
  for (const [, name, prefix, , arbitrary, ordinary, alternate] of finalShellGeometry) {
    for (const caller of [arbitrary, ordinary, alternate]) {
      it.each(variants)(`${name} versus ${caller} keeps both orders for %s`, variant => {
        const named = `${variant}${prefix}-${name}`
        const old = `${variant}${caller}`
        expect(cn(named, old)).toBe(old)
        expect(cn(old, named)).toBe(named)
      })
    }
  }

  it('keeps different breakpoints, importance and independent properties in both orders', () => {
    for (const [, name, prefix] of finalShellGeometry) {
      const named = `${prefix}-${name}`
      for (const independent of [`md:${named}`, `!${named}`, `md:!${named}`, `sm:${named}`]) {
        expect(tokens(cn(named, independent))).toEqual(new Set([named, independent]))
        expect(tokens(cn(independent, named))).toEqual(new Set([named, independent]))
      }
    }
    const independent = ['w-help-menu', 'min-w-64', 'max-w-sm', 'z-shell-status-bar', 'fixed', 'bottom-0']
    expect(tokens(cn(independent))).toEqual(new Set(independent))
    expect(tokens(cn([...independent].reverse()))).toEqual(new Set(independent))
  })

  it('generates equal real declarations, selector context, media and importance', async () => {
    const current = loadConfig(resolve('tailwind.config.js'))
    const oldClasses = variants.flatMap(variant =>
      finalShellGeometry.flatMap(([, , , , arbitrary, ordinary, alternate]) =>
        [arbitrary, ordinary, alternate].map(cls => `${variant}${cls}`)))
    const namedClasses = variants.flatMap(variant =>
      finalShellGeometry.map(([, name, prefix]) => `${variant}${prefix}-${name}`))
    const generate = async (config: typeof current, classes: string[]) =>
      (await postcss([tailwindcss({ ...config, content: [{ raw: classes.join(' '), extension: 'html' }] })])
        .process('@tailwind utilities;', { from: undefined })).root
    const before = await generate(finalShellPredecessor(), oldClasses)
    const after = await generate(current, [...oldClasses, ...namedClasses])
    console.log('RAW FINAL SHELL BEFORE CSS\n' + before.toString())
    console.log('RAW FINAL SHELL AFTER CSS\n' + after.toString())
    function signature(root: Root, className: string) {
      const matches: { selector: string; declarations: [string, string, boolean][]; context: string[] }[] = []
      root.walkRules(rule => {
        const selector = rule.selector.replace(/\\([\da-f]{1,6})\s?/gi,
          (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/\\(.)/g, '$1')
        if (selector !== `.${className}`) return
        const declarations: [string, string, boolean][] = []
        rule.walkDecls(decl => { declarations.push([decl.prop, decl.value.replace(/,\s*/g, ','), Boolean(decl.important)]) })
        const context: string[] = []
        let parent: typeof rule.parent | Root['parent'] = rule.parent
        while (parent) {
          if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`)
          parent = parent.parent
        }
        matches.push({ selector: selector.replace(className, 'ROLE'), declarations, context })
      })
      expect(matches, className).toHaveLength(1)
      return matches[0]
    }
    for (const variant of variants) {
      for (const [, name, prefix, value, arbitrary, ordinary, alternate] of finalShellGeometry) {
        const named = `${variant}${prefix}-${name}`
        const original = signature(before, `${variant}${arbitrary}`)
        expect(signature(after, named)).toEqual(original)
        expect(original).toEqual({
          selector: '.ROLE',
          declarations: [[prefix === 'w' ? 'width' : 'z-index', value, variant.includes('!')]],
          context: variant.startsWith('md:') ? ['@media (min-width: 768px)'] : [],
        })
        for (const caller of [arbitrary, ordinary, alternate]) {
          const old = `${variant}${caller}`
          expect(signature(after, old)).toEqual(signature(before, old))
          expect(signature(after, cn(named, old))).toEqual(signature(before, old))
          expect(signature(after, cn(old, named))).toEqual(signature(after, named))
        }
      }
    }
  })
})

describe('cn — exact six workspace and command-palette geometry roles', () => {
  const variants = ['', 'sm:', 'md:', 'xl:', '@[26rem]/metric:', 'motion-reduce:', 'forced-colors:'] as const
  for (const [, name, prefix, , arbitrary, ordinary, alternate] of newGeometry) {
    const named = `${prefix}-${name}`
    for (const caller of [arbitrary, ordinary, alternate]) {
      it.each(variants)(`${named} versus ${caller} preserves both orders for %s`, variant => {
        expect(cn(`${variant}${named}`, `${variant}${caller}`)).toBe(`${variant}${caller}`)
        expect(cn(`${variant}${caller}`, `${variant}${named}`)).toBe(`${variant}${named}`)
        expect(cn([`${variant}${named}`, false], { [`${variant}${caller}`]: true }))
          .toBe(`${variant}${caller}`)
      })
    }
  }

  it.each(variants)('preserves directional padding and independent properties/variants for %s', variant => {
    const py = `${variant}py-command-palette-viewport`
    const cls = (value: string) => `${variant}${value}`
    for (const padding of ['p-4', 'p-[3rem]']) {
      expect(cn(cls(padding), py)).toBe(`${cls(padding)} ${py}`)
      expect(cn(py, cls(padding))).toBe(cls(padding))
    }
    for (const edge of ['pt', 'pb']) {
      for (const size of ['4', '[3rem]']) {
        const caller = cls(`${edge}-${size}`)
        expect(cn(caller, py)).toBe(py)
        expect(cn(py, caller)).toBe(`${py} ${caller}`)
      }
    }
    for (const horizontal of ['px-4', 'pl-4', 'pr-4', 'ps-4', 'pe-4']) {
      expect(cn(cls(horizontal), py)).toBe(`${cls(horizontal)} ${py}`)
      expect(cn(py, cls(horizontal))).toBe(`${py} ${cls(horizontal)}`)
    }
    const independent = [
      ...newGeometry.filter(([, , prefix]) => prefix !== 'z').map(([, name, prefix]) => cls(`${prefix}-${name}`)),
      cls('z-command-palette-backdrop'), cls('min-h-side-panel-header'),
      cls('w-side-panel'), cls('max-w-side-panel-viewport'),
      'lg:h-20', 'lg:py-4', cls('col-start-2'),
    ]
    expect(tokens(cn(independent))).toEqual(new Set(independent))
    expect(tokens(cn([...independent].reverse()))).toEqual(new Set(independent))
    expect(cn(cls('z-command-palette-backdrop'), cls('z-command-palette-positioner')))
      .toBe(cls('z-command-palette-positioner'))
    expect(cn(cls('z-command-palette-positioner'), cls('z-command-palette-backdrop')))
      .toBe(cls('z-command-palette-backdrop'))
  })

  it('proves entire before/after generated declarations, importance and variant context for all six roles', async () => {
    const current = loadConfig(resolve('tailwind.config.js'))
    const predecessor = newGeometryPredecessor()
    const generate = async (config: typeof current, classes: string[]) =>
      (await postcss([tailwindcss({
        ...config, content: [{ raw: classes.join(' '), extension: 'html' }],
      })]).process('@tailwind utilities;', { from: undefined })).root
    const oldClasses = variants.flatMap(variant => newGeometry.flatMap(([, , , , arbitrary, ordinary, alternate]) =>
      [arbitrary, ordinary, alternate].map(utility => `${variant}${utility}`)))
    const namedClasses = variants.flatMap(variant => newGeometry.map(([, name, prefix]) => `${variant}${prefix}-${name}`))
    const before = await generate(predecessor, oldClasses)
    const after = await generate(current, [...oldClasses, ...namedClasses])
    console.log('RAW EXACT SIX GEOMETRY BEFORE CSS\n' + before.toString())
    console.log('RAW EXACT SIX GEOMETRY AFTER CSS\n' + after.toString())
    function signature(root: Root, className: string) {
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
    const properties = { h: 'height', 'grid-cols': 'grid-template-columns', z: 'z-index', 'max-h': 'max-height' }
    const contexts = {
      '': [], 'sm:': ['@media (min-width: 640px)'], 'md:': ['@media (min-width: 768px)'],
      'xl:': ['@media (min-width: 1280px)'], '@[26rem]/metric:': ['@container metric (min-width: 26rem)'],
      'motion-reduce:': ['@media (prefers-reduced-motion: reduce)'],
      'forced-colors:': ['@media (forced-colors: active)'],
    }
    for (const variant of variants) {
      for (const [, name, prefix, value, arbitrary, ordinary, alternate] of newGeometry) {
        const named = `${variant}${prefix}-${name}`
        const original = signature(before, `${variant}${arbitrary}`)
        if (prefix === 'py') {
          // Tailwind inserts comma whitespace only in arbitrary max() values.
          expect(original).toEqual({
            declarations: [
              ['padding-top', 'max(2rem, 8vh)', false],
              ['padding-bottom', 'max(2rem, 8vh)', false],
            ],
            context: contexts[variant],
          })
          expect(signature(after, named)).toEqual({
            ...original,
            declarations: original.declarations.map(([property, cssValue, important]) =>
              [property, cssValue.replace(/,\s*/g, ','), important]),
          })
        } else {
          expect(signature(after, named)).toEqual(original)
        }
        expect(signature(after, named)).toEqual({
          declarations: prefix === 'py'
            ? [['padding-top', value, false], ['padding-bottom', value, false]]
            : [[properties[prefix], value, false]],
          context: contexts[variant],
        })
        for (const utility of [arbitrary, ordinary, alternate]) {
          const caller = `${variant}${utility}`
          expect(signature(after, caller)).toEqual(signature(before, caller))
          expect(signature(after, cn(named, caller))).toEqual(signature(before, caller))
          expect(signature(after, cn(caller, named))).toEqual(signature(after, named))
        }
      }
    }
  })
})

const resourceGeometry = [
  ['gridTemplateColumns', 'metric-compact', 'grid-cols', 'minmax(0,1fr) minmax(0,1fr) 5rem', 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem]', 'grid-cols-2', 'grid-cols-[1fr_2fr]'],
  ['minHeight', 'error-fallback', 'min-h', '400px', 'min-h-[400px]', 'min-h-0', 'min-h-[500px]'],
  ['transitionProperty', 'width', 'transition', 'width', 'transition-[width]', 'transition-all', 'transition-[opacity]'],
  ['width', 'command-deck-collapsed', 'w', '76px', 'w-[76px]', 'w-full', 'w-[90px]'],
  ['width', 'command-deck-expanded', 'w', '320px', 'w-[320px]', 'w-80', 'w-[400px]'],
  ['minWidth', 'freshness-age', 'min-w', '4.5rem', 'min-w-[4.5rem]', 'min-w-0', 'min-w-[5rem]'],
] as const

function resourcePredecessor() {
  const current = newGeometryPredecessor()
  const extend = {
    ...current.theme?.extend,
    gridTemplateColumns: { ...current.theme?.extend?.gridTemplateColumns },
    minHeight: { ...current.theme?.extend?.minHeight },
    transitionProperty: { ...current.theme?.extend?.transitionProperty },
    width: { ...current.theme?.extend?.width },
    minWidth: { ...current.theme?.extend?.minWidth },
  }
  for (const [group, name, , value] of resourceGeometry) {
    expect(extend[group]).toHaveProperty(name, value)
    Reflect.deleteProperty(extend[group], name)
  }
  return { ...current, theme: { ...current.theme, extend } }
}

describe('cn — six resource geometry roles (MDC-043)', () => {
  const variants = ['', 'sm:', 'md:', 'xl:', '@[26rem]/metric:', 'motion-reduce:'] as const
  const reuse = ['minWidth', '24', 'min-w', '6rem', 'min-w-[6rem]', 'min-w-0', 'min-w-[8rem]'] as const
  const pairs = [...resourceGeometry, reuse]

  for (const [, name, prefix, , arbitrary, ordinary, alternate] of pairs) {
    const named = `${prefix}-${name}`
    for (const alternative of [arbitrary, ordinary, alternate]) {
      it.each(variants)(`${named} and ${alternative} honor both caller orders for %s`, variant => {
        expect(cn(`${variant}${named}`, `${variant}${alternative}`)).toBe(`${variant}${alternative}`)
        expect(cn(`${variant}${alternative}`, `${variant}${named}`)).toBe(`${variant}${named}`)
        expect(cn([`${variant}${named}`, false], { [`${variant}${alternative}`]: true }))
          .toBe(`${variant}${alternative}`)
      })
    }
  }

  it('retains independent properties, variants, motion and actual caller override order', () => {
    const independent = [
      'w-command-deck-collapsed', 'min-w-freshness-age', 'max-w-md',
      'min-h-error-fallback', 'h-full', 'grid-cols-metric-compact', 'col-start-3',
      'transition-width', 'duration-normal', 'ease-standard', 'motion-reduce:transition-none',
      'sm:w-command-deck-expanded', '@[26rem]/metric:grid-cols-2',
      'outline', 'outline-2', 'outline-offset-2', 'outline-[var(--focus-ring)]',
    ]
    expect(tokens(cn(independent))).toEqual(new Set(independent))
    expect(tokens(cn([...independent].reverse()))).toEqual(new Set(independent))
    expect(cn('w-command-deck-collapsed', 'w-command-deck-expanded')).toBe('w-command-deck-expanded')
    expect(cn('w-command-deck-expanded', 'w-command-deck-collapsed')).toBe('w-command-deck-collapsed')
    expect(cn('min-h-error-fallback p-8 max-w-md', 'min-h-0')).toBe('p-8 max-w-md min-h-0')
    expect(cn('@[26rem]/metric:grid-cols-metric-compact', '@[26rem]/metric:grid-cols-2'))
      .toBe('@[26rem]/metric:grid-cols-2')
    expect(cn('@[26rem]/metric:grid-cols-2', '@[26rem]/metric:grid-cols-metric-compact'))
      .toBe('@[26rem]/metric:grid-cols-metric-compact')
    expect(cn('transition-width', 'transition-none')).toBe('transition-none')
    expect(cn('transition-none', 'transition-width')).toBe('transition-width')
  })

  it('generates exact before/after CSS using the predecessor config and real responsive/container/motion plugins', async () => {
    const current = loadConfig(resolve('tailwind.config.js'))
    const predecessor = resourcePredecessor()
    const generate = async (config: typeof current, classes: string[]) =>
      (await postcss([tailwindcss({
        ...config, content: [{ raw: classes.join(' '), extension: 'html' }],
      })]).process('@tailwind utilities;', { from: undefined })).root
    const oldClasses = variants.flatMap(variant => pairs.flatMap(([, , , , arbitrary, ordinary, alternate]) =>
      [arbitrary, ordinary, alternate].map(value => `${variant}${value}`)))
    const newClasses = variants.flatMap(variant => pairs.map(([, name, prefix]) => `${variant}${prefix}-${name}`))
    const before = await generate(predecessor, oldClasses)
    const after = await generate(current, [...oldClasses, ...newClasses])
    console.log('RAW RESOURCE GEOMETRY BEFORE CSS\n' + before.toString())
    console.log('RAW RESOURCE GEOMETRY AFTER CSS\n' + after.toString())
    function signature(root: Root, className: string) {
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
    const properties = {
      'grid-cols': 'grid-template-columns', 'min-h': 'min-height',
      transition: 'transition-property', w: 'width', 'min-w': 'min-width',
    }
    const contexts = {
      '': [], 'sm:': ['@media (min-width: 640px)'], 'md:': ['@media (min-width: 768px)'],
      'xl:': ['@media (min-width: 1280px)'], '@[26rem]/metric:': ['@container metric (min-width: 26rem)'],
      'motion-reduce:': ['@media (prefers-reduced-motion: reduce)'],
    }
    expect(resourceGeometry).toHaveLength(6)
    expect(resolveConfig(current).theme.minWidth['24']).toBe('6rem')
    for (const variant of variants) {
      for (const [, name, prefix, value, arbitrary, ordinary, alternate] of pairs) {
        const named = `${variant}${prefix}-${name}`
        expect(signature(after, named)).toEqual(signature(before, `${variant}${arbitrary}`))
        expect(signature(after, named)).toEqual({
          declarations: prefix === 'transition'
            ? [
                [properties[prefix], value, false],
                ['transition-timing-function', 'cubic-bezier(0.4, 0, 0.2, 1)', false],
                ['transition-duration', '150ms', false],
              ]
            : [[properties[prefix], value, false]],
          context: contexts[variant],
        })
        for (const utility of [arbitrary, ordinary, alternate]) {
          const caller = `${variant}${utility}`
          expect(signature(after, caller)).toEqual(signature(before, caller))
          expect(signature(after, cn(named, caller))).toEqual(signature(before, caller))
          expect(signature(after, cn(caller, named))).toEqual(signature(after, named))
        }
      }
    }
    for (const root of [16, 20]) {
      expect(5 * root).toBe(root === 16 ? 80 : 100)
      expect(26 * root).toBe(root === 16 ? 416 : 520)
      expect(4.5 * root).toBe(root === 16 ? 72 : 90)
      expect(6 * root).toBe(root === 16 ? 96 : 120)
    }
  })
})

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
    const config = resourcePredecessor()
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
    const config = resourcePredecessor()
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
