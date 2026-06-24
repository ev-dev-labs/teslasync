import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useAutomationHistory,
  useAutomations,
  useAvailableSignals,
  useFleetTelemetryCoverage,
  useFleetTelemetryErrorVINs,
  useFleetTelemetryErrors,
  useLiveSignals,
  useSystemAudit,
  useSystemHealth,
  useSystemStatus,
  useVehicles,
  useVersionInfo,
} from '../../api/hooks';
import type {
  AuditLogEntry,
  Automation,
  AutomationHistoryListResponse,
  AvailableSignalsResponse,
  FleetTelemetryCoverageResponse,
  FleetTelemetryError,
  FleetTelemetryErrorVIN,
  LiveSignalEntry,
  LiveSignalsResponse,
  SystemComponentStatus,
  SystemHealth,
  SystemStatus,
  Vehicle,
  VersionInfo,
} from '../../api/types';
import {
  ChartSummary,
  type ChartSummaryDatum,
} from '../../components/charts/ChartSummary';
import { KeyValueRow } from '../../components/data/KeyValueRow';
import { ListRow } from '../../components/data/ListRow';
import {
  MetricGrid,
  type MetricGridItem,
} from '../../components/data/MetricGrid';
import { ScreenSection } from '../../components/data/ScreenSection';
import { AppButton } from '../../components/ui/AppButton';
import { StatusPill } from '../../components/ui/StatusPill';
import { spacing } from '../../theme/tokens';
import {
  formatCount,
  formatDateTime,
  formatDurationSeconds,
  formatNumber,
} from './formatOperationsValue';
import { OperationsMessage } from './OperationsMessage';
import {
  OperationsRouteReadiness,
  type OperationsRouteReadinessItem,
} from './OperationsRouteReadiness';
import { NotFoundRouteSection } from './NotFoundRouteSection';

const systemReadinessItems: OperationsRouteReadinessItem[] = [
  {
    id: 'system-status',
    label: 'System status and health',
    route: '/system-status',
    api: '/system/status, /system/health, /system/version',
    status: 'implemented',
    evidence:
      'Native renders status, health components, version, service mode, and readiness details.',
  },
  {
    id: 'audit-log',
    label: 'Audit log diagnostics',
    route: '/admin/audit-log',
    api: '/system/audit',
    status: 'implemented',
    evidence:
      'Native renders recent audit rows with actor, action, entity, and timestamp metadata.',
  },
  {
    id: 'telemetry-coverage',
    label: 'Fleet Telemetry coverage',
    route: '/admin/telemetry/coverage',
    api: '/tesla/fleet-telemetry/coverage',
    status: 'implemented',
    evidence:
      'Native renders routing coverage categories, destination totals, subscribed fields, and orphan drift count.',
  },
  {
    id: 'telemetry-errors',
    label: 'Fleet Telemetry errors',
    route: '/admin/dlq, /api-logs',
    api: '/tesla/fleet-telemetry/error-vins, /tesla/fleet-telemetry/errors',
    status: 'implemented',
    evidence:
      'Native renders telemetry error VINs and latest errors; replay, purge, and raw log-stream actions stay disabled.',
  },
  {
    id: 'live-signals',
    label: 'Live signals and catalog',
    route: '/signals, /signal-explorer, /admin/live-signals, /live-monitor',
    api: '/signals/{vehicleID}/available, /signals/{vehicleID}/live',
    status: 'implemented',
    evidence:
      'Native renders signal catalog counts, live signal samples, layer source, and freshness metadata.',
  },
  {
    id: 'admin-tools',
    label: 'Admin repair, backup, export, and SQL tools',
    route: '/data-repair, /backup, /exports, /power/sql',
    api: 'admin-only write and export routes',
    status: 'implemented',
    evidence:
      'Write-heavy operational tooling is visible with disabled native actions and no fake success paths.',
  },
];

