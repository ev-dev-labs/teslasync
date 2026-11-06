import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RepairCase, RepairSessionKind } from '@/api/hooks/useDataRepair';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { correctionFields } from './repairCorrectionFields';

interface RepairCaseNextStepsProps {
  repairCase: RepairCase;
}

export function RepairCaseNextSteps({ repairCase }: RepairCaseNextStepsProps) {
  const { t } = useTranslation();
  const relatedKind: RepairSessionKind = repairCase.rule === 'cross_kind_overlap_drive_charging'
    ? 'charging' : repairCase.kind;
  const sessionPath = (kind: RepairSessionKind, id: number) =>
    kind === 'drive' ? `/drives/${id}` : `/charging/${id}`;
  const sessionLabel = (kind: RepairSessionKind, id: number) =>
    kind === 'drive'
      ? t('dataRepair.correction.openDrive', 'Open drive #{{id}} in a new tab', { id })
      : t('dataRepair.correction.openCharging', 'Open charging session #{{id}} in a new tab', { id });
  let explanation: string;
  if (repairCase.rule === 'duplicate_session_window') {
    explanation = t('dataRepair.correction.duplicateHelp', 'Compare both sessions. If this session is a duplicate, move it to quarantine below; the other session stays active and the quarantined row can be restored.');
  } else if (repairCase.rule.includes('overlap')) {
    explanation = t('dataRepair.correction.overlapHelp', 'Compare both sessions and their timestamps. If you have evidence for the earlier session’s correct end, review a correction below. Do not guess which boundary is wrong.');
  } else if (repairCase.rule === 'ended_before_started') {
    explanation = t('dataRepair.correction.boundaryHelp', 'The end precedes the start. Check the original session evidence, then enter the correct end below if it is known; the application cannot infer it safely.');
  } else if (correctionFields(repairCase.rule).length > 0) {
    explanation = t('dataRepair.correction.reviewHelp', 'Review the session evidence, then choose a correction below. Nothing changes until you confirm the preview.');
  } else {
    explanation = t('dataRepair.correction.uncertainHelp', 'Review the session and evidence before deciding whether to dismiss, quarantine, or record a manual resolution.');
  }
  return (
    <GlassPanel className="space-y-3 p-4">
      <PanelTitle>{t('dataRepair.correction.nextSteps', 'What to do')}</PanelTitle>
      <Text as="p" variant="bodySm">{explanation}</Text>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link
          to={sessionPath(repairCase.kind, repairCase.session_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--text-primary)] underline underline-offset-2"
        >
          {sessionLabel(repairCase.kind, repairCase.session_id)}
        </Link>
        {repairCase.related_session_id != null ? (
          <Link
            to={sessionPath(relatedKind, repairCase.related_session_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--text-primary)] underline underline-offset-2"
          >
            {sessionLabel(relatedKind, repairCase.related_session_id)}
          </Link>
        ) : null}
      </div>
    </GlassPanel>
  );
}
