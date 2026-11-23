import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import checkpoint from './__fixtures__/verified-workspace-display.json'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
expect(hash(JSON.stringify(checkpoint)), 'pinned workspace display delta')
  .toBe('1e63b73e750ad5c824cfc2d431452b50fd21412e151d839feb06350f54c055b1')
const patches = new Map(checkpoint.sources.map(patch => [patch.file, patch]))

export function restoreWorkspaceDisplaySource(file: string, source: string): string {
  const patch = patches.get(file)
  if (!patch) return source
  expect(hash(source), file + ': exact current workspace display source').toBe(patch.after)
  const lines = source.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    expect(lines.slice(hunk.start, hunk.start + hunk.current.length), file + ': reviewed workspace display hunk').toEqual(hunk.current)
    lines.splice(hunk.start, hunk.current.length, ...hunk.previous)
  }
  const previous = lines.join('\n')
  expect(hash(previous), file + ': exact prior workspace display source').toBe(patch.before)
  return previous
}

export function catalogBeforeWorkspaceDisplay<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog)
  for (const { path, value } of checkpoint.copy) {
    let parent: Record<string, unknown> = previous
    for (const segment of path.slice(0, -1)) parent = parent[segment] as Record<string, unknown>
    const key = path[path.length - 1]
    expect(parent[key], path.join('.')).toBe(value)
    delete parent[key]
  }
  return previous
}