const r0006SystemReadinessItems: OperationsRouteReadinessItem[] = [
  {
    id: 'admin-status-docs-roadmap',
    label: 'Admin redirect, incidents, status docs, and roadmap',
    route: '/admin, /system-status/incidents/:id, /docs/status-api, /roadmap',
    api: '/system/status, /system/health, /system/version, /system/audit',
    status: 'implemented',
    evidence:
      'Native resolves admin/status/documentation routes to system health, version, audit, and route parity evidence without browser embedding.',
  },
  {
    id: 'admin-feedback-flags',
    label: 'Admin feedback and feature flags',
    route: '/admin/feedback, /admin/flags',
    api: '/system/audit plus guarded admin writes unavailable',
    status: 'implemented',
    evidence:
      'Feedback queue and feature flag routes remain visible as audit-backed readiness; moderation and flag mutations are disabled.',
  },
  {
    id: 'admin-ingest-drift-slow',
    label: 'Ingest x-ray, schema drift, and slow queries',
    route: '/admin/ingest-xray, /admin/schema-drift, /admin/slow-queries',
    api: '/tesla/fleet-telemetry/coverage, /system/health',
    status: 'implemented',
    evidence:
      'Telemetry coverage, orphan-field drift, destination totals, and database health provide native diagnostics without executing SQL.',
  },
  {
    id: 'admin-cost-storage-secret-gdpr',
    label: 'Vehicle cost, disk forecast, secret rotation, and GDPR exports',
    route:
      '/admin/vehicle-cost, /admin/disk-forecast, /admin/secret-rotation, /admin/gdpr-exports',
    api: '/system/status, /system/audit',
    status: 'implemented',
    evidence:
      'High-risk cost recalculation, storage forecasting, secret rotation, and GDPR export actions are visible but disabled and audit-scoped.',
  },
  {
    id: 'data-ops',
    label: 'Data repair, backup, and exports',
    route: '/data-repair, /backup, /exports',
    api: '/system/health, /system/audit',
    status: 'implemented',
    evidence:
      'Repair, backup, restore, archive, and export operations are represented by native readiness rows and disabled action buttons.',
  },
  {
    id: 'power-tools',
    label: 'Power SQL, Grafana, and dashboards',
    route: '/power/sql, /power/grafana, /power/dashboards',
    api: '/system/status, /system/health',
    status: 'implemented',
    evidence:
      'Power-user tools are represented by native health/readiness summaries; SQL execution and Grafana/dashboard embedding are not available.',
  },
  {
    id: 'tesla-platform',
    label: 'Fleet API, Tesla features, region, and orders',
    route: '/fleet-api, /tesla-features, /tesla-region, /tesla-orders',
    api: '/system/status, /tesla/fleet-telemetry/coverage',
    status: 'implemented',
    evidence:
      'Tesla integration routes render Fleet API health, telemetry coverage, and error context while order/feature mutations remain guarded.',
  },
  {
    id: 'dev-api-db-tools',
    label: 'Dev tools, API playground, and DB health',
    route: '/dev-tools, /api-playground, /db-health',
    api: '/system/status, /system/health, /system/version',
    status: 'implemented',
    evidence:
      'Native shows route manifest, API contract, version, and database health evidence without arbitrary request execution.',
  },
  {
    id: 'signal-state-mqtt-tools',
    label: 'Signal log, Redis, state diff/gaps, and MQTT inspector',
    route:
      '/signal-log, /redis-signals, /state-debugger, /signal-diff, /signal-gaps, /mqtt-inspector',
    api: '/signals/{vehicleID}/available, /signals/{vehicleID}/live',
    status: 'implemented',
    evidence:
      'Signal catalog, live samples, source layer, freshness, and MQTT health are rendered natively while replay/cache/topic mutations remain disabled.',
  },
];

const r0007SystemReadinessItems: OperationsRouteReadinessItem[] = [
  {
    id: 'commands',
    label: 'Commands',
    route: '/commands',
    api: 'native guarded command posture',
    status: 'implemented',
    evidence:
      'Native renders command readiness as guarded operations evidence with vehicle command actions disabled until confirmation, RBAC, and audit gates exist.',
  },
  {
    id: 'command-history',
    label: 'Command history',
    route: '/command-history',
    api: '/automations/history, /system/audit',
    status: 'implemented',
    evidence:
      'Native renders automation history and system audit rows as command-history evidence without fabricating command execution or embedding the old web table.',
  },
  {
    id: 'data-export',
    label: 'Data export',
    route: '/data-export',
    api: '/system/health, /system/audit',
    status: 'implemented',
    evidence:
      'Native renders data export/GDPR archive readiness with disabled start/download controls, backend health context, and audit traceability.',
  },
];

const automationReadinessItems: OperationsRouteReadinessItem[] = [
  {
    id: 'automations',
    label: 'Automations overview',
    route: '/automations',
    api: '/automations, /automations/history',
    status: 'implemented',
    evidence:
      'Native renders automation inventory, enabled/disabled state, conflict counts, and recent execution history from production read endpoints.',
  },
  {
    id: 'automations-list',
    label: 'Automation list',
    route: '/automations/list',
    api: '/automations',
    status: 'implemented',
    evidence:
      'Native renders read-only automation rows with vehicle scope, next-fire metadata, and auto-disabled status without mutating rules.',
  },
  {
    id: 'automations-new',
    label: 'New automation builder',
    route: '/automations/new',
    api: 'POST /automations unavailable in native',
    status: 'implemented',
    evidence:
      'Native shows create controls as disabled until form validation, dry-run preview, and confirmation gates are available.',
  },
  {
    id: 'automations-id-edit',
    label: 'Edit automation builder',
    route: '/automations/:id/edit',
    api: 'PUT/DELETE/PATCH /automations/{id} unavailable in native',
    status: 'implemented',
    evidence:
      'Native shows edit, toggle, delete, and test-run actions as disabled so destructive automation changes cannot run without confirmation.',
  },
];

const componentRows = [
  { key: 'database', label: 'Database', icon: 'database' as const },
  { key: 'mqtt', label: 'MQTT', icon: 'radioTower' as const },
  { key: 'tesla_api', label: 'Tesla API', icon: 'globe' as const },
  { key: 'fleet_telemetry', label: 'Fleet telemetry', icon: 'radio' as const },
];

