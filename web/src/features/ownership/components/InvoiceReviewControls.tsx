import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { useInvoiceReviewChange } from '@/api/hooks/useOwnership';
import { AlertBanner, QueryError } from '@/components/feedback';
import { Button, ConfirmDialog, Text, Toggle } from '@/components/ui';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useUnits } from '@/hooks/useUnits';
import type { ChargingInvoice, InvoiceLine, InvoiceVarianceOptions } from '@/types/ownership';
import { InvoiceEvidenceEditor } from './InvoiceEvidenceEditor';
import { InvoiceReviewOptionsFields } from './InvoiceReviewOptionsFields';

interface ReviewDraft {
  version: number;
  options: InvoiceVarianceOptions;
  lines: InvoiceLine[];
  confirmed: boolean;
}

interface Props {
  invoice: ChargingInvoice;
  scope: PersonalScope | null;
  fresh: boolean;
}

export function InvoiceReviewControls({ invoice, scope, fresh }: Props) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { canWrite, writeBlockReason } = useOperationalMode();
  const change = useInvoiceReviewChange(invoice.id, invoice.vehicle_id, scope);
  const [draft, setDraft] = useState<ReviewDraft>();
  const [clear, setClear] = useState<number>();
  const editorId = useId();
  const invoker = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLFormElement>(null);
  const restore = useRef(false);
  const editing = draft != null;
  const blocked = !fresh || !canWrite || scope?.mode !== 'forward_auth' || change.isPending;
  const changed = draft != null && draft.version !== invoice.version;
  useEffect(() => {
    if (editing) editor.current?.focus();
    else if (restore.current && !blocked) {
      invoker.current?.focus();
      restore.current = false;
    }
  }, [editing, blocked]);
  const finish = () => {
    restore.current = true;
    setDraft(undefined);
  };
  const toggleEditor = () => {
    if (draft) {
      finish();
      return;
    }
    if (!blocked) {
      setDraft({
        version: invoice.version,
        options: invoice.variance_options ?? { material_amount_minor: 0, complete_statement: false },
        lines: invoice.lines ?? [],
        confirmed: false,
      });
    }
  };
  const clearLabel = t('ownership.reconcile.review.clearCheck', 'Turn off and clear statement check');
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button ref={invoker} variant="secondary" type="button" className="min-h-11" wrapLabel
        disabled={blocked && !editing} aria-expanded={editing} aria-controls={editing ? editorId : undefined}
        onClick={toggleEditor}>
        {editing ? t('ownership.action.cancel', 'Cancel')
          : invoice.variance_review_cleared ? t('ownership.reconcile.review.enableAgain', 'Enable statement check again')
            : t('ownership.reconcile.review.editCheck', 'Edit statement check')}
      </Button>
      {!editing && !invoice.variance_review_cleared && (
        <Button type="button" variant="ghost" className="min-h-11" wrapLabel
          disabled={blocked} onClick={() => setClear(invoice.version)}>{clearLabel}</Button>
      )}
    </div>
    {!canWrite && writeBlockReason && <Text as="p" variant="caption">{writeBlockReason}</Text>}
    {change.error && clear == null && <QueryError error={change.error} />}
    {draft && <form id={editorId} ref={editor} tabIndex={-1} className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (blocked || changed || !draft.confirmed || draft.options.material_amount_minor < 1 ||
          !event.currentTarget.reportValidity()) return;
      change.mutate({ kind: 'save', version: draft.version, options: draft.options, lines: draft.lines }, { onSuccess: finish });
    }}>
      {changed && <AlertBanner variant="warning">
        {t('ownership.reconcile.review.changedCheck', 'This statement check changed. Cancel and open the current review before saving.')}
      </AlertBanner>}
      <fieldset disabled={blocked || changed} className="min-w-0 space-y-3">
        <Text as="p" variant="caption">
          {t('ownership.reconcile.review.replaceEvidence', 'Edit only the independent evidence. The imported billing amounts and dispute history stay unchanged.')}
        </Text>
        <InvoiceReviewOptionsFields currency={invoice.currency} locale={unitPrefs.locale}
          options={draft.options} onChange={(options) => setDraft({ ...draft, options, confirmed: false })} />
        {draft.lines.map((line) => <fieldset key={line.id} className="min-w-0 rounded-xl border border-[var(--border-default)] p-3">
          <Text as="legend" variant="label">{line.line_ref || t('ownership.reconcile.line.unnamed', 'Unnamed line')} (#{line.id})</Text>
          <InvoiceEvidenceEditor line={line} currency={invoice.currency} locale={unitPrefs.locale} enabled reviewOnly
            onChange={(patch) => setDraft({
              ...draft, confirmed: false,
              lines: draft.lines.map((item) => item.id === line.id ? { ...item, variance_evidence: patch.variance_evidence } : item),
            })} />
        </fieldset>)}
        <Toggle label={t('ownership.reconcile.review.confirmChange', 'Use this evidence only for my private statement check')}
          checked={draft.confirmed} onChange={(confirmed) => setDraft({ ...draft, confirmed })} />
        <Button type="submit" className="min-h-11" loading={change.isPending}
          disabled={blocked || changed || !draft.confirmed || draft.options.material_amount_minor < 1}>
          {t('ownership.reconcile.review.saveCheck', 'Save statement check')}
        </Button>
      </fieldset>
    </form>}
    {clear != null && <ConfirmDialog open variant="danger" title={clearLabel} confirmLabel={clearLabel}
      message={t('ownership.reconcile.review.clearEvidence', 'Remove only the private check settings and independent evidence. Imported statements, charging sessions, and local dispute history will be kept.')}
      loading={change.isPending} confirmDisabled={blocked || clear !== invoice.version}
      details={change.error && <QueryError error={change.error} />}
      onCancel={() => setClear(undefined)} onConfirm={() => {
        if (!blocked && clear === invoice.version) {
          change.mutate({ kind: 'clear', version: clear }, { onSuccess: () => { setClear(undefined); finish(); } });
        }
      }} />}
  </div>;
}
