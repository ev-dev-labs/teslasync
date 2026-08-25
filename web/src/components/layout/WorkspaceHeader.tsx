import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Caption, CommandPaletteTrigger } from '@/components/ui/runtime'
import { LayoutBreadcrumbs } from './LayoutBreadcrumbs'
import { VehiclePicker } from './VehiclePicker'
import { WorkspaceContextControl } from './WorkspaceContextControl'

interface WorkspaceHeaderProps {
  notifications?: ReactNode
  themeControl?: ReactNode
}

/**
 * Persistent desktop command header.
 *
 * Global discovery and scope controls live here so the sidebar can remain a
 * focused navigation surface. The footer status line still exposes the active
 * vehicle and operational state for always-on monitoring.
 */
export function WorkspaceHeader({
  notifications,
  themeControl,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation()

  return (
    <header
      data-role="workspace-header"
      aria-label={t('nav.workspaceHeader', 'Workspace command bar')}
      className="hidden h-[4.5rem] shrink-0 items-center gap-5 border-b border-[var(--border-default)] bg-[var(--surface-1)] px-6 shadow-e1 xl:flex 2xl:px-8"
    >
      <div className="min-w-0 flex-1">
        <Caption className="mb-1 block font-semibold uppercase tracking-[0.1em]">
          {t('nav.workspaceContext', 'Fleet operations')}
        </Caption>
        <LayoutBreadcrumbs variant="workspace" className="min-w-0 text-sm" />
      </div>

      <div
        className="w-[min(24vw,22rem)] shrink-0"
        data-role="workspace-search"
      >
        <CommandPaletteTrigger />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-s border-[var(--border-default)] ps-4">
        <WorkspaceContextControl />
        <VehiclePicker className="min-w-52 border-b-0 px-0 py-0 xl:px-0 xl:py-0" />
        {notifications}
        {themeControl}
      </div>
    </header>
  )
}