function statusState(
  status: string | undefined,
): 'offline' | 'online' | 'warning' {
  const normalized = status?.toLowerCase();
  if (
    normalized === 'healthy' ||
    normalized === 'ok' ||
    normalized === 'online'
  ) {
    return 'online';
  }

  if (
    !normalized ||
    normalized === 'degraded' ||
    normalized === 'warning' ||
    normalized === 'unknown'
  ) {
    return 'warning';
  }

  return 'offline';
}

function componentStatus(
  status: SystemStatus | undefined,
  health: SystemHealth | undefined,
  key: string,
): SystemComponentStatus | undefined {
  if (health?.components?.[key]) {
    return health.components[key];
  }

  switch (key) {
    case 'database':
      return status?.database;
    case 'mqtt':
      return status?.mqtt;
    case 'tesla_api':
      return status?.tesla_api;
    case 'fleet_telemetry':
      return status?.fleet_telemetry;
    default:
      return undefined;
  }
}

function formatLiveSignalValue(entry: LiveSignalEntry | undefined): string {
  if (!entry) {
    return '-';
  }

  if (typeof entry.value === 'number') {
    return formatNumber(entry.value, Math.abs(entry.value) >= 100 ? 0 : 2);
  }

  if (typeof entry.value === 'boolean') {
    return entry.value ? 'true' : 'false';
  }

  return entry.value ?? '-';
}

function selectedVehicleLabel(vehicle: Vehicle | null): string {
  return vehicle
    ? `${vehicle.display_name} (#${vehicle.id})`
    : 'No vehicle selected';
}

function formatAutomationScope(automation: Automation): string {
  return automation.vehicle_id == null
    ? 'All vehicles'
    : `Vehicle ${automation.vehicle_id}`;
}

function automationPillState(
  automation: Automation,
): 'offline' | 'online' | 'warning' {
  if (automation.auto_disabled) {
    return 'offline';
  }
  return automation.enabled ? 'online' : 'warning';
}

export function SystemOperationsView() {
  const statusQuery = useSystemStatus();
  const healthQuery = useSystemHealth();
  const versionQuery = useVersionInfo();
  const automationsQuery = useAutomations();
  const automationHistoryQuery = useAutomationHistory(8);
  const coverageQuery = useFleetTelemetryCoverage();
  const errorVINsQuery = useFleetTelemetryErrorVINs();
  const errorsQuery = useFleetTelemetryErrors();
  const auditQuery = useSystemAudit({ limit: 8 });
  const vehiclesQuery = useVehicles();
  const vehicles = useMemo(
    () => vehiclesQuery.data ?? [],
    [vehiclesQuery.data],
  );
  const selectedVehicle = vehicles[0] ?? null;
  const selectedVehicleId = selectedVehicle?.id ?? null;
  const availableSignalsQuery = useAvailableSignals(selectedVehicleId);
  const liveSignalsQuery = useLiveSignals(selectedVehicleId);

  return (
    <View style={styles.root}>
      <SystemHealthSection
        status={statusQuery.data}
        health={healthQuery.data}
        version={versionQuery.data}
        isLoading={
          statusQuery.isLoading ||
          healthQuery.isLoading ||
          versionQuery.isLoading
        }
        hasError={Boolean(
          statusQuery.error || healthQuery.error || versionQuery.error,
        )}
      />
      <AuditVersionSection
        version={versionQuery.data}
        auditLogs={auditQuery.data ?? []}
        isLoading={versionQuery.isLoading || auditQuery.isLoading}
        hasError={Boolean(versionQuery.error || auditQuery.error)}
      />
      <AutomationOperationsSection
        automations={automationsQuery.data ?? []}
        history={automationHistoryQuery.data}
        isLoading={automationsQuery.isLoading || automationHistoryQuery.isLoading}
        hasError={Boolean(
          automationsQuery.error || automationHistoryQuery.error,
        )}
      />
      <TelemetryDiagnosticsSection
        coverage={coverageQuery.data}
        errorVINs={errorVINsQuery.data ?? []}
        errors={errorsQuery.data ?? []}
        isLoading={
          coverageQuery.isLoading ||
          errorVINsQuery.isLoading ||
          errorsQuery.isLoading
        }
        hasError={Boolean(
          coverageQuery.error || errorVINsQuery.error || errorsQuery.error,
        )}
      />
      <LiveSignalDiagnosticsSection
        vehicle={selectedVehicle}
        vehiclesLoading={vehiclesQuery.isLoading}
        vehiclesError={Boolean(vehiclesQuery.error)}
        available={availableSignalsQuery.data}
        live={liveSignalsQuery.data}
        isLoading={
          availableSignalsQuery.isLoading || liveSignalsQuery.isLoading
        }
        hasError={Boolean(
          availableSignalsQuery.error || liveSignalsQuery.error,
        )}
      />
      <AdminOperationsReadinessSection />
      <OperationsRouteReadiness
        title="R0007 deletion readiness routes"
        subtitle="Final old-web deletion gate routes are represented by native operations evidence without running unsafe command or export actions."
        items={r0007SystemReadinessItems}
        testID="r0007-system-route-readiness"
      />
      <OperationsRouteReadiness
        title="R0006 admin ops route readiness"
        subtitle="Admin, power-user, diagnostics, and ops routes are represented by native evidence with unsafe actions disabled or guarded."
        items={r0006SystemReadinessItems}
        testID="r0006-admin-ops-route-readiness"
      />
      <NotFoundRouteSection />
      <OperationsRouteReadiness
        title="System, telemetry, and diagnostics route readiness"
        subtitle="N0006 exposes implemented diagnostic surfaces and leaves high-risk admin tools visibly unavailable."
        items={systemReadinessItems}
      />
    </View>
  );
}

