import { describe, expect, it } from 'vitest'
import { hasPackDeliveryOverride, resetPackDelivery, resolvePackChannels, withPackChannels, type PackDelivery } from './packDelivery'

const defaults: PackDelivery = { cooldown_s: 900, trigger_mode: 'once', include_title: true, channel_ids: [2, 3] }
const selection = { template_id: 'battery-low', op: '<', value_num: 20, message: 'Reviewed message' }

describe('pack channel inheritance', () => {
  it.each([null, [], [2, 3]])('inherits %j only when the rule has no channel override', channel_ids => {
    const master = { ...defaults, channel_ids }
    expect(resolvePackChannels(selection, master)).toEqual(channel_ids)
    expect(resolvePackChannels({ ...selection, channel_ids: null }, master)).toBeNull()
    expect(resolvePackChannels({ ...selection, channel_ids: [] }, master)).toEqual([])
    expect(resolvePackChannels({ ...selection, channel_ids: [7] }, master)).toEqual([7])
  })

  it.each([null, [], [2, 3]])('returns to inheritance when edited channels match %j', channel_ids => {
    const master = { ...defaults, channel_ids }
    const sameChannels = channel_ids === null ? null : [...channel_ids].reverse()
    const reverted = withPackChannels({ ...selection, channel_ids: [7] }, sameChannels, master)
    expect(reverted.channel_ids).toBeUndefined()
    expect(hasPackDeliveryOverride(reverted)).toBe(false)
    expect(JSON.stringify(reverted)).toBe(JSON.stringify(selection))
    expect(resolvePackChannels(reverted, { ...master, channel_ids: [9] })).toEqual([9])
  })

  it.each([null, [], [7]])('keeps %j as a real channel-only override and can reset it', channel_ids => {
    const overridden = withPackChannels(selection, channel_ids, defaults)
    expect(hasPackDeliveryOverride(overridden)).toBe(true)
    expect(resolvePackChannels(overridden, defaults)).toEqual(channel_ids)
    expect(resetPackDelivery(overridden)).toEqual(selection)
  })

  it('clears all delivery fields without changing reviewed rule content', () => {
    const overridden = { ...selection, cooldown_s: 7200, trigger_mode: 'repeat' as const, include_title: false, channel_ids: [] }
    expect(resetPackDelivery(overridden)).toEqual(selection)
    expect(overridden.include_title).toBe(false)
    expect(overridden.channel_ids).toEqual([])
  })
})
