import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Lock, Unlock, Thermometer, ThermometerSnowflake, Container, Flashlight,
  Volume2, Loader2, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVehicleCommand } from '@/api/hooks/useVehicleCommand';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

interface QuickCommand {
  id: string;
  command: string;
  icon: React.ElementType;
  labelKey: string;
  labelFallback: string;
  color: string;
}

const COMMANDS: QuickCommand[] = [
  { id: 'lock', command: 'lock', icon: Lock, labelKey: 'widget.quickActions.lock', labelFallback: 'Lock', color: 'text-neon-green' },
  { id: 'unlock', command: 'unlock', icon: Unlock, labelKey: 'widget.quickActions.unlock', labelFallback: 'Unlock', color: 'text-neon-red' },
  { id: 'climate_on', command: 'climate_on', icon: Thermometer, labelKey: 'widget.quickActions.climateOn', labelFallback: 'Climate On', color: 'text-neon-cyan' },
  { id: 'climate_off', command: 'climate_off', icon: ThermometerSnowflake, labelKey: 'widget.quickActions.climateOff', labelFallback: 'Climate Off', color: 'text-blue-400' },
  { id: 'frunk', command: 'actuate_frunk', icon: Container, labelKey: 'widget.quickActions.frunk', labelFallback: 'Frunk', color: 'text-purple-400' },
  { id: 'honk', command: 'honk_horn', icon: Volume2, labelKey: 'widget.quickActions.horn', labelFallback: 'Horn', color: 'text-amber-400' },
  { id: 'flash', command: 'flash_lights', icon: Flashlight, labelKey: 'widget.quickActions.flash', labelFallback: 'Flash', color: 'text-yellow-400' },
  { id: 'trunk', command: 'actuate_trunk', icon: Container, labelKey: 'widget.quickActions.trunk', labelFallback: 'Trunk', color: 'text-indigo-400' },
];

export default function CommandQuickActionsWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const mutation = useVehicleCommand();
  const [activeCommand, setActiveCommand] = useState<string | null>(null);

  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isWide = size.cols >= 3;

  const handleCommand = useCallback(
    (command: string) => {
      if (!id) return;
      setActiveCommand(command);
      mutation.mutate(
        { vehicleId: id, command },
        { onSettled: () => setActiveCommand(null) },
      );
    },
    [id, mutation],
  );

  // Pick which commands to show based on size
  const visibleCommands = isCompact ? COMMANDS.slice(0, 4) : isWide ? COMMANDS : COMMANDS.slice(0, 6);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.quickActions.title', 'Quick Actions')}
      icon={isCompact ? undefined : <Zap className="h-3.5 w-3.5 text-neon-cyan" />}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {id ? (
        <div
          className={
            isCompact
              ? 'grid grid-cols-2 gap-1.5 h-full items-center'
              : isWide
                ? 'grid grid-cols-4 gap-2'
                : 'grid grid-cols-3 gap-2'
          }
        >
          {visibleCommands.map((cmd) => {
            const Icon = cmd.icon;
            const isRunning = activeCommand === cmd.command;

            return (
              <Button
                key={cmd.id}
                variant="ghost"
                size="sm"
                disabled={!!activeCommand}
                onClick={() => handleCommand(cmd.command)}
                aria-label={t(cmd.labelKey, cmd.labelFallback)}
                className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-colors h-auto"
              >
                {isRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin text-neon-cyan" />
                ) : (
                  <Icon className={`h-4 w-4 ${cmd.color}`} />
                )}
                {!isCompact && (
                  <span className="text-[10px] text-white/60 truncate w-full text-center">
                    {t(cmd.labelKey, cmd.labelFallback)}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          message={t('widget.quickActions.noVehicle', 'No vehicle selected')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
