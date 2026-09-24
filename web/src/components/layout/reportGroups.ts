export const REPORT_GROUPS = [
  {
    primary: '/statistics',
    label: 'Fleet Insights',
    labelKey: 'nav.reportGroups.fleetInsights',
    pages: [
      { to: '/statistics', label: 'Statistics', labelKey: 'nav.items.statistics' },
      { to: '/analytics', label: 'Analytics', labelKey: 'nav.items.analytics' },
      { to: '/period-compare', label: 'Period Comparison', labelKey: 'nav.items.period-compare' },
    ],
  },
  {
    primary: '/efficiency',
    label: 'Driving Efficiency',
    labelKey: 'nav.reportGroups.drivingEfficiency',
    pages: [
      { to: '/efficiency', label: 'Efficiency', labelKey: 'nav.items.efficiency' },
      { to: '/temperature-impact', label: 'Temperature Impact', labelKey: 'nav.items.temperature-impact' },
      { to: '/drive-archetypes', label: 'Drive Archetypes', labelKey: 'nav.items.drive-archetypes' },
    ],
  },
  {
    primary: '/cost-analysis',
    label: 'Costs',
    labelKey: 'nav.reportGroups.costs',
    pages: [
      { to: '/cost-analysis', label: 'Cost Analysis', labelKey: 'nav.items.cost-analysis' },
      { to: '/tco', label: 'Cost of Ownership', labelKey: 'nav.items.tco' },
    ],
  },
] as const

const REPORT_STANDALONE_PATHS = ['/share-card', '/analytics/carbon', '/benchmarks/privacy']
const REPORT_PRIMARY_PATHS = new Set<string>([
  ...REPORT_GROUPS.map(group => group.primary),
  ...REPORT_STANDALONE_PATHS,
])

export function findReportGroup(pathname: string) {
  return REPORT_GROUPS.find(group => group.pages.some(page => page.to === pathname))
}

export function reportPrimaryPath(pathname: string) {
  return findReportGroup(pathname)?.primary ?? pathname
}

export function labelReportPrimaries<T extends { to: string; label: string; labelKey: string }>(
  items: readonly T[],
): T[] {
  return items.map(item => {
    const group = REPORT_GROUPS.find(candidate => candidate.primary === item.to)
    return group ? { ...item, label: group.label, labelKey: group.labelKey } : item
  })
}

export function reportSidebarItems<T extends { to: string; label: string; labelKey: string }>(
  items: readonly T[],
): T[] {
  return labelReportPrimaries(items.filter(item => REPORT_PRIMARY_PATHS.has(item.to)))
}
