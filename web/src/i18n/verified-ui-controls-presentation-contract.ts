import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import checkpoint from './__fixtures__/verified-ui-controls-presentation.json'
import { producerProjection, projectionDigest } from './producer-projection'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
expect(hash(JSON.stringify(checkpoint)), 'pinned UI and Smart Features source changes')
  .toBe('8e8bc756c2052feb085d9a7363bf13faa1703c3a320e6842c30564d4751071fa')
const patches = new Map(checkpoint.sources.map(patch => [patch.file, patch]))

export function restoreUiControlsPresentationSource(file: string, source: string): string {
  const patch = patches.get(file)
  if (!patch) return source
  expect(hash(source), file + ': exact current UI source').toBe(patch.after)
  const currentProjection = producerProjection(file, source)
  expect(projectionDigest(currentProjection), file + ': actual calls and controls').toBe(patch.afterProjection)

  const lines = source.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    lines.splice(hunk.start, hunk.count, ...hunk.previous)
  }
  const previous = lines.join('\n')
  expect(hash(previous), file + ': exact pre-UI source').toBe(patch.before)
  const previousProjection = producerProjection(file, previous)
  expect(projectionDigest(previousProjection), file + ': original calls and controls').toBe(patch.beforeProjection)
  expect(currentProjection.bindings, file + ': original translator and unit bindings').toEqual(previousProjection.bindings)
  const calls = currentProjection.calls.map(({ call }) => call)
  for (const { call } of previousProjection.calls) {
    const index = calls.indexOf(call)
    expect(index, file + ': preserved original call ' + call).toBeGreaterThanOrEqual(0)
    calls.splice(index, 1)
  }
  return previous
}
