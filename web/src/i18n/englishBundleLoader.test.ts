import { describe, expect, it } from 'vitest'
import { loadEnglishBundleResource } from './englishBundleLoader'
import catalog from './en.json'

describe('deferred English bundle registry', () => {
  it('returns the original generated namespace resource without a module wrapper', async () => {
    const resources = await loadEnglishBundleResource('detail-toast')
    expect(resources.toast).toEqual(catalog.toast)
  })

  it('rejects unknown bundles without substituting a complete catalog', async () => {
    await expect(loadEnglishBundleResource('not-a-real-bundle')).rejects.toThrow(
      'Unknown English locale bundle: not-a-real-bundle',
    )
  })
})
