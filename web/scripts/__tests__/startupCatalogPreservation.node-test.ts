import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import ts from 'typescript'
import { build as viteBuild } from 'vite'
import { findEntryAssetNames, findModulePreloadAssetNames } from '../bundle-assets.mjs'

type Json = Record<string, unknown>
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readJson = (path: string): Json => JSON.parse(readFileSync(path, 'utf8')) as Json
const catalog = readJson(resolve(webRoot, 'src', 'i18n', 'en.json'))
const shell = readJson(resolve(webRoot, 'src', 'i18n', 'en', 'shell.json'))
const generated = readdirSync(resolve(webRoot, 'src', 'i18n', 'en'))
  .filter(name => name.startsWith('locale-') && name.endsWith('.json'))
  .map(name => readJson(resolve(webRoot, 'src', 'i18n', 'en', name)))
const remaining = ['error.request.title', 'error.unavailable.title', 'error.unsupported.title']

function leaves(resource: Json, prefix = ''): [string, unknown][] {
  return Object.entries(resource).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object' && !Array.isArray(value)
      ? leaves(value as Json, path)
      : [[path, value] as [string, unknown]]
  })
}

function nested(resource: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((value, segment) =>
    value && typeof value === 'object' ? (value as Json)[segment] : undefined, resource)
}

