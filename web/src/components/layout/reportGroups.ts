import {
  findSectionGroup,
  labelSectionPrimaries,
  sectionPrimaryPath,
  sectionSidebarItems,
} from './sectionGroups'

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
export function findReportGroup(pathname: string) {
  return findSectionGroup(REPORT_GROUPS, pathname)
}

export function reportPrimaryPath(pathname: string) {
  return sectionPrimaryPath(REPORT_GROUPS, pathname)
}

export function labelReportPrimaries<T extends { to: string; label: string; labelKey: string }>(
  items: readonly T[],
): T[] {
  return labelSectionPrimaries(items, REPORT_GROUPS)
}

export function reportSidebarItems<T extends { to: string; label: string; labelKey: string }>(
  items: readonly T[],
): T[] {
  return sectionSidebarItems(items, REPORT_GROUPS, REPORT_STANDALONE_PATHS)
}
