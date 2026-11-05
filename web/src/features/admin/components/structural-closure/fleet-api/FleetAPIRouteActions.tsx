import { Toggle, Label, Tooltip } from '@/components/ui';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIRouteActions({ controller }: Props) {
  const { t, pollingConfigMut, pollingConfig, pollingKnown, toggleAllAccess, toggleAllAuto, totalCount, enabledCount, autoCount, eligibleCount } = controller;
  if (!pollingKnown || !pollingConfig) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Label className="flex items-center gap-2">
        {t('fleetApi.controls.bulkAccess', 'Access all')}
        <Toggle checked={enabledCount === totalCount} onChange={toggleAllAccess}
          disabled={pollingConfigMut.isPending} size="sm"
          aria-label={t('fleetApi.controls.bulkAccess', 'Access all')} />
      </Label>
      <Tooltip multiline content={pollingConfig.auto_polling_enabled
        ? t('fleetApi.controls.bulkHint', 'Auto-poll selects only enabled routes with a scheduled job.')
        : t('fleetApi.controls.pausedHint', 'Turn on Tesla API Polling to change auto-poll selections. Existing selections are retained while paused.')}>
        <Label className="flex items-center gap-2" tabIndex={0}>
          {t('fleetApi.controls.bulkAuto', 'Auto-poll eligible routes')}
          <Toggle checked={eligibleCount > 0 && autoCount === eligibleCount} onChange={toggleAllAuto}
            disabled={pollingConfigMut.isPending || eligibleCount === 0 || !pollingConfig.auto_polling_enabled} size="sm"
            aria-label={t('fleetApi.controls.bulkAuto', 'Auto-poll eligible routes')} />
        </Label>
      </Tooltip>
    </div>
  );
}
