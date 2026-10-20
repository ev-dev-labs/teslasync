import { DIAGNOSTIC_GROUPS } from '../diagnosticGroups'
import { REPORT_GROUPS } from '../reportGroups'
import { sectionPrimaryPath, type SectionGroup } from '../sectionGroups'
import type { Icons, LucideIcon } from '@/lib/icons'

type Item = { to: string; label: string; labelKey: string }
type IconItem = Item & { icon: typeof Icons.home; color?: string }
type Section<T extends Item> = { title: string; items: T[] }

/**
 * One flat, directly-renderable sidebar row.
 *
 * Every sidebar style renders collections FLAT: a group primary expands
 * into its visible pages, each a first-class row under the section.
 * There is no second nesting level — multi-level trees made the sidebar
 * hard to scan. The secondary panel can show a collapsible collection
 * heading, but pages retain their own catalog labels and direct links.
 */
export interface FlatSidebarEntry {
  to: string
  label: string
  labelKey: string
  icon: LucideIcon
  color?: string
  dataTour?: string
}

export interface SidebarEntryGroup {
  label?: string
  labelKey?: string
  entries: FlatSidebarEntry[]
}

export function groupSidebarItems<
  T extends { to: string; label: string; labelKey: string; icon: LucideIcon; color?: string; dataTour?: string },
>(
  items: readonly T[],
  groups: readonly SectionGroup[],
): SidebarEntryGroup[] {
  return (items ?? []).flatMap(item => {
    const group = groups.find(candidate => candidate.primary === item.to)
    const entries = flattenSidebarItems([item], groups)
    return entries.length ? [{
      label: group?.label,
      labelKey: group?.labelKey,
      entries,
    }] : []
  })
}

/**
 * Expand a section's items into flat rows: standalone items pass
 * through, collection primaries expand into their pages. Catalog order
 * is preserved throughout. Pinning never removes a page from its
 * group — pins are bookmarks, so the page stays browsable in place
 * and additionally appears under Saved.
 */
export function flattenSidebarItems<
  T extends { to: string; label: string; labelKey: string; icon: LucideIcon; color?: string; dataTour?: string },
>(
  items: readonly T[],
  groups: readonly SectionGroup[],
): FlatSidebarEntry[] {
  return (items ?? []).flatMap(item => {
    const group = groups.find(candidate => candidate.primary === item.to)
    if (!group) {
      return [{
        to: item.to,
        label: item.label,
        labelKey: item.labelKey,
        icon: item.icon,
        color: item.color,
        dataTour: item.dataTour,
      }]
    }
    return group.pages.map(page => ({
      to: page.to,
      label: page.label,
      labelKey: page.labelKey,
      icon: page.icon ?? item.icon,
      color: page.color ?? item.color,
      dataTour: page.to === item.to ? item.dataTour : undefined,
    }))
  })
}

