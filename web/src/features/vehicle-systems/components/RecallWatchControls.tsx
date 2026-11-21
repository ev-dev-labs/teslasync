import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useRecallWatch, useRecallWatchChange } from '@/api/hooks/useRecallWatch';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, ErrorText, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import type { PrivateVehicleReviewScope } from '@/components/vehicles';
import { RecallCampaignEvidence } from './RecallCampaignEvidence';
import { RecallWatchForm } from './RecallWatchForm';

export function RecallWatchControls({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat('user');
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useRecallWatch(scope, vehicleId);
  const source = useDataState(query);
  const change = useRecallWatchChange(scope, vehicleId);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  const form = useRef<HTMLDivElement>(null);
  const data = source.data;
  const busy = identityPending || !canWrite || query.isFetching || source.status !== 'ok' || change.isPending;
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  const remove = t('maintenance.recallWatch.remove', 'Turn off and clear recall watch');

  useEffect(() => {
    if (editing) form.current?.focus();
  }, [editing]);
  const closeForm = () => {
    setEditing(false);
    edit.current?.focus();
  };

  if (denied || source.fatalError) return <QueryError error={source.fatalError ?? query.error} onRetry={source.retry ?? undefined} />;
  if (!data) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('maintenance.recallWatch.offline', 'Reconnect to review your private recall watch.')}</Text>
    : <Skeleton lines={2} />;
  const active = data.id > 0;
  const matches = (data.matches ?? []).filter(match => Date.parse(match.fresh_until) > Date.now());
  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={source} label={t('maintenance.recallWatch.title', 'Private recall watch')} />
      <Text as="p" variant="bodySm" role="status">{!active
        ? t('maintenance.recallWatch.off', 'Off. Turn on a watch for your selected vehicle.')
        : t('maintenance.recallWatch.active', 'Watching {{year}} {{model}}.', { year: data.setup.model_year, model: data.setup.model })}</Text>
      {data.last_success && <Text as="p" variant="bodySm">
        {t('maintenance.recallWatch.lastCheck', 'Last successful check: {{when}}.', { when: formatDateTime(data.last_success) })}
      </Text>}
      {active && <Text as="p" variant="bodySm">{data.last_failed
        ? t('maintenance.recallWatch.unavailable', 'NHTSA could not be checked. Any visible matches are from the last successful check; none confirms VIN status.')
        : !data.last_success
          ? t('maintenance.recallWatch.waiting', 'Waiting for the first catalog check. You can close the browser.')
          : matches.length === 0
            ? t('maintenance.recallWatch.empty', 'No current model-year matches to review. This does not mean your VIN has no open recalls.')
            : t('maintenance.recallWatch.hint', 'Only recent public model-year matches appear here. Check your VIN separately by entering it yourself on Tesla’s site.')}</Text>}
      {matches.length > 0 && <ul className="space-y-3">
        {matches.map(match => <RecallCampaignEvidence key={match.campaign} match={match} />)}
      </ul>}
      {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
      <div className="flex flex-wrap gap-2">
        <Button ref={edit} type="button" className="min-h-11" variant="secondary" wrapLabel aria-expanded={editing}
          aria-disabled={busy} onClick={() => {
            if (busy) return;
            change.reset();
            setEditing(!editing);
          }}>
          {active ? t('maintenance.recallWatch.edit', 'Edit recall watch') : t('maintenance.recallWatch.start', 'Set up recall watch')}
        </Button>
        {active && !editing && <Button type="button" className="min-h-11" variant="ghost" wrapLabel aria-disabled={busy}
          onClick={event => {
            if (busy) return;
            event.currentTarget.focus();
            change.reset();
            setConfirm(true);
          }}>{remove}</Button>}
      </div>
      {editing && <div ref={form} tabIndex={-1}>
        <RecallWatchForm current={data.setup} updating={active} disabled={busy} onCancel={closeForm} onSave={setup =>
          change.mutate({ kind: 'enable', watchId: data.id, setup }, { onSuccess: closeForm })} />
      </div>}
      {change.isError && <ErrorText role="alert">
        {isApiError(change.error) && change.error.code === 'RECALL_WATCH_CHANGED'
          ? t('maintenance.recallWatch.conflict', 'The watch changed. Review the current setup before trying again.')
          : t('maintenance.recallWatch.failure', 'Could not change your recall watch. Refresh and verify your sign-in and vehicle.')}
      </ErrorText>}
      <ConfirmDialog open={confirm} title={remove} confirmLabel={remove} cancelLabel={t('common.cancel', 'Cancel')}
        message={t('maintenance.recallWatch.removeMessage', 'Stop future checks and delete these private matches? Existing vehicle and service records will not change.')}
        confirmDisabled={busy} onCancel={() => setConfirm(false)} onConfirm={() => {
          if (busy) return;
          setConfirm(false);
          change.mutate({ kind: 'remove', watchId: data.id }, { onSuccess: closeForm });
        }} />
    </div>
  );
}
