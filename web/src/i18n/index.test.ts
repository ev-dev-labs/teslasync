import { describe, expect, it } from 'vitest'
import i18n, { loadEnglishResources } from './index'

describe('deferred English resources', () => {
  it('keeps first-render defaults readable and hydrates the catalog once', async () => {
    expect(i18n.t('nav.dashboard', 'Dashboard fallback')).toBe('Dashboard fallback')

    const firstLoad = loadEnglishResources()
    const concurrentLoad = loadEnglishResources()

    expect(concurrentLoad).toBe(firstLoad)
    await firstLoad
    expect(i18n.t('nav.dashboard', 'Dashboard fallback')).toBe('Dashboard')
  })
})
