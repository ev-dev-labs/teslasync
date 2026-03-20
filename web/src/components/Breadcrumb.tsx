import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

const routeNames: Record<string, string> = {
  '': 'Dashboard',
  'live': 'Live Map',
  'vehicles': 'Vehicles',
  'drives': 'Drives',
  'charging': 'Charging',
  'analytics': 'Analytics',
  'energy': 'Energy',
  'battery': 'Battery Health',
  'settings': 'Settings',
  'commands': 'Commands',
  'alerts': 'Alerts',
  'geofences': 'Geofences',
  'notifications': 'Notifications',
  'chatbot': 'Chatbot',
  'tire-pressure': 'Tire Pressure',
  'software-updates': 'Software Updates',
  'vampire-drain': 'Vampire Drain',
  'locations': 'Locations',
  'timeline': 'Timeline',
  'mileage': 'Mileage',
  'projected-range': 'Projected Range',
  'efficiency': 'Efficiency',
  'trips': 'Trips',
  'statistics': 'Statistics',
  'system-status': 'System Status',
  'roadmap': 'Roadmap',
}

export function Breadcrumb() {
  const location = useLocation()
  const parts = location.pathname.split('/').filter(Boolean)

  if (parts.length === 0) return null

  return (
    <nav className="flex items-center gap-1 text-[11px] mb-4" style={{ color: 'var(--text-muted)' }}>
      <Link to="/" className="hover:text-[var(--theme-primary)]"><Home className="h-3 w-3" /></Link>
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          {i === parts.length - 1 ? (
            <span style={{ color: 'var(--text-primary)' }}>{routeNames[part] || part}</span>
          ) : (
            <Link to={'/' + parts.slice(0, i + 1).join('/')} className="hover:text-[var(--theme-primary)]">
              {routeNames[part] || part}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
