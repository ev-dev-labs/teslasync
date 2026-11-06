import { useId } from 'react';
import { Toggle, Tooltip } from '@/components/ui';
import { VisuallyHidden } from '@/components/a11y';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = {
  controller: ReturnType<typeof useFleetAPIPage>;
  group: string;
  kind: 'access' | 'auto';
};

export function FleetAPIGroupActions({ controller, group, kind }: Props) {
  const descriptionId = useId();
  const { t, catalog, groupBy, groupLabel, pollingConfig, pollingConfigMut,
    toggleGroupAccess, toggleGroupAuto } = controller;
  if (!pollingConfig) return null;
  const members = catalog.filter(endpoint => (groupBy === 'category' ? endpoint.category : endpoint.method) === group);
  const pollable = members.filter(endpoint => endpoint.pollable);
  if (!members.length || (kind === 'auto' && !pollable.length)) return null;

  const isAccess = kind === 'access';
  const eligible = isAccess ? members : pollable.filter(endpoint => pollingConfig.fleet_endpoints[endpoint.key]);
  const selected = eligible.filter(endpoint => isAccess
    ? pollingConfig.fleet_endpoints[endpoint.key] : pollingConfig.auto_endpoints[endpoint.key]).length;
  const mixed = selected > 0 && selected < eligible.length;
  const label = isAccess
    ? t('fleetApi.allowGroup', 'Allow all {{group}}', { group: groupLabel(group) })
    : t('fleetApi.controls.groupAuto', 'Auto-poll all eligible {{group}}', { group: groupLabel(group) });
  const disabled = pollingConfigMut.isPending || (!isAccess && (!pollingConfig.auto_polling_enabled || !eligible.length));
  const hint = isAccess ? label : !pollingConfig.auto_polling_enabled
    ? t('fleetApi.controls.pausedHint', 'Turn on Tesla API Polling to change auto-poll selections. Existing selections are retained while paused.')
    : !eligible.length ? t('fleetApi.controls.noEligible', 'Allow an eligible endpoint before selecting auto-poll.')
      : t('fleetApi.controls.bulkHint', 'Auto-poll selects only enabled routes with a scheduled job.');

  return (
    <>
      <Tooltip multiline content={hint}>
        <Toggle checked={eligible.length > 0 && selected === eligible.length} indeterminate={mixed}
          onChange={() => isAccess ? toggleGroupAccess(group) : toggleGroupAuto(group)} disabled={disabled}
          focusableWhenDisabled={!isAccess}
          aria-label={label} aria-describedby={mixed ? descriptionId : undefined} />
      </Tooltip>
      {mixed && <VisuallyHidden id={descriptionId}>{t('fleetApi.controls.partial', 'Some enabled')}</VisuallyHidden>}
    </>
  );
}
