/**
 * Incidents client and React Query hooks.
 *
 * Backs the incidents block on /system-status and the per-incident
 * post-mortem page. Mutations invalidate the list cache key so the UI stays
 * consistent after writes.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from '@/api/client'
import { safeArray } from '@/lib/safeArray'

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type IncidentSeverity = 'minor' | 'major' | 'critical'
export type IncidentSource = 'manual' | 'auto'

export interface IncidentUpdateEntry {
  at: string
  status: IncidentStatus
  message: string
  author?: string
}

export interface Incident {
  id: number
  title: string
  description: string
  severity: IncidentSeverity
  status: IncidentStatus
  source: IncidentSource
  affected_components: string[]
  updates: IncidentUpdateEntry[]
  started_at: string
  resolved_at?: string
  created_at: string
  updated_at: string
  created_by?: string
}

export interface IncidentListResponse {
  incidents: Incident[]
  count: number
}

const INCIDENTS_BASE = '/status/incidents'

export interface ListIncidentsParams {
  activeOnly?: boolean
  limit?: number
}

export function listIncidents(p: ListIncidentsParams = {}, opts?: { signal?: AbortSignal }) {
  const q = new URLSearchParams()
  if (p.activeOnly) q.set('active', '1')
  if (p.limit) q.set('limit', String(p.limit))
  const qs = q.toString()
  return request<IncidentListResponse>(`${INCIDENTS_BASE}${qs ? `?${qs}` : ''}`, { signal: opts?.signal })
}

export function getIncident(id: number, opts?: { signal?: AbortSignal }) {
  return request<Incident>(`${INCIDENTS_BASE}/${id}`, { signal: opts?.signal })
}

export interface CreateIncidentPayload {
  title: string
  description?: string
  severity?: IncidentSeverity
  status?: IncidentStatus
  affected_components?: string[]
  initial_message?: string
}

export function createIncident(p: CreateIncidentPayload) {
  return request<Incident>(INCIDENTS_BASE, {
    method: 'POST',
    body: JSON.stringify(p),
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface PatchIncidentPayload {
  title?: string
  description?: string
  severity?: IncidentSeverity
  status?: IncidentStatus
  affected_components?: string[]
  resolved?: boolean
}

export function patchIncident(id: number, p: PatchIncidentPayload) {
  return request<Incident>(`${INCIDENTS_BASE}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(p),
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface AppendIncidentUpdatePayload {
  message: string
  status?: IncidentStatus
}

export function appendIncidentUpdate(id: number, p: AppendIncidentUpdatePayload) {
  return request<Incident>(`${INCIDENTS_BASE}/${id}/updates`, {
    method: 'POST',
    body: JSON.stringify(p),
    headers: { 'Content-Type': 'application/json' },
  })
}

export function deleteIncident(id: number) {
  return request<void>(`${INCIDENTS_BASE}/${id}`, { method: 'DELETE' })
}

// ── React Query hooks ────────────────────────────────────────────

const KEY_LIST = (p: ListIncidentsParams) => ['status-incidents', 'list', p] as const
const KEY_DETAIL = (id: number) => ['status-incidents', 'detail', id] as const
const KEY_DETAIL_NOOP = ['status-incidents', 'detail', 'noop'] as const

/**
 * Guarantees the list payload is renderable no matter what the server (or a
 * proxy) sends: `incidents` is always an array — even when the endpoint
 * returns `{ "incidents": null }` — so consumers can `.map`/`.length` without
 * a `?? []` guard, and `count` stays coherent with the array it describes.
 */
function normalizeIncidentList(data: IncidentListResponse): IncidentListResponse {
  const incidents = safeArray(data?.incidents)
  return { incidents, count: data?.count ?? incidents.length }
}

export function useIncidents(p: ListIncidentsParams = {}) {
  return useQuery({
    queryKey: KEY_LIST(p),
    queryFn: ({ signal }) => listIncidents(p, { signal }),
    select: normalizeIncidentList,
    refetchInterval: 30_000,
  })
}

export function useIncident(id: number | null) {
  // Incident ids are always positive (the backend rejects id <= 0 with 400),
  // so treat null AND non-positive ids as "no selection" and keep the query
  // disabled instead of firing a request the server would reject.
  const enabled = id != null && id > 0
  return useQuery({
    queryKey: enabled ? KEY_DETAIL(id) : KEY_DETAIL_NOOP,
    queryFn: ({ signal }) => getIncident(id!, { signal }),
    enabled,
  })
}

function invalidateIncidents(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['status-incidents'] })
}

export function useCreateIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createIncident,
    onSuccess: () => invalidateIncidents(qc),
  })
}

export function usePatchIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PatchIncidentPayload }) =>
      patchIncident(id, payload),
    onSuccess: () => invalidateIncidents(qc),
  })
}

export function useAppendIncidentUpdate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AppendIncidentUpdatePayload }) =>
      appendIncidentUpdate(id, payload),
    onSuccess: () => invalidateIncidents(qc),
  })
}

export function useDeleteIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteIncident,
    onSuccess: () => invalidateIncidents(qc),
  })
}
