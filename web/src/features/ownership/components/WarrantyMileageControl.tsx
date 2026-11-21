import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { useWarrantyReminder, useWarrantyReminderChange } from '@/api/hooks/useWarrantyReminder';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, ErrorText, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useWarrantyReminderDisplay } from '@/lib/warrantyReminderDisplay';

interface Props {
  scope: Extract<PersonalScope, { mode: 'forward_auth' }>;
  vehicleId: number;
  warrantyId: number;
  disabled: boolean;
}

export function WarrantyMileageControl({ scope, vehicleId, warrantyId, disabled }: Props) {
  const { t } = useTranslation();
  const { canWrite } = useOperationalMode();
  const query = useWarrantyReminder(scope, vehicleId, warrantyId);
  const state = useDataState(query);
  const change = useWarrantyReminderChange(scope, vehicleId, warrantyId);
  const trigger = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState<'enable' | 'disable' | null>(null);
  const accessDenied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  const data = state.data;
  const projection = data?.projection;
  const copy = useWarrantyReminderDisplay(!accessDenied && projection
    && Date.parse(projection.expires_at) > Date.now() ? projection : null);
  const canEnable = data?.start_odometer_known !== false;
  const available = !disabled && canWrite && !query.isFetching && !change.isPending && state.status === 'ok'
    && (data?.enabled || canEnable);
  const enable = t('ownership.warranty.mileage.enable', 'Enable private mileage reminder');
  const disable = t('ownership.warranty.mileage.disable', 'Turn off mileage reminder');

  if (accessDenied || state.fatalError) {
    return <QueryError error={state.fatalError ?? query.error} onRetry={() => void query.refetch()} />;
  }
  if (!data) return <Skeleton lines={2} />;
  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={state} label={t('ownership.warranty.mileage.title', 'Private warranty mileage reminder')} />
      {copy ? <>
        <Text as="p" variant="bodySm">{copy.summary}</Text>
        <Text as="p" variant="bodySm">{copy.basis}</Text>
        <Text as="p" variant="caption">{copy.limitation}</Text>
      </> : <Text as="p" variant="bodySm" role="status">{!canEnable
        ? t('ownership.warranty.mileage.unknownBaseline', 'No mileage reminder is possible without a documented starting odometer. If you have it, add coverage with that reading.')
        : data.enabled
          ? t('ownership.warranty.mileage.waiting', 'Enabled. No current distance-first estimate. The worker checks for enough recent odometer evidence; a calendar-first or stale result does not trigger a reminder.')
          : t('ownership.warranty.mileage.off', 'Off. No reminder analysis runs for this warranty until you enable it.')}</Text>}
      <Button ref={trigger} type="button" className="min-h-11" variant="secondary" wrapLabel
        aria-disabled={!available} onClick={() => {
          if (available) {
            trigger.current?.focus();
            setConfirm(data.enabled ? 'disable' : 'enable');
          }
        }}>
        {data.enabled ? disable : enable}
      </Button>
      {change.error && <ErrorText role="alert">
        {t('ownership.warranty.mileage.changeError', 'Could not change the reminder. Refresh and check your sign-in and selected warranty.')}
      </ErrorText>}
      <ConfirmDialog open={confirm != null}
        variant="warning" confirmDisabled={!available}
        title={confirm === 'enable' ? enable : disable}
        message={confirm === 'enable'
          ? t('ownership.warranty.mileage.confirmEnable', 'Allow this server to check the selected warranty terms and this vehicle’s recent completed-drive odometer records. One private Action Center reminder appears as the estimated limit approaches. Nothing is sent outside TeslaSync.')
          : t('ownership.warranty.mileage.confirmDisable', 'Future checks stop and the private projection and reminder are removed. Recorded warranties, claims and drives are kept.')}
        confirmLabel={confirm === 'enable' ? enable : disable} cancelLabel={t('common.cancel', 'Cancel')}
        onCancel={() => setConfirm(null)} onConfirm={() => {
          if (available && confirm != null) change.mutate(confirm === 'enable');
          setConfirm(null);
        }} />
    </div>
  );
}
