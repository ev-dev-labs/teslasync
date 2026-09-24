import {
  findSectionGroup,
  labelSectionPrimaries,
  sectionPrimaryPath,
  sectionSidebarItems,
} from './sectionGroups'

export const DIAGNOSTIC_GROUPS = [
  {
    primary: '/system-status',
    label: 'System Health',
    labelKey: 'nav.diagnosticGroups.systemHealth',
    pages: [
      { to: '/system-status', label: 'System Status', labelKey: 'nav.items.system-status' },
      { to: '/outage', label: 'Outage Autobiography', labelKey: 'nav.items.outage' },
      { to: '/tesla-api-usage', label: 'Tesla API Usage', labelKey: 'nav.items.tesla-api-usage' },
      { to: '/api-logs', label: 'API Logs', labelKey: 'nav.items.api-logs' },
    ],
  },
  {
    primary: '/db-health',
    label: 'Database & Data Health',
    labelKey: 'nav.diagnosticGroups.dataHealth',
    pages: [
      { to: '/db-health', label: 'Database Health', labelKey: 'nav.items.db-health' },
      { to: '/admin/schema-drift', label: 'Schema Drift', labelKey: 'nav.items.admin_schema-drift' },
      { to: '/admin/slow-queries', label: 'Slow Queries', labelKey: 'nav.items.admin_slow-queries' },
      { to: '/admin/data-quality', label: 'Data Quality', labelKey: 'nav.items.admin_data-quality' },
      { to: '/admin/disk-forecast', label: 'Disk Forecast', labelKey: 'nav.items.admin_disk-forecast' },
    ],
  },
  {
    primary: '/signals',
    label: 'Telemetry Troubleshooting',
    labelKey: 'nav.diagnosticGroups.telemetry',
    pages: [
      { to: '/signals', label: 'Live Signals', labelKey: 'nav.items.signals' },
      { to: '/admin/live-signals', label: 'Live Signal Inspector', labelKey: 'nav.items.admin_live-signals' },
      { to: '/admin/ingest-xray', label: 'Ingest X-Ray', labelKey: 'nav.items.admin_ingest-xray' },
      { to: '/mqtt-inspector', label: 'MQTT Inspector', labelKey: 'nav.items.mqtt-inspector' },
      { to: '/admin/dlq', label: 'DLQ Inspector', labelKey: 'nav.items.admin_dlq' },
      { to: '/redis-signals', label: 'Redis Signals', labelKey: 'nav.items.redis-signals' },
      { to: '/admin/telemetry/coverage', label: 'Telemetry Coverage', labelKey: 'nav.items.admin_telemetry_coverage' },
      { to: '/state-debugger', label: 'State Debugger', labelKey: 'nav.items.state-debugger' },
    ],
  },
  {
    primary: '/signal-correlation',
    label: 'Signal Analysis',
    labelKey: 'nav.diagnosticGroups.signalAnalysis',
    pages: [
      { to: '/signal-correlation', label: 'Signal Correlation', labelKey: 'nav.items.signal-correlation' },
      { to: '/signal-entropy', label: 'Signal Entropy', labelKey: 'nav.items.signal-entropy' },
      { to: '/signal-trend', label: 'Signal Trend', labelKey: 'nav.items.signal-trend' },
      { to: '/signal-change-points', label: 'Signal Change Points', labelKey: 'nav.items.signal-change-points' },
      { to: '/signal-deadband', label: 'Signal Deadband Advisor', labelKey: 'nav.items.signal-deadband' },
      { to: '/signal-mutual-information', label: 'Nonlinear Signal Coupling', labelKey: 'nav.items.signal-mutual-information' },
    ],
  },
  {
    primary: '/anomaly-detection',
    label: 'Vehicle Diagnostics',
    labelKey: 'nav.diagnosticGroups.vehicle',
    pages: [
      { to: '/anomaly-detection', label: 'Anomaly Detection', labelKey: 'nav.items.anomaly-detection' },
      { to: '/diagnostics/rul', label: 'Remaining Useful Life', labelKey: 'nav.items.diagnostics_rul' },
      { to: '/diagnostics/root-cause', label: 'Root-Cause Intelligence', labelKey: 'nav.items.diagnostics_root-cause' },
    ],
  },
] as const

export function findDiagnosticGroup(pathname: string) {
  return findSectionGroup(DIAGNOSTIC_GROUPS, pathname)
}

export function diagnosticPrimaryPath(pathname: string) {
  return sectionPrimaryPath(DIAGNOSTIC_GROUPS, pathname)
}

export function labelDiagnosticPrimaries<T extends { to: string; label: string; labelKey: string }>(
  items: readonly T[],
): T[] {
  return labelSectionPrimaries(items, DIAGNOSTIC_GROUPS)
}

export function diagnosticSidebarItems<T extends { to: string; label: string; labelKey: string }>(
  items: readonly T[],
): T[] {
  return sectionSidebarItems(items, DIAGNOSTIC_GROUPS)
}
