import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { CommandPaletteTrigger } from '@/components/ui/CommandPaletteTrigger'
import { NotificationBellPopover } from '../NotificationBellPopover'
import { ThemeQuickSwitcher } from '../ThemeQuickSwitcher'
import { LayoutBreadcrumbs } from '../LayoutBreadcrumbs'
import { VehiclePicker } from '../VehiclePicker'
import { WorkspaceContextControl } from '../WorkspaceContextControl'
import { HorizontalNavigation } from './HorizontalNavigation'
import type { NavModel } from './navGroups'

type Props = NavModel & { activeSectionTitle?: string; notificationLabel: string }

export default function HorizontalHeader({ activeSectionTitle, notificationLabel, ...model }: Props) {
  const compact = useMediaQuery('(max-width: 1023px)')
  const scope = useWorkspaceScope()
  const showRange = scope.range || (!compact && !scope.managed)
  const showVehicle = scope.vehicle || (!compact && !scope.managed)
  const workspace = (showRange || showVehicle) && <div className="horizontal-nav-scope">
    <WorkspaceContextControl hidden={!showRange} className={compact ? 'max-w-40 px-2' : 'max-w-32 px-2'} />
    {showVehicle && <VehiclePicker hideWhenSingle={false}
      className={compact ? 'min-w-0 flex-1 border-b-0 px-0 py-0 lg:px-0 lg:py-0' : 'w-32 min-w-0 border-b-0 px-0 py-0 lg:px-0 lg:py-0'} />}
  </div>
  return <HorizontalNavigation model={model} activeSectionTitle={activeSectionTitle}
    context={<LayoutBreadcrumbs variant="workspace" sections={model.sections} collections={model.collections} />}
    workspace={workspace} tools={<>
      <CommandPaletteTrigger compact />
      <NotificationBellPopover count={model.unreadCount} label={notificationLabel} className="horizontal-nav-bell" />
      <ThemeQuickSwitcher />
    </>} />
}
