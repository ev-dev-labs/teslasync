import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import checkpoint from './__fixtures__/verified-mobile-grid-source.json'
import { producerProjection } from './producer-projection'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
expect(hash(JSON.stringify(checkpoint)), 'pinned mobile grid source delta')
  .toBe('ebaeee55386d402b4b60a9e3bd0ebafb97312881ec0c6499756a3b20eac4916b')
const patches = new Map(checkpoint.sources.map(patch => [patch.file, patch]))

export function restoreMobileGridSource(file: string, source: string): string {
  const patch = patches.get(file)
  if (!patch) return source
  expect(hash(source), file + ': exact current mobile grid source').toBe(patch.after)
  const lines = source.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    lines.splice(hunk.start, hunk.count, ...hunk.previous)
  }
  const previous = lines.join('\n')
  expect(hash(previous), file + ': exact pre-mobile-grid source').toBe(patch.before)
  const currentCopy = producerProjection(file, source)
  const previousCopy = producerProjection(file, previous)
  expect(currentCopy.bindings, file + ': original translator and unit bindings').toEqual(previousCopy.bindings)
  const calls = currentCopy.calls.map(({ call }) => call)
  for (const { call } of previousCopy.calls) {
    const index = calls.indexOf(call)
    expect(index, file + ': preserved original call ' + call).toBeGreaterThanOrEqual(0)
    calls.splice(index, 1)
  }
  return previous
}
