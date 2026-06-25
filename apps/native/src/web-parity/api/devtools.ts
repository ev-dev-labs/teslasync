import { Linking } from 'react-native';

import { ApiError, apiUrl, request } from '../../api/client';
import type { ChargingSession, Drive } from '../../api/types';

// === Telemetry Capture ===
export const getCaptureStats = () =>
  request<CaptureStats>('/dev-tools/telemetry-capture/stats');

// === Redis Signal Cache ===
export interface RedisSignalEntry {
  value: number | string | boolean;
  type: 'number' | 'string' | 'boolean';
}

export interface RedisSignalsMeta {
  live_signal_store_mode: 'hybrid' | 'local';
  redis_key: string;
  redis_field_count: number;
  l1_signal_count: number;
  l1_last_seen_at: string | null;
  l2_last_seen_at: string | null;
  vehicle_vin: string;
}

export interface RedisSignalsResponse {
  vehicle_id: number;
  signal_count: number;
  signals: Record<string, RedisSignalEntry>;
  meta?: RedisSignalsMeta;
}

export interface RedisSignalKeyEntry {
  vehicle_id: number;
  field_count: number;
  vehicle_vin?: string;
  display_name?: string;
}

export interface RedisSignalKeysResponse {
  keys: RedisSignalKeyEntry[];
  total: number;
}

export const getRedisSignals = (vehicleId: number) =>
  request<RedisSignalsResponse>(`/dev-tools/redis-signals?vehicle_id=${vehicleId}`);

export const getRedisSignalKeys = (limit = 50) =>
  request<RedisSignalKeysResponse>(`/dev-tools/redis-signals/keys?limit=${limit}`);

export interface RedisSignalsPurgeResponse {
  vehicle_id: number;
  purged: boolean;
}

export interface RedisSignalsPurgeAllResponse {
  purged: number;
  scanned: number;
  limit: number;
  has_more: boolean;
}

export const purgeRedisSignals = (vehicleId: number) =>
  request<RedisSignalsPurgeResponse>(
    `/dev-tools/redis-signals?vehicle_id=${vehicleId}`,
    { method: 'DELETE' },
  );

export const purgeAllRedisSignals = () =>
  request<RedisSignalsPurgeAllResponse>('/dev-tools/redis-signals/keys', {
    method: 'DELETE',
  });

// === Fleet Telemetry ===
export const getTelemetryStatus = () => request<TelemetryStatus>('/telemetry');

// === API Call Logs ===
export const getAPICallLogs = (
  params: {
    limit?: number;
    offset?: number;
    method?: string;
    status?: string;
    endpoint?: string;
    service?: string;
    start?: string;
    end?: string;
  } = {},
) => {
  const query = new URLSearchParams();
  if (params.limit) {
    query.append('limit', String(params.limit));
  }
  if (params.offset) {
    query.append('offset', String(params.offset));
  }
  if (params.method) {
    query.append('method', params.method);
  }
  if (params.status) {
    query.append('status', params.status);
  }
  if (params.endpoint) {
    query.append('endpoint', params.endpoint);
  }
  if (params.service) {
    query.append('service', params.service);
  }
  if (params.start) {
    query.append('start', params.start);
  }
  if (params.end) {
    query.append('end', params.end);
  }
  return request<APICallLogResponse>(`/api-logs?${query.toString()}`);
};

export const getAPICallLogStats = () =>
  request<APICallLogStats>('/api-logs/stats');

// === System / Admin ===
export const getAPIUsage = () => request<APIUsage>('/system/api-usage');

export const getCompressionStats = () =>
  request<CompressionStats>('/system/compression-stats');

export const getExtendedHealth = () =>
  request<ExtendedHealthResponse>('/system/health');

export const getBackupStats = () => request<BackupStats>('/system/backup/stats');

export const getErrorStats = () => request<ErrorStats>('/system/errors/stats');

// === Workers Health ===
/** Fetches health status of background worker services. */
export const getWorkersHealth = () => request<WorkersHealth>('/system/workers');

// === Version & Update Check ===
export const getVersionInfo = () => request<VersionInfo>('/system/version');
export const checkForUpdates = () =>
  request<UpdateCheckResult>('/system/update-check');

