import { describe, expect, it } from 'vitest'
import { producerProjection } from './producer-projection'
import patches from './__fixtures__/verified-fleet-source-patches.json'
import { readFleetCurrentSource, restoreVerifiedFleetSource } from './verified-fleet-source-contract'
import { restoreNavOrientationSource } from './verified-horizontal-navigation-contract'
import { restoreSmartNotificationsSource } from './verified-smart-notifications-contract'

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
    const projection = producerProjection(file, restoreNavOrientationSource(file, restoreSmartNotificationsSource(file, source)))
    const previous = producerProjection(file, restoreVerifiedFleetSource(file, source))
    if (file === 'web/src/components/layout/Layout.tsx') {
      // The three legacy chrome translations are still present, now gated to
      // vertical/hybrid designs. Every other control and call stays exact.
      const gates = new Map([
        ["t('a11y.primaryNav', 'Primary')", "binary:&&:presentation.mode === 'standard'"],
        ["t('a11y.primaryHeader', 'Site header')", "binary:&&:presentation.mode === 'standard' && !sidebarOpen"],
        ["t('nav.openSidebar', 'Open sidebar')", "binary:&&:presentation.mode === 'standard' && !sidebarOpen"],
      ])
      for (const [call, gate] of gates) {
        const matches = previous.calls.filter(entry => entry.call === call)
        expect(matches).toHaveLength(1)
        const entry = matches[0]
        expect(entry.controls.filter(control => control === gate)).toHaveLength(1)
        entry.controls = entry.controls.map(control => control === gate
          ? gate.replace("'standard'", "'standard' && !horizontal") : control)
      }
    }
    expect(projection).toEqual(previous)
  })
})
