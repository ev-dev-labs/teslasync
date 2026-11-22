import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useColdTireChange, useColdTireReview } from '@/api/hooks/useColdTireReview';
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, ErrorText, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useColdTireDisplay } from '@/lib/coldTireDisplay';
import { ColdTireReadingForm } from './ColdTireReadingForm';

interface Props {
  scope: PersonalScope;
  vehicleId: number;
  identityPending: boolean;
}

export function ColdTireReview({ scope, vehicleId, identityPending }: Props) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useColdTireReview(scope, vehicleId);
  const change = useColdTireChange(scope, vehicleId);
  const source = useDataState(query);
  const data = source.data;
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(false);
  const [expired, setExpired] = useState('');
  const form = useRef<HTMLDivElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const expiry = data?.drift?.expires_at ?? '';
  const end = Date.parse(expiry);
  const display = useColdTireDisplay(expiry !== expired && end > Date.now() ? data?.drift : null);
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  const busy = identityPending || !canWrite || query.isFetching || source.status !== 'ok' || change.isPending;
  const conflict = isApiError(change.error) && change.error.code === 'COLD_TIRE_SERIES_CHANGED';
  const remove = t('tireDifferentialDrift.coldReview.remove', 'Turn off and clear readings');

  useEffect(() => {
    if (!Number.isFinite(end) || end <= Date.now()) return;
    const timer = window.setTimeout(() => setExpired(expiry), end - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [expiry, end]);
  useEffect(() => {
    if (editing) form.current?.focus();
  }, [editing]);
  const closeForm = () => {
    setEditing(false);
    add.current?.focus();
  };

  if (denied || source.fatalError) return <QueryError error={source.fatalError ?? query.error} onRetry={source.retry ?? undefined} />;
  if (!data) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('tireDifferentialDrift.coldReview.offline', 'Reconnect to review your saved cold checks.')}</Text>
    : <Skeleton lines={2} />;
  return (
    <div className="space-y-3">
      <StaleRefreshWarning state={source} label={t('tireDifferentialDrift.coldReview.title', 'Cold tire checks')} />
      {display ? <>
        <Text as="p" variant="bodySm" weight="semibold">{display.summary}</Text>
        <Text as="p" variant="bodySm">{display.basis}</Text>
        <Text as="p" variant="bodySm">{display.limitation}</Text>
      </> : <Text as="p" variant="bodySm" role="status">{data.series_id === 0
        ? t('tireDifferentialDrift.coldReview.off', 'Off. Save a confirmed cold gauge check to start a series.')
        : t('tireDifferentialDrift.coldReview.waiting', 'No current repeated drift. Saved checks: {{checks}}. We need at least five comparable checks spanning seven days or more.', {
          checks: fmtInt(data.reading_count),
        })}</Text>}
      {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
      <div className="flex flex-wrap gap-2">
        <Button ref={add} type="button" className="min-h-11" variant="secondary" wrapLabel aria-expanded={editing}
          aria-disabled={busy} onClick={() => {
            if (busy) return;
            change.reset();
            setEditing(!editing);
          }}>
          {t('tireDifferentialDrift.coldReview.add', 'Record a cold gauge check')}
        </Button>
        {data.series_id > 0 && !editing && <Button type="button" className="min-h-11" variant="ghost" wrapLabel aria-disabled={busy}
          onClick={event => {
            if (busy) return;
            event.currentTarget.focus();
            change.reset();
            setDialog(true);
          }}>{remove}</Button>}
      </div>
      {editing && <div ref={form} tabIndex={-1}>
        <ColdTireReadingForm disabled={busy} onCancel={closeForm} onSave={reading => {
          change.mutate({ kind: 'append', seriesId: data.series_id, reading }, { onSuccess: closeForm });
        }} />
      </div>}
      {change.isError && <ErrorText role="alert">{conflict
        ? t('tireDifferentialDrift.coldReview.conflict', 'The series changed, or this reading is less than 18 hours after the last one. Check the last entry before saving again.')
        : t('tireDifferentialDrift.coldReview.failure', 'Could not change the series. Refresh, check the selected vehicle, and try again.')}</ErrorText>}
      <ConfirmDialog open={dialog} title={remove} confirmLabel={remove} cancelLabel={t('common.cancel', 'Cancel')}
        message={t('tireDifferentialDrift.coldReview.removeMessage', 'Delete these gauge readings and their recommendation? Vehicle telemetry and warnings are not changed. Start over after a rotation or pressure adjustment.')}
        confirmDisabled={busy} onCancel={() => setDialog(false)} onConfirm={() => {
          if (busy) return;
          setDialog(false);
          change.mutate({ kind: 'remove', seriesId: data.series_id }, { onSuccess: closeForm });
        }} />
    </div>
  );
}
