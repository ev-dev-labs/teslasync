import { useEffect, useState } from 'react';
import { MessageSquarePlus, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAddRepairCaseComment,
  useAssignRepairCase,
  type RepairCaseComment,
} from '@/api/hooks/useDataRepair';
import { Button, GlassPanel, Input, PanelTitle, Text, Textarea } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';

interface RepairCaseCollaborationProps {
  caseId: number;
  assignedTo?: string | null;
  comments: RepairCaseComment[];
  canWrite: boolean;
  writeBlockReason?: string;
}

export function RepairCaseCollaboration({
  caseId,
  assignedTo,
  comments,
  canWrite,
  writeBlockReason,
}: RepairCaseCollaborationProps) {
  const { t } = useTranslation();
  const assign = useAssignRepairCase();
  const addComment = useAddRepairCaseComment();
  const [assignee, setAssignee] = useState(assignedTo ?? '');
  const [commentBody, setCommentBody] = useState('');

  useEffect(() => {
    setAssignee(assignedTo ?? '');
    setCommentBody('');
  }, [assignedTo, caseId]);

  return (
    <>
      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <UserRound className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          <PanelTitle>{t('dataRepair.cases.assignmentTitle', 'Ownership')}</PanelTitle>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            className="flex-1"
            aria-label={t('dataRepair.cases.assignee', 'Assignee')}
            placeholder={t('dataRepair.cases.assigneePlaceholder', 'Operator name')}
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            disabled={!canWrite}
          />
          <Button
            variant="secondary"
            loading={assign.isPending}
            disabled={!canWrite}
            title={!canWrite ? writeBlockReason : undefined}
            onClick={() => assign.mutate({ case_id: caseId, assigned_to: assignee.trim() || null })}
          >
            {t('dataRepair.cases.saveAssignment', 'Save assignment')}
          </Button>
        </div>
      </GlassPanel>

      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          <PanelTitle>{t('dataRepair.cases.activityTitle', 'Review notes')}</PanelTitle>
        </div>
        <div className="space-y-3">
          {(comments ?? []).map((entry) => (
            <div key={entry.id} className="rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text as="span" size="sm" weight="semibold">{entry.actor}</Text>
                <Text as="span" variant="caption">{formatDateTime(entry.created_at)}</Text>
              </div>
              <Text as="p" variant="bodySm" className="mt-2 whitespace-pre-wrap">{entry.body}</Text>
            </div>
          ))}
          {(comments ?? []).length === 0 ? (
            <Text as="p" variant="bodySm" color="muted">
              {t('dataRepair.cases.noComments', 'No review notes yet.')}
            </Text>
          ) : null}
          <Textarea
            label={t('dataRepair.cases.commentLabel', 'Add review note')}
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            rows={3}
            maxLength={2000}
            disabled={!canWrite}
          />
          <div className="flex justify-end">
            <Button
              variant="secondary"
              disabled={!canWrite || !commentBody.trim()}
              loading={addComment.isPending}
              title={!canWrite ? writeBlockReason : undefined}
              onClick={() => addComment.mutate(
                { case_id: caseId, body: commentBody.trim() },
                { onSuccess: () => setCommentBody('') },
              )}
            >
              {t('dataRepair.cases.addComment', 'Add note')}
            </Button>
          </div>
        </div>
      </GlassPanel>
    </>
  );
}
