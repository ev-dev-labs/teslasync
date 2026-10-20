import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useRepairCase,
  useTransitionRepairCase,
  type RepairCaseStatus,
} from '@/api/hooks/useDataRepair';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Badge, Button, ConfirmDialog, Drawer, Text, Textarea } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { useDataState } from '@/hooks/useDataState';
import { RepairCaseCollaboration } from './RepairCaseCollaboration';
import { RepairCaseControlledActions } from './RepairCaseControlledActions';
import { RepairCaseEvidencePanel } from './RepairCaseEvidencePanel';
import {
  repairStatusLabel,
  isStructuralRepairCase,
  REPAIR_STATUS_BADGE_VARIANTS,
} from './repairCasePresentation';

interface RepairCaseDrawerProps {
  caseId: number | null;
  onClose: () => void;
  canWrite: boolean;
  writeBlockReason?: string;
}

export function RepairCaseDrawer({
  caseId,
  onClose,
  canWrite,
  writeBlockReason,
}: RepairCaseDrawerProps) {
  const { t } = useTranslation();
  const detailQuery = useRepairCase(caseId);
  const detailState = useDataState(detailQuery);
  const transition = useTransitionRepairCase();
  const resetTransition = transition.reset;
  const [resolveReason, setResolveReason] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const inFlight = useRef(false);
  const activeCaseId = useRef(caseId);
  activeCaseId.current = caseId;
  useEffect(() => {
    setResolveReason('');
    setResolveOpen(false);
    resetTransition();
  }, [caseId, resetTransition]);
  const detail = detailQuery.data;
  const repairCase = detail?.case;
  const drawerTitle = repairCase
    ? t('dataRepair.cases.drawerTitle', 'Case #{{id}}', { id: repairCase.id })
    : t('dataRepair.cases.drawerLoadingTitle', 'Repair case');
  const transitionTo = (status: RepairCaseStatus, resolutionNote?: string) => {
    if (!repairCase || !canWrite || inFlight.current || transition.isPending
      || (status === 'resolved' && !resolutionNote?.trim())) return;
    inFlight.current = true;
    const submittedCaseId = repairCase.id;
    transition.mutate({
      case_id: repairCase.id,
      status,
      expected_updated_at: repairCase.updated_at,
      resolution_note: resolutionNote,
    }, {
      onSuccess: () => {
        if (status === 'resolved' && activeCaseId.current === submittedCaseId) {
          setResolveOpen(false);
          setResolveReason('');
        }
      },
      onSettled: () => { inFlight.current = false; },
    });
  };
  const transitionError = transition.error ? t('dataRepair.cases.transitionFailed', {
    message: transition.error instanceof Error ? transition.error.message
      : t('toast.dataRepair.case.transition.error', 'Failed to update repair case'),
    defaultValue: 'The case could not be updated. {{message}}',
  }) : null;

  return (
    <Drawer
      open={caseId != null}
      onClose={onClose}
      size="lg"
      title={drawerTitle}
      description={
        repairCase
          ? t(
              'dataRepair.cases.drawerDescription',
              '{{kind}} session #{{id}} · vehicle #{{vehicle}}',
              {
                kind: repairCase.kind,
                id: repairCase.session_id,
                vehicle: repairCase.vehicle_id,
              },
            )
          : t('dataRepair.cases.drawerLoading', 'Loading durable evidence and operator history')
      }
      footer={
        repairCase ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {repairCase.status === 'open' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => transitionTo('in_review')}
                  loading={transition.isPending}
                  disabled={!canWrite}
                  title={!canWrite ? writeBlockReason : undefined}
                  wrapLabel
                >
                  {t('dataRepair.cases.beginReview', 'Begin review')}
                </Button>
              ) : null}
              {repairCase.status === 'dismissed' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => transitionTo('open')}
                  loading={transition.isPending}
                  disabled={!canWrite}
                  title={!canWrite ? writeBlockReason : undefined}
                  wrapLabel
                >
                  {t('dataRepair.cases.reopen', 'Reopen')}
                </Button>
              ) : null}
            </div>
            {repairCase.status === 'open' || repairCase.status === 'in_review' ? (
              <Button
                size="sm"
                variant="primary"
                icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                onClick={() => { transition.reset(); setResolveOpen(true); }}
                loading={transition.isPending}
                disabled={!canWrite}
                title={!canWrite ? writeBlockReason : undefined}
                wrapLabel
              >
                {t('dataRepair.cases.resolve', 'Resolve case')}
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      <StaleRefreshWarning state={detailState} />
      {!resolveOpen && transitionError && <Text as="p" role="alert" className="mb-3 text-[var(--semantic-danger)]">{transitionError}</Text>}
      {detailQuery.isLoading && !detail ? (
        <div className="space-y-3">
          <Skeleton height={120} />
          <Skeleton height={220} />
          <Skeleton height={180} />
        </div>
      ) : detailState.fatalError ? (
        <QueryError error={detailState.fatalError} onRetry={() => void detailQuery.refetch()} />
      ) : repairCase && detail ? (
        <div className="space-y-4 pb-24">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={REPAIR_STATUS_BADGE_VARIANTS[repairCase.status]}>
              {repairStatusLabel(t, repairCase.status)}
            </Badge>
            <Badge variant="neutral">
              {repairCase.confidence === 'high'
                ? t('dataRepair.confidence.high', 'High confidence')
                : t('dataRepair.confidence.medium', 'Medium confidence')}
            </Badge>
            <Text variant="caption">
              {t('dataRepair.cases.lastSeen', 'Last seen {{time}}', {
                time: formatDateTime(repairCase.last_seen_at),
              })}
            </Text>
          </div>

          <RepairCaseEvidencePanel repairCase={repairCase} />
          <RepairCaseCollaboration
            caseId={repairCase.id}
            assignedTo={repairCase.assigned_to}
            comments={detail.comments}
            canWrite={canWrite}
            writeBlockReason={writeBlockReason}
          />
          <RepairCaseControlledActions
            repairCase={repairCase}
            quarantine={detail.quarantine}
            canWrite={canWrite}
            writeBlockReason={writeBlockReason}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={resolveOpen}
        onCancel={() => setResolveOpen(false)}
        onConfirm={() => transitionTo('resolved', resolveReason.trim())}
        title={t('dataRepair.cases.confirmResolve', 'Resolve this case?')}
        message={t(
          'dataRepair.cases.reasonRequiredDescription',
          'Provide an operator note. This action is recorded in the audit trail.',
        )}
        confirmLabel={t('dataRepair.cases.resolve', 'Resolve case')}
        variant="warning"
        loading={transition.isPending}
        details={(
          <>
            {transitionError && <Text as="p" role="alert" className="text-[var(--semantic-danger)]">{transitionError}</Text>}
            {repairCase && isStructuralRepairCase(repairCase) && <Text as="p" variant="bodySm">
              {t('dataRepair.cases.manualResolutionHint', 'Resolution records your review; it does not correct the source data. Document the manual correction in the operator note.')}
            </Text>}
            {!canWrite && <Text as="p" variant="caption" role="note">
              {writeBlockReason ?? t('dataRepair.cases.readOnly', 'Repair controls are read-only')}
            </Text>}
            <Textarea
              id="repair-case-resolution-reason"
              label={t('dataRepair.cases.reasonLabel', 'Operator note')}
              value={resolveReason}
              onChange={(event) => setResolveReason(event.target.value)}
              rows={3}
              maxLength={4000}
              placeholder={t('dataRepair.cases.reasonPlaceholder', 'Explain the evidence and decision')}
              disabled={!canWrite}
            />
          </>
        )}
        confirmDisabled={!canWrite || !resolveReason.trim()}
      />
    </Drawer>
  );
}
