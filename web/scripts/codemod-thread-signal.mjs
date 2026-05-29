#!/usr/bin/env node
// one-shot codemod.
//
// For every web/src/api/hooks/*.ts file, rewrites every
// `useQuery({ queryFn: ... })` and `useInfiniteQuery({ queryFn: ... })`
// arrow function to:
//
// 1. Accept `{ signal }` as its first parameter.
// 2. Append `signal` (or `, { signal }`) to every `request(...)` call
// inside the queryFn body.
//
// This is a one-time helper; it lives in scripts/ for reproducibility
// but is not wired into the build.
//
// Usage: node scripts/codemod-thread-signal.mjs

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const HOOK_ROOT = join('src', 'api', 'hooks')
const TARGETED_CALLEES = new Set(['useQuery', 'useInfiniteQuery'])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) yield p
  }
}

function calleeName(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
    return node.expression.name.text
  }
  return ''
}

function findQueryFnProperty(objLit) {
  for (const prop of objLit.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'queryFn'
    ) {
      return prop
    }
  }
  return null
}

function paramDestructuresSignal(fn) {
  const param = fn.parameters?.[0]
  if (!param) return false
  if (!ts.isObjectBindingPattern(param.name)) return false
  for (const element of param.name.elements) {
    if (!ts.isBindingElement(element)) continue
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
 * Mutating rewrite using string-edit ranges. We collect a list of
 * {start, end, replacement } edits during AST traversal and apply
 * them in reverse order so earlier offsets stay valid.
 */
function transformFile(file) {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

  /** @type {Array<{start:number,end:number,replacement:string}>} */
  const edits = []

  /**
 * Append `, { signal }` (or merge into an existing options object)
 * to every CallExpression named `request` inside `body`.
 */
  function patchRequestCalls(body) {
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const isRequestCall =
          ts.isIdentifier(node.expression) && node.expression.text === 'request'
        if (isRequestCall) {
          const args = node.arguments
          const close = node.end - 1 // position of `)` — the call ends with)
          if (args.length === 1) {
            // request<T>(`/path`) → request<T>(`/path`, { signal })
            const insertAt = args[0].end
            edits.push({
              start: insertAt,
              end: insertAt,
              replacement: ', { signal }',
            })
          } else if (args.length >= 2) {
            const second = args[1]
            if (ts.isObjectLiteralExpression(second)) {
              const props = second.properties
              const alreadyHasSignal = props.some(
                (p) =>
                  (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
                  ts.isIdentifier(p.name) &&
                  p.name.text === 'signal',
              )
              if (!alreadyHasSignal) {
                // Insert before the closing `}` of the object literal.
                const objClose = second.end - 1
                // Detect if the object is empty: `{}` -> insert `signal`,
                // otherwise insert `, signal` after the last property's
                // text (or before the closing brace).
                const objText = src.slice(second.pos, second.end)
                const isEmpty = props.length === 0
                if (isEmpty) {
                  edits.push({
                    start: objClose,
                    end: objClose,
                    replacement: ' signal ',
                  })
                } else {
                  // Place before the `}` with a leading comma. Whitespace
                  // before `}` may be a trailing newline; we handle both.
                  const trailingTrim = objText.match(/(\s*)\}$/)
                  const padBefore = trailingTrim ? trailingTrim[1] : ' '
                  edits.push({
                    start: objClose - padBefore.length,
                    end: objClose - padBefore.length,
                    replacement: `, signal${padBefore.length === 0 ? ' ' : ''}`,
                  })
                }
              }
            } else {
              // Second arg is not an object literal (e.g. a variable).
              // Replace `req(path, opts)` with `req(path, { ...opts, signal })`.
              const startOfArg = second.getStart(sf)
              const endOfArg = second.end
              const argText = src.slice(startOfArg, endOfArg)
              edits.push({
                start: startOfArg,
                end: endOfArg,
                replacement: `{ ...${argText}, signal }`,
              })
            }
          }
          // Avoid re-applying to nested calls inside the args we just
          // patched — but nested `request(` is rare; let normal recursion
          // pick them up.
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
  }

  /**
   * Patch the parameter list of a queryFn arrow / function expression.
   *
   * `() => ...`              → `({ signal }) => ...`
   * `(arg) => ...`           → `({ signal }) => ...`   (shouldn't happen in practice)
   * `async () => ...`        → `async ({ signal }) => ...`
   */
  function patchParamList(fn) {
    const open = src.indexOf('(', fn.getStart(sf))
    if (open === -1) return
    // Find matching `)` accounting for nested tokens — but the param
    // list of a queryFn is always flat. Use the first ')'.
    const close = src.indexOf(')', open)
    if (close === -1) return
    edits.push({
      start: open,
      end: close + 1,
      replacement: '({ signal })',
    })
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      if (TARGETED_CALLEES.has(name) && node.arguments.length > 0) {
        const arg = node.arguments[0]
        if (ts.isObjectLiteralExpression(arg)) {
          const queryFnProp = findQueryFnProperty(arg)
          if (queryFnProp && ts.isPropertyAssignment(queryFnProp)) {
            const init = queryFnProp.initializer
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
              if (!paramDestructuresSignal(init)) {
                patchParamList(init)
              }
              if (init.body) {
                patchRequestCalls(init.body)
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (edits.length === 0) return false

  // Apply edits in reverse offset order so earlier indices stay valid.
  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end)
  }
  writeFileSync(file, out, 'utf8')
  return true
}

let changed = 0
for (const f of walk(HOOK_ROOT)) {
  if (transformFile(f)) {
    changed++
    console.log(`  patched ${f}`)
  }
}
console.log(`\nDone — ${changed} file(s) patched`)
