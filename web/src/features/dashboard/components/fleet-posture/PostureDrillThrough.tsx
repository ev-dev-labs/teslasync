import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Caption, Text } from '@/components/ui'
import { Icons } from '@/lib/icons'

interface PostureDrillThroughProps {
  /** Currently scoped vehicle, when one is selected. */
  vehicleId?: number
}

/**
 * Evidence drill-through.
 *
 * A posture panel that says "unverified" without telling the operator where to
 * look is a dead end. Every link goes to an EXISTING route that can actually
 * answer the question the category raises:
 *
 *   - Signals workspace — what did this vehicle last emit, and when?
 *   - System status     — is the ingest/API side healthy?
 *   - Live signals      — the raw L1/L2 boundary, for a suspected cache issue.
 *   - Vehicle detail    — the per-car view, when a vehicle is scoped.
 */
export function PostureDrillThrough({ vehicleId }: PostureDrillThroughProps) {
  const { t } = useTranslation()

  const links = [
    {
      to: '/signals',
      icon: Icons.activity,
      label: t('dashboard.fleetPosture.drill.signals', 'Signal evidence'),
      description: t(
        'dashboard.fleetPosture.drill.signalsHelp',
        'What each vehicle last emitted, and when',
      ),
    },
    {
      to: '/system-status',
      icon: Icons.radioTower,
      label: t('dashboard.fleetPosture.drill.system', 'System diagnostics'),
      description: t(
        'dashboard.fleetPosture.drill.systemHelp',
        'Ingest and API health behind an unreachable read',
      ),
    },
    {
      to: '/admin/live-signals',
      icon: Icons.wifi,
      label: t('dashboard.fleetPosture.drill.liveSignals', 'Live signal inspector'),
      description: t(
        'dashboard.fleetPosture.drill.liveSignalsHelp',
        'The raw live-state boundary for a suspected cache gap',
      ),
    },
    ...(vehicleId != null
      ? [{
        to: `/vehicles/${vehicleId}`,
        icon: Icons.vehicle,
        label: t('dashboard.fleetPosture.drill.vehicle', 'Open scoped vehicle'),
        description: t(
          'dashboard.fleetPosture.drill.vehicleHelp',
          'Full detail for the vehicle in scope',
        ),
      }]
      : []),
  ]

  return (
    <nav
      aria-label={t('dashboard.fleetPosture.drill.title', 'Investigate fleet posture')}
      className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1"
    >
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="group flex min-h-14 items-center gap-3 rounded-shape-md border border-transparent px-3 py-2 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--theme-primary)]">
            <link.icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <Text as="span" weight="medium">{link.label}</Text>
            <Caption className="mt-0.5 block truncate">{link.description}</Caption>
          </span>
          <Icons.drillThrough
            className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:-translate-y-0.5 group-hover:text-[var(--text-secondary)]"
            aria-hidden="true"
          />
        </Link>
      ))}
    </nav>
  )
}
