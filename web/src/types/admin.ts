export interface APIKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: 'read' | 'read-write' | 'admin';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface APICallLog {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  requestBody: string | null;
  responseBody: string | null;
  error: string | null;
  createdAt: string;
}

export interface APICallLogStats {
  totalCalls: number;
  errorRate: number;
  avgDurationMs: number;
  last24h: number;
  errorCount: number;
  // Optional grouped breakdowns also returned by the backend.
  by_method?: Record<string, number>;
  by_service?: Record<string, number>;
}

export interface BackupConfig {
  id: string;
  name: string;
  enabled: boolean;
  backupType: 'full' | 'incremental';
  frequencyDays: number;
  maxRetention: number;
  provider: 'local' | 's3' | 'azure' | 'gcs';
  providerConfig: Record<string, string>;
  compress: boolean;
  encrypt: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface BackupRun {
  id: string;
  configId: string;
  status: 'completed' | 'failed' | 'running' | 'queued';
  backupType: string;
  fileSize: number;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

/**
 * Backend emits the following per-component status values:
 *   - 'healthy' (current canonical for live components)
 *   - 'ok' (legacy probe responses + buffer health)
 *   - 'degraded' / 'warning' (recoverable issues)
 *   - 'unhealthy' / 'offline' / 'down' / 'failed' (broken)
 *   - 'unknown' (e.g. tesla_api never polled, last_check is zero)
 * Kept as a string-literal union (with `string` fallback) because new
 * status keys are added without coordinated FE/BE migrations.
 */
export type ComponentStatus =
  | 'healthy' | 'ok'
  | 'degraded' | 'warning'
  | 'unhealthy' | 'offline' | 'down' | 'failed'
  | 'unknown'
  | (string & {});

export interface SystemHealthComponent {
  status: ComponentStatus;
  consecutiveFailures: number;
  lastError: string | null;
  details: Record<string, unknown>;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, SystemHealthComponent>;
  databaseSize: string;
  tableCount: number;
  /**
   * Operator-controlled service-mode banner (Phase-46 / Prompt 04).
   * Emitted by /api/v1/system/health alongside the existing component
   * map. `mode === 'ok'` means hide the banner; `'degraded'` or
   * `'maintenance'` mean show with the supplied message + countdown.
   * `source` is `'env'` when TESLASYNC_SYSTEM_MODE is set, `'db'`
   * when the value comes from an admin POST, `'default'` when neither
   * input is configured.
   */
  mode?: 'ok' | 'degraded' | 'maintenance';
  maintenance_message?: string;
  maintenance_until?: string;
  maintenance_updated_at?: string;
  source?: 'env' | 'db' | 'default';
}

/**
 * Persisted system_state row + env-override marker for the admin
 * Maintenance Mode panel. Returned by GET /api/v1/admin/maintenance
 * and the POST mutation. snake_case mirrors the Go JSON tags.
 */
export interface MaintenanceState {
  mode: 'ok' | 'degraded' | 'maintenance';
  maintenance_message?: string;
  maintenance_until?: string | null;
  updated_at: string;
  updated_by?: string;
  source: 'env' | 'db' | 'default';
  env_override_mode?: string;
}

export interface MaintenanceUpdateInput {
  mode: 'ok' | 'degraded' | 'maintenance';
  message?: string;
  until?: string | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  details: string;
  createdAt: string;
}

/**
 * Last-hour rolling summary of frontend errors reported by the SPA via
 * `POST /api/v1/web-errors`. The same handler that ingests reports
 * exposes this summary via `GET /api/v1/admin/web-errors/summary`.
 *
 * Backend wire format is snake_case (`window_seconds`, `as_of`); after
 * `camelCaseKeys()` both forms are present at runtime — frontend code
 * uses the snake_case names that match the Go JSON tags for clarity.
 */
export interface WebErrorsSummaryEntry {
  name: string;
  route: string;
  count: number;
}

export interface WebErrorsSummary {
  window_seconds: number;
  windowSeconds: number;
  total: number;
  top: WebErrorsSummaryEntry[];
  as_of: string;
  asOf: string;
}

/**
 * Per-user activity entry returned by `GET /users/me/activity`
 * (Phase-40 / Prompt 49 — Recent Activity Discoverability).
 *
 * Mirrors `userActivityEntry` in `internal/api/audit.go` after camelCaseKeys
 * — both `entity_type` / `entityType` etc. are present at runtime, but the
 * canonical shape uses the snake_case names that match the Go JSON tags.
 */
export interface UserActivityEntry {
  id: number;
  ts: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
}

// SecurityEvent mirrors `/security/latest` and `/security` rows. After
// the per-field MQTT cutover (Phase-42a) the backend serializes raw
// `signal.SignalValue` (`interface{}`) directly, so several fields whose
// signal *names* sound string-shaped actually arrive as native JSON
// booleans (e.g. `speed_limit_mode`, `service_mode`). Fields below that
// can arrive as either a string enum *or* a boolean are declared as a
// union so consumers MUST type-narrow before calling string methods.
// See `web/src/lib/typeGuards.ts::asNonEmptyString` for the canonical
// narrowing helper.
export interface SecurityEvent {
  id: string;
  locked: boolean | null;
  sentryMode: string | boolean | null;
  doorState: string | boolean | null;
  fdWindow: string | boolean | null;
  fpWindow: string | boolean | null;
  rdWindow: string | boolean | null;
  rpWindow: string | boolean | null;
  homelinkNearby: boolean | null;
  guestMode: boolean | null;
  homelinkDeviceCount: number | null;
  guestModeMobileAccessState: string | null;
  driverSeatOccupied: boolean | null;
  centerDisplay: string | boolean | null;
  speedLimitMode: string | boolean | null;
  valetModeEnabled: boolean | null;
  serviceMode: boolean | null;
  pairedPhoneKeyCount: number | null;
  lightsHazardsActive: boolean | null;
  lightsHighBeams: boolean | null;
  lightsTurnSignal: string | null;
  driverSeatBelt: string | null;
  passengerSeatBelt: string | null;
  createdAt: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
  indexCount: number;
  lastVacuum: string | null;
}

export interface DBStats {
  tables: TableInfo[];
  tableCount: number;
  databaseSize: string;
}

export interface MigrationInfo {
  version: string;
  name: string;
  appliedAt: string;
}

export interface MigrationStatus {
  currentVersion: string;
  dirty: boolean;
  pending: number;
  migrations: MigrationInfo[];
}

export interface ConnectionPool {
  maxOpen: number;
  open: number;
  inUse: number;
  idle: number;
  waitCount: number;
  waitDurationMs: number;
}

export interface ExportJob {
  id: string;
  type: 'drives' | 'charging' | 'analytics' | 'backup';
  format: 'csv' | 'json';
  status: 'queued' | 'processing' | 'ready' | 'failed';
  recordCount: number | null;
  fileSize: number | null;
  createdAt: string;
}

export interface VehicleState {
  state: string;
  since: string;
  vehicleId: string;
}

export interface StateTransition {
  state: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
}

export interface Alert {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  type: string;
  isRead: boolean;
  createdAt: string;
}

export type AlertRuleSeverity = 'info' | 'warn' | 'critical';
export type AlertRuleOp = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'changed' | 'between' | 'outside';

export interface AlertRule {
  id: number;
  name: string;
  description?: string | null;
  enabled: boolean;
  vehicle_id?: number | null;
  signal_name: string;
  op: AlertRuleOp;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  severity: AlertRuleSeverity;
  cooldown_min: number;
  /** Phase-50 / ADR-014 — per-rule notification body template. */
  msg_template?: string | null;
  /** Phase-50 / ADR-014 — transport title toggle (default TRUE). */
  include_title?: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: 'discord' | 'slack' | 'telegram' | 'email' | 'webhook' | 'ntfy' | 'pushover';
  config: Record<string, string>;
  enabled: boolean;
}

export interface NotificationLog {
  id: string;
  status: 'sent' | 'failed' | 'pending';
  channelId: string;
  title: string;
  createdAt: string;
}

export interface NotificationStats {
  sent: number;
  failed: number;
  pending: number;
  enabledChannels: number;
  totalChannels: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

// ChangelogEntry is generated from CHANGELOG.md by web/scripts/buildChangelog.mjs.
// The shape lives in @/generated/changelog so the parser, modal, and pages
// share a single source of truth (Phase-40 / Prompt 67). The legacy
// `changes: string[]` shape was replaced with a typed `ChangelogChange[]`;
// any consumer that needs flat strings can `entry.changes.map(c => c.text)`.
export type {
  ChangelogChange,
  ChangelogChangeType,
  ChangelogBadge,
  ChangelogEntry,
} from '@/generated/changelog';

export type RoadmapPhase = 'done' | 'current' | 'next' | 'future';

export interface RoadmapItem {
  title: string;
  description: string;
  phase: RoadmapPhase;
  features: string[];
}
