import { describe, expect, it } from 'vitest'
import { producerProjection } from './producer-projection'
import patches from './__fixtures__/verified-fleet-source-patches.json'
import { readFleetCurrentSource, restoreVerifiedFleetSource } from './verified-fleet-source-contract'

describe('reviewed Fleet API and shared-control changes', () => {
  it.each(patches)('preserves the guarded predecessor and rejects unreviewed changes: $file', patch => {
    const source = readFleetCurrentSource(patch.file)
    const previous = restoreVerifiedFleetSource(patch.file, source)
    if (patch.after !== null) expect(previous, patch.file).not.toBe(source)
    expect(() => restoreVerifiedFleetSource(patch.file, source + '\n')).toThrow()
  })

  it.each([
    'web/src/components/layout/Layout.tsx',
    'web/src/components/layout/sidebar/CommandDeck.tsx',
  ])('preserves translation calls and their controls in %s', file => {
    const source = readFleetCurrentSource(file)
    expect(producerProjection(file, source))
      .toEqual(producerProjection(file, restoreVerifiedFleetSource(file, source)))
  })
})
