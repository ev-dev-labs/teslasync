import { useTranslation } from 'react-i18next';
import type { RepairCaseCorrectionPreview } from '@/api/hooks/useDataRepair';
import { KVList } from '@/components/data-display';
import { ConfirmDialog, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { correctionFieldLabel } from './repairCorrectionFields';

interface RepairCaseCorrectionDialogProps {
  preview: RepairCaseCorrectionPreview | null;
  canConfirm: boolean;
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RepairCaseCorrectionDialog({
  preview, canConfirm, pending, error, onConfirm, onCancel,
}: RepairCaseCorrectionDialogProps) {
  const { t } = useTranslation();
  const units = useUnits();
  const { formatDateTime } = useDateFormat();
  const sessionLabel = (kind: 'drive' | 'charging', id: number) => kind === 'drive'
    ? t('dataRepair.correction.driveNumber', 'Drive #{{id}}', { id })
    : t('dataRepair.correction.chargingNumber', 'Charging session #{{id}}', { id });
  const formatInstant = (value: string | undefined) => value
    ? t('dataRepair.correction.exactTime', '{{local}} ({{utc}})', { local: formatDateTime(value), utc: value })
    : t('dataRepair.correction.unknown', 'Unknown');
  const formatValue = (field: RepairCaseCorrectionPreview['changes'][number]['field'], value: number | null) => {
    if (value == null) return t('dataRepair.correction.unknown', 'Unknown');
    if (field === 'duration_s') {
      return t('dataRepair.correction.durationValue', '{{formatted}} ({{seconds}} s)', {
        formatted: units.formatDuration(value, { precision: 3 }), seconds: String(value),
      });
    }
    if (field.endsWith('_odometer_m') || field === 'distance_m') {
      return t('dataRepair.correction.exactValue', '{{formatted}} (exact: {{value}} {{unit}})', {
        formatted: units.formatDistance(value), value: String(value), unit: 'm',
      });
    }
    if (field.endsWith('_wh')) {
      return t('dataRepair.correction.exactValue', '{{formatted}} (exact: {{value}} {{unit}})', {
        formatted: units.formatEnergy(value), value: String(value), unit: 'Wh',
      });
    }
    return t('dataRepair.correction.percentValue', '{{value}}%', { value: String(value) });
  };
  const formatChangeText = (field: 'cost_decimal' | 'cost_source', value: string | undefined, unit?: string) => {
    if (value == null || value === 'unknown') return t('dataRepair.correction.unknown', 'Unknown');
    if (field === 'cost_decimal') return unit ? `${value} ${unit}` : value;
    return t(`chargingPlaces.costSource.${value}`, value);
  };
  return (
    <ConfirmDialog
      open={preview != null}
      title={t('dataRepair.correction.confirmTitle', 'Apply this correction?')}
      message={t(
        'dataRepair.correction.confirmMessage',
        'Only the values shown below will change. The session and case are updated together and recorded in the audit log.',
      )}
      variant="warning"
      confirmLabel={t('dataRepair.correction.apply', 'Apply correction')}
      cancelLabel={t('common.cancel', 'Cancel')}
      aboveNotifications
      loading={pending}
      confirmDisabled={!canConfirm}
      onConfirm={onConfirm}
      onCancel={onCancel}
      details={preview ? (
        <div className="space-y-3">
          <KVList
            wrap
            items={[
              { label: t('dataRepair.correction.start', 'Session start'), value: formatDateTime(preview.started_at) },
              { label: t('dataRepair.correction.end', 'Session end'), value: formatDateTime(preview.ended_at) },
              ...(preview.other ? [
                { label: t('dataRepair.correction.targetSession', 'Session to change'), value: sessionLabel(preview.kind, preview.session_id) },
                { label: t('dataRepair.correction.otherSession', 'Other session'), value: sessionLabel(preview.other.kind, preview.other.id) },
                { label: t('dataRepair.correction.otherStart', 'Other session start'), value: formatInstant(preview.other.started_at) },
                { label: t('dataRepair.correction.otherEnd', 'Other session end'), value: formatInstant(preview.other.ended_at ?? undefined) },
              ] : []),
              ...preview.changes.map((change) => ({
                label: correctionFieldLabel(t, change.field),
                value: change.field === 'ended_at'
                  ? `${formatInstant(change.before_text)} → ${formatInstant(change.after_text)}`
                  : change.field === 'cost_decimal' || change.field === 'cost_source'
                    ? `${formatChangeText(change.field, change.before_text, change.unit)} → ${formatChangeText(change.field, change.after_text, change.unit)}`
                    : `${formatValue(change.field, change.before)} → ${formatValue(change.field, change.after)}`,
              })),
            ]}
          />
          {preview.changes.some((change) => change.field === 'duration_s') ? (
            <Text as="p" variant="bodySm">
              {t('dataRepair.correction.verifyWindow', 'Confirm the start and end are correct: the duration is calculated from those timestamps, not independently verified.')}
            </Text>
          ) : null}
          {preview.changes.some((change) => change.field === 'ended_at') ? (
            <Text as="p" variant="bodySm">
              {t('dataRepair.correction.boundaryPreserved', 'Other measurements and telemetry associations remain unchanged; check them against the corrected session window.')}
            </Text>
          ) : null}
          {preview.changes.some((change) => change.field !== 'cost_decimal' && change.after == null && change.after_text == null) ? (
            <Text as="p" variant="bodySm">
              {t('dataRepair.correction.clearWarning', 'Marking a measurement unknown removes its recorded value; it does not recover the measurement.')}
            </Text>
          ) : null}
          {preview.changes.some((change) => change.field === 'cost_decimal') ? (
            <Text as="p" variant="bodySm">
              {t('dataRepair.correction.costInvalidated', 'The previous estimate depended on the incorrect energy value. It will be removed; reprice the session to calculate a new estimate. Actual or manually recorded costs are preserved.')}
            </Text>
          ) : null}
          {!canConfirm ? (
            <Text as="p" variant="bodySm" role="status">
              {t('dataRepair.correction.reviewExpired', 'The case or write access changed. Cancel and review the current finding again.')}
            </Text>
          ) : null}
          {error ? <Text as="p" role="alert" className="text-[var(--semantic-danger)]">{error}</Text> : null}
        </div>
      ) : undefined}
    />
  );
}
