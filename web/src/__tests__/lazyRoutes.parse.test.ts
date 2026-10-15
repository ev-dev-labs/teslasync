import { describe, expect, it } from 'vitest'
import { lazyBindings, manifestSpecifiers, sharedLoaderSpecifiers } from './lazyRoutes.parse'

const loaders = "export const Shared = () => import('./features/Shared')"
const namespace = "import * as routeLoaders from './loaders';"
const sources = { './loaders': loaders }

describe('exhaustive shared lazy-loader parsing', () => {
  it('resolves shared, inline, conditional and named-adapter bindings together', () => {
    expect(lazyBindings(`${namespace}
      const Shared = lazy(routeLoaders.Shared);
      const Direct = lazy(() => import('./features/Direct'));
      const Dev = import.meta.env.DEV ? lazy(() => import('./features/Dev')) : null;
      const Named = lazy(async () => {
        const module = await import('./features/Named');
        return { default: module.Named };
      });
      // const Ignored = lazy(routeLoaders.Missing);
    `, sources)).toEqual([
      { name: 'Shared', specifier: './features/Shared' },
      { name: 'Direct', specifier: './features/Direct' },
      { name: 'Dev', specifier: './features/Dev' },
      { name: 'Named', specifier: './features/Named' },
    ])
  })

  it('resolves import paths relative to the actual shared source owner', () => {
    expect(lazyBindings(
      "import * as routeLoaders from './lib/routeLoaders'; const Shared = lazy(routeLoaders.Shared)",
      { './lib/routeLoaders': "export const Shared = () => import('../features/Shared')" },
    )).toEqual([{ name: 'Shared', specifier: './features/Shared' }])
  })

  it.each([
    'const Missing = lazy(routeLoaders.Missing)',
    'const Dynamic = lazy(routeLoaders[key])',
    'const Called = lazy(routeLoaders.Shared())',
    'const Arbitrary = lazy(unregistered)',
    'const Extra = lazy(routeLoaders.Shared, anotherLoader)',
    'lazy(routeLoaders.Shared)',
    'function nested(routeLoaders) { const Shadowed = lazy(routeLoaders.Shared) }',
    'const routeLoaders = other; const Shadowed = lazy(routeLoaders.Shared)',
  ])('rejects unknown, computed, called, unbound or ambiguous loaders: %s', declaration => {
    expect(() => lazyBindings(`${namespace} ${declaration}`, sources)).toThrow()
  })

  it('rejects missing source ownership and type-only namespace imports', () => {
    expect(() => lazyBindings(`${namespace} const Shared = lazy(routeLoaders.Shared)`))
      .toThrow('Unknown shared loader')
    expect(() => lazyBindings(
      "import type * as routeLoaders from './loaders'; const Shared = lazy(routeLoaders.Shared)",
      sources,
    )).toThrow('Unknown shared loader')
  })

  it('rejects duplicate imported namespaces', () => {
    expect(() => lazyBindings(`${namespace} ${namespace} const Shared = lazy(routeLoaders.Shared)`, sources))
      .toThrow('Ambiguous')
  })

  it.each([
    "export const Shared = () => import(path)",
    "export const Shared = () => import(`./features/${name}`)",
    "export const Shared = (path) => import('./features/Shared')",
    "export const Shared = () => { import('./features/Shared'); return undefined }",
    "export const Shared = otherLoader",
    "export let Shared = () => import('./features/Shared')",
    "const Shared = () => import('./features/Shared')",
    "export const Shared = () => import('./features/Shared', options)",
    `${loaders}; ${loaders}`,
    `${loaders}; export const Duplicate = () => import('./features/Shared')`,
    '',
  ])('rejects incomplete, nonliteral or ambiguous shared sources: %s', source => {
    expect(() => sharedLoaderSpecifiers(source)).toThrow()
  })

  it('keeps inline static-import completeness and manifest negative controls', () => {
    expect(() => lazyBindings('const Dynamic = lazy(() => import(path))')).toThrow('static import')
    expect(() => lazyBindings("const Two = lazy(() => Promise.all([import('./a'), import('./b')]))"))
      .toThrow('exactly one static import')
    expect(() => lazyBindings('const Empty = lazy(() => Promise.resolve({}))'))
      .toThrow('exactly one static import')
    expect(() => manifestSpecifiers('const entries = [{ load: () => import(path) }]'))
      .toThrow('static import')
    expect(() => manifestSpecifiers("const entries = [{ load: () => Promise.all([import('./a'), import('./b')]) }]"))
      .toThrow('exactly one static import')
  })
})
