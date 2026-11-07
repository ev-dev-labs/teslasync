import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import catalog from './en.json'
import themeCatalog from './en/locale-detail-theme.json'
import settings from './en/locale-settings.json'
import { catalogBeforeDashboardPolish } from './verified-combined-contract'
import { restoreVerifiedThemeSource } from './verified-theme-source-contract'
import patches from './__fixtures__/verified-theme-source-patches.json'

describe('reviewed theme changes', () => {
  it('preserves every guarded producer and its translation controls', () => {
    for (const patch of patches) {
      const source = readFileSync(resolve(process.cwd(), '..', patch.file), 'utf8')
      expect(restoreVerifiedThemeSource(patch.file, source), patch.file).not.toBe(source)
    }
  })

  it('rejects unreviewed changes to a guarded producer', () => {
    const patch = patches[0]
    const source = readFileSync(resolve(process.cwd(), '..', patch.file), 'utf8')
    expect(() => restoreVerifiedThemeSource(patch.file, source + '\n')).toThrow()
  })

  it('pins the new theme copy while preserving historical catalogs', () => {
    expect(catalogBeforeDashboardPolish(catalog).theme.saveFailed).toBeUndefined()
    expect(catalogBeforeDashboardPolish(catalog).theme.presets).toBeUndefined()
    expect(themeCatalog.theme.saveFailed).toBe(catalog.theme.saveFailed)
    expect(settings.theme.saveFailed).toBe(catalog.theme.saveFailed)
    expect(themeCatalog.theme.accentPresets).toEqual(catalog.theme.accentPresets)
    expect(settings.theme.accentPresets).toEqual(catalog.theme.accentPresets)

    const changed = structuredClone(catalog)
    changed.theme.saveFailed = 'Changed'
    expect(() => catalogBeforeDashboardPolish(changed)).toThrow()

    const changedPreset = structuredClone(catalog)
    changedPreset.theme.presets['neon-cyan'] = 'Changed'
    expect(() => catalogBeforeDashboardPolish(changedPreset)).toThrow()

    const changedCurrentPreset = structuredClone(catalog)
    changedCurrentPreset.theme.accentPresets['neon-cyan'] = 'Changed'
    expect(() => catalogBeforeDashboardPolish(changedCurrentPreset)).toThrow()
  })
})
