import { useTranslation } from 'react-i18next';
import type { RepairCase } from '@/api/hooks/useDataRepair';
import { KVList } from '@/components/data-display';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { repairCodeLabel } from './repairCasePresentation';

interface RepairCaseEvidencePanelProps {
  repairCase: RepairCase;
}

export function RepairCaseEvidencePanel({ repairCase }: RepairCaseEvidencePanelProps) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();

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
          <Badge variant={repairCase.applicable ? 'success' : 'warning'}>
            {repairCase.applicable
              ? t('dataRepair.cases.actionable', 'Actionable')
              : t('dataRepair.cases.blocked', 'Blocked')}
          </Badge>
        </div>
        {repairCase.blocked_reason ? (
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
                ? t('dataRepair.confidence.high', 'High')
                : t('dataRepair.confidence.medium', 'Medium'),
            },
            {
              label: t('dataRepair.cases.firstDetected', 'First detected'),
              value: formatDateTime(repairCase.first_seen_at),
            },
            {
              label: t('dataRepair.cases.lastDetected', 'Last detected'),
              value: formatDateTime(repairCase.last_seen_at),
            },
            {
              label: t('dataRepair.cases.suggestedBoundary', 'Suggested boundary'),
              value: formatDateTime(repairCase.suggested_ended_at),
            },
            {
              label: t('dataRepair.cases.evidenceGap', 'Evidence gap'),
              value: formatDuration(repairCase.evidence_gap_s),
            },
          ]}
        />
      </GlassPanel>

      <GlassPanel className="p-4">
        <PanelTitle>{t('dataRepair.cases.evidenceTitle', 'Evidence chain')}</PanelTitle>
        <Text as="p" variant="bodySm" className="mt-1">
          {t(
            'dataRepair.cases.evidenceDescription',
            'Durable observations used to establish the session boundary.',
          )}
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
            <Text as="p" variant="caption" className="mt-1 break-all">
              {repairCase.evidence_contradiction_src} · {repairCase.evidence_contradiction_field} · {repairCase.evidence_contradiction_value}
            </Text>
          </div>
        </div>
      </GlassPanel>
    </>
  );
}
