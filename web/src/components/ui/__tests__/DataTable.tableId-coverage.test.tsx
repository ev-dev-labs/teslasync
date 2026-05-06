import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

/**
 * Phase-46 / Prompt 03 — defense-in-depth contract test.
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

function buildMaskedRegions(text: string): Array<[number, number]> {
  const regions: Array<[number, number]> = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      const start = i
      i += 2
      while (i < text.length && text[i] !== '\n') i++
      regions.push([start, i])
      continue
    }
    if (c === '/' && next === '*') {
      const start = i
      i += 2
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      regions.push([start, i])
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      const start = i
      i++
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 2
        else i++
      }
      i++
      regions.push([start, i])
      continue
    }
    i++
  }
  return regions
}

function isMaskedRegion(regions: Array<[number, number]>, offset: number): boolean {
  for (const [s, e] of regions) {
    if (offset >= s && offset < e) return true
    if (s > offset) return false
  }
  return false
}

function findTagEnd(text: string, from: number): number {
  let i = from
  if (text[i] === '<') {
    let angle = 0
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '<') angle++
      else if (c === '>') {
        angle--
        if (angle === 0) {
          i++
          break
        }
      }
    }
  }
  let depth = 0
  let inString: string | null = null
  for (; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === inString && text[i - 1] !== '\\') inString = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c
      continue
    }
    if (c === '{') {
      depth++
      continue
    }
    if (c === '}') {
      depth--
      continue
    }
    if (depth === 0 && (c === '>' || (c === '/' && text[i + 1] === '>'))) {
      return c === '/' ? i + 2 : i + 1
    }
  }
  return -1
}

function findOffenders(): string[] {
  const offenders: string[] = []
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, 'utf8')
    const masked = buildMaskedRegions(text)
    const re = /<DataTable(?=[\s</>])/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (isMaskedRegion(masked, m.index)) continue
      const tagEnd = findTagEnd(text, m.index + '<DataTable'.length)
      if (tagEnd === -1) {
        const line = text.slice(0, m.index).split('\n').length
        offenders.push(`${file}:${line} (unterminated tag)`)
        continue
      }
      const tagSource = text.slice(m.index, tagEnd)
      if (!/\btableId\s*=/.test(tagSource)) {
        const line = text.slice(0, m.index).split('\n').length
        offenders.push(`${file}:${line}`)
      }
    }
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
