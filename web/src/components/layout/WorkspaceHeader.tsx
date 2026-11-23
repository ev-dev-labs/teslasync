import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Caption } from '../ui/Typography'
import { CommandPaletteTrigger } from '../ui/CommandPaletteTrigger'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { LayoutBreadcrumbs } from './LayoutBreadcrumbs'
import type { SectionGroup } from './sectionGroups'
import type { BreadcrumbSection } from './sidebar/sidebarBreadcrumbs'
import { VehiclePicker } from './VehiclePicker'
import { WorkspaceContextControl } from './WorkspaceContextControl'
import MobileWorkspaceControls from './MobileWorkspaceControls'
import { NotificationBellPopover } from './NotificationBellPopover'
import { ThemeQuickSwitcher } from './ThemeQuickSwitcher'
import { PrefetchNavLink } from './PrefetchLink'
import { Icons } from '@/lib/icons'
import { cn } from '@/lib/cn'

interface WorkspaceHeaderProps {
  unreadCount: number
  notificationLabel: string
  compact?: boolean
  browseControl?: ReactNode
  breadcrumbSections?: readonly BreadcrumbSection[]
  breadcrumbCollections?: readonly SectionGroup[]
}

/**
 * Persistent desktop command header.
 *
 * Global discovery and scope controls live here so the sidebar can remain a
 * focused navigation surface. Discovery stays centered when both side tracks
 * have room; the controls reserve space before the flexible tracks shrink.
 */
export function WorkspaceHeader({
  unreadCount,
  notificationLabel,
  compact = false,
  browseControl,
  breadcrumbSections,
  breadcrumbCollections,
}: WorkspaceHeaderProps) {
  const { t } = useTranslation()
  const workspaceScope = useWorkspaceScope()
  const showRange = !workspaceScope.managed || workspaceScope.range
  const showVehicle = !workspaceScope.managed || workspaceScope.vehicle
  const accountPath = breadcrumbSections?.find(section => section.titleKey === 'nav.groups.account')?.items[0]?.to

  return (
    <header
      data-app-part="workspace-header"
      data-role="workspace-header"
      aria-label={t('nav.workspaceHeader', 'Workspace command bar')}
      data-layout={compact ? undefined : 'balanced-three-track'}
      className={cn('relative z-20 shrink-0 items-center border-b border-[var(--border-default)] bg-[var(--surface-1)] px-4 shadow-e1',
        compact ? 'flex min-h-14 flex-wrap gap-1 pb-1 pt-[calc(0.25rem+env(safe-area-inset-top,0px))] max-sm:justify-between' : 'grid h-workspace-header grid-cols-workspace-header gap-4 2xl:px-6')}
    >
      {browseControl}
      <div data-app-header-slot="context" className={cn('min-w-0 overflow-hidden justify-self-start', compact && 'hidden flex-1 sm:block')}>
        <Caption className="mb-1 hidden 3xl:block">
          {t('nav.workspaceContext', 'Fleet operations')}
        </Caption>
        <LayoutBreadcrumbs variant="workspace" className="min-w-0 text-sm" sections={breadcrumbSections} collections={breadcrumbCollections} />
      </div>

      <div
        className={cn('min-w-0 justify-self-center', compact ? 'shrink-0' : 'w-full')}
        data-role="workspace-search"
        data-app-header-slot="discovery"
      >
        <CommandPaletteTrigger compact={compact} />
      </div>

      <div data-app-header-slot="controls" className="flex min-w-0 items-center justify-self-end gap-2">
        {!compact && <WorkspaceContextControl
          hidden={!showRange}
          className="max-w-32 px-2 2xl:max-w-40 2xl:px-3"
        />}
        {!compact && showVehicle && (
          <VehiclePicker
            hideWhenSingle={false}
            className="w-40 border-b-0 px-0 py-0 lg:px-0 lg:py-0 2xl:w-44"
          />
        )}
        <NotificationBellPopover count={unreadCount} label={notificationLabel} className="max-lg:[&>button]:min-h-11 max-lg:[&>button]:min-w-11" />
        <ThemeQuickSwitcher />
        {accountPath && <PrefetchNavLink to={accountPath} aria-label={t('nav.groups.account', 'Account')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-shape-md hover:bg-[var(--control-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-accent)]">
          <Icons.user className="size-5" aria-hidden />
        </PrefetchNavLink>}
      </div>
      {compact && (workspaceScope.range || workspaceScope.vehicle) && <MobileWorkspaceControls />}
    </header>
  )
}
