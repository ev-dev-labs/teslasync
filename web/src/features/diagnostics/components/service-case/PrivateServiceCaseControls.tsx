import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useServiceCase, useServiceCaseChange } from '@/api/hooks/useServiceCase';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, ConfirmDialog, ErrorText, Input, PanelTitle, Text } from '@/components/ui';
import type { PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { ServiceCaseEntryForm } from './ServiceCaseEntryForm';
import { ServiceCaseEvidenceReview } from './ServiceCaseEvidenceReview';

export function PrivateServiceCaseControls({ scope, vehicleId, identityPending }: PrivateVehicleReviewScope) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { canWrite, writeBlockReason } = useOperationalMode();
  const query = useServiceCase(scope, vehicleId);
  const source = useDataState(query);
  const change = useServiceCaseChange(scope, vehicleId);
  const [confirm, setConfirm] = useState<{ caseId: number; version: number; entryId?: number } | null>(null);
  const [edit, setEdit] = useState<{ caseId: number; version: number; title: string } | null>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const data = source.data;
  const denied = isApiError(query.error) &&
    ([401, 403, 404].includes(query.error.status) || query.error.code === 'IDENTITY_CHANGED');
  const busy = identityPending || !canWrite || query.isFetching || source.status !== 'ok' || change.isPending;
  const editing = edit != null && edit.caseId === data?.id && edit.version === data?.version;
  const dialogOpen = confirm != null && confirm.caseId === data?.id && confirm.version === data?.version;

  useEffect(() => {
    if (editing) titleField.current?.focus();
  }, [editing]);

  if (denied || source.fatalError) return <QueryError error={source.fatalError ?? query.error} onRetry={source.retry ?? undefined} />;
  if (!data) return query.fetchStatus === 'paused'
    ? <Text as="p" variant="bodySm">{t('serviceEvidencePack.privateCase.offline', 'Reconnect to review your private service case.')}</Text>
    : <Skeleton lines={2} />;
  const rows = data.evidence ?? [];
  const key = { id: data.id, version: data.version };
  const titleAction = data.id > 0
    ? t('serviceEvidencePack.privateCase.rename', 'Rename case')
    : t('serviceEvidencePack.privateCase.start', 'Open private case');
  const removeLabel = confirm?.entryId != null
    ? t('serviceEvidencePack.privateCase.removeNote', 'Delete note')
    : t('serviceEvidencePack.privateCase.removeCase', 'Delete private case');
  const closeTitle = () => {
    setEdit(null);
    titleButton.current?.focus();
  };

  return (
    <div className="space-y-4">
      <StaleRefreshWarning state={source} label={t('serviceEvidencePack.privateCase.title', 'Private service case')} />
      {data.id === 0
        ? <Text as="p" role="status">{t('serviceEvidencePack.privateCase.off', 'Off. No private case is open for this vehicle.')}</Text>
        : <div className="space-y-1">
            <PanelTitle className="break-words">{data.title}</PanelTitle>
            <Text as="p" variant="bodySm">{t('serviceEvidencePack.privateCase.opened', 'Opened {{when}}', {
              when: formatDateTime(data.opened_at),
            })}</Text>
          </div>}
      {!canWrite && writeBlockReason && <Text as="p" variant="bodySm">{writeBlockReason}</Text>}
      <div className="flex flex-wrap gap-2">
        <Button ref={titleButton} type="button" className="min-h-11" variant="secondary" wrapLabel
          aria-expanded={editing} aria-disabled={busy} onClick={() => {
            if (busy) return;
            change.reset();
            if (editing) closeTitle();
            else setEdit({ caseId: data.id, version: data.version, title: data.title });
          }}>{titleAction}</Button>
        {data.id > 0 && <Button type="button" className="min-h-11" variant="ghost" wrapLabel aria-disabled={busy} onClick={event => {
          if (busy) return;
          event.currentTarget.focus();
          setConfirm({ caseId: data.id, version: data.version });
        }}>{t('serviceEvidencePack.privateCase.removeCase', 'Delete private case')}</Button>}
      </div>
      {editing && <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        if (busy || !edit.title.trim()) return;
        change.mutate({ kind: 'save', key, title: edit.title.trim() }, { onSuccess: closeTitle });
      }}>
        <Input ref={titleField} value={edit.title} label={t('serviceEvidencePack.privateCase.label', 'Private case title')}
          maxLength={120} required disabled={busy} onChange={event => setEdit({ ...edit, title: event.target.value })} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="min-h-11" disabled={busy || !edit.title.trim()}>
            {t('serviceEvidencePack.privateCase.save', 'Save private case')}
          </Button>
          <Button type="button" className="min-h-11" variant="secondary" onClick={closeTitle}>
            {t('common.cancel', 'Cancel')}
          </Button>
        </div>
      </form>}
      {data.id > 0 && <>
        <ServiceCaseEntryForm key={data.id} openedAt={data.opened_at}
          full={rows.length >= 20} disabled={busy}
          onSave={(entry, reset) => change.mutate({ kind: 'add', key, entry }, { onSuccess: reset })} />
        <ServiceCaseEvidenceReview key={`${data.id}:${data.version}`} caseKey={key} entries={rows} scope={scope}
          vehicleId={vehicleId} disabled={busy} onRemove={(id, invoker) => {
            invoker.focus();
            change.reset();
            setConfirm({ caseId: data.id, version: data.version, entryId: id });
          }} />
      </>}
      {change.isError && <ErrorText role="alert">
        {isApiError(change.error) && change.error.code === 'SERVICE_CASE_CHANGED'
          ? t('serviceEvidencePack.privateCase.changed', 'The case changed. Review the current case before trying again.')
          : t('serviceEvidencePack.privateCase.failure', 'Could not change your private case. Check your sign-in, timestamps and connection.')}
      </ErrorText>}
      <ConfirmDialog open={dialogOpen} title={removeLabel} confirmLabel={removeLabel}
        cancelLabel={t('common.cancel', 'Cancel')} confirmDisabled={busy}
        message={confirm?.entryId != null
          ? t('serviceEvidencePack.privateCase.removeNotePrompt', 'Permanently remove this note from the case?')
          : t('serviceEvidencePack.privateCase.removeCasePrompt', 'Delete this private case and its notes? Source vehicle records and any downloaded files will not change.')}
        onCancel={() => setConfirm(null)} onConfirm={() => {
          if (busy || !confirm || !dialogOpen) return;
          setConfirm(null);
          const mutation = confirm.entryId == null ? { kind: 'delete' as const, key }
            : { kind: 'remove' as const, key, id: confirm.entryId };
          change.mutate(mutation, { onSuccess: closeTitle });
        }} />
    </div>
  );
}
