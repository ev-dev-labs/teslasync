import { useId } from 'react';
import { Toggle, Tooltip } from '@/components/ui';
import { VisuallyHidden } from '@/components/a11y';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage>; kind: 'access' | 'auto' };

export function FleetAPIRouteActions({ controller, kind }: Props) {
  const descriptionId = useId();
  const { t, pollingConfigMut, pollingConfig, pollingKnown, toggleAllAccess, toggleAllAuto,
    totalCount, enabledCount, autoCount, eligibleCount } = controller;
  if (!pollingKnown || !pollingConfig) return null;

  const isAccess = kind === 'access';
  const selected = isAccess ? enabledCount : autoCount;
  const total = isAccess ? totalCount : eligibleCount;
  const mixed = selected > 0 && selected < total;
  const label = isAccess
    ? t('fleetApi.controls.bulkAccess', 'Allow all endpoints')
    : t('fleetApi.controls.bulkAuto', 'Auto-poll all eligible endpoints');
  const disabled = pollingConfigMut.isPending || (!isAccess && (!pollingConfig.auto_polling_enabled || total === 0));
  const hint = isAccess ? label : !pollingConfig.auto_polling_enabled
    ? t('fleetApi.controls.pausedHint', 'Turn on Tesla API Polling to change auto-poll selections. Existing selections are retained while paused.')
    : total === 0 ? t('fleetApi.controls.noEligible', 'Allow an eligible endpoint before selecting auto-poll.')
      : t('fleetApi.controls.bulkHint', 'Auto-poll selects only enabled routes with a scheduled job.');

  return (
    <>
      <Tooltip multiline content={hint}>
        <Toggle checked={total > 0 && selected === total} indeterminate={mixed}
          onChange={isAccess ? toggleAllAccess : toggleAllAuto} disabled={disabled}
          focusableWhenDisabled={!isAccess}
          aria-label={label} aria-describedby={mixed ? descriptionId : undefined} />
      </Tooltip>
      {mixed && <VisuallyHidden id={descriptionId}>{t('fleetApi.controls.partial', 'Some enabled')}</VisuallyHidden>}
    </>
  );
}
