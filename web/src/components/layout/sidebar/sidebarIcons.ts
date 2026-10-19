import { NAV_SECTION_ICONS } from './NavIcons'
import { Icons, type LucideIcon } from '@/lib/icons'

export const SIDEBAR_SHORTCUT_ICONS = {
  suggested: Icons.sparkles,
  saved: Icons.star,
  allPages: Icons.compass,
  alerts: Icons.notificationsActive,
  display: Icons.palette,
}

// Route glyphs stay eager; section motion stays in the lazy navigation chunk.
export { SIDEBAR_ROUTE_ICONS } from './sidebarRouteIcons'

export const SIDEBAR_SECTION_ICONS = NAV_SECTION_ICONS

/** One section glyph for every navigation surface. */
export function resolveSectionIcon(title: string): LucideIcon {
  return SIDEBAR_SECTION_ICONS[title] ?? Icons.home
}
export const PHONE_TAB_SECTIONS = ['Home', 'Vehicles', 'Driving', 'Charging'] as const
