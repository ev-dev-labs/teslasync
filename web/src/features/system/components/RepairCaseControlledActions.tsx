import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useApplyChargingRepair,
  useApplyDriveRepair,
  useQuarantineRepairCase,
  useRepairImpactPreview,
  useRestoreQuarantine,
  useTransitionRepairCase,
  type ApplyRepairInput,
  type RepairCase,
  type RepairImpactPreview,
  type RepairQuarantine,
  type RepairRule,
} from '@/api/hooks/useDataRepair';
import { ConfirmDialog, Text, Textarea } from '@/components/ui';
import { RepairCaseActionPanel } from './RepairCaseActionPanel';
import { RepairImpactSummary } from './RepairImpactSummary';

interface RepairCaseControlledActionsProps {
  repairCase: RepairCase;
  quarantine?: RepairQuarantine | null;
  canWrite: boolean;
  writeBlockReason?: string;
}

type ControlledAction = 'apply' | 'dismiss' | 'quarantine' | 'restore' | null;

interface ReviewedAction {
  action: Exclude<ControlledAction, null>;
  repairCase: RepairCase;
  quarantine: RepairQuarantine | null;
  revision: number;
  input?: ApplyRepairInput;
  preview?: RepairImpactPreview;
}

const actionableRules = new Set<string>([
  'drive_open_charging_started',
  'drive_open_park_observed',
  'drive_end_after_contradiction',
  'charging_open_drive_started',
  'charging_open_charge_ended',
  'charging_end_after_contradiction',
]);

function isActionableRepairRule(rule: string): rule is RepairRule {
  return actionableRules.has(rule);
}

function buildApplyInput(repairCase: RepairCase): ApplyRepairInput | null {
  if (
    !repairCase.applicable
    || !repairCase.suggested_ended_at
    || !isActionableRepairRule(repairCase.rule)
  ) {
    return null;
  }
  return {
    id: repairCase.session_id,
    case_id: repairCase.id,
    ended_at: repairCase.suggested_ended_at,
    rule: repairCase.rule,
    expected_stored_ended_at: repairCase.evidence_stored_ended_at ?? '',
  };
}