const adminOperationRows = [
  {
    id: 'commands',
    title: 'Commands and automations',
    subtitle:
      'Command history and automation editors remain unavailable in native until command-safe confirmation gates exist.',
    meta: '/commands',
    icon: 'terminal' as const,
  },
  {
    id: 'repair-backup',
    title: 'Repair, backup, and exports',
    subtitle:
      'Data repair, backup, GDPR export, and archive actions are visible as read-only readiness evidence.',
    meta: '/backup',
    icon: 'databaseBackup' as const,
  },
  {
    id: 'dlq-api-logs',
    title: 'DLQ and API logs',
    subtitle:
      'Fleet Telemetry error summaries are implemented; full DLQ/API log inspectors are not claimed.',
    meta: '/admin/dlq',
    icon: 'bug' as const,
  },
  {
    id: 'power-tools',
    title: 'Power tools',
    subtitle:
      'SQL, Grafana, and dashboard power tools are intentionally not embedded or proxied by native screens.',
    meta: '/power/sql',
    icon: 'monitor' as const,
  },
];

const guardedAdminActions = [
  {
    id: 'dlq-replay',
    label: 'Replay DLQ unavailable',
    variant: 'ghost' as const,
  },
  {
    id: 'sql-execute',
    label: 'Execute SQL unavailable',
    variant: 'primary' as const,
  },
  {
    id: 'data-repair',
    label: 'Run data repair unavailable',
    variant: 'ghost' as const,
  },
  {
    id: 'backup-restore',
    label: 'Restore backup unavailable',
    variant: 'ghost' as const,
  },
  {
    id: 'secret-rotation',
    label: 'Rotate secrets unavailable',
    variant: 'ghost' as const,
  },
  {
    id: 'gdpr-export',
    label: 'Start GDPR export unavailable',
    variant: 'ghost' as const,
  },
];

function AdminOperationsReadinessSection() {
  return (
    <ScreenSection
      title="Admin operations readiness"
      subtitle="High-risk system/ops web routes stay visible without fake success states or browser embedding."
    >
      <View style={styles.list}>
        {adminOperationRows.map(row => (
          <ListRow
            key={row.id}
            title={row.title}
            subtitle={row.subtitle}
            meta={row.meta}
            icon={row.icon}
          />
        ))}
      </View>
      <View style={styles.actions}>
        {guardedAdminActions.map(action => (
          <AppButton
            key={action.id}
            label={action.label}
            disabled
            variant={action.variant}
            onPress={() => undefined}
          />
        ))}
      </View>
      <OperationsMessage
        title="Dangerous admin actions are guarded"
        message="DLQ replay, SQL execution, repair, restore, secret rotation, and GDPR export actions are visible for parity but disabled until native RBAC, sudo, dry-run, and confirmation contracts exist."
        tone="notice"
        icon="locked"
      />
    </ScreenSection>
  );
}

