import {
  findSectionGroup,
  labelSectionPrimaries,
  sectionPrimaryPath,
  sectionSidebarItems,
} from './sectionGroups'

const page = (to: string, label: string) => ({
  to,
  label,
  labelKey: `nav.items.${to.slice(1).replace(/\//g, '_')}`,
})

export const DIAGNOSTIC_GROUPS = [
  {
    primary: '/system-status',
    label: 'System Health',
    labelKey: 'nav.diagnosticGroups.systemHealth',
    pages: [
      page('/system-status', 'System Status'),
      page('/outage', 'Outage Autobiography'),
      page('/tesla-api-usage', 'Tesla API Usage'),
      page('/api-logs', 'API Logs'),
    ],
  },
  {
    primary: '/db-health',
    label: 'Database & Data Health',
    labelKey: 'nav.diagnosticGroups.dataHealth',
    pages: [
      page('/db-health', 'Database Health'),
      page('/admin/schema-drift', 'Schema Drift'),
      page('/admin/slow-queries', 'Slow Queries'),
      page('/admin/data-quality', 'Data Quality'),
      page('/admin/disk-forecast', 'Disk Forecast'),
    ],
  },
  {
    primary: '/signals',
    label: 'Telemetry Troubleshooting',
    labelKey: 'nav.diagnosticGroups.telemetry',
    pages: [
      page('/signals', 'Live Signals'),
      page('/admin/live-signals', 'Live Signal Inspector'),
      page('/admin/ingest-xray', 'Ingest X-Ray'),
      page('/mqtt-inspector', 'MQTT Inspector'),
      page('/admin/dlq', 'DLQ Inspector'),
      page('/redis-signals', 'Redis Signals'),
      page('/admin/telemetry/coverage', 'Telemetry Coverage'),
      page('/state-debugger', 'State Debugger'),
    ],
  },
  {
    primary: '/signal-correlation',
    label: 'Signal Analysis',
    labelKey: 'nav.diagnosticGroups.signalAnalysis',
    pages: [
      page('/signal-correlation', 'Signal Correlation'),
      page('/signal-entropy', 'Signal Entropy'),
      page('/signal-trend', 'Signal Trend'),
      page('/signal-change-points', 'Signal Change Points'),
      page('/signal-deadband', 'Signal Deadband Advisor'),
      page('/signal-mutual-information', 'Nonlinear Signal Coupling'),
    ],
  },
  {
    primary: '/anomaly-detection',
    label: 'Vehicle Diagnostics',
    labelKey: 'nav.diagnosticGroups.vehicle',
    pages: [
      page('/anomaly-detection', 'Anomaly Detection'),
      page('/diagnostics/rul', 'Remaining Useful Life'),
      page('/diagnostics/root-cause', 'Root-Cause Intelligence'),
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
