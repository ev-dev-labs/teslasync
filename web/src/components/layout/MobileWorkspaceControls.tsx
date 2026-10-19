import { useWorkspaceScope } from '@/hooks/useWorkspaceScope'
import { VehiclePicker } from './VehiclePicker'
import { WorkspaceContextControl } from './WorkspaceContextControl'

/** Scope remains reachable when the desktop command bar is hidden. */
export default function MobileWorkspaceControls() {
  const scope = useWorkspaceScope()
  return (
    <div data-role="mobile-workspace-controls" className="flex w-full min-w-0 basis-full items-center gap-2">
      <WorkspaceContextControl hidden={scope.managed && !scope.range}
        listenForCommands={false} className="max-w-40 shrink-0 px-2" />
      {(!scope.managed || scope.vehicle) && (
        <VehiclePicker hideWhenSingle={false}
          className="min-w-0 flex-1 border-b-0 px-0 py-0 lg:px-0 lg:py-0" />
      )}
    </div>
  )
}