// Keep routes in the canonical catalog. Collections only change how the
// sidebar presents related destinations, never what a route renders.
const DEFINITIONS = [
  ["Vehicle history", '/timeline', '/activity', '/day-log', '/time-machine'],
  ['Fleet', '/vehicles', '/vehicle-management', '/vehicle-comparison', '/utilization', '/fleet-operations'],
  ["Live vehicle", '/digital-twin', '/physics-cockpit', '/intelligence/twin-lab'],
  ['Places', '/locations', '/parking', '/geofences'],
  ["Drive records", '/drives', '/drive-calendar', '/explorer', '/drive-compare', '/segments'],
  ["Trip records", '/trips', '/mileage', '/logbook', '/mileage-budget'],
  ["Journey planning", '/journeys', '/trip-planner', '/navigation', '/departure-forecast', '/arrival-reliability', '/destination-transitions', '/journey-fragmentation', '/intelligence/journey-assurance'],
  ["Driving insights", '/drive-score', '/driving-rhythm', '/speed-sweetspot', '/efficiency-target', '/cold-start', '/milestones', '/lifetime-stats', '/fsd'],
  ["Driving performance", '/driving-dynamics', '/speed-profile', '/regen-efficiency', '/route-efficiency', '/drive-dna', '/seasonal-efficiency', '/what-if'],
  ["Charging activity", '/charging', '/tesla-charging-history', '/charging-curve', '/charging-heatmap', '/charge-departure-alignment', '/charging-thermal-tax'],
  ["Charge planning", '/smart-charge', '/charge-advisor', '/energy-orchestrator', '/powershare'],
  ["Charging reliability", '/charger-health', '/charge-interruption', '/charger-resilience', '/intelligence/charging-forensics', '/intelligence/charging-site-twin'],
  ["Battery insights", '/battery', '/battery-cells', '/battery-degradation', '/battery-passport', '/pack-capacity', '/cycle-stress', '/battery-care'],
  ['Range & Standby', '/projected-range', '/range-buffer', '/vampire-drain', '/sleep-efficiency'],
  ["Energy insights", '/energy', '/energy-flow', '/power-flow', '/energy-ledger', '/energy-products'],
  ["Service & maintenance", '/maintenance', '/service-intelligence', '/diagnostics/service-evidence', '/ownership/warranty-command', '/ownership/consumables-lifecycle'],
  ["Vehicle health", '/tire-pressure', '/tire-differential-drift', '/drivetrain-health', '/intelligence/component-survival'],
  ['Firmware', '/software-updates', '/firmware-impact', '/intelligence/firmware-canary'],
  ["Cabin climate", '/climate-control', '/cabin-thermal', '/hvac-cycling', '/comfort-consistency', '/preconditioning-effectiveness'],
  ["Command center", '/commands', '/command-history', '/command-reliability'],
  ["Alerts & automation", '/automations', '/notifications/studio', '/notifications/rules', '/notifications/packs'],
  ["Notification center", '/notifications/inbox', '/notifications/channels', '/notifications/browser', '/notifications/quiet-hours', '/notifications/health'],
  ["Safety & security", '/security-access', '/safety-settings', '/guard-mode', '/dashcam'],
  ["Tesla account & services", '/tesla-account', '/tesla-orders', '/fleet-api', '/tesla-region', '/tesla-features', '/account/2fa', '/account/sessions', '/account/privacy'],
  ["Helix tools", '/chatbot', '/integrations/helix', '/intelligence-packs'],
  ["Data management", '/data-export', '/backup', '/data-repair', '/ownership/data-governance', '/ownership/jurisdiction-compliance'],
  ["Ownership costs", '/ownership/tariff-lab', '/ownership/charging-reconciliation', '/ownership/subscription-roi', '/intelligence/tco-optimizer'],
  ["Driver insights", '/ownership/driver-attribution', '/ownership/insurance-telematics'],
  ['Administration', '/admin/flags', '/admin/secret-rotation', '/admin/audit-log', '/admin/gdpr-exports'],
  ["Developer workspace", '/dev-tools', '/api-playground', '/api-keys'],
] as const

export const COLLECTION_DEFINITIONS = DEFINITIONS.map(([label, primary, ...siblings]) => ({
  label,
  primary,
  paths: [primary, ...siblings],
  labelKey: `nav.collections.${primary.slice(1).replace(/\W/g, '_')}`,
}))

export function collectionGroups<T extends IconItem>(sections: readonly Section<T>[]): SectionGroup[] {
  const items = new Map(sections.flatMap(section => section.items.map(item => [item.to, item] as const)))
  const custom = COLLECTION_DEFINITIONS.map(({ label, labelKey, primary, paths }) => ({
    primary,
    label,
    labelKey,
    pages: paths.flatMap(path => {
      const item = items.get(path)
      return item ? [{ to: item.to, label: item.label, labelKey: item.labelKey, icon: item.icon, color: item.color }] : []
    }),
  }))
  const configuredGroups: SectionGroup[] = [...REPORT_GROUPS, ...DIAGNOSTIC_GROUPS, ...custom]
  return configuredGroups
    .map(group => ({
      ...group,
      pages: group.pages.flatMap(page => {
        const item = items.get(page.to)
        return item ? [{ ...page, icon: item.icon, color: item.color }] : []
      }),
    }))
    .filter(group => (group.pages.length > 1 || group.includeSingleton) && group.pages[0]?.to === group.primary)
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
