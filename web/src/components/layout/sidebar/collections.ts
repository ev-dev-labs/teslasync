import { DIAGNOSTIC_GROUPS } from '../diagnosticGroups'
import { REPORT_GROUPS } from '../reportGroups'
import { sectionPrimaryPath, type SectionGroup } from '../sectionGroups'

type Item = { to: string; label: string; labelKey: string }
type Section<T extends Item> = { title: string; items: T[] }

// Keep routes in the canonical catalog. Collections only change how the
// sidebar presents related destinations, never what a route renders.
const DEFINITIONS = [
  ['Vehicle History', '/timeline', '/activity', '/day-log', '/time-machine'],
  ['Fleet', '/vehicles', '/vehicle-management', '/vehicle-comparison', '/utilization', '/fleet-operations'],
  ['Live Vehicle', '/digital-twin', '/physics-cockpit', '/intelligence/twin-lab'],
  ['Places', '/locations', '/parking', '/geofences'],
  ['Drives', '/drives', '/drive-calendar', '/explorer', '/drive-compare', '/segments'],
  ['Trip Records', '/trips', '/mileage', '/logbook', '/mileage-budget'],
  ['Journeys', '/journeys', '/trip-planner', '/navigation', '/departure-forecast', '/arrival-reliability', '/destination-transitions', '/journey-fragmentation', '/intelligence/journey-assurance'],
  ['Driving Insights', '/drive-score', '/driving-rhythm', '/speed-sweetspot', '/efficiency-target', '/cold-start', '/milestones', '/lifetime-stats', '/fsd'],
  ['Driving Dynamics', '/driving-dynamics', '/speed-profile', '/regen-efficiency', '/route-efficiency', '/drive-dna', '/seasonal-efficiency', '/what-if'],
  ['Charging', '/charging', '/tesla-charging-history', '/charging-curve', '/charging-heatmap', '/charge-departure-alignment', '/charging-thermal-tax'],
  ['Charge Planning', '/smart-charge', '/charge-advisor', '/energy-orchestrator', '/powershare'],
  ['Charger Health', '/charger-health', '/charge-interruption', '/charger-resilience', '/intelligence/charging-forensics', '/intelligence/charging-site-twin'],
  ['Battery Health', '/battery', '/battery-cells', '/battery-degradation', '/battery-passport', '/pack-capacity', '/cycle-stress', '/battery-care'],
  ['Range & Standby', '/projected-range', '/range-buffer', '/vampire-drain', '/sleep-efficiency'],
  ['Energy', '/energy', '/energy-flow', '/power-flow', '/energy-ledger', '/energy-products'],
  ['Maintenance', '/maintenance', '/service-intelligence', '/diagnostics/service-evidence', '/ownership/warranty-command', '/ownership/consumables-lifecycle'],
  ['Vehicle Health', '/tire-pressure', '/tire-differential-drift', '/drivetrain-health', '/intelligence/component-survival'],
  ['Firmware', '/software-updates', '/firmware-impact', '/intelligence/firmware-canary'],
  ['Cabin Climate', '/climate-control', '/cabin-thermal', '/hvac-cycling', '/comfort-consistency', '/preconditioning-effectiveness'],
  ['Commands', '/commands', '/command-history', '/command-reliability'],
  ['Alerts & Automation', '/automations', '/notifications/studio', '/notifications/rules', '/notifications/packs'],
  ['Notifications', '/notifications/inbox', '/notifications/channels', '/notifications/browser', '/notifications/quiet-hours', '/notifications/health'],
  ['Security', '/security-access', '/safety-settings', '/guard-mode', '/dashcam'],
  ['Tesla Account', '/tesla-account', '/tesla-orders', '/fleet-api', '/tesla-region', '/tesla-features', '/account/2fa', '/account/sessions', '/account/privacy'],
  ['Helix', '/chatbot', '/integrations/helix', '/intelligence-packs'],
  ['Data Management', '/data-export', '/backup', '/data-repair', '/ownership/data-governance', '/ownership/jurisdiction-compliance'],
  ['Ownership Costs', '/ownership/tariff-lab', '/ownership/charging-reconciliation', '/ownership/subscription-roi', '/intelligence/tco-optimizer'],
  ['Driver Insights', '/ownership/driver-attribution', '/ownership/insurance-telematics'],
  ['Administration', '/admin/flags', '/admin/secret-rotation', '/admin/audit-log', '/admin/gdpr-exports'],
  ['Developer Tools', '/dev-tools', '/api-playground', '/api-keys'],
] as const

export const COLLECTION_DEFINITIONS = DEFINITIONS.map(([label, primary, ...siblings]) => ({
  label,
  primary,
  paths: [primary, ...siblings],
  labelKey: `nav.collections.${primary.slice(1).replace(/\W/g, '_')}`,
}))

export function collectionGroups<T extends Item>(sections: readonly Section<T>[]): SectionGroup[] {
  const items = new Map(sections.flatMap(section => section.items.map(item => [item.to, item] as const)))
  const custom = COLLECTION_DEFINITIONS.map(({ label, labelKey, primary, paths }) => ({
    primary,
    label,
    labelKey,
    pages: paths.flatMap(path => {
      const item = items.get(path)
      return item ? [{ to: item.to, label: item.label, labelKey: item.labelKey }] : []
    }),
  }))
  return [...REPORT_GROUPS, ...DIAGNOSTIC_GROUPS, ...custom]
    .map(group => ({ ...group, pages: group.pages.filter(page => items.has(page.to)) }))
    .filter(group => group.pages.length > 1 && group.pages[0].to === group.primary)
}

export function collectionPrimaryPath(groups: readonly SectionGroup[], pathname: string) {
  return sectionPrimaryPath(groups, pathname)
}

export function collectionSidebarSections<T extends Item>(
  sections: readonly Section<T>[],
  groups: readonly SectionGroup[],
): Array<Section<T>> {
  const children = new Set(groups.flatMap(group => group.pages.map(page => page.to).filter(path => path !== group.primary)))
  const primaries = new Map(groups.map(group => [group.primary, group]))
  return sections.map(section => ({
    ...section,
    items: section.items.filter(item => !children.has(item.to)).map(item => {
      const group = primaries.get(item.to)
      return group ? { ...item, label: group.label, labelKey: group.labelKey } : item
    }),
  })).filter(section => section.items.length > 0)
}
