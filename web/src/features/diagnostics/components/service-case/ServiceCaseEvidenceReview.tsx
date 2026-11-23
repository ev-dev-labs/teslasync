import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { useServiceCaseReview, type ServiceCaseKey } from '@/api/hooks/useServiceCase';
import { Button, Checkbox, ErrorText, PanelTitle, Text } from '@/components/ui';
import type { PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDateFormat } from '@/hooks/useDateFormat';
import { downloadBlob } from '@/lib/export';
import type { CaseReview, PrivateServiceCase, ServiceCaseSelection } from '@/types/serviceCase';
import { useServiceCaseKinds } from './useServiceCaseKinds';

interface Props {
  caseKey: ServiceCaseKey;
  entries: PrivateServiceCase['evidence'];
  scope: PrivateVehicleReviewScope['scope'];
  vehicleId: number;
  disabled: boolean;
  onRemove: (id: number, invoker: HTMLButtonElement) => void;
}

export function ServiceCaseEvidenceReview({ caseKey, entries, scope, vehicleId, disabled, onRemove }: Props) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const labels = useServiceCaseKinds();
  const request = useServiceCaseReview(scope, vehicleId);
  const [picked, setPicked] = useState<Record<number, ServiceCaseSelection>>({});
  const [review, setReview] = useState<CaseReview | null>(null);
  const [saved, setSaved] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const previewRegion = useRef<HTMLElement>(null);
  const picks = Object.values(picked).filter(row => row.include_detail || row.include_time);
  const busy = disabled || request.isPending;

  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (review) previewRegion.current?.focus();
  }, [review]);
  const select = (id: number, field: 'include_detail' | 'include_time', enabled: boolean) => {
    if (busy) return;
    request.reset();
    setReview(null);
    setSaved(false);
    setPicked(previous => ({
      ...previous,
      [id]: { ...(previous[id] ?? { id, include_detail: false, include_time: false }), [field]: enabled },
    }));
  };
  const run = async (kind: 'preview' | 'export') => {
    if (busy || pending.current || picks.length === 0 || (kind === 'export' && review == null)) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaved(false);
    const selection = { key: caseKey, selection: picks, signal: controller.signal };
    try {
      const result = await request.mutateAsync(kind === 'preview' ? { kind, ...selection }
        : { kind, ...selection, digest: review?.digest ?? '' });
      if (controller.signal.aborted) return;
      if (result.kind === 'preview') setReview(result.data);
      else {
        downloadBlob(result.data, 'service-case-evidence.json', 'application/json');
        setSaved(true);
      }
    } catch {
      if (!controller.signal.aborted) setReview(null);
    } finally {
      pending.current = null;
    }
  };

  if (entries.length === 0) return <Text as="p" variant="bodySm">
    {t('serviceEvidencePack.privateCase.empty', 'No notes yet. Add evidence before preparing an export.')}
  </Text>;
  const previewLabel = t('serviceEvidencePack.privateCase.previewTitle', 'Reviewed export contents');
  return (
    <div className="space-y-3">
      <PanelTitle>{t('serviceEvidencePack.privateCase.review', 'Select and redact evidence')}</PanelTitle>
      <Text as="p" variant="bodySm">{t('serviceEvidencePack.privateCase.reviewHint', 'Nothing is selected by default. Include only the fields you intend to share. The case title and application identifiers are never exported; selected free text is included as written.')}</Text>
      <ul className="space-y-3">
        {entries.map(row => (
          <li key={row.id} className="space-y-2 rounded-shape-md border border-[var(--border-subtle)] p-3">
            <Text as="p" variant="bodySm">{labels[row.kind]} · {formatDateTime(row.observed_at)}</Text>
            <Text as="p" className="break-words whitespace-pre-wrap">{row.detail}</Text>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Checkbox checked={picked[row.id]?.include_detail ?? false} disabled={busy}
                label={t('serviceEvidencePack.privateCase.includeDetail', 'Include detail')}
                onChange={value => select(row.id, 'include_detail', value)} />
              <Checkbox checked={picked[row.id]?.include_time ?? false} disabled={busy}
                label={t('serviceEvidencePack.privateCase.includeTime', 'Include timestamp')}
                onChange={value => select(row.id, 'include_time', value)} />
              <Button type="button" className="min-h-11" variant="ghost" disabled={busy}
                onClick={event => onRemove(row.id, event.currentTarget)}>
                {t('serviceEvidencePack.privateCase.removeNote', 'Delete note')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button type="button" className="min-h-11" variant="secondary" disabled={busy || picks.length === 0}
        onClick={() => void run('preview')}>{t('serviceEvidencePack.privateCase.preview', 'Preview selected evidence')}</Button>
      {review && <section ref={previewRegion} tabIndex={-1} aria-label={previewLabel}
        className="space-y-3 rounded-shape-md border border-[var(--border-subtle)] p-3">
        <PanelTitle>{previewLabel}</PanelTitle>
        <Text as="p" variant="bodySm">{t('serviceEvidencePack.privateCase.previewHint', 'Review the exact details below before downloading. This JSON contains user-recorded evidence only. Download saves a local file; it does not share it.')}</Text>
        <ul className="space-y-3">
          {(review.document.evidence ?? []).map((row, index) => <li key={index} className="space-y-1">
            <Text as="p" variant="bodySm">{labels[row.kind]}</Text>
            {row.observed_at && <Text as="p" variant="bodySm" className="break-words">{row.observed_at}</Text>}
            {row.detail && <Text as="p" className="break-words whitespace-pre-wrap">{row.detail}</Text>}
          </li>)}
        </ul>
        <Button type="button" className="min-h-11" disabled={busy} onClick={() => void run('export')}>
          {t('serviceEvidencePack.privateCase.export', 'Download reviewed JSON')}
        </Button>
        {saved && <Text as="p" role="status">{t('serviceEvidencePack.privateCase.download', 'Download requested. Nothing was shared.')}</Text>}
      </section>}
      {request.isError && <ErrorText role="alert">
        {isApiError(request.error) && request.error.code === 'SERVICE_CASE_CHANGED'
          ? t('serviceEvidencePack.privateCase.changed', 'The case changed. Review the current case before trying again.')
          : t('serviceEvidencePack.privateCase.reviewFailed', 'Could not prepare the selected evidence. Check your connection, then preview again.')}
      </ErrorText>}
    </div>
  );
}
