import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildCatalogArtifacts, routeBundlePaths, routeBundleSources } from '../split-i18n-catalog.mjs'
import { staticClosure, translationNamespaces } from '../i18n-source-graph.mjs'

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const module = './lib/routeLoaders'
const namespace = `import * as routeLoaders from '${module}';`
const shared = "export const Drives = () => import('../features/driving/pages/DrivesListPage')"
const route = '<Route path="drives" element={<SafeRoute name="Drives"><Drives /></SafeRoute>} />'
const manifest = JSON.parse(readFileSync(join(sourceRoot, 'i18n', 'en', 'usage-manifest.json'), 'utf8'))
const bundles = new Set(Object.keys(manifest.bundles))

test('static namespace evidence covers computed registry keys without treating unrelated strings as translations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'i18n-registry-'))
  const file = join(directory, 'registry.ts')
  try {
    writeFileSync(file, `
      const registry = [
        { i18nKey: 'routes.' + name.charAt(0).toLowerCase() + name.slice(1) },
        { i18nKey: \`nav.items.\${name}\` },
        { i18nKey: 'common.save' },
        { label: 'unrelated.value' },
        { i18nKey: dynamicName },
      ]
    `)
    assert.deepEqual([...translationNamespaces(file)].sort(), ['common', 'nav', 'routes'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('shared and inline lazy imports resolve identical route roots and static dependency closures', () => {
  const inline = `const Drives = lazy(() => import('./features/driving/pages/DrivesListPage')); ${route}`
  const referenced = `${namespace} const Drives = lazy(routeLoaders.Drives); ${route}`
  const original = routeBundleSources(inline, bundles)
  const resolved = routeBundleSources(referenced, bundles, { [module]: shared })
  assert.deepEqual(resolved, original)
  assert.equal(resolved.length, 1)
  assert.deepEqual(
    [...staticClosure(sourceRoot, resolved.map(entry => entry.file))].sort(),
    [...staticClosure(sourceRoot, original.map(entry => entry.file))].sort(),
  )
})

test('every current route root and dependency closure matches the original inline loader structure', () => {
  const app = readFileSync(join(sourceRoot, 'App.tsx'), 'utf8')
  const loaders = readFileSync(join(sourceRoot, 'lib', 'routeLoaders.ts'), 'utf8')
  const imports = new Map([...loaders.matchAll(/export const (\w+) = \(\) => import\('([^']+)'\)/g)]
    .map(([, name, specifier]) => [name, specifier.replace(/^\.\.\//, './')]))
  assert.equal(imports.size, 132)
  const inline = app.replace(/^import \* as routeLoaders from '\.\/lib\/routeLoaders'\r?\n/m, '')
    .replace(/lazy\(routeLoaders\.(\w+)\)/g, (_, name) => {
      assert.ok(imports.has(name), `missing original module for ${name}`)
      return `lazy(() => import('${imports.get(name)}'))`
    })
  const original = routeBundleSources(inline, bundles)
  const resolved = routeBundleSources(app, bundles)
  assert.deepEqual(resolved, original)
  assert.equal(resolved.length, Object.keys(manifest.routeBundles).length)
  assert.deepEqual(routeBundlePaths(app, bundles), manifest.routeBundles)
  assert.deepEqual(routeBundlePaths(app, bundles), routeBundlePaths(inline, bundles))
  assert.deepEqual(
    [...staticClosure(sourceRoot, resolved.map(entry => entry.file))].sort(),
    [...staticClosure(sourceRoot, original.map(entry => entry.file))].sort(),
  )
})

test('inline conditional and named export adapters remain exhaustive', () => {
  const app = `
    const Drives = import.meta.env.DEV ? lazy(() => import('./features/driving/pages/DrivesListPage')) : null;
    const Tasks = lazy(async () => {
      const module = await import('./features/onboarding/components/TaskOnboardingHost');
      return { default: module.TaskOnboardingHost };
    });
    <>${route}
    <Route path="tasks" element={<SafeRoute name="Tasks"><Tasks /></SafeRoute>} />
    </>
  `
  assert.deepEqual(routeBundlePaths(app, new Set([...bundles, 'onboarding'])),
    { '/drives': 'driving', '/tasks': 'onboarding' })
})

for (const declaration of [
  'const Drives = lazy(routeLoaders.Missing)',
  'const Drives = lazy(routeLoaders[key])',
  'const Drives = lazy(routeLoaders.Drives())',
  'const Drives = lazy(arbitrary)',
  'const Drives = lazy(routeLoaders.Drives, other)',
  'lazy(routeLoaders.Drives)',
  'function nested(routeLoaders) { const Drives = lazy(routeLoaders.Drives) }',
  'const routeLoaders = other; const Drives = lazy(routeLoaders.Drives)',
  'const { routeLoaders } = other; const Drives = lazy(routeLoaders.Drives)',
  'const named = function routeLoaders() { const Drives = lazy(routeLoaders.Drives) }',
  'const named = class routeLoaders { field = lazy(routeLoaders.Drives) }',
  'const Drives = lazy(() => import(path))',
  "const Drives = lazy(() => Promise.all([import('./a'), import('./b')]))",
  'const Drives = lazy(() => Promise.resolve({}))',
]) {
  test(`unknown, dynamic, unbound or shadowed loader fails explicitly: ${declaration}`, () => {
    assert.throws(() => routeBundleSources(`${namespace} ${declaration}; ${route}`, bundles, { [module]: shared }),
      /\[i18n-split\] App\.tsx lazy loader/)
  })
}

for (const body of [
  'export const Drives = () => import(path)',
  'export const Drives = () => import(`../features/${name}`)',
  "export const Drives = (path) => import('../features/driving/pages/DrivesListPage')",
  "export const Drives = () => { import('../features/driving/pages/DrivesListPage'); return undefined }",
  'export const Drives = anotherLoader',
  "export let Drives = () => import('../features/driving/pages/DrivesListPage')",
  "const Drives = () => import('../features/driving/pages/DrivesListPage')",
  "export const Drives = () => import('../features/driving/pages/DrivesListPage', options)",
  "export const Drives = () => import('../features/missing/NoSuchPage')",
  `${shared}; ${shared}`,
  `${shared}; export const Alias = () => import('../features/driving/pages/DrivesListPage')`,
  '',
]) {
  test(`shared source cannot lose module completeness: ${body}`, () => {
    assert.throws(() => routeBundleSources(`${namespace} const Drives = lazy(routeLoaders.Drives); ${route}`,
      bundles, { [module]: body }), /\[i18n-split\] App\.tsx lazy loader/)
  })
}

test('type-only, duplicate, unimported and unresolved shared namespaces fail rather than disappear', () => {
  for (const imports of [
    `import type * as routeLoaders from '${module}';`,
    `${namespace} ${namespace}`,
    `${namespace} import { other as routeLoaders } from './other';`,
    `${namespace} import routeLoaders from './other';`,
    '',
    "import * as routeLoaders from './missing-route-loaders';",
  ]) {
    assert.throws(() => routeBundleSources(`${imports} const Drives = lazy(routeLoaders.Drives); ${route}`,
      bundles, { [module]: shared }), /\[i18n-split\] App\.tsx lazy loader/)
  }
})

test('all generated catalog artifacts retain their existing byte contents', () => {
  const catalog = JSON.parse(readFileSync(join(sourceRoot, 'i18n', 'en.json'), 'utf8'))
  const { files } = buildCatalogArtifacts(catalog)
  assert.ok(files.size > 100)
  for (const [name, contents] of files) {
    assert.equal(contents, readFileSync(join(sourceRoot, 'i18n', 'en', name), 'utf8'), name)
  }
})
