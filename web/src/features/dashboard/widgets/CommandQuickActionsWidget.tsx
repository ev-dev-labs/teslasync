import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Unlock, Thermometer, Container, Flashlight,
  Volume2, Loader2, Zap,
} from 'lucide-react';
import { Button, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useDataState } from '@/hooks/useDataState';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps, WidgetSize } from './types';

export interface QuickCommand {
  id: string;
  command: string;
  icon: React.ElementType;
  labelKey: string;
  labelFallback: string;
  color: string;
}

export const COMMANDS: QuickCommand[] = [
  { id: 'unlock', command: 'unlock', icon: Unlock, labelKey: 'glance.action.unlock', labelFallback: 'Unlock', color: 'text-[var(--theme-on-primary)]' },
  { id: 'climate_on', command: 'climate_on', icon: Thermometer, labelKey: 'widget.climatePanel.title', labelFallback: 'Climate', color: 'text-cyan-300' },
  { id: 'frunk', command: 'actuate_frunk', icon: Container, labelKey: 'commands.doors.frunk', labelFallback: 'Frunk', color: 'text-purple-400' },
  { id: 'trunk', command: 'actuate_trunk', icon: Container, labelKey: 'commands.doors.trunk', labelFallback: 'Trunk', color: 'text-indigo-400' },
  { id: 'flash', command: 'flash_lights', icon: Flashlight, labelKey: 'palette.cmd.flash', labelFallback: 'Flash', color: 'text-yellow-400' },
  { id: 'honk', command: 'honk_horn', icon: Volume2, labelKey: 'glance.action.horn', labelFallback: 'Honk', color: 'text-amber-400' },
];

/**
 * The command set follows the widget's After card: it is stable across sizes,
 * with layout density changing only for a compact 1×1 tile.
 */
export function visibleCommandsForSize(size: WidgetSize): QuickCommand[] {
  void size;
  return COMMANDS;
}

export default function CommandQuickActionsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehicleQuery = useVehicles();
  const { data: vehicles, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = vehicleQuery;
  // An explicit selection is already sufficient evidence for these actions.
  const state = useDataState({ ...vehicleQuery, data: vehicleId ? vehicleId : vehicles });
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { mutate: sendCommand } = useVehicleCommand();
  const operationalMode = useOperationalMode();
  const [activeCommand, setActiveCommand] = useState<string | null>(null);

  const cols = size?.cols ?? 2;
  const rows = size?.rows ?? 2;
  const isCompact = cols <= 1 && rows <= 1;

  // Only show the skeleton while we're still resolving a vehicle id from the
  // list. If an explicit vehicleId prop was supplied the command grid is
  // immediately actionable and must not be hidden behind a loading state.
  const showLoading = !id && isLoading;

  const handleCommand = useCallback(
    (command: string) => {
      if (!id || !operationalMode.canWrite) return;
      setActiveCommand(command);
      sendCommand(
        { vehicleId: id, command },
        { onSettled: () => setActiveCommand(null) },
      );
    },
    [id, operationalMode.canWrite, sendCommand],
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const visibleCommands = visibleCommandsForSize(size);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.quickActions.title', 'Quick actions')}
      icon={isCompact ? undefined : <Zap className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={showLoading}
      dataState={{ ...state, status: state.status === 'initial' && !showLoading ? 'unavailable' : state.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {id ? (
        <div
          className={
            isCompact
              ? 'grid grid-cols-3 gap-1.5 h-full items-center'
              : 'grid grid-cols-3 gap-2'
          }
        >
          {visibleCommands.map((cmd) => {
            const Icon = cmd.icon;
            const isRunning = activeCommand === cmd.command;

            return (
              <Button
                key={cmd.id}
                variant={cmd.id === 'unlock' ? 'primary' : 'secondary'}
                size="sm"
                wrapLabel={false}
                icon={isRunning
                  ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-neon-cyan" />
                  : <Icon aria-hidden="true" className={`h-4 w-4 ${cmd.color}`} />}
                disabled={!!activeCommand || !operationalMode.canWrite}
                title={
                  !operationalMode.canWrite
                    ? operationalMode.writeBlockReason ?? undefined
                    : undefined
                }
                aria-busy={isRunning || undefined}
                onClick={() => handleCommand(cmd.command)}
                aria-label={t(cmd.labelKey, cmd.labelFallback)}
                className={
                  isCompact
                    ? 'h-full min-h-8 min-w-0 flex-col gap-1 px-1 rounded-shape-lg'
                    : 'h-auto min-h-[68px] min-w-0 flex-col gap-1 px-2 py-2 rounded-shape-lg'
                }
              >
                {!isCompact && (
                  <Text variant="bodySm" className="w-full text-center">
                    {t(cmd.labelKey, cmd.labelFallback)}
                  </Text>
                )}
              </Button>
            );
          })}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.quickActions.noVehicle', 'No vehicle selected')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
