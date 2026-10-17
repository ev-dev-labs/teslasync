import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  Route,
  Wrench,
} from 'lucide-react';

import { Badge, Button, ConfirmDialog, GlassPanel, Text } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import {
  repairApplyInput,
  useRepairImpactPreview,
  type RepairSuggestion,
  type RepairImpactPreview,
} from '@/api/hooks/useDataRepair';

import { RepairChangeDetails } from './RepairChangeDetails';
import { RepairEvidenceTimeline } from './RepairEvidenceTimeline';
import { RepairImpactSummary } from './RepairImpactSummary';
import {
  blockedReasonLabel,
  confidenceLabel,
  confidenceVariant,
  ruleExplanation,
  ruleLabel,
  sessionKindLabel,
} from './repairPresentation';

export interface RepairSuggestionCardProps {
  suggestion: RepairSuggestion;
  onApply: (suggestion: RepairSuggestion) => void;
  isApplying?: boolean;
  isApplied?: boolean;
  errorMessage?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * `RepairSuggestionCard` — one reviewable, NOT-yet-applied boundary repair.
 *
 * The card is deliberately verbose: it shows the stored boundary, every piece
 * of durable evidence behind the proposal, the unobserved gap, and exactly
 * which columns an apply would rewrite. Applying is a two-step, explicit
 * action — the button opens a confirmation that restates the change; nothing
 * is ever applied automatically or in bulk.
 *
 * All timestamps arrive as RFC3339 from the API and all durations as SI
 * seconds; conversion to the operator's display units happens here, at the
 * render boundary, via `useUnits()`.
 */
export function RepairSuggestionCard({
  suggestion,
  onApply,
  isApplying = false,
  isApplied = false,
  errorMessage,
  disabled = false,
  disabledReason,
}: RepairSuggestionCardProps) {
  const { t } = useTranslation();
  const operationalMode = useOperationalMode();
  const [review, setReview] = useState<{
    suggestion: RepairSuggestion;
    preview: RepairImpactPreview;
    revision: number;
  } | null>(null);
  const preview = useRepairImpactPreview(suggestion.kind);
  const contextKey = JSON.stringify(
    suggestion,
    [...Object.keys(suggestion), 'ts', 'source', 'field', 'value'].sort(),
  );
  const context = useRef({ key: contextKey, revision: 0, canWrite: true });
  if (context.current.key !== contextKey) {
    context.current.key = contextKey;
    context.current.revision += 1;
  }
  const previewRequest = useRef(0);
  useEffect(() => () => { previewRequest.current += 1; }, []);

  const KindIcon = suggestion.kind === 'drive' ? Route : BatteryCharging;
  const blocked = !suggestion.applicable;
  const applyDisabled = !operationalMode.canWrite || disabled || blocked || isApplied || isApplying;
  context.current.canWrite = !applyDisabled;
  const reviewCurrent = review?.revision === context.current.revision;
  const previewError = preview.error instanceof Error ? preview.error.message : undefined;

  // Timestamps arrive as RFC3339 and are rendered in the browser locale at the
  // display boundary; SI durations go through useUnits().
  const at = (iso: string): string => formatDateTime(iso);

  const confirmMessage = t(
    'dataRepair.confirm.message',
    'This rewrites {{kind}} #{{id}} to end at {{end}}. Distance, energy and speed totals are NOT recomputed — they were measured over the original window. This is recorded in the audit log and is not undone automatically.',
    {
      kind: sessionKindLabel(t, review?.suggestion.kind ?? suggestion.kind),
      id: review?.suggestion.session_id ?? suggestion.session_id,
      end: at(review?.suggestion.suggested_ended_at ?? suggestion.suggested_ended_at),
    },
  );

  return (
    <GlassPanel
      className="p-4 sm:p-5"
      data-testid={`repair-suggestion-${suggestion.kind}-${suggestion.session_id}`}
    >
      <article
        aria-label={t('dataRepair.card.label', 'Repair suggestion for {{kind}} #{{id}}', {
          kind: sessionKindLabel(t, suggestion.kind),
          id: suggestion.session_id,
        })}
        className="space-y-4"
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <KindIcon className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
            <div className="min-w-0">
              <Text as="p" variant="bodySm" className="font-semibold text-[var(--text-primary)]">
                {ruleLabel(t, suggestion.rule)}
              </Text>
              <Text as="p" variant="caption" className="mt-0.5">
                {sessionKindLabel(t, suggestion.kind)} #{suggestion.session_id}
                {' · '}
                {t('dataRepair.row.vehicle', 'Vehicle {{id}}', { id: suggestion.vehicle_id })}
              </Text>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={confidenceVariant(suggestion.confidence)} size="sm">
              {confidenceLabel(t, suggestion.confidence)}
            </Badge>
            {suggestion.stored_ended_at === null && (
              <Badge variant="warning" size="sm">
                {t('dataRepair.badge.open', 'Open')}
              </Badge>
            )}
          </div>
        </header>

        <Text as="p" variant="bodySm" className="text-[var(--text-secondary)]">
          {ruleExplanation(t, suggestion.rule)}
        </Text>

        <RepairEvidenceTimeline suggestion={suggestion} />
        <RepairChangeDetails suggestion={suggestion} />

        {blocked && (
          <InlineCallout variant="danger" icon={<AlertTriangle />}>
            {blockedReasonLabel(t, suggestion.blocked_reason)}
          </InlineCallout>
        )}

        {errorMessage && (
          <InlineCallout variant="danger" icon={<AlertTriangle />}>
            {errorMessage}
          </InlineCallout>
        )}

        {previewError && (
          <InlineCallout variant="danger" icon={<AlertTriangle />}>
            {previewError}
          </InlineCallout>
        )}

        {isApplied && (
          <InlineCallout variant="success" icon={<CheckCircle2 />}>
            {t('dataRepair.card.applied', 'Applied. Refresh to re-check the remaining suggestions.')}
          </InlineCallout>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              if (applyDisabled || preview.isPending) return;
              const original = structuredClone(suggestion);
              const revision = context.current.revision;
              const request = ++previewRequest.current;
              preview.reset();
              preview.mutate(repairApplyInput(original), {
                onSuccess: (impact) => {
                  if (request !== previewRequest.current
                    || revision !== context.current.revision
                    || !context.current.canWrite) return;
                  setReview({ suggestion: original, preview: structuredClone(impact), revision });
                },
              });
            }}
            loading={isApplying || preview.isPending}
            disabled={applyDisabled}
            title={blocked ? blockedReasonLabel(t, suggestion.blocked_reason) : disabledReason}
            icon={<Wrench className="h-4 w-4" aria-hidden="true" />}
            className="min-h-11"
            data-testid={`repair-apply-${suggestion.kind}-${suggestion.session_id}`}
          >
            {t('dataRepair.action.reviewApply', 'Review & apply')}
          </Button>
          <Text as="span" variant="caption">
            {t('dataRepair.card.manualOnly', 'Nothing is applied until you confirm.')}
          </Text>
        </div>
      </article>

      <ConfirmDialog
        open={review != null}
        variant="warning"
        title={t('dataRepair.confirm.title', 'Apply this repair?')}
        message={confirmMessage}
        details={review ? <>
          {(disabled || !operationalMode.canWrite) && <Text as="p" variant="caption" role="note">
            {disabledReason ?? operationalMode.writeBlockReason
              ?? t('dataRepair.cases.readOnly', 'Repair controls are read-only')}
          </Text>}
          <RepairImpactSummary preview={review.preview} />
        </> : undefined}
        confirmLabel={t('dataRepair.confirm.apply', 'Apply repair')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={isApplying}
        confirmDisabled={applyDisabled || !reviewCurrent}
        onConfirm={() => {
          if (applyDisabled || !review || !reviewCurrent) return;
          setReview(null);
          onApply(structuredClone(review.suggestion));
        }}
        onCancel={() => { previewRequest.current += 1; setReview(null); }}
      />
    </GlassPanel>
  );
}
