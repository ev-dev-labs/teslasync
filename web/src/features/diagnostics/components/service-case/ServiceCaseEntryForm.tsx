import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorText, Input, PanelTitle, Select, Text, Textarea } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { zonedWallTimeToUtc } from '@/lib/dateConvert';
import type { ServiceCaseEntry, ServiceCaseKind } from '@/types/serviceCase';
import { useServiceCaseKinds } from './useServiceCaseKinds';

interface Props {
  disabled: boolean;
  openedAt: string;
  full: boolean;
  onSave: (entry: ServiceCaseEntry, reset: () => void) => void;
}

export function ServiceCaseEntryForm({ disabled, openedAt, full, onSave }: Props) {
  const { t } = useTranslation();
  const { tz } = useDateFormat('user');
  const labels = useServiceCaseKinds();
  const [kind, setKind] = useState<ServiceCaseKind>('warning');
  const [observed, setObserved] = useState('');
  const [detail, setDetail] = useState('');
  const [invalid, setInvalid] = useState(false);
  const dateField = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || full || !detail.trim()) return;
    const when = zonedWallTimeToUtc(observed, tz);
    if (when == null || when.getTime() < Date.parse(openedAt) - 14 * 86400_000 || when.getTime() > Date.now()) {
      setInvalid(true);
      dateField.current?.focus();
      return;
    }
    setInvalid(false);
    onSave({ kind, observed_at: when.toISOString(), detail: detail.trim() }, () => {
      setObserved('');
      setDetail('');
    });
  };
  return (
    <form className="space-y-3" onSubmit={submit}>
      <PanelTitle>{t('serviceEvidencePack.privateCase.addTitle', 'Record evidence')}</PanelTitle>
      <Text as="p" variant="bodySm">{t('serviceEvidencePack.privateCase.provenance', 'These notes are user-recorded, not verified vehicle data or a diagnosis. Do not enter VINs, addresses, contact details or account information.')}</Text>
      <div className="grid gap-3 md:grid-cols-2">
        <Select label={t('serviceEvidencePack.privateCase.kind', 'Evidence type')} value={kind} disabled={disabled || full}
          options={Object.entries(labels).map(([value, label]) => ({ value, label }))}
          onChange={event => setKind(event.target.value as ServiceCaseKind)} />
        <Input ref={dateField} type="datetime-local" value={observed} disabled={disabled || full} required
          label={t('serviceEvidencePack.privateCase.when', 'Observation time ({{zone}})', { zone: tz })}
          onChange={event => setObserved(event.target.value)} />
      </div>
      <Textarea value={detail} disabled={disabled || full} rows={2} required maxLength={600}
        label={t('serviceEvidencePack.privateCase.detail', 'Recorded detail')} onChange={event => setDetail(event.target.value)} />
      {invalid && <ErrorText role="alert">{t('serviceEvidencePack.privateCase.invalidTime', 'Use a time no more than 14 days before this case opened, and not in the future.')}</ErrorText>}
      {full && <Text as="p" variant="bodySm">{t('serviceEvidencePack.privateCase.full', 'This case has 20 notes. Delete an unused note to make room.')}</Text>}
      <Button type="submit" className="min-h-11" disabled={disabled || full || !detail.trim()}>
        {t('serviceEvidencePack.privateCase.add', 'Save private note')}
      </Button>
    </form>
  );
}
