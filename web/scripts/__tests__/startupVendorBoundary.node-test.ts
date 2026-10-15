import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import ts from 'typescript'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const configText = readFileSync(resolve(webRoot, 'vite.config.ts'), 'utf8')
const source = ts.createSourceFile('vite.config.ts', configText, ts.ScriptTarget.Latest, true)

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression {
  const match = object.properties.find((entry) => (
    ts.isPropertyAssignment(entry) && entry.name.getText(source).replace(/['"]/g, '') === name
  ))
  assert.ok(match && ts.isPropertyAssignment(match), `Missing ${name}`)
  return match.initializer
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralExpression {
  const value = property(object, name)
  assert.ok(ts.isObjectLiteralExpression(value), `${name} must remain a static object`)
  return value
}

const exportStatement = source.statements.find(ts.isExportAssignment)
assert.ok(exportStatement && ts.isCallExpression(exportStatement.expression))
const config = exportStatement.expression.arguments[0]
assert.ok(ts.isObjectLiteralExpression(config))
const build = objectProperty(config, 'build')
const output = objectProperty(objectProperty(build, 'rollupOptions'), 'output')
const chunkObject = objectProperty(output, 'manualChunks')
const chunks = Object.fromEntries(chunkObject.properties.map((entry) => {
  assert.ok(ts.isPropertyAssignment(entry) && ts.isArrayLiteralExpression(entry.initializer))
  return [
    entry.name.getText(source).replace(/['"]/g, ''),
    entry.initializer.elements.map((element) => {
      assert.ok(ts.isStringLiteral(element))
      return element.text
    }),
  ]
}))

test('co-locates only the existing eager React, localization and motion dependencies', () => {
  assert.deepEqual(chunks['vendor-react'], [
    'react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'i18next', 'react-i18next', 'framer-motion',
  ])
  assert.equal(Object.hasOwn(chunks, 'vendor-i18n'), false)
  assert.equal(Object.values(chunks).flat().filter((module) => module === 'i18next').length, 1)
  assert.equal(Object.values(chunks).flat().filter((module) => module === 'react-i18next').length, 1)
  assert.equal(Object.values(chunks).flat().filter((module) => module === 'framer-motion').length, 1)
  assert.equal(Object.hasOwn(chunks, 'vendor-motion'), false)
})

test('retains lazy chart and map boundaries without force-grouping route icons', () => {
  assert.deepEqual(chunks['vendor-charts'], ['recharts'])
  assert.deepEqual(chunks['vendor-map'], ['leaflet', 'react-leaflet'])
  assert.equal(Object.values(chunks).flat().includes('lucide-react'), false)
  assert.deepEqual(Object.keys(chunks).sort(), [
    'vendor-charts', 'vendor-map', 'vendor-react',
  ])
})

test('keeps English shell initialization eager and leaves the browser target unchanged', () => {
  const main = readFileSync(resolve(webRoot, 'src', 'main.tsx'), 'utf8')
  const i18n = readFileSync(resolve(webRoot, 'src', 'i18n', 'index.ts'), 'utf8')
  assert.match(main, /import\s+['"]\.\/i18n['"]/)
  assert.match(i18n, /import\s+i18n\s+from\s+['"]i18next['"]/)
  assert.match(i18n, /import\s+\{\s*initReactI18next\s*\}\s+from\s+['"]react-i18next['"]/)
  assert.match(i18n, /import\s+englishShell\s+from\s+['"]\.\/en\/shell\.json['"]/)
  assert.match(i18n, /en:\s*\{\s*translation:\s*englishShell\s*\}/)
  assert.equal(build.properties.some((entry) => (
    ts.isPropertyAssignment(entry) && entry.name.getText(source) === 'target'
  )), false)
})

test('uses CommonJS dependency analysis rather than disabling require-order protection', () => {
  const commonjs = objectProperty(build, 'commonjsOptions')
  const strictRequires = property(commonjs, 'strictRequires')
  assert.ok(ts.isStringLiteral(strictRequires))
  assert.equal(strictRequires.text, 'auto')
  assert.deepEqual(commonjs.properties.map(entry => entry.name?.getText(source)), ['strictRequires'])
})
