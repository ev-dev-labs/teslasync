import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Caption, CommandPaletteTrigger } from '@/components/ui/runtime'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
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
 * focused navigation surface. Equal side tracks keep discovery geometrically
 * centered within the workspace regardless of breadcrumb or utility width.
 */
export function WorkspaceHeader({
  notifications,
  themeControl,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation()
  const workspaceScope = useWorkspaceScope()
  const showRange = !workspaceScope.managed || workspaceScope.range
  const showVehicle = !workspaceScope.managed || workspaceScope.vehicle

  return (
    <header
      data-role="workspace-header"
      aria-label={t('nav.workspaceHeader', 'Workspace command bar')}
      data-layout="balanced-three-track"
      className="hidden h-[4.5rem] shrink-0 grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)_minmax(0,1fr)] items-center gap-4 border-b border-[var(--border-default)] bg-[var(--surface-1)] px-4 shadow-e1 xl:grid 2xl:px-6"
    >
      <div className="min-w-0 overflow-hidden justify-self-start">
        <Caption className="mb-1 hidden font-semibold uppercase tracking-[0.1em] 3xl:block">
          {t('nav.workspaceContext', 'Fleet operations')}
        </Caption>
        <LayoutBreadcrumbs variant="workspace" className="min-w-0 text-sm" />
      </div>

      <div
        className="w-full min-w-0 justify-self-center"
        data-role="workspace-search"
      >
        <CommandPaletteTrigger />
      </div>

      <div className="flex min-w-0 items-center justify-self-end gap-1.5 border-s border-[var(--border-default)] ps-3">
        <WorkspaceContextControl
          hidden={!showRange}
          className="max-w-32 px-2 2xl:max-w-40 2xl:px-3"
        />
        {showVehicle && (
          <VehiclePicker
            hideWhenSingle={false}
            className="w-40 border-b-0 px-0 py-0 2xl:w-44 2xl:px-0 2xl:py-0"
          />
        )}
        {notifications}
        {themeControl}
      </div>
    </header>
  )
}
