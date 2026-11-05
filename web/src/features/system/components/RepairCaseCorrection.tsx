import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type RepairCase,
  type RepairCorrectionField,
  type RepairCorrectionMode,
} from '@/api/hooks/useDataRepair';
import { Button, GlassPanel, Input, PanelTitle, Select, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { RepairCaseCorrectionDialog } from './RepairCaseCorrectionDialog';
import {
  correctionCanClear, correctionFieldLabel, correctionFields, correctionUnit, correctionValueToSI,
} from './repairCorrectionFields';
import { useRepairCaseCorrectionReview } from './useRepairCaseCorrectionReview';

interface RepairCaseCorrectionProps {
  repairCase: RepairCase;
  canWrite: boolean;
  writeBlockReason?: string;
}

export function RepairCaseCorrection({ repairCase, canWrite, writeBlockReason }: RepairCaseCorrectionProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const fields = correctionFields(repairCase.rule);
  const duration = fields[0] === 'duration_s';
  const [field, setField] = useState<RepairCorrectionField | ''>(fields.length === 1 ? fields[0] : '');
  const [mode, setMode] = useState<RepairCorrectionMode>(duration ? 'derive' : 'replace');
  const [value, setValue] = useState('');
  const review = useRepairCaseCorrectionReview(repairCase, canWrite);

  if (fields.length === 0 || !['open', 'in_review'].includes(repairCase.status)) return null;
  const number = value.trim() === '' ? null : Number(value);
  const validNumber = number != null && Number.isFinite(number) && number >= 0
    && (!field.endsWith('_pct') || number <= 100);
  const converted = validNumber && field ? correctionValueToSI(field, number, unitPrefs) : null;
  const conversionOverflow = converted != null && !Number.isFinite(converted);
  const canClear = correctionCanClear(field);
  const canPreview = canWrite && field !== '' && !review.previewPending && !review.applyPending
    && (mode !== 'clear' || canClear)
    && (mode !== 'replace' || (validNumber && !conversionOverflow));
  const requestPreview = () => {
    if (!canPreview || !field) return;
    review.requestPreview({
      field,
      mode,
      value: mode === 'replace' ? converted : null,
    });
  };

  return (
    <>
      <GlassPanel className="space-y-3 p-4">
        <PanelTitle>{t('dataRepair.correction.title', 'Correct this finding')}</PanelTitle>
        <Text as="p" variant="bodySm">
          {duration
            ? t('dataRepair.correction.durationHelp', 'Check the start and end times, then recalculate the duration from that window.')
            : fields.some(correctionCanClear)
              ? t('dataRepair.correction.measurementHelp', 'Enter a value from a trusted source, or mark the incorrect measurement unknown.')
              : t('dataRepair.correction.verifiedValueHelp', 'Enter a value from a trusted source.')}
        </Text>
        {repairCase.rule === 'soc_inconsistent' ? (
          <Text as="p" variant="bodySm">
            {t('dataRepair.correction.socHelp', 'Battery readings can legitimately change this way. Correct a reading only when you have evidence; otherwise consider dismissing the finding.')}
          </Text>
        ) : null}
        {fields.length > 1 ? (
          <Select
            label={t('dataRepair.correction.chooseReading', 'Which reading is incorrect?')}
            placeholder={t('dataRepair.correction.choosePlaceholder', 'Choose a reading')}
            options={fields.map((item) => ({ value: item, label: correctionFieldLabel(t, item) }))}
            value={field}
            onChange={(event) => {
              const next = fields.find((item) => item === event.target.value);
              setField(next ?? '');
              if (!correctionCanClear(next ?? '')) setMode('replace');
              setValue('');
            }}
            disabled={!canWrite || review.previewPending || review.applyPending}
          />
        ) : null}
        {!duration ? (
          <Select
            label={t('dataRepair.correction.method', 'Correction')}
            options={[
              { value: 'replace', label: t('dataRepair.correction.replace', 'Enter the correct value') },
              ...(canClear ? [
                { value: 'clear', label: t('dataRepair.correction.clear', 'Mark measurement unknown') },
              ] : []),
            ]}
            value={mode}
            onChange={(event) => {
              if (event.target.value === 'replace' || event.target.value === 'clear') setMode(event.target.value);
            }}
            disabled={!canWrite || review.previewPending || review.applyPending}
          />
        ) : null}
        {field && !duration && !canClear ? (
          <Text as="p" variant="bodySm">
            {t('dataRepair.correction.valueRequiresEvidence', 'Enter a verified value or leave this finding open. Some existing views display an unknown reading as an actual value.')}
          </Text>
        ) : null}
        {!duration && mode === 'replace' && field ? (
          <Input
            label={t('dataRepair.correction.value', 'Corrected {{field}} ({{unit}})', {
              field: correctionFieldLabel(t, field), unit: correctionUnit(field, unitPrefs),
            })}
            type="number"
            min={0}
            max={field.endsWith('_pct') ? 100 : undefined}
            step="any"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={!canWrite || review.previewPending || review.applyPending}
          />
        ) : null}
        {mode === 'clear' ? (
          <Text as="p" variant="bodySm">
            {t('dataRepair.correction.clearHelp', 'The recorded value will be removed. Some existing summaries may interpret missing readings differently.')}
          </Text>
        ) : null}
        {mode === 'replace' && conversionOverflow ? (
          <Text as="p" role="alert" className="text-[var(--semantic-danger)]">
            {t('dataRepair.correction.valueTooLarge', 'This value is too large to convert safely.')}
          </Text>
        ) : null}
        <Button
          variant="primary"
          onClick={requestPreview}
          loading={review.previewPending}
          disabled={!canPreview}
          title={!canWrite ? writeBlockReason : undefined}
          wrapLabel
        >
          {t('dataRepair.correction.review', 'Review correction')}
        </Button>
        {review.previewError ? (
          <Text as="p" role="alert" className="text-[var(--semantic-danger)]">{review.previewError}</Text>
        ) : null}
      </GlassPanel>
      <RepairCaseCorrectionDialog
        preview={review.preview}
        canConfirm={review.canConfirm}
        pending={review.applyPending}
        error={review.applyError}
        onConfirm={review.confirm}
        onCancel={review.closeReview}
      />
    </>
  );
}