// Reuse the accepted producer ledger, not a second list of translated defaults.
const ledger = ts.createSourceFile('ledger.ts',
  readFileSync(resolve(webRoot, 'src', 'i18n', 'excluded-consistent-defaults.test.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true)
const declarations = ledger.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
const additionDeclaration = declarations.find(declaration => declaration.name.getText(ledger) === 'additions')
assert.ok(additionDeclaration?.initializer && ts.isAsExpression(additionDeclaration.initializer))
const additionArray = additionDeclaration.initializer.expression
assert.ok(ts.isArrayLiteralExpression(additionArray))
const additions = additionArray.elements.map(element => {
  assert.ok(ts.isArrayLiteralExpression(element))
  const [key, value] = element.elements
  assert.ok(ts.isStringLiteral(key) && ts.isStringLiteral(value))
  return [key.text, value.text] as const
})

test('preserves the complete accepted81 producer batch and all frozen old catalog leaves', () => {
  assert.equal(additions.length, 81)
  const addedKeys = new Set(additions.map(([key]) => key))
  assert.equal(addedKeys.size, 81)
  for (const [key, value] of additions) {
    assert.equal(nested(catalog, key), value, key)
    assert.ok([shell, ...generated].some(resource => nested(resource, key) === value), key)
  }
  const oldEntries = leaves(catalog).filter(([key]) => !addedKeys.has(key))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  assert.equal(oldEntries.length, 28176)
  assert.equal(createHash('sha256').update(JSON.stringify(oldEntries)).digest('hex'),
    'e04f0f9479fe65e8a0346bc7dd53d53f662cc66850c18440ceae702a43698966')
  assert.equal(leaves(catalog).length, 28257)
  for (const [key, value] of leaves(shell)) assert.deepEqual(nested(catalog, key), value, key)
})

test('keeps exactly the three real misses without changing PWA or Settings resources', () => {
  assert.deepEqual(JSON.parse(readFileSync(resolve(webRoot, 'src', 'i18n', 'known-missing-keys.json'), 'utf8')), remaining)
  for (const [file, field] of [['runtime-manifest.json', 'missing'], ['usage-manifest.json', 'knownMissingKeys']]) {
    assert.deepEqual(readJson(resolve(webRoot, 'src', 'i18n', 'en', file))[field], remaining)
  }
  for (const key of remaining) {
    for (const resource of [catalog, shell, ...generated]) {
      assert.equal(nested(resource, key), undefined)
    }
  }
  assert.equal(nested(catalog, 'settings.title'), 'Settings')
  for (const key of ['pwa.offline', 'pwa.update', 'pwa.cache']) {
    assert.deepEqual(nested(shell, key), nested(catalog, key), key)
  }
})

test('Vite automatic CommonJS wrapping preserves conditional non-execution and cyclic partial exports', async () => {
  const fixtureRoot = resolve(webRoot, 'node_modules', '__startup_boundary_fixtures__')
  const entry = resolve(fixtureRoot, 'entry.js')
  const fixtures = new Map([
    [entry, 'import conditional from "./conditional.cjs"; import cycle from "./cycle-a.cjs"; export { conditional, cycle };'],
    [resolve(fixtureRoot, 'conditional.cjs'), 'const state = require("./state.cjs"); state.push("before"); if (state.length < 0) require("./never.cjs"); state.push("after"); module.exports = state;'],
    [resolve(fixtureRoot, 'state.cjs'), 'module.exports = [];'],
    [resolve(fixtureRoot, 'never.cjs'), 'throw new Error("A conditional require executed eagerly");'],
    [resolve(fixtureRoot, 'cycle-a.cjs'), 'exports.value = "a-start"; const b = require("./cycle-b.cjs"); exports.value = "a-done"; exports.seen = b.seen;'],
    [resolve(fixtureRoot, 'cycle-b.cjs'), 'exports.seen = require("./cycle-a.cjs").value;'],
  ])
  for (const strictRequires of [true, 'auto'] as const) {
    const result = await viteBuild({
      configFile: false, root: webRoot, publicDir: false, envDir: false, logLevel: 'silent',
      plugins: [{
        name: 'in-memory-commonjs-order-fixtures',
        resolveId(source, importer) {
          if (source === entry) return entry
          if (importer?.startsWith(fixtureRoot) && source.startsWith('.')) {
            return resolve(dirname(importer), source)
          }
        },
        load(id) { return fixtures.get(id) },
      }],
      build: {
        write: false, minify: false, commonjsOptions: { strictRequires },
        rollupOptions: { input: entry, preserveEntrySignatures: 'strict', output: { format: 'es' } },
      },
    })
    assert.ok(!Array.isArray(result) && 'output' in result)
    const chunk = result.output.find(output => output.type === 'chunk' && output.isEntry)
    assert.ok(chunk?.type === 'chunk')
    const exports: { conditional: string[]; cycle: { value: string; seen: string } } =
      await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`)
    assert.deepEqual(exports.conditional, ['before', 'after'], String(strictRequires))
    assert.deepEqual(exports.cycle, { value: 'a-done', seen: 'a-start' }, String(strictRequires))
  }
})

function startup(dist: string) {
  const pending = [...findEntryAssetNames(dist), ...findModulePreloadAssetNames(dist)]
  const chunks = new Set<string>()
  const modules = new Map<string, string>()
  let gzipBytes = 0
  while (pending.length) {
    const name = pending.pop()
    assert.ok(name)
    if (chunks.has(name)) continue
    chunks.add(name)
    const bytes = readFileSync(resolve(dist, 'assets', name))
    gzipBytes += gzipSync(bytes).length
    const code = bytes.toString('utf8')
    for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*)["']\.\/([^"']+\.js)["']/g)) {
      pending.push(match[1])
    }
    const map = JSON.parse(readFileSync(resolve(dist, 'assets', `${name}.map`), 'utf8')) as {
      sources: string[]; sourcesContent: string[]
    }
    map.sources.forEach((source, index) => {
      const normalized = source.replaceAll('\\', '/')
      const sourceRoot = normalized.indexOf('/node_modules/') >= 0
        ? normalized.indexOf('/node_modules/') : normalized.lastIndexOf('/src/')
      const virtualRoot = normalized.indexOf('/@vite-plugin-pwa/')
      assert.ok(sourceRoot >= 0 || virtualRoot >= 0, `Unknown source root: ${source}`)
      const key = normalized.slice((sourceRoot >= 0 ? sourceRoot : virtualRoot) + 1)
      assert.equal(modules.has(key), false, `Duplicated startup module: ${key}`)
      modules.set(key, createHash('sha256').update(map.sourcesContent[index]).digest('hex'))
    })
  }
  return { gzipBytes, modules: [...modules].sort(([a], [b]) => a.localeCompare(b)) }
}

const baselineDist = process.env.STARTUP_CATALOG_BASELINE_DIST
const candidateDist = process.env.STARTUP_CATALOG_CANDIDATE_DIST
test('real private output reduces startup by at least 326 bytes with identical eager modules and source content', {
  skip: !baselineDist && !candidateDist ? 'Provide both private build directories for the measured regression' : false,
}, () => {
  assert.ok(baselineDist && candidateDist, 'Both private output directories are required')
  const before = startup(baselineDist)
  const after = startup(candidateDist)
  assert.deepEqual(after.modules, before.modules)
  assert.equal(before.gzipBytes, 409926)
  assert.ok(before.gzipBytes - after.gzipBytes >= 326,
    `Startup reduction ${before.gzipBytes - after.gzipBytes} bytes is below 326`)
  assert.ok(after.gzipBytes <= 409600, `Startup ${after.gzipBytes} bytes exceeds 409600`)
  console.log(JSON.stringify({
    baselineGzipBytes: before.gzipBytes, candidateGzipBytes: after.gzipBytes,
    reductionBytes: before.gzipBytes - after.gzipBytes, unchangedStaticModules: after.modules.length,
  }))
})