// === Data Repair ===
export const getStaleSessions = () =>
  request<StaleSessionsResponse>('/data-repair/stale-sessions');
export const updateChargingSession = (
  id: number,
  data: Partial<ChargingSession>,
) =>
  request<ChargingSession>(`/data-repair/charging/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
export const updateDrive = (id: number, data: Partial<Drive>) =>
  request<Drive>(`/data-repair/drive/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
export const closeChargingSession = (id: number) =>
  request<void>(`/data-repair/charging/${id}/close`, { method: 'POST' });
export const closeDrive = (id: number) =>
  request<void>(`/data-repair/drive/${id}/close`, { method: 'POST' });
export const deleteChargingSession = (id: number) =>
  request<void>(`/data-repair/charging/${id}`, { method: 'DELETE' });
export const deleteDrive = (id: number) =>
  request<void>(`/data-repair/drive/${id}`, { method: 'DELETE' });

// === Backup & Restore ===
export const getBackupConfigs = () => request<BackupConfig[]>('/backup/configs');
export const getBackupConfig = (id: number) =>
  request<BackupConfig>(`/backup/configs/${id}`);
export const createBackupConfig = (cfg: Partial<BackupConfig>) =>
  request<BackupConfig>('/backup/configs', {
    method: 'POST',
    body: JSON.stringify(cfg),
    headers: { 'Content-Type': 'application/json' },
  });
export const updateBackupConfig = (
  id: number,
  cfg: Partial<BackupConfig>,
) =>
  request<BackupConfig>(`/backup/configs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(cfg),
    headers: { 'Content-Type': 'application/json' },
  });
export const deleteBackupConfig = (id: number) =>
  request<void>(`/backup/configs/${id}`, { method: 'DELETE' });
export const triggerBackup = (configId: number) =>
  request<BackupRun>(`/backup/configs/${configId}/trigger`, { method: 'POST' });
export const triggerQuickBackup = () =>
  request<BackupRun>('/backup/quick', { method: 'POST' });
export const getBackupRuns = (limit = 50, offset = 0) =>
  request<BackupRun[]>(`/backup/runs?limit=${limit}&offset=${offset}`);
export const getBackupRun = (id: number) =>
  request<BackupRun>(`/backup/runs/${id}`);
export const downloadBackup = (runId: number) =>
  Linking.openURL(apiUrl(`/backup/runs/${runId}/download`));
export const verifyBackup = (runId: number) =>
  request<{ verified: boolean; error?: string; checksum?: string }>(
    `/backup/runs/${runId}/verify`,
    { method: 'POST' },
  );
export const previewRestore = (runId: number) =>
  request<{
    tables: { name: string; rows: number }[];
    metadata: Record<string, unknown>;
    checksum_verified: boolean;
  }>(`/backup/runs/${runId}/preview`);

// === API Keys ===
export const getAPIKeys = () => request<APIKey[]>('/api-keys');
export const createAPIKey = (data: { name: string; permissions: string }) =>
  request<APIKey & { key: string }>('/api-keys', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const deleteAPIKey = (id: number) =>
  request<void>(`/api-keys/${id}`, { method: 'DELETE' });
export const revokeAPIKey = (id: number) =>
  request<void>(`/api-keys/${id}/revoke`, { method: 'POST' });

// === Audit Logs ===
export const getAuditLogs = (limit = 50) =>
  request<AuditLog[]>(`/system/audit?limit=${limit}`);

// === Export Jobs (Async) ===
export const submitExportJob = (data: ExportJobSubmitRequest) =>
  request<ExportJobSubmitResponse>('/export/jobs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const getExportJobs = (limit?: number, offset?: number) =>
  request<ExportJobSummary[]>(
    `/export/jobs?limit=${limit || 50}&offset=${offset || 0}`,
  );
export const getExportJob = (jobId: string) =>
  request<ExportJobSummary>(`/export/jobs/${jobId}`);
export const getExportJobDownloadUrl = (jobId: string) =>
  apiUrl(`/export/jobs/${jobId}/download`);

export interface NativeImportFile {
  uri: string;
  name: string;
  type?: string;
}

export type ImportUploadFile = Blob | NativeImportFile;

function isNativeImportFile(file: ImportUploadFile): file is NativeImportFile {
  return (
    typeof file === 'object' &&
    file !== null &&
    'uri' in file &&
    typeof file.uri === 'string' &&
    'name' in file &&
    typeof file.name === 'string'
  );
}

function appendImportFile(formData: FormData, file: ImportUploadFile): void {
  if (isNativeImportFile(file)) {
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type ?? 'application/octet-stream',
    } as unknown as Blob);
    return;
  }

  formData.append('file', file);
}

async function parseImportError(
  response: Response,
): Promise<{ message: string; code?: string }> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return {
      message:
        typeof body.error === 'string' && body.error.trim() !== ''
          ? body.error
          : response.statusText,
      code:
        typeof body.code === 'string' && body.code.trim() !== ''
          ? body.code
          : undefined,
    };
  }

  const text = await response.text().catch(() => '');
  return { message: text || response.statusText };
}

async function requestImportJob(
  formData: FormData,
): Promise<ExportJobSubmitResponse> {
  const response = await fetch(apiUrl('/export/jobs/import'), {
    credentials: 'include',
    method: 'POST',
    body: formData,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const { message, code } = await parseImportError(response);
    throw new ApiError(message, response.status, code);
  }

  return (await response.json()) as ExportJobSubmitResponse;
}

export const submitImportJob = (
  type: 'import_drives' | 'import_charging',
  file: ImportUploadFile,
) => {
  const formData = new FormData();
  formData.append('type', type);
  appendImportFile(formData, file);
  return requestImportJob(formData);
};

// === Chatbot ===
/** Sends a user message and receives an AI assistant response. */
export const sendChatMessage = (message: string, sessionId?: string) =>
  request<ChatResponse>('/chatbot', {
    method: 'POST',
    body: JSON.stringify({ message, session_id: sessionId }),
  });
/** Fetches the full chat history for a given session. */
export const getChatHistory = (
  sessionId: string,
  opts?: { signal?: AbortSignal | null },
) => request<ChatMessage[]>(`/chatbot/history?session_id=${sessionId}`, {
  signal: opts?.signal ?? undefined,
});
/** Lists chat sessions with rich metadata (title, message count, timestamps). */
export const getChatSessions = (opts?: { signal?: AbortSignal | null }) =>
  request<ChatSessionInfo[]>('/chatbot/sessions', {
    signal: opts?.signal ?? undefined,
  });
/** Renames a chat session. Pass an empty `title` to clear the override. */
export const renameChatSession = (sessionId: string, title: string) =>
  request<{ id: string; title: string }>(
    `/chatbot/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    },
  );