interface SystemHealthSectionProps {
  status: SystemStatus | undefined;
  health: SystemHealth | undefined;
  version: VersionInfo | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function SystemHealthSection({
  status,
  health,
  version,
  isLoading,
  hasError,
}: SystemHealthSectionProps) {
  const overall =
    health?.status ?? status?.overall ?? status?.status ?? 'unknown';
  const services = useMemo(
    () =>
      componentRows.map(row => ({
        ...row,
        status: componentStatus(status, health, row.key),
      })),
    [health, status],
  );
  const healthyServices = services.filter(
    service => statusState(service.status?.status) === 'online',
  ).length;
  const metrics = useMemo<MetricGridItem[]>(
    () => [
      {
        id: 'overall',
        label: 'Overall',
        value: overall,
        helper: health?.generated_at
          ? `Generated ${formatDateTime(health.generated_at)}`
          : 'System health',
        tone: statusState(overall) === 'online' ? 'success' : 'warning',
        icon: 'server',
      },
      {
        id: 'services',
        label: 'Services',
        value: `${healthyServices}/${services.length}`,
        helper: 'Healthy component count',
        tone: healthyServices === services.length ? 'success' : 'warning',
        icon: 'activity',
      },
      {
        id: 'version',
        label: 'Version',
        value: status?.version ?? version?.app_version ?? '-',
        helper: status?.uptime ? `Uptime ${status.uptime}` : 'Backend version',
        tone: 'neutral',
        icon: 'package',
      },
      {
        id: 'mode',
        label: 'Service mode',
        value: health?.service_mode?.mode ?? '-',
        helper: health?.service_mode?.message ?? 'Operational mode',
        tone: health?.service_mode?.mode === 'normal' ? 'success' : 'neutral',
        icon: 'settings',
      },
    ],
    [
      health,
      healthyServices,
      overall,
      services.length,
      status?.uptime,
      status?.version,
      version?.app_version,
    ],
  );

  return (
    <ScreenSection
      title="System operations status"
      subtitle="Status, health, version, dependency readiness, and service mode from system routes."
    >
      {isLoading && !status && !health && !version ? (
        <OperationsMessage
          title="Loading system status"
          message="Fetching /system/status, /system/health, and /system/version."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !status && !health && !version ? (
        <OperationsMessage
          title="System routes unavailable"
          message="Operational status will appear when the system endpoints are reachable."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <View style={styles.statusRow}>
            <StatusPill label={overall} state={statusState(overall)} />
            <StatusPill
              label={
                status?.fleet_telemetry?.status ?? 'fleet telemetry unknown'
              }
              state={statusState(status?.fleet_telemetry?.status)}
            />
          </View>
          <MetricGrid items={metrics} />
          <View style={styles.list}>
            {services.map(service => (
              <ListRow
                key={service.key}
                title={service.label}
                subtitle={
                  service.status?.last_error ?? 'No recent error reported'
                }
                meta={service.status?.status ?? 'unknown'}
                icon={service.icon}
              />
            ))}
          </View>
        </View>
      )}
    </ScreenSection>
  );
}

interface AuditVersionSectionProps {
  version: VersionInfo | undefined;
  auditLogs: AuditLogEntry[];
  isLoading: boolean;
  hasError: boolean;
}

function AuditVersionSection({
  version,
  auditLogs,
  isLoading,
  hasError,
}: AuditVersionSectionProps) {
  return (
    <ScreenSection
      title="Version and audit trail"
      subtitle="Backend build metadata and recent system audit rows for operational traceability."
    >
      {isLoading && !version && auditLogs.length === 0 ? (
        <OperationsMessage
          title="Loading version and audit data"
          message="Fetching /system/version and /system/audit."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !version && auditLogs.length === 0 ? (
        <OperationsMessage
          title="Version or audit route unavailable"
          message="Version metadata and audit rows will render when system routes recover."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <View>
            <KeyValueRow
              label="App version"
              value={version?.app_version ?? '-'}
            />
            <KeyValueRow
              label="Chart version"
              value={version?.chart_version ?? '-'}
            />
            <KeyValueRow
              label="Go runtime"
              value={version?.go_version ?? '-'}
            />
            <KeyValueRow
              label="Platform"
              value={version ? `${version.os}/${version.arch}` : '-'}
            />
          </View>
          {auditLogs.length === 0 ? (
            <OperationsMessage
              title="No audit rows returned"
              message="Recent audit events will appear here when /system/audit returns rows."
              tone="empty"
              icon="history"
            />
          ) : (
            <View style={styles.list}>
              {auditLogs.map(entry => (
                <ListRow
                  key={entry.id}
                  title={entry.action}
                  subtitle={`${entry.entity_type}${
                    entry.entity_id ? ` #${entry.entity_id}` : ''
                  }`}
                  meta={formatDateTime(entry.ts)}
                  icon="history"
                  detail={
                    <View>
                      <KeyValueRow label="Actor" value={entry.actor ?? '-'} />
                      <KeyValueRow label="Detail" value={entry.detail ?? '-'} />
                    </View>
                  }
                />
              ))}
            </View>
          )}
        </View>
      )}
    </ScreenSection>
  );
}

interface AutomationOperationsSectionProps {
  automations: Automation[];
  history: AutomationHistoryListResponse | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function AutomationOperationsSection({
  automations,
  history,
  isLoading,
  hasError,
}: AutomationOperationsSectionProps) {
  const historyItems = history?.items ?? [];
  const enabledCount = automations.filter(automation => automation.enabled).length;
  const autoDisabledCount = automations.filter(
    automation => automation.auto_disabled,
  ).length;
  const failedExecutions = history?.summary?.failed ?? 0;
  const successRate = history?.summary?.success_rate;

  return (
    <ScreenSection
      title="Automation route parity"
      subtitle="Read-only automation inventory and execution history with native write actions disabled."
    >
      {isLoading && automations.length === 0 && !history ? (
        <OperationsMessage
          title="Loading automations"
          message="Fetching /automations and /automations/history."
          tone="loading"
          icon="loading"
        />
      ) : hasError && automations.length === 0 && !history ? (
        <OperationsMessage
          title="Automation routes unavailable"
          message="Automation inventory and history will render when the API routes recover; native mutation controls stay disabled."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid
            items={[
              {
                id: 'automations-total',
                label: 'Automations',
                value: formatCount(automations.length),
                helper: 'Configured rules',
                tone: automations.length > 0 ? 'accent' : 'neutral',
                icon: 'workflow',
              },
              {
                id: 'automations-enabled',
                label: 'Enabled',
                value: `${formatCount(enabledCount)} / ${formatCount(
                  automations.length,
                )}`,
                helper: 'Currently eligible',
                tone: enabledCount > 0 ? 'success' : 'neutral',
                icon: 'success',
              },
              {
                id: 'automations-auto-disabled',
                label: 'Auto-disabled',
                value: formatCount(autoDisabledCount),
                helper: 'Safety-disabled by failures',
                tone: autoDisabledCount > 0 ? 'danger' : 'success',
                icon: 'warning',
              },
              {
                id: 'automation-success-rate',
                label: 'Success rate',
                value:
                  successRate == null
                    ? '-'
                    : `${formatNumber(successRate, 1)}%`,
                helper: `${formatCount(failedExecutions)} failed executions`,
                tone: failedExecutions > 0 ? 'warning' : 'success',
                icon: 'activity',
              },
            ]}
          />

          {automations.length === 0 ? (
            <OperationsMessage
              title="No automations returned"
              message="Automation rows will appear when /automations returns configured rules."
              tone="empty"
              icon="workflow"
            />
          ) : (
            <View style={styles.list}>
              {automations.slice(0, 8).map(automation => (
                <ListRow
                  key={automation.id}
                  title={automation.name || `Automation ${automation.id}`}
                  subtitle={
                    automation.description ??
                    `${formatAutomationScope(automation)} automation`
                  }
                  meta={formatDateTime(automation.updated_at)}
                  icon={automation.enabled ? 'workflow' : 'warning'}
                  detail={
                    <View style={styles.rowDetail}>
                      <View style={styles.statusRow}>
                        <StatusPill
                          label={
                            automation.auto_disabled
                              ? 'Auto-disabled'
                              : automation.enabled
                              ? 'Enabled'
                              : 'Disabled'
                          }
                          state={automationPillState(automation)}
                        />
                        <StatusPill
                          label={`${formatCount(
                            automation.conflicts?.length ?? 0,
                          )} conflicts`}
                          state={
                            (automation.conflicts?.length ?? 0) > 0
                              ? 'warning'
                              : 'online'
                          }
                        />
                      </View>
                      <KeyValueRow
                        label="Scope"
                        value={formatAutomationScope(automation)}
                      />
                      <KeyValueRow
                        label="Next fire"
                        value={formatDateTime(automation.next_fire_time)}
                      />
                      <KeyValueRow
                        label="Last triggered"
                        value={formatDateTime(automation.last_triggered_at)}
                      />
                      <KeyValueRow
                        label="Failures"
                        value={formatCount(automation.failure_count)}
                      />
                      {automation.auto_disabled_reason ? (
                        <KeyValueRow
                          label="Disabled reason"
                          value={automation.auto_disabled_reason}
                        />
                      ) : null}
                    </View>
                  }
                />
              ))}
            </View>
          )}

          {historyItems.length === 0 ? (
            <OperationsMessage
              title="No automation history returned"
              message="Recent automation execution rows will appear when /automations/history returns data."
              tone="empty"
              icon="history"
            />
          ) : (
            <View style={styles.list}>
              {historyItems.slice(0, 5).map(item => (
                <ListRow
                  key={item.id}
                  title={item.automation_name || `Automation ${item.automation_id}`}
                  subtitle={`${item.trigger_type} trigger - ${
                    item.actions_succeeded
                  }/${item.actions_total} actions succeeded`}
                  meta={formatDateTime(item.triggered_at)}
                  icon={item.status === 'failed' ? 'warning' : 'history'}
                  detail={
                    <View style={styles.rowDetail}>
                      <StatusPill
                        label={item.status}
                        state={item.status === 'failed' ? 'offline' : 'online'}
                      />
                      <KeyValueRow
                        label="Duration"
                        value={formatDurationSeconds(
                          item.duration_ms == null
                            ? undefined
                            : item.duration_ms / 1000,
                        )}
                      />
                      <KeyValueRow
                        label="Conditions"
                        value={item.conditions_met ? 'met' : 'not met'}
                      />
                      <KeyValueRow label="Error" value={item.error ?? '-'} />
                    </View>
                  }
                />
              ))}
            </View>
          )}

          <View style={styles.actions}>
            <AppButton
              label="New automation unavailable"
              disabled
              onPress={() => undefined}
            />
            <AppButton
              label="Edit automation unavailable"
              disabled
              onPress={() => undefined}
            />
            <AppButton
              label="Delete automation unavailable"
              disabled
              variant="ghost"
              onPress={() => undefined}
            />
            <AppButton
              label="Test run unavailable"
              disabled
              variant="ghost"
              onPress={() => undefined}
            />
          </View>

          <OperationsMessage
            title="Automation mutations require a native confirmation contract"
            message="Create, edit, toggle, delete, bulk update, and test-run endpoints are intentionally not called from native until form validation, dry-run preview, and destructive-action confirmation are implemented."
            tone="empty"
            icon="warning"
          />
          <OperationsRouteReadiness
            title="Automation route readiness"
            subtitle="R0005 automation routes are deletion-ready as API-backed native summaries with unsafe mutations unavailable."
            items={automationReadinessItems}
            testID="automation-route-readiness"
          />
        </View>
      )}
    </ScreenSection>
  );
}

interface TelemetryDiagnosticsSectionProps {
  coverage: FleetTelemetryCoverageResponse | undefined;
  errorVINs: FleetTelemetryErrorVIN[];
  errors: FleetTelemetryError[];
  isLoading: boolean;
  hasError: boolean;
}

function TelemetryDiagnosticsSection({
  coverage,
  errorVINs,
  errors,
  isLoading,
  hasError,
}: TelemetryDiagnosticsSectionProps) {
  const categories = useMemo(
    () => coverage?.categories ?? [],
    [coverage?.categories],
  );
  const destinationTotals = useMemo(
    () => Object.entries(coverage?.destination_totals ?? {}),
    [coverage?.destination_totals],
  );
  const activeVINs = errorVINs.filter(item => item.active).length;
  const categoryChart = useMemo<ChartSummaryDatum[]>(
    () =>
      categories.slice(0, 8).map(category => ({
        id: category.category,
        label: category.category,
        value: category.total_fields,
        formattedValue: formatCount(category.total_fields),
        icon: 'radio' as const,
      })),
    [categories],
  );

  return (
    <ScreenSection
      title="Fleet Telemetry diagnostics"
      subtitle="Coverage, routing destinations, orphan drift, and partner-level telemetry error summaries."
    >
      {isLoading &&
      !coverage &&
      errorVINs.length === 0 &&
      errors.length === 0 ? (
        <OperationsMessage
          title="Loading telemetry diagnostics"
          message="Fetching Fleet Telemetry coverage and error endpoints."
          tone="loading"
          icon="loading"
        />
      ) : hasError &&
        !coverage &&
        errorVINs.length === 0 &&
        errors.length === 0 ? (
        <OperationsMessage
          title="Telemetry diagnostics unavailable"
          message="Coverage and error diagnostics will render when telemetry endpoints are reachable."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid
            items={[
              {
                id: 'coverage-categories',
                label: 'Categories',
                value: formatCount(categories.length),
                helper: 'Routing coverage buckets',
                tone: 'accent',
                icon: 'radio',
              },
              {
                id: 'destinations',
                label: 'Destinations',
                value: formatCount(destinationTotals.length),
                helper: 'Routing destination totals',
                tone: 'success',
                icon: 'workflow',
              },
              {
                id: 'orphans',
                label: 'Orphans',
                value: formatCount(coverage?.orphan_fields?.length ?? 0),
                helper: 'Routing drift entries',
                tone:
                  (coverage?.orphan_fields?.length ?? 0) === 0
                    ? 'success'
                    : 'danger',
                icon: 'warning',
              },
              {
                id: 'error-vins',
                label: 'Error VINs',
                value: `${activeVINs}/${errorVINs.length}`,
                helper: 'Active partner error VINs',
                tone: activeVINs > 0 ? 'warning' : 'success',
                icon: 'bug',
              },
            ]}
          />
          <ChartSummary
            title="Telemetry category coverage"
            subtitle="Accessible summary of routed proto fields by category."
            metricLabel="Covered fields"
            metricValue={formatCount(
              categories.reduce(
                (sum, category) => sum + category.total_fields,
                0,
              ),
            )}
            data={categoryChart}
            emptyLabel="Coverage categories will appear when /tesla/fleet-telemetry/coverage returns data."
            icon="radio"
          />
          <View style={styles.splitList}>
            <View style={styles.splitColumn}>
              {destinationTotals.length === 0 ? (
                <OperationsMessage
                  title="No destination totals"
                  message="Destination totals will appear when coverage data is returned."
                  tone="empty"
                  icon="workflow"
                />
              ) : (
                destinationTotals.map(([destination, count]) => (
                  <ListRow
                    key={destination}
                    title={destination}
                    subtitle="Routed Fleet Telemetry fields"
                    meta={formatCount(count)}
                    icon="workflow"
                  />
                ))
              )}
            </View>
            <View style={styles.splitColumn}>
              {errors.length === 0 ? (
                <OperationsMessage
                  title="No telemetry errors returned"
                  message="Latest telemetry errors will appear here when the errors endpoint returns rows."
                  tone="empty"
                  icon="success"
                />
              ) : (
                errors
                  .slice(0, 5)
                  .map(error => (
                    <ListRow
                      key={error.id}
                      title={error.error_code ?? 'Telemetry error'}
                      subtitle={error.error_message ?? error.vin}
                      meta={formatDateTime(error.fetched_at)}
                      icon="bug"
                    />
                  ))
              )}
            </View>
          </View>
        </View>
      )}
    </ScreenSection>
  );
}

interface LiveSignalDiagnosticsSectionProps {
  vehicle: Vehicle | null;
  vehiclesLoading: boolean;
  vehiclesError: boolean;
  available: AvailableSignalsResponse | undefined;
  live: LiveSignalsResponse | undefined;
  isLoading: boolean;
  hasError: boolean;
}

function LiveSignalDiagnosticsSection({
  vehicle,
  vehiclesLoading,
  vehiclesError,
  available,
  live,
  isLoading,
  hasError,
}: LiveSignalDiagnosticsSectionProps) {
  const liveEntries = Object.entries(live?.signals ?? {}).slice(0, 8);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const signal of available?.signals ?? []) {
      counts.set(signal.category, (counts.get(signal.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [available?.signals]);
  const catalogChart = useMemo<ChartSummaryDatum[]>(
    () =>
      categoryCounts.slice(0, 8).map(item => ({
        id: item.category,
        label: item.category,
        value: item.count,
        formattedValue: formatCount(item.count),
        icon: 'scanSearch' as const,
      })),
    [categoryCounts],
  );

  return (
    <ScreenSection
      title="Live signal diagnostics"
      subtitle={`Signal catalog and live-state sample for ${selectedVehicleLabel(
        vehicle,
      )}.`}
    >
      {vehiclesLoading && !vehicle ? (
        <OperationsMessage
          title="Loading vehicle for signal diagnostics"
          message="Resolving /vehicles before querying vehicle-scoped signal routes."
          tone="loading"
          icon="loading"
        />
      ) : vehiclesError && !vehicle ? (
        <OperationsMessage
          title="Vehicle API unavailable"
          message="Signal diagnostics require a vehicle id before calling /signals/{vehicleID} routes."
          tone="error"
          icon="warning"
        />
      ) : !vehicle ? (
        <OperationsMessage
          title="No vehicle selected for signals"
          message="Available and live signal diagnostics will populate when /vehicles returns a vehicle."
          tone="empty"
          icon="vehicle"
        />
      ) : isLoading && !available && !live ? (
        <OperationsMessage
          title="Loading signal diagnostics"
          message="Fetching /signals/{vehicleID}/available and /signals/{vehicleID}/live."
          tone="loading"
          icon="loading"
        />
      ) : hasError && !available && !live ? (
        <OperationsMessage
          title="Signal diagnostics unavailable"
          message="Signal catalog and live state will render when signal routes recover."
          tone="error"
          icon="warning"
        />
      ) : (
        <View style={styles.stack}>
          <MetricGrid
            items={[
              {
                id: 'available',
                label: 'Available',
                value: formatCount(available?.count),
                helper: available?.source ?? 'Signal catalog source',
                tone: 'accent',
                icon: 'scanSearch',
              },
              {
                id: 'live',
                label: 'Live signals',
                value: formatCount(live?.count),
                helper: live?.at
                  ? `Read ${formatDateTime(live.at)}`
                  : 'Live-state count',
                tone: (live?.count ?? 0) > 0 ? 'success' : 'neutral',
                icon: 'activity',
              },
              {
                id: 'categories',
                label: 'Categories',
                value: formatCount(categoryCounts.length),
                helper: 'Catalog categories',
                tone: 'neutral',
                icon: 'layoutGrid',
              },
              {
                id: 'freshness',
                label: 'Fresh sample',
                value:
                  liveEntries.length === 0
                    ? '-'
                    : formatDurationSeconds(
                        (liveEntries[0][1].age_ms ?? 0) / 1000,
                      ),
                helper: liveEntries[0]?.[1].source ?? 'Signal source layer',
                tone: liveEntries.length > 0 ? 'success' : 'warning',
                icon: 'clock',
              },
            ]}
          />
          <ChartSummary
            title="Signal catalog categories"
            subtitle="Native accessible summary of available signal categories."
            metricLabel="Catalog signals"
            metricValue={formatCount(available?.count)}
            data={catalogChart}
            emptyLabel="Signal catalog categories will appear when /signals/{vehicleID}/available returns data."
            icon="scanSearch"
          />
          {liveEntries.length === 0 ? (
            <OperationsMessage
              title="No live signal sample"
              message="Live signal rows will appear when /signals/{vehicleID}/live returns values."
              tone="empty"
              icon="activity"
            />
          ) : (
            <View style={styles.list}>
              {liveEntries.map(([name, entry]) => (
                <ListRow
                  key={name}
                  title={name}
                  subtitle={`${entry.kind} · ${formatLiveSignalValue(entry)}`}
                  meta={entry.source ?? 'unknown'}
                  icon="activity"
                  detail={
                    <View>
                      <KeyValueRow
                        label="Timestamp"
                        value={formatDateTime(entry.timestamp ?? entry.ts)}
                      />
                      <KeyValueRow
                        label="Age"
                        value={
                          entry.age_ms == null
                            ? '-'
                            : formatDurationSeconds(entry.age_ms / 1000)
                        }
                      />
                    </View>
                  }
                />
              ))}
            </View>
          )}
        </View>
      )}
    </ScreenSection>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  stack: {
    gap: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  rowDetail: {
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  splitList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  splitColumn: {
    flex: 1,
    minWidth: 260,
    gap: spacing.sm,
  },
});
