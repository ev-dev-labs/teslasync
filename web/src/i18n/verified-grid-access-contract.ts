import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import checkpoint from './__fixtures__/verified-grid-access.json'
import { restoreUiControlsPresentationSource } from './verified-ui-controls-presentation-contract'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
expect(hash(JSON.stringify(checkpoint)), 'pinned grid/access delta')
  .toBe('dfde4c0e745b072b8de6ca2400fe3b664c81255c6f2bc06c21c1cfb8f981f32d')
const sourcePatches = new Map(checkpoint.sources.map(patch => [patch.file, patch]))

export function gridAccessRemovedSource(file: string): boolean {
  return sourcePatches.get(file)?.removed === true
}

export function restoreGridAccessSource(file: string, source: string): string {
  source = restoreUiControlsPresentationSource(file, source)
  const patch = sourcePatches.get(file)
  if (!patch) return source
  expect(hash(source), file + ': reviewed grid/access successor').toBe(patch.after)
  const lines = source.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    lines.splice(hunk.start, hunk.count, ...hunk.previous)
  }
  const previous = lines.join('\n')
  expect(hash(previous), file + ': exact pre-grid/access source').toBe(patch.before)
  return previous
}

export function catalogBeforeGridAccess<T extends Record<string, unknown>>(catalog: T): T {
  const previous = structuredClone(catalog)
  for (const change of checkpoint.copy) {
    let parent: Record<string, unknown> = previous
    for (const part of change.path.slice(0, -1)) parent = parent[part] as Record<string, unknown>
    const key = change.path[change.path.length - 1]
    expect(parent[key], change.path.join('.')).toEqual(change.current)
    if ('previous' in change) {
      let following: [string, unknown][] = []
      if ('beforeKey' in change) {
        const entries = Object.entries(parent)
        const index = entries.findIndex(([sibling]) => sibling === change.beforeKey)
        expect(index, change.path.join('.') + ': original insertion point').toBeGreaterThanOrEqual(0)
        following = entries.slice(index)
        for (const [sibling] of following) delete parent[sibling]
      }
      parent[key] = structuredClone(change.previous)
      for (const [sibling, value] of following) parent[sibling] = value
    } else delete parent[key]
  }
  return previous
}
