import type { PackSelection } from '@/api/hooks/useAlertPacks'

export type PackDelivery = Required<Pick<PackSelection, 'cooldown_s' | 'trigger_mode' | 'include_title' | 'channel_ids'>>

export function resolvePackChannels(selection: PackSelection, defaults: PackDelivery): number[] | null {
  return selection.channel_ids === undefined ? defaults.channel_ids : selection.channel_ids
}

export function withPackChannels(selection: PackSelection, channels: number[] | null, defaults: PackDelivery): PackSelection {
  const defaultChannels = defaults.channel_ids
  const inherited = channels === defaultChannels || (channels !== null && defaultChannels !== null
    && channels.length === defaultChannels.length && channels.every(id => defaultChannels.includes(id)))
  return { ...selection, channel_ids: inherited ? undefined : channels }
}

export function hasPackDeliveryOverride(selection: PackSelection): boolean {
  return selection.cooldown_s != null || selection.trigger_mode != null || selection.include_title != null
    || selection.channel_ids !== undefined
}

export function resetPackDelivery(selection: PackSelection): PackSelection {
  const { cooldown_s: _cooldown, trigger_mode: _mode, include_title: _title, channel_ids: _channels, ...rest } = selection
  return rest
}
