import { describe, expect, it } from 'vitest'
import catalog from './en.json'
import adminCatalog from './en/locale-admin.json'
import { catalogBeforeDashboardPolish } from './verified-combined-contract'

describe('reviewed Fleet API wording', () => {
  it('ships the reviewed copy in the admin catalog and preserves the historical catalog', () => {
    const previous = catalogBeforeDashboardPolish(catalog)
    expect(previous.fleetApi.counts).toBeUndefined()
    expect(previous.fleetApi.polling.automatic).toBeUndefined()
    expect(previous.fleetApi.controls.bulkAccess).toBe('Access all')
    expect(previous.fleetApi.controls.title).toBe('API endpoint controls')
    expect(adminCatalog.fleetApi).toEqual(catalog.fleetApi)
  })

  it('rejects altered and unreviewed Fleet API copy', () => {
    const changed = structuredClone(catalog)
    changed.fleetApi.polling.actionsHelp = 'Changed'
    expect(() => catalogBeforeDashboardPolish(changed)).toThrow()

    const extended = structuredClone(catalog)
    Object.assign(extended.fleetApi.polling, { unreviewed: 'Unreviewed copy' })
    expect(catalogBeforeDashboardPolish(extended)).not.toEqual(catalogBeforeDashboardPolish(catalog))
  })
})
