import { createHash } from 'node:crypto'
import { expect } from 'vitest'
import { producerProjection } from './producer-projection'
import { restoreVerifiedFleetSource } from './verified-fleet-source-contract'
import patches from './__fixtures__/verified-theme-source-patches.json'

export function restoreVerifiedThemeSource(file: string, text: string): string {
  text = restoreVerifiedFleetSource(file, text)
  const patch = patches.find(entry => entry.file === file)
  if (!patch) return text

  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  expect(hash(text), file + ': current theme source').toBe(patch.after)
  const lines = text.split('\n')
  for (const hunk of [...patch.hunks].reverse()) {
    const index = hunk.new.length === 0 ? hunk.start : hunk.start - 1
    expect(lines.slice(index, index + hunk.new.length), file + ': theme patch').toEqual(hunk.new)
    lines.splice(index, hunk.new.length, ...hunk.old)
  }
  const previous = lines.join('\n')
  expect(hash(previous), file + ': previous theme source').toBe(patch.before)
  expect(producerProjection(file, text), file + ': translation calls and controls')
    .toEqual(producerProjection(file, previous))
  return previous
}
