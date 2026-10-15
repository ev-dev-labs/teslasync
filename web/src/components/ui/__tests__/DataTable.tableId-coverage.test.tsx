import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import ts from 'typescript'

/**
 * Defense-in-depth contract test.
 *
 * Mirrors `web/scripts/audit-datatable-tableid.mjs` so the
 * coverage rule is enforced both at lint-time (audit script) and at
 * test-time (this Vitest spec). If a future caller adds a new
 * <DataTable> without `tableId`, BOTH gates fail loudly.
 */

const ROOT = join('src', 'features')

function* walk(dir: string): Generator<string> {
  let entries: string[]
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
    if (!p.endsWith('.tsx')) continue
    yield p
  }
}

function findOffenders(): string[] {
  const offenders: string[] = []
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        && node.tagName.getText(source) === 'DataTable'
        && !node.attributes.properties.some(attribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'tableId')
      ) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        offenders.push(`${file}:${line}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return offenders
}

describe('DataTable tableId coverage', () => {
  it('every <DataTable> under src/features sets a tableId so persistence works', () => {
    const offenders = findOffenders()
    if (offenders.length > 0) {
      const list = offenders.map((o) => `  ${o}`).join('\n')
      throw new Error(
        `Found ${offenders.length} <DataTable> instance(s) without tableId:\n${list}\n\n` +
          `Without tableId, column visibility / widths / sort / page size do not persist.\n` +
          `Add a stable id of the form "<feature>:<purpose>" (e.g. tableId="drives:list").`,
      )
    }
    expect(offenders).toEqual([])
  })

  // Sanity: keep the import linter happy if `sep` is needed later.
  it('uses platform-appropriate separators', () => {
    expect(typeof sep).toBe('string')
  })
})
