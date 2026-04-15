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

export interface SystemHealthComponent {
  status: 'ok' | 'degraded' | 'unhealthy';
  consecutiveFailures: number;
  lastError: string | null;
  details: Record<string, unknown>;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: Record<string, SystemHealthComponent>;
  databaseSize: string;
  tableCount: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  resource: string;
  details: string;
  createdAt: string;
}

export interface SecurityEvent {
  id: string;
  vehicleId: string;
  locked: boolean | null;
  sentryMode: boolean | null;
  doorState: string | null;
  fdWindow: string | null;
  fpWindow: string | null;
  rdWindow: string | null;
  rpWindow: string | null;
  homelinkNearby: boolean | null;
  guestMode: boolean | null;
  homelinkDeviceCount: number | null;
  guestModeMobileAccessState: string | null;
  driverSeatOccupied: boolean | null;
  centerDisplay: string | null;
  speedLimitMode: string | null;
  valetModeEnabled: boolean | null;
  serviceMode: boolean | null;
  currentLimitMph: number | null;
  pairedPhoneKeyCount: number | null;
  lightsHazardsActive: boolean | null;
  lightsHighBeams: boolean | null;
  lightsTurnSignal: string | null;
  driverSeatBelt: boolean | null;
  passengerSeatBelt: boolean | null;
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

export interface AlertRule {
  id: string;
  name: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  enabled: boolean;
  cooldownMin: number;
  msgTemplate: string;
  conditions: Record<string, unknown>;
  notifyChannels: string[];
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

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

export type RoadmapPhase = 'done' | 'current' | 'next' | 'future';

export interface RoadmapItem {
  title: string;
  description: string;
  phase: RoadmapPhase;
  features: string[];
}
