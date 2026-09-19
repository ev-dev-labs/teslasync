import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '@/api/client'
import { queryPolicy } from '@/api/queryPolicy'
import type { AlertRule } from '@/api/types'
import { safeArray } from '@/lib/safeArray'
import { invalidateAndBroadcast } from '@/lib/queryBroadcast'
import { notificationKeys } from './useNotifications'

export interface PackTemplate {
  id: string
  unit: string
  rule: AlertRule
}

export interface AlertPack {
  id: string
  version: number
  name: string
  description: string
  rules: PackTemplate[]
}

export interface PackMember {
  template_id: string
  rule_id: number | null
  name: string
  owned: boolean
  enabled: boolean
  shared: boolean
}

export interface PackInstallation {
  id: number
  pack_id: string
  name: string
  version: number
  scope_key: string
  created_at: string
  members: PackMember[]
}

export interface PackSelection {
  template_id: string
  op?: string
  channel_ids?: number[] | null
  value_num?: number
  message?: string
  cooldown_s?: number
  trigger_mode?: 'once' | 'repeat'
  include_title?: boolean
}

export interface InstallPackInput {
  name?: string
  pack_id: string
  version: number
  all_vehicles: boolean
  vehicle_ids: number[]
  enabled: boolean
  cooldown_s?: number
  trigger_mode?: 'once' | 'repeat'
  include_title?: boolean
  rules: PackSelection[]
}

export const packKeys = {
  catalog: ['alert-packs'] as const,
  installations: notificationKeys.packInstallations,
}

export function useAlertPacks() {
  return useQuery({
    queryKey: packKeys.catalog,
    queryFn: ({ signal }) => request<AlertPack[]>('/alerts/packs', { signal }),
    select: data => safeArray(data).map(pack => ({ ...pack, rules: safeArray(pack.rules) })),
    ...queryPolicy('reference'),
  })
}

export function usePackInstallations(page: number) {
  return useQuery({
    queryKey: [...packKeys.installations, page],
    queryFn: ({ signal }) => request<PackInstallation[]>(`/alerts/pack-installations?limit=20&offset=${page * 20}`, { signal }),
    select: data => safeArray(data).map(item => ({ ...item, members: safeArray(item.members) })),
    ...queryPolicy('operational'),
  })
}

export function useInstallAlertPack() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ pack_id, ...body }: InstallPackInput) =>
      request<PackInstallation>(`/alerts/packs/${encodeURIComponent(pack_id)}/install`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(client, { queryKey: notificationKeys.alertRules })
      invalidateAndBroadcast(client, { queryKey: packKeys.installations })
    },
  })
}

export function useRemoveAlertPack() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, delete_rule_ids }: { id: number; delete_rule_ids: number[] }) =>
      request<{ status: string }>(`/alerts/pack-installations/${id}/remove`, {
        method: 'POST', body: JSON.stringify({ delete_rule_ids }),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(client, { queryKey: notificationKeys.alertRules })
      invalidateAndBroadcast(client, { queryKey: packKeys.installations })
    },
  })
}