/** Deletes a chat session and all its messages. */
export const deleteChatSession = (sessionId: string) =>
  request<void>(`/chatbot/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });

export interface WorkerStatus {
  name: string;
  host: string;
  status: 'healthy' | 'unhealthy' | 'down';
  latency_ms: number;
  error?: string;
}

export interface WorkersHealth {
  workers: WorkerStatus[];
  total: number;
  healthy_count: number;
}

export interface ChatMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ChatResponse {
  response: string;
  session_id: string;
}

export interface ChatSessionInfo {
  id: string;
  title: string | null;
  first_message: string | null;
  message_count: number;
  last_message_at: string | null;
  created_at: string | null;
}

export interface APIKey {
  id: number;
  name: string;
  key_prefix: string;
  permissions: string;
  last_used_at?: string;
  created_at: string;
  expires_at?: string;
}

export interface AuditLog {
  id: number;
  action: string;
  resource: string;
  details: string;
  ip: string;
  created_at: string;
}

export interface APIUsage {
  total_requests: number;
  skipped_polls: number;
  estimated_cost: number;
  cost_per_request: number;
  monthly_credit: number;
  estimated_remaining: number;
}

export interface CompressionStats {
  total: number;
  compressed: number;
  savings_percent: number;
  total_positions: number;
  compressed_positions: number;
  estimated_saved_rows: number;
  estimated_saved_bytes: number;
}

export interface ExtendedHealthResponse {
  status: string;
  components: Record<
    string,
    {
      status: string;
      latency_ms?: number;
      last_check?: string;
      consecutive_failures?: number;
    }
  >;
  database: { status: string; latency_ms: number };
  database_pool: {
    total_conns: number;
    idle_conns: number;
    acquired_conns: number;
  };
  system: { goroutines: number; go_version: string; uptime_seconds: number };
}

export interface BackupStats {
  database_size: string;
  table_count: number;
  row_counts: Record<string, number>;
}

export interface ErrorStatsByCode {
  count: number;
  last_seen: string;
  last_message: string;
}

export interface ErrorStats {
  total_errors: number;
  uptime: string;
  by_code: Record<string, ErrorStatsByCode>;
}

export interface APICallLog {
  id: number;
  ts: string;
  vehicle_id: number | null;
  service: string;
  http_method: string;
  endpoint: string;
  status_code: number | null;
  duration_ms: number;
  error_message: string | null;
  rate_limited: boolean;
  request_body: string | null;
  response_body: string | null;
}

export interface APICallLogResponse {
  data: APICallLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface APICallLogStats {
  total_calls: number;
  by_method: Record<string, number>;
  by_service: Record<string, number>;
  error_rate: number;
  error_count: number;
  avg_duration_ms: number;
  last_24h: number;
}

export interface VersionInfo {
  app_version: string;
  chart_version: string;
  go_version: string;
  os: string;
  arch: string;
  uptime_seconds: number;
  goroutines: number;
  endpoints?: {
    api?: string;
    web?: string;
    oauth_callback?: string;
    tesla_api?: string;
  };
}

export interface UpdateCheckResult {
  current: string;
  latest: string;
  update_available: boolean;
  checked_at?: string;
  message?: string;
}

export interface ExportJobSummary {
  id: string;
  type: string;
  format: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  file_name: string;
  file_size: number;
  record_count: number;
  error_message: string;
  created_at: string;
  completed_at: string | null;
}

export interface ExportJobSubmitRequest {
  type: 'drives' | 'charging' | 'backup' | 'analytics' | 'import_drives' | 'import_charging';
  format?: 'csv' | 'json';
  vehicle_id?: number;
  start?: string;
  end?: string;
}

export interface ExportJobSubmitResponse {
  id: string;
  type: string;
  format: string;
  status: string;
  message: string;
}

export interface TelemetryStatus {
  enabled: boolean;
  mode: string;
  endpoint: string;
  protocol: string;
  supported_signals: string[];
  mqtt_publishing: boolean;
  speed_comparison?: {
    fleet_telemetry_latency: string;
    fleet_api_polling: string;
    speedup: string;
  };
  aggregate_stats?: {
    streaming_vehicles: number;
    total_vehicles_seen: number;
    total_signals_received: number;
    total_batches_processed: number;
    avg_signals_per_second: string;
    stale_timeout: string;
  };
  streaming_vehicles: Record<
    string,
    {
      vin: string;
      last_received: string;
      first_received: string;
      signal_count: number;
      batch_count: number;
      is_streaming: boolean;
      data_source: string;
      signals_per_second: number;
      latency_ms: number;
      uptime_seconds: number;
      last_signals?: Record<string, unknown>;
    }
  >;
}

export interface StaleSessionsResponse {
  stale_charging: ChargingSession[];
  stale_drives: Drive[];
}

export interface CaptureStats {
  mongodb_enabled: boolean;
  capture_enabled: boolean;
  total_documents: number;
  distinct_vins: string[];
}

export interface BackupConfig {
  id: number;
  name: string;
  enabled: boolean;
  backup_type: string;
  frequency_days: number;
  max_retention: number;
  provider: string;
  provider_config: Record<string, string>;
  include_tables: string[] | null;
  compress: boolean;
  encrypt: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackupRun {
  id: number;
  config_id: number | null;
  run_type: string;
  backup_type: string;
  status: string;
  provider: string;
  file_name: string | null;
  file_path: string | null;
  file_size: number;
  record_count: number;
  table_count: number;
  checksum: string | null;
  duration_ms: number;
  error_message: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}
