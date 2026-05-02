import { apiUrl, request } from './client'
import type {
  CaptureStats,
  TelemetryStatus,
  APICallLogResponse,
  APICallLogStats,
  APIUsage,
  CompressionStats,
  ExtendedHealthResponse,
  BackupStats,
  WorkersHealth,
  VersionInfo,
  UpdateCheckResult,
  StaleSessionsResponse,
  ChargingSession,
  Drive,
  BackupConfig,
  BackupRun,
  APIKey,
  AuditLog,
  ExportJobSummary,
  ExportJobSubmitRequest,
  ExportJobSubmitResponse,
  ChatResponse,
  ChatMessage,
  ChatSessionInfo,
} from './types'

// === Telemetry Capture ===
export const getCaptureStats = () => request<CaptureStats>('/dev-tools/telemetry-capture/stats')

// === Redis Signal Cache ===
export interface RedisSignalEntry {
  value: number | string | boolean
  type: 'number' | 'string' | 'boolean'
}

export interface RedisSignalsResponse {
  vehicle_id: number
  signal_count: number
  signals: Record<string, RedisSignalEntry>
}

export const getRedisSignals = (vehicleId: number) =>
  request<RedisSignalsResponse>(`/dev-tools/redis-signals?vehicle_id=${vehicleId}`)

// === Fleet Telemetry ===
export const getTelemetryStatus = () =>
  request<TelemetryStatus>('/telemetry')

// === API Call Logs ===
export const getAPICallLogs = (params: {
  limit?: number
  offset?: number
  method?: string
  status?: string
  endpoint?: string
  service?: string
  start?: string
  end?: string
} = {}) => {
  const query = new URLSearchParams()
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))
  if (params.method) query.set('method', params.method)
  if (params.status) query.set('status', params.status)
  if (params.endpoint) query.set('endpoint', params.endpoint)
  if (params.service) query.set('service', params.service)
  if (params.start) query.set('start', params.start)
  if (params.end) query.set('end', params.end)
  return request<APICallLogResponse>(`/api-logs?${query.toString()}`)
}

export const getAPICallLogStats = () => request<APICallLogStats>('/api-logs/stats')

// === System / Admin ===
export const getAPIUsage = () => request<APIUsage>('/system/api-usage')

export const getCompressionStats = () => request<CompressionStats>('/system/compression-stats')

export const getExtendedHealth = () => request<ExtendedHealthResponse>('/system/health')

export const getBackupStats = () => request<BackupStats>('/system/backup/stats')

// === Workers Health ===
/** Fetches health status of background worker services. */
export const getWorkersHealth = () => request<WorkersHealth>('/system/workers')

// === Version & Update Check ===
export const getVersionInfo = () => request<VersionInfo>('/system/version')
export const checkForUpdates = () => request<UpdateCheckResult>('/system/update-check')

// === Data Repair ===
export const getStaleSessions = () =>
  request<StaleSessionsResponse>('/data-repair/stale-sessions')
