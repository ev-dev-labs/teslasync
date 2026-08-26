import { useState } from 'react';
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
  type RepairQuarantine,
  type RepairRule,
} from '@/api/hooks/useDataRepair';
import { ConfirmDialog, Textarea } from '@/components/ui';
import { RepairCaseActionPanel } from './RepairCaseActionPanel';
import { RepairImpactSummary } from './RepairImpactSummary';

interface RepairCaseControlledActionsProps {
  repairCase: RepairCase;
  quarantine?: RepairQuarantine | null;
  canWrite: boolean;
  writeBlockReason?: string;
}

type ControlledAction = 'apply' | 'dismiss' | 'quarantine' | 'restore' | null;

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
  const [action, setAction] = useState<ControlledAction>(null);
  const [reason, setReason] = useState('');
  const applyInput = buildApplyInput(repairCase);
  const activeQuarantine = quarantine && !quarantine.restored_at ? quarantine : null;
  const previewError = preview.error instanceof Error ? preview.error.message : undefined;

  const closeDialog = () => {
    setAction(null);
    setReason('');
    preview.reset();
  };

  const requestApplyPreview = () => {
    if (!applyInput) return;
    preview.reset();
    preview.mutate(applyInput, { onSuccess: () => setAction('apply') });
  };

  const confirm = () => {
    if (action === 'apply' && applyInput) {
      const mutation = repairCase.kind === 'drive' ? applyDrive : applyCharging;
      mutation.mutate(applyInput, { onSuccess: closeDialog });
      return;
    }
    const note = reason.trim();
    if (!note) return;
    if (action === 'dismiss') {
      transition.mutate({
        case_id: repairCase.id,
        status: 'dismissed',
        expected_updated_at: repairCase.updated_at,
        resolution_note: note,
      }, { onSuccess: closeDialog });
    } else if (action === 'quarantine') {
      quarantineCase.mutate(
        { case_id: repairCase.id, reason: note },
        { onSuccess: closeDialog },
      );
    } else if (action === 'restore' && activeQuarantine) {
      restore.mutate(
        { quarantine_id: activeQuarantine.id, reason: note },
        { onSuccess: closeDialog },
      );
    }
  };

  const mutationPending = transition.isPending
    || quarantineCase.isPending
    || restore.isPending
    || applyDrive.isPending
    || applyCharging.isPending;

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
          onDismiss={() => setAction('dismiss')}
          onQuarantine={() => setAction('quarantine')}
        />
      ) : null}

      {repairCase.status === 'quarantined' && activeQuarantine ? (
        <RepairCaseActionPanel
          mode="restore"
          canWrite={canWrite}
          writeBlockReason={writeBlockReason}
          onRestore={() => setAction('restore')}
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
          action === 'apply' && preview.data
            ? <RepairImpactSummary preview={preview.data} />
            : (
                <Textarea
                  id="repair-case-controlled-action-reason"
                  label={t('dataRepair.cases.reasonLabel', 'Operator note')}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  maxLength={action === 'quarantine' || action === 'restore' ? 1000 : 4000}
                  placeholder={t('dataRepair.cases.reasonPlaceholder', 'Explain the evidence and decision')}
                />
              )
        }
        confirmDisabled={action !== 'apply' && !reason.trim()}
      />
    </>
  );
}
