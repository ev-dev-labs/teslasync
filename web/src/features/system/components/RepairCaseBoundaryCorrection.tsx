import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RepairCase } from '@/api/hooks/useDataRepair';
import { Button, GlassPanel, Input, PanelTitle, Select, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { toZonedDatetimeStr, zonedWallTimeToUtc } from '@/lib/dateConvert';
import { RepairCaseCorrectionDialog } from './RepairCaseCorrectionDialog';
import { isBoundaryCorrectionRule } from './repairCorrectionFields';
import { useRepairCaseCorrectionReview } from './useRepairCaseCorrectionReview';

interface RepairCaseBoundaryCorrectionProps {
  repairCase: RepairCase;
  canWrite: boolean;
  writeBlockReason?: string;
}

export function RepairCaseBoundaryCorrection({ repairCase, canWrite, writeBlockReason }: RepairCaseBoundaryCorrectionProps) {
  const { t } = useTranslation();
  const { tz } = useDateFormat();
  const [target, setTarget] = useState<'primary' | 'related' | ''>(
    repairCase.related_session_id == null ? 'primary' : '',
  );
  const [wallTime, setWallTime] = useState('');
  const review = useRepairCaseCorrectionReview(repairCase, canWrite);
  if (!isBoundaryCorrectionRule(repairCase.rule) || !['open', 'in_review'].includes(repairCase.status)) return null;

  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(wallTime)
    ? zonedWallTimeToUtc(wallTime, tz) : null;
  const validTime = instant != null && toZonedDatetimeStr(instant, tz) === wallTime.slice(0, 16);
  const pending = review.previewPending || review.applyPending;
  const relatedKind = repairCase.rule === 'cross_kind_overlap_drive_charging' ? 'charging' : repairCase.kind;
  const label = (kind: 'drive' | 'charging', id: number) => kind === 'drive'
    ? t('dataRepair.correction.driveNumber', 'Drive #{{id}}', { id })
    : t('dataRepair.correction.chargingNumber', 'Charging session #{{id}}', { id });

  return (
    <>
      <GlassPanel className="space-y-3 p-4">
        <PanelTitle>{t('dataRepair.correction.boundaryTitle', 'Correct an end time')}</PanelTitle>
        <Text as="p" variant="bodySm">
          {t('dataRepair.correction.boundaryInstructions', 'Enter a time only when you have evidence. For an overlap, select the earlier session and end it no later than the other session starts. Start times cannot be changed here.')}
        </Text>
        {repairCase.related_session_id != null ? (
          <Select
            label={t('dataRepair.correction.boundaryTarget', 'Which session has the incorrect end?')}
            placeholder={t('dataRepair.correction.chooseSession', 'Choose a session')}
            options={[
              { value: 'primary', label: label(repairCase.kind, repairCase.session_id) },
              { value: 'related', label: label(relatedKind, repairCase.related_session_id) },
            ]}
            value={target}
            onChange={(event) => {
              const next = event.target.value;
              if (next === 'primary' || next === 'related' || next === '') setTarget(next);
            }}
            disabled={!canWrite || pending}
          />
        ) : null}
        <Input
          label={t('dataRepair.correction.boundaryTime', 'Correct end time ({{timezone}})', { timezone: tz })}
          type="datetime-local"
          step={1}
          value={wallTime}
          onChange={(event) => setWallTime(event.target.value)}
          error={wallTime && !validTime
            ? t('dataRepair.correction.invalidLocalTime', 'Enter a valid time that exists in this time zone.')
            : undefined}
          disabled={!canWrite || pending}
        />
        <Text as="p" variant="caption">
          {t('dataRepair.correction.timeAmbiguity', 'If the clock repeats an hour, the first occurrence is used. Check the exact UTC time in the preview.')}
        </Text>
        <Button
          variant="primary"
          onClick={() => {
            if (!target || !validTime || !instant) return;
            review.requestPreview({
              field: 'ended_at', mode: 'boundary', value: null,
              target, ended_at: instant.toISOString(),
            });
          }}
          loading={review.previewPending}
          disabled={!canWrite || pending || !target || !validTime}
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
