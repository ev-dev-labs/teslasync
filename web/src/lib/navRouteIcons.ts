import { Icons } from './icons'

// Shared glyphs for destinations linked from more than one navigation surface.
export const navRouteIcons = {
  '/': Icons.layoutDashboard,
  '/drives': Icons.drive,
  '/charging': Icons.batteryCharging,
  '/battery': Icons.heartPulse,
  '/live': Icons.radar,
  '/analytics': Icons.analytics,
  '/climate': Icons.climate,
  '/climate-control': Icons.climate,
  '/efficiency': Icons.leaf,
  '/settings': Icons.settings,
  '/statistics': Icons.pieChart,
  '/period-compare': Icons.calendar,
  '/weekly-digest': Icons.calendarCheck,
  '/mileage': Icons.speed,
  '/timeline': Icons.clock,
} as const
