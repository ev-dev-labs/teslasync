#!/usr/bin/env node
// Phase-46 / Prompt 02 — useQuery / useInfiniteQuery `signal` audit.
//
// Scans every file under web/src/api/hooks/*.ts and uses the TypeScript
// compiler API to find every `useQuery({ ... })` / `useInfiniteQuery({ ... })`
// call. For each one, asserts that:
//
//   1. The `queryFn` is an arrow function or function expression whose
//      first parameter destructures `signal`. TanStack Query passes
//      `{ signal }` to the queryFn so the underlying fetch can be
//      cancelled when the query is unmounted/cancelled.
//
//   2. The body of the queryFn references `signal` somewhere (i.e. it
//      is forwarded to `request(...)` or to a helper). A queryFn that
//      destructures `signal` but never uses it would silently leak
//      cancellation.
//
// This audit complements the broader Phase-46 hardening: it locks in
// the property that no domain hook can ship a queryFn that ignores
// the cancellation contract. Run via `npm run audit:query-signal`.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const HOOK_ROOT = join('src', 'api', 'hooks')
const TARGETED_CALLEES = new Set(['useQuery', 'useInfiniteQuery'])

const offenders = []

/**
 * Walk a directory recursively and yield every `.ts` file path
 * (excluding `.test.ts` files — tests don't ship to production).
 */
function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const p = join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walk(p)
      continue
    }
    if (!p.endsWith('.ts')) continue
    if (p.endsWith('.test.ts')) continue
    yield p
  }
}

/**
 * Resolve a CallExpression's callee name. Handles both bare identifiers
 * (`useQuery(...)`) and dotted accesses (`tanstack.useQuery(...)`).
 */
function calleeName(node) {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text
  }
  if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
    return node.expression.name.text
  }
  return ''
}

/**
 * Find the first `queryFn:` PropertyAssignment within an object
 * literal (the only argument to `useQuery({ ... })`).
 */
function findQueryFnProperty(objLit) {
  for (const prop of objLit.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'queryFn'
    ) {
      return prop
    }
    // Shorthand or method shorthand — `queryFn() { ... }`
    if (ts.isMethodDeclaration(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'queryFn') {
      return prop
    }
  }
  return null
}

/**
 * Returns true when the function's first parameter destructures
 * `signal` (handles `({ signal })`, `({ signal, ... })`, and
 * renamings like `({ signal: sig })` — though renamings are also
 * flagged by the body-usage check below).
 */
function paramDestructuresSignal(fn) {
  const param = fn.parameters?.[0]
  if (!param) return false
  if (!ts.isObjectBindingPattern(param.name)) return false
  for (const element of param.name.elements) {
    if (!ts.isBindingElement(element)) continue
    // Property name comes from `propertyName` if present, else `name`.
    const sourceName =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : ts.isIdentifier(element.name)
          ? element.name.text
          : ''
    if (sourceName === 'signal') return true
  }
  return false
}

/**
 * Scan the body of a function for an Identifier reference named
 * `signal`. We deliberately do NOT require it to be an argument to
 * `request(...)` — the body may forward through a helper, and a
 * brittle "must be in second arg" check would generate false
 * positives. Anything that mentions `signal` in the body is treated
 * as forwarding it onward.
 */
function bodyReferencesSignal(fn) {
  if (!fn.body) return false
  let found = false
  const visit = (node) => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === 'signal') {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn.body, visit)
  return found
}

function locOf(file, sf, node) {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
  return `${file}:${line + 1}:${character + 1}`
}

function auditFile(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      if (TARGETED_CALLEES.has(name) && node.arguments.length > 0) {
        const arg = node.arguments[0]
        if (ts.isObjectLiteralExpression(arg)) {
          const queryFnProp = findQueryFnProperty(arg)
          if (queryFnProp) {
            let fn = null
            if (ts.isPropertyAssignment(queryFnProp)) {
              const init = queryFnProp.initializer
              if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
                fn = init
              }
            } else if (ts.isMethodDeclaration(queryFnProp)) {
              fn = queryFnProp
            }

            if (!fn) {
              offenders.push({
                where: locOf(file, sf, queryFnProp),
                why: `${name}: queryFn is not an inline arrow / function — cannot statically verify signal forwarding`,
              })
            } else {
              if (!paramDestructuresSignal(fn)) {
                offenders.push({
                  where: locOf(file, sf, fn),
                  why: `${name}: queryFn must accept \`{ signal }\` as its first parameter (TanStack Query passes the cancellation signal here)`,
                })
              } else if (!bodyReferencesSignal(fn)) {
                offenders.push({
                  where: locOf(file, sf, fn),
                  why: `${name}: queryFn destructures \`signal\` but never uses it in its body — pass it through to request() or a helper`,
                })
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

let scanned = 0
for (const file of walk(HOOK_ROOT)) {
  scanned++
  auditFile(file)
}

if (offenders.length > 0) {
  console.error(
    `\nuseQuery / useInfiniteQuery queryFn missing AbortSignal threading (${offenders.length}):`,
  )
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.why}`)
  }
  console.error(
    '\nFix by changing\n' +
      '  queryFn: () => request(`/path`)\n' +
      'to\n' +
      '  queryFn: ({ signal }) => request(`/path`, { signal })\n' +
      'so unmounting / route changes cancel the in-flight request.',
  )
  process.exit(1)
}

console.log(`OK — every useQuery/useInfiniteQuery queryFn in ${HOOK_ROOT} threads { signal } (${scanned} files scanned)`)
