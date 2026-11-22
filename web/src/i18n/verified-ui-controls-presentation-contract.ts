import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import checkpoint from './__fixtures__/verified-ui-controls-presentation.json'
import { producerProjection, projectionDigest } from './producer-projection'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
expect(hash(JSON.stringify(checkpoint)), 'pinned UI and Smart Features source changes')
  .toBe('20cf7a4eb6a48df31674d013ddf060976a18c72242a28bdab0e676dcf5cb66ba')
const patches = new Map(checkpoint.sources.map(patch => [patch.file, patch]))

export function restoreUiControlsPresentationSource(file: string, source: string): string {
  const patch = patches.get(file)
  if (!patch) return source
  if (file === 'web/src/components/ui/DataTable.tsx') {
    for (const [current, previous] of [
      ["hasInlineFilter ? 'min-h-8' : tableTokens.headLabelMinHeight,", "hasInlineFilter && 'min-h-8',"],
      ["tableTokens.headLabelMinHeight,\n                            'h-auto gap-1 p-0 text-[length:inherit] font-semibold leading-[inherit] select-none',",
        "'h-auto min-h-11 gap-1 p-0 text-size-inherit font-semibold select-none md:min-h-6',"],
    ]) {
      expect(source.split(current), file + ': shared header label sizing').toHaveLength(2)
      source = source.replace(current, previous)
    }
  }
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
