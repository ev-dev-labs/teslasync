import { useTranslation } from 'react-i18next'

import { Caption, Text } from '@/components/ui'
import { PrefetchLink } from '@/components/layout'
import { Icons } from '@/lib/icons'

/**
 * The dashboard's primary workflow shortcuts.
 *
 * Extracted out of `FleetOperationsBrief` when the posture panel gained its
 * evidence drill-through, so the two navigations stay side by side instead of
 * one replacing the other. These are DESTINATIONS an operator goes to next;
 * `PostureDrillThrough` answers "why does the panel say that?".
 */
export function PostureWorkflows() {
  const { t } = useTranslation()

  const workflows = [
    {
      to: '/live',
      icon: Icons.map,
      label: t('dashboard.fleetPosture.workflow.live', 'Live map'),
      description: t('dashboard.fleetPosture.workflow.liveHelp', 'Position and movement'),
    },
    {
      to: '/notifications/alerts',
      icon: Icons.notificationsActive,
      label: t('dashboard.fleetPosture.workflow.alerts', 'Review alerts'),
      description: t('dashboard.fleetPosture.workflow.alertsHelp', 'Exceptions requiring attention'),
    },
    {
      to: '/charging',
      icon: Icons.charging,
      label: t('dashboard.fleetPosture.workflow.charging', 'Charging'),
      description: t('dashboard.fleetPosture.workflow.chargingHelp', 'Sessions, cost, and readiness'),
    },
    {
      to: '/battery',
      icon: Icons.battery,
      label: t('dashboard.fleetPosture.workflow.battery', 'Battery'),
      description: t('dashboard.fleetPosture.workflow.batteryHelp', 'Capacity and health evidence'),
    },
  ]

  return (
    <>
      <Caption className="mt-6 block font-semibold uppercase tracking-[0.1em]">
        {t('dashboard.fleetPosture.workflows', 'Primary workflows')}
      </Caption>
      <nav
        aria-label={t('dashboard.fleetPosture.workflows', 'Primary workflows')}
        className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1"
      >
        {workflows.map((workflow) => (
          <PrefetchLink
            key={workflow.to}
            to={workflow.to}
            className="group flex min-h-14 items-center gap-3 rounded-shape-md border border-transparent px-3 py-2 transition-colors hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--theme-primary)]">
              <workflow.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <Text as="span" weight="medium">{workflow.label}</Text>
              <Caption className="mt-0.5 block truncate">{workflow.description}</Caption>
            </span>
            <Icons.next
              className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-secondary)]"
              aria-hidden="true"
            />
          </PrefetchLink>
        ))}
      </nav>
    </>
  )
}
