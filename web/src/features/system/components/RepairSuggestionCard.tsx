import { useState } from 'react';
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
import type { RepairSuggestion } from '@/api/hooks/useDataRepair';

import { RepairChangeDetails } from './RepairChangeDetails';
import { RepairEvidenceTimeline } from './RepairEvidenceTimeline';
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
  /** Fires only after the operator confirms in the dialog. */
  onApply: (suggestion: RepairSuggestion) => void;
  /** True while this row's mutation is in flight. */
  isApplying?: boolean;
  /** True once this row's mutation resolved successfully. */
  isApplied?: boolean;
  /** Per-row failure text; rendered inline so it cannot be missed. */
  errorMessage?: string;
  /** Read-only operational mode, missing sudo, etc. */
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const KindIcon = suggestion.kind === 'drive' ? Route : BatteryCharging;
  const blocked = !suggestion.applicable;
  const applyDisabled = disabled || blocked || isApplied;

  // Timestamps arrive as RFC3339 and are rendered in the browser locale at the
  // display boundary; SI durations go through useUnits().
  const at = (iso: string): string => formatDateTime(iso);

  const confirmMessage = t(
    'dataRepair.confirm.message',
    'This rewrites {{kind}} #{{id}} to end at {{end}}. Distance, energy and speed totals are NOT recomputed — they were measured over the original window. This is recorded in the audit log and is not undone automatically.',
    {
      kind: sessionKindLabel(t, suggestion.kind),
      id: suggestion.session_id,
      end: at(suggestion.suggested_ended_at),
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

        {isApplied && (
          <InlineCallout variant="success" icon={<CheckCircle2 />}>
            {t('dataRepair.card.applied', 'Applied. Refresh to re-check the remaining suggestions.')}
          </InlineCallout>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
            loading={isApplying}
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
        open={confirmOpen}
        variant="warning"
        title={t('dataRepair.confirm.title', 'Apply this repair?')}
        message={confirmMessage}
        confirmLabel={t('dataRepair.confirm.apply', 'Apply repair')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={isApplying}
        onConfirm={() => {
          setConfirmOpen(false);
          onApply(suggestion);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </GlassPanel>
  );
}