export const updateChargingSession = (id: number, data: Partial<ChargingSession>) =>
  request<ChargingSession>(`/data-repair/charging/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateDrive = (id: number, data: Partial<Drive>) =>
  request<Drive>(`/data-repair/drive/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const closeChargingSession = (id: number) =>
  request<void>(`/data-repair/charging/${id}/close`, { method: 'POST' })
export const closeDrive = (id: number) =>
  request<void>(`/data-repair/drive/${id}/close`, { method: 'POST' })
export const deleteChargingSession = (id: number) =>
  request<void>(`/data-repair/charging/${id}`, { method: 'DELETE' })
export const deleteDrive = (id: number) =>
  request<void>(`/data-repair/drive/${id}`, { method: 'DELETE' })

// === Backup & Restore ===
export const getBackupConfigs = () => request<BackupConfig[]>('/backup/configs')
export const getBackupConfig = (id: number) => request<BackupConfig>(`/backup/configs/${id}`)
export const createBackupConfig = (cfg: Partial<BackupConfig>) => request<BackupConfig>('/backup/configs', { method: 'POST', body: JSON.stringify(cfg), headers: { 'Content-Type': 'application/json' } })
export const updateBackupConfig = (id: number, cfg: Partial<BackupConfig>) => request<BackupConfig>(`/backup/configs/${id}`, { method: 'PUT', body: JSON.stringify(cfg), headers: { 'Content-Type': 'application/json' } })
export const deleteBackupConfig = (id: number) => request<void>(`/backup/configs/${id}`, { method: 'DELETE' })
export const triggerBackup = (configId: number) => request<BackupRun>(`/backup/configs/${configId}/trigger`, { method: 'POST' })
export const triggerQuickBackup = () => request<BackupRun>('/backup/quick', { method: 'POST' })
export const getBackupRuns = (limit = 50, offset = 0) => request<BackupRun[]>(`/backup/runs?limit=${limit}&offset=${offset}`)
export const getBackupRun = (id: number) => request<BackupRun>(`/backup/runs/${id}`)
export const downloadBackup = (runId: number) => window.open(apiUrl(`/backup/runs/${runId}/download`), '_blank')
export const verifyBackup = (runId: number) => request<{ verified: boolean; error?: string; checksum?: string }>(`/backup/runs/${runId}/verify`, { method: 'POST' })
export const previewRestore = (runId: number) => request<{ tables: { name: string; rows: number }[]; metadata: Record<string, unknown>; checksum_verified: boolean }>(`/backup/runs/${runId}/preview`)

// === API Keys ===
export const getAPIKeys = () => request<APIKey[]>('/api-keys')
export const createAPIKey = (data: { name: string; permissions: string }) =>
  request<APIKey & { key: string }>('/api-keys', { method: 'POST', body: JSON.stringify(data) })
export const deleteAPIKey = (id: number) =>
  request<void>(`/api-keys/${id}`, { method: 'DELETE' })
export const revokeAPIKey = (id: number) =>
  request<void>(`/api-keys/${id}/revoke`, { method: 'POST' })

// === Audit Logs ===
export const getAuditLogs = (limit = 50) =>
  request<AuditLog[]>(`/system/audit?limit=${limit}`)

// === Export Jobs (Async) ===
export const submitExportJob = (data: ExportJobSubmitRequest) =>
  request<ExportJobSubmitResponse>('/export/jobs', { method: 'POST', body: JSON.stringify(data) })
export const getExportJobs = (limit?: number, offset?: number) =>
  request<ExportJobSummary[]>(`/export/jobs?limit=${limit || 50}&offset=${offset || 0}`)
export const getExportJob = (jobId: string) =>
  request<ExportJobSummary>(`/export/jobs/${jobId}`)
export const getExportJobDownloadUrl = (jobId: string) =>
  apiUrl(`/export/jobs/${jobId}/download`)
export const submitImportJob = (type: 'import_drives' | 'import_charging', file: File) => {
  const formData = new FormData()
  formData.append('type', type)
  formData.append('file', file)
  // Override Content-Type to let browser set multipart/form-data with boundary
  return request<ExportJobSubmitResponse>('/export/jobs/import', {
    method: 'POST',
    body: formData,
    headers: {},
  })
}

// === Chatbot ===
/** Sends a user message and receives an AI assistant response. */
export const sendChatMessage = (message: string, sessionId?: string) =>
  request<ChatResponse>('/chatbot', { method: 'POST', body: JSON.stringify({ message, session_id: sessionId }) })
/** Fetches the full chat history for a given session. */
export const getChatHistory = (sessionId: string) =>
  request<ChatMessage[]>(`/chatbot/history?session_id=${sessionId}`)
/** Lists chat sessions with rich metadata (title, message count, timestamps). */
export const getChatSessions = () => request<ChatSessionInfo[]>('/chatbot/sessions')
/** Renames a chat session. Pass an empty `title` to clear the override. */
export const renameChatSession = (sessionId: string, title: string) =>
  request<{ id: string; title: string }>(`/chatbot/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
/** Deletes a chat session and all its messages. */
export const deleteChatSession = (sessionId: string) =>
  request<void>(`/chatbot/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
