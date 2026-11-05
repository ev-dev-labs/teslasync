import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RepairCase } from '@/api/hooks/useDataRepair';
import { KVList } from '@/components/data-display';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useDateFormat, type DateFormatter } from '@/hooks/useDateFormat';
import { useUnits, type UseUnitsResult } from '@/hooks/useUnits';
import { isStructuralRepairCase, repairCodeLabel } from './repairCasePresentation';
import { correctionFieldLabel, correctionFields } from './repairCorrectionFields';

interface RepairCaseEvidencePanelProps {
  repairCase: RepairCase;
}

function evidenceNumber(value: string | undefined): number | null {
  if (!value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function structuralEvidenceItems(
  repairCase: RepairCase,
  t: TFunction,
  units: UseUnitsResult,
  formatDateTime: DateFormatter,
) {
  const raw = repairCase.evidence_contradiction_value;
  const parts = Object.fromEntries(raw.split(/\s+/).map((part) => part.split('=')));
  const pair = (first: string, second: string) => {
    const a = evidenceNumber(parts[first]);
    const b = evidenceNumber(parts[second]);
    return a == null || b == null ? null : [a, b] as const;
  };
  if (repairCase.rule === 'duration_mismatch') {
    const values = pair('stored', 'computed');
    return values ? [
      { label: t('dataRepair.correction.storedDuration', 'Stored duration'), value: units.formatDuration(values[0]) },
      { label: t('dataRepair.correction.windowDuration', 'Duration from start and end'), value: units.formatDuration(values[1]) },
    ] : [];
  }
  if (repairCase.rule === 'odometer_rollback') {
    const values = pair('start_m', 'end_m');
    return values ? [
      { label: correctionFieldLabel(t, 'start_odometer_m'), value: units.formatDistance(values[0]) },
      { label: correctionFieldLabel(t, 'end_odometer_m'), value: units.formatDistance(values[1]) },
    ] : [];
  }
  if (repairCase.rule === 'soc_inconsistent') {
    const values = pair('start_pct', 'end_pct');
    return values ? [
      { label: correctionFieldLabel(t, 'start_soc_pct'), value: t('dataRepair.correction.percentValue', '{{value}}%', { value: values[0] }) },
      { label: correctionFieldLabel(t, 'end_soc_pct'), value: t('dataRepair.correction.percentValue', '{{value}}%', { value: values[1] }) },
    ] : [];
  }
  if (repairCase.rule === 'ended_before_started') {
    return [
      { label: t('dataRepair.correction.start', 'Session start'), value: formatDateTime(repairCase.evidence_started_at) },
      { label: t('dataRepair.correction.end', 'Session end'), value: formatDateTime(repairCase.evidence_stored_ended_at) },
    ];
  }
  const fields = correctionFields(repairCase.rule);
  const value = evidenceNumber(raw);
  if (fields.length !== 1 || value == null) return [];
  const field = fields[0];
  const formatted = field === 'duration_s' ? units.formatDuration(value)
    : field === 'distance_m' ? units.formatDistance(value) : units.formatEnergy(value);
  return [{ label: correctionFieldLabel(t, field), value: formatted }];
}

export function RepairCaseEvidencePanel({ repairCase }: RepairCaseEvidencePanelProps) {
  const { t } = useTranslation();
  const units = useUnits();
  const { formatDateTime } = useDateFormat();
  const structural = isStructuralRepairCase(repairCase);
  const active = repairCase.status === 'open' || repairCase.status === 'in_review';
  const observations = structural ? structuralEvidenceItems(repairCase, t, units, formatDateTime) : [];

  return (
    <>
      <GlassPanel className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <PanelTitle>{t('dataRepair.cases.findingTitle', 'Integrity finding')}</PanelTitle>
            <Text as="p" variant="bodySm" className="mt-1">
              {repairCodeLabel(t, repairCase.rule)}
            </Text>
          </div>
          {!structural || active ? (
            <Badge variant={repairCase.applicable ? 'success' : 'warning'}>
              {structural
                ? t('dataRepair.correction.reviewRequired', 'Review required')
                : repairCase.applicable
                  ? t('dataRepair.cases.actionable', 'Actionable')
                  : t('dataRepair.cases.blocked', 'Blocked')}
            </Badge>
          ) : null}
        </div>
        {structural ? (
          <Text as="p" variant="bodySm" role="note" className="mb-3 text-[var(--semantic-warning)]">
            {repairCase.status === 'applied'
              ? t('dataRepair.correction.appliedNote', 'A reviewed correction was applied to this finding.')
              : t('dataRepair.cases.blockedReasons.structuralCorrection', 'This structural anomaly requires a manual correction')}
          </Text>
        ) : repairCase.blocked_reason ? (
          <Text as="p" variant="bodySm" className="mb-3 text-amber-700 dark:text-amber-300">
            {repairCodeLabel(t, repairCase.blocked_reason)}
          </Text>
        ) : null}
        <KVList
          columns={2}
          items={[
            {
              label: t('dataRepair.cases.vehicle', 'Vehicle'),
              value: t('dataRepair.cases.vehicleNumber', 'Vehicle #{{id}}', {
                id: repairCase.vehicle_id,
              }),
            },
            ...(repairCase.related_session_id != null ? [{
              label: t('dataRepair.cases.relatedSession', 'Related session'),
              value: `#${repairCase.related_session_id}`,
            }] : []),
            {
              label: t('dataRepair.cases.confidence', 'Confidence'),
              value: repairCase.confidence === 'high'
                ? t('dataRepair.confidence.high', 'High confidence')
                : t('dataRepair.confidence.medium', 'Medium confidence'),
            },
            {
              label: t('dataRepair.cases.firstDetected', 'First detected'),
              value: formatDateTime(repairCase.first_seen_at),
            },
            {
              label: t('dataRepair.cases.lastDetected', 'Last detected'),
              value: formatDateTime(repairCase.last_seen_at),
            },
            ...(!structural ? [{
              label: t('dataRepair.cases.suggestedBoundary', 'Suggested boundary'),
              value: formatDateTime(repairCase.suggested_ended_at),
            }, {
              label: t('dataRepair.cases.evidenceGap', 'Evidence gap'),
              value: units.formatDuration(repairCase.evidence_gap_s),
            }] : []),
          ]}
        />
      </GlassPanel>

      <GlassPanel className="p-4">
        <PanelTitle>{t('dataRepair.cases.evidenceTitle', 'Evidence chain')}</PanelTitle>
        <Text as="p" variant="bodySm" className="mt-1">
          {structural
            ? t('dataRepair.correction.structuralEvidence', 'Observations from the last scan. Review current values before applying a correction.')
            : t('dataRepair.cases.evidenceDescription', 'Durable observations used to establish the session boundary.')}
        </Text>
        <div className="mt-4 space-y-3">
          {repairCase.evidence_last_in_session_ts ? (
            <div className="rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
              <Text as="p" size="xs" weight="semibold" color="muted">
                {t('dataRepair.cases.lastInSession', 'Last in-session observation')}
              </Text>
              <Text as="p" size="sm" className="mt-1">
                {formatDateTime(repairCase.evidence_last_in_session_ts)}
              </Text>
              <Text as="p" variant="caption" className="mt-1 break-all">
                {repairCase.evidence_last_in_session_src ?? '—'} · {repairCase.evidence_last_in_session_field ?? '—'} · {repairCase.evidence_last_in_session_value ?? '—'}
              </Text>
            </div>
          ) : null}
          <div className="rounded-shape-md border border-amber-500/20 bg-amber-500/[0.06] p-3">
            <Text as="p" size="xs" weight="semibold" className="text-amber-700 dark:text-amber-300">
              {t('dataRepair.cases.contradiction', 'Contradicting observation')}
            </Text>
            <Text as="p" size="sm" className="mt-1">
              {formatDateTime(repairCase.evidence_contradiction_ts)}
            </Text>
            {observations.length > 0 ? (
              <>
                <KVList items={observations} layout="responsive" />
                <details className="mt-2">
                  <Text as="summary" variant="caption" className="cursor-pointer">
                    {t('dataRepair.correction.technicalDetails', 'Technical details')}
                  </Text>
                  <Text as="p" variant="caption" className="mt-1 break-all">
                    {repairCase.evidence_contradiction_src} · {repairCase.evidence_contradiction_field} · {repairCase.evidence_contradiction_value}
                  </Text>
                </details>
              </>
            ) : (
              <Text as="p" variant="caption" className="mt-1 break-all">
                {repairCase.evidence_contradiction_src} · {repairCase.evidence_contradiction_field} · {repairCase.evidence_contradiction_value}
              </Text>
            )}
          </div>
        </div>
      </GlassPanel>
    </>
  );
}