export function RepairCaseControlledActions({
  repairCase,
  quarantine,
  canWrite,
  writeBlockReason,
}: RepairCaseControlledActionsProps) {
  const { t } = useTranslation();
  const transition = useTransitionRepairCase();
  const quarantineCase = useQuarantineRepairCase();
  const restore = useRestoreQuarantine();
  const preview = useRepairImpactPreview(repairCase.kind);
  const applyDrive = useApplyDriveRepair();
  const applyCharging = useApplyChargingRepair();
  const [review, setReview] = useState<ReviewedAction | null>(null);
  const [reason, setReason] = useState('');
  const action = review?.action ?? null;
  const applyInput = buildApplyInput(repairCase);
  const activeQuarantine = quarantine && !quarantine.restored_at ? quarantine : null;
  const previewError = preview.error instanceof Error ? preview.error.message : undefined;
  const contextKey = JSON.stringify(
    [repairCase, activeQuarantine],
    [...new Set([...Object.keys(repairCase), ...Object.keys(activeQuarantine ?? {})])].sort(),
  );
  const context = useRef({ key: contextKey, revision: 0, canWrite });
  if (context.current.key !== contextKey) {
    context.current.key = contextKey;
    context.current.revision += 1;
  }
  context.current.canWrite = canWrite;
  const previewRequest = useRef(0);
  useEffect(() => () => { previewRequest.current += 1; }, []);

  const mutationPending = transition.isPending
    || quarantineCase.isPending
    || restore.isPending
    || applyDrive.isPending
    || applyCharging.isPending;
  const reviewCurrent = review?.revision === context.current.revision;

  const closeDialog = () => {
    previewRequest.current += 1;
    setReview(null);
    setReason('');
    preview.reset();
  };

  const beginReview = (nextAction: Exclude<ControlledAction, null>) => {
    if (!canWrite || mutationPending) return;
    previewRequest.current += 1;
    setReview({
      action: nextAction,
      repairCase: structuredClone(repairCase),
      quarantine: activeQuarantine ? structuredClone(activeQuarantine) : null,
      revision: context.current.revision,
    });
  };

  const requestApplyPreview = () => {
    if (!canWrite || !applyInput || preview.isPending || mutationPending) return;
    const input = { ...applyInput };
    const originalCase = structuredClone(repairCase);
    const revision = context.current.revision;
    const request = ++previewRequest.current;
    preview.reset();
    preview.mutate(input, {
      onSuccess: (impact) => {
        if (request !== previewRequest.current
          || revision !== context.current.revision
          || !context.current.canWrite) return;
        setReview({
          action: 'apply',
          repairCase: originalCase,
          quarantine: null,
          revision,
          input,
          preview: structuredClone(impact),
        });
      },
    });
  };

  const confirm = () => {
    if (!canWrite || !review || !reviewCurrent || mutationPending) return;
    if (action === 'apply' && review.input && review.preview) {
      const mutation = review.repairCase.kind === 'drive' ? applyDrive : applyCharging;
      mutation.mutate({ ...review.input }, { onSuccess: closeDialog });
      return;
    }
    const note = reason.trim();
    if (!note) return;
    if (action === 'dismiss') {
      transition.mutate({
        case_id: review.repairCase.id,
        status: 'dismissed',
        expected_updated_at: review.repairCase.updated_at,
        resolution_note: note,
      }, { onSuccess: closeDialog });
    } else if (action === 'quarantine') {
      quarantineCase.mutate(
        { case_id: review.repairCase.id, reason: note },
        { onSuccess: closeDialog },
      );
    } else if (action === 'restore' && review.quarantine) {
      restore.mutate(
        { quarantine_id: review.quarantine.id, reason: note },
        { onSuccess: closeDialog },
      );
    }
  };

  return (
    <>
      {repairCase.status === 'open' || repairCase.status === 'in_review' ? (
        <RepairCaseActionPanel
          mode="review"
          canWrite={canWrite}
          writeBlockReason={writeBlockReason}
          hasApplyAction={applyInput != null}
          previewPending={preview.isPending}
          previewError={previewError}
          onApply={requestApplyPreview}
          onDismiss={() => beginReview('dismiss')}
          onQuarantine={() => beginReview('quarantine')}
        />
      ) : null}

      {repairCase.status === 'quarantined' && activeQuarantine ? (
        <RepairCaseActionPanel
          mode="restore"
          canWrite={canWrite}
          writeBlockReason={writeBlockReason}
          onRestore={() => beginReview('restore')}
        />
      ) : null}

      <ConfirmDialog
        open={action != null}
        onCancel={closeDialog}
        onConfirm={confirm}
        title={
          action === 'quarantine'
            ? t('dataRepair.cases.confirmQuarantine', 'Move session to quarantine?')
            : action === 'restore'
              ? t('dataRepair.cases.confirmRestore', 'Restore this session?')
              : action === 'apply'
                ? t('dataRepair.confirm.title', 'Apply this repair?')
                : t('dataRepair.cases.confirmDismiss', 'Dismiss this finding?')
        }
        message={t(
          action === 'apply'
            ? 'dataRepair.confirm.caseImpactDescription'
            : 'dataRepair.cases.reasonRequiredDescription',
          action === 'apply'
            ? 'Review the exact server-calculated impact before applying this boundary.'
            : 'Provide an operator note. This action is recorded in the audit trail.',
        )}
        confirmLabel={
          action === 'quarantine'
            ? t('dataRepair.cases.quarantineAction', 'Move to quarantine')
            : action === 'restore'
              ? t('dataRepair.cases.restoreAction', 'Restore session')
              : action === 'apply'
                ? t('dataRepair.confirm.apply', 'Apply repair')
                : t('dataRepair.cases.dismiss', 'Dismiss finding')
        }
        variant={action === 'quarantine' ? 'danger' : 'warning'}
        loading={mutationPending}
        details={
          <>
            {!canWrite && <Text as="p" variant="caption" role="note">
              {writeBlockReason ?? t('dataRepair.cases.readOnly', 'Repair controls are read-only')}
            </Text>}
            {action === 'apply' && review?.preview
              ? <RepairImpactSummary preview={review.preview} />
              : (
                <Textarea
                  id="repair-case-controlled-action-reason"
                  label={t('dataRepair.cases.reasonLabel', 'Operator note')}
                  value={reason}
                  onChange={(event) => {
                    if (!canWrite || !reviewCurrent || mutationPending) return;
                    setReason(event.target.value);
                  }}
                  rows={3}
                  maxLength={action === 'quarantine' || action === 'restore' ? 1000 : 4000}
                  placeholder={t('dataRepair.cases.reasonPlaceholder', 'Explain the evidence and decision')}
                  disabled={!canWrite || !reviewCurrent || mutationPending}
                />
                )}
          </>
        }
        confirmDisabled={!canWrite || !reviewCurrent || (action !== 'apply' && !reason.trim())}
      />
    </>
  );
}
