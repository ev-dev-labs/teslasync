import { type FormEvent, useId, useMemo, useRef, useState } from 'react';
import { FileWarning, Gavel, Receipt, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useChargingInvoices,
  useCreateDispute,
  useCreateInvoice,
  useDeleteInvoice,
  useReconciliationReport,
} from '@/api/hooks/useOwnership';
import { AlertBanner } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, ConfirmDialog, DataTable, Icon, Input, Pagination, Text, Textarea } from '@/components/ui';
import type { Column } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { isoUtcToLocalDatetimeInput, localDatetimeInputToIso } from '@/lib/dateFormat';
import { downloadCSV, downloadJSON, objectsToCSV, type CsvCellValue } from '@/lib/csvExport';

import type {
  ChargingInvoice,
  InvoiceLine,
  ReconciledLine,
  UninvoicedSession,
  VarianceBucket,
} from '@/types/ownership';
import {
  EvidencePanel,
  MoneyInput,
  MutationError,
  OwnershipPanel,
  VerdictBadge,
} from '../components';
import { OwnershipBrief } from '../components/operationalbrief-all/OwnershipBrief';
import { specialistDisplay } from '../components/operationalbrief-all/specialistDisplay';
import { formatCurrencyMinor, formatPct, formatSpan, toDateInput } from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';
import { severityTokens } from '@/lib/tokens';

function blankLine(): InvoiceLine {
  return {
    id: 0,
    line_ref: '',
    occurred_at: new Date().toISOString(),
    location: '',
    billed_energy_wh: 0,
    billed_energy_minor: 0,
    billed_idle_minor: 0,
    billed_tax_minor: 0,
    billed_total_minor: 0,
  };
}

function exportSourceRows(
  format: 'csv' | 'json',
  filename: string,
  rows: readonly Record<string, CsvCellValue>[],
) {
  if (format === 'csv') downloadCSV(filename, objectsToCSV(rows));
  else downloadJSON(filename, rows);
}

interface InvoiceTarget {
  id: number;
  vehicleId: number;
}

interface DisputeTarget extends InvoiceTarget {
  currency: string;
  version: number;
  digest: string;
}

export default function ChargingReconciliationPage() {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const { formatDateTime } = useDateFormat();
  const [activeTarget, setActiveTarget] = useState<InvoiceTarget | null>(null);
  const activeInvoice = activeTarget?.id ?? null;
  const [registerPage, setRegisterPage] = useState({ vehicleId, offset: 0 });
  const registerOffset = registerPage.vehicleId === vehicleId ? registerPage.offset : 0;
  const [importVehicleId, setImportVehicleId] = useState<number | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<DisputeTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const importActivation = useRef(0);
  const disputeActivation = useRef(0);
  const workspaceRevision = useRef(0);
  const previousVehicleId = useRef(vehicleId);
  if (previousVehicleId.current !== vehicleId) {
    previousVehicleId.current = vehicleId;
    workspaceRevision.current += 1;
  }
  const importing = useRef(false);
  const disputing = useRef(false);
  const importEditorId = useId();
  const disputeEditorId = useId();
  const [draft, setDraft] = useState({
    provider: '',
    invoice_ref: '',
    currency: 'USD',
    period_start: new Date(Date.now() - 30 * 86400000).toISOString(),
    period_end: new Date().toISOString(),
    billed_total_minor: 0 as number | null,
    lines: [blankLine()],
  });
  const [dispute, setDispute] = useState({ claimed_minor: 0 as number | null, note: '', reasons: [] as string[] });

  usePageTitle(t('ownership.reconcile.title', 'Charging invoice reconciliation'));

  const invoicesQuery = useChargingInvoices(vehicleId, 50, registerOffset);
  const reportQuery = useReconciliationReport(activeInvoice);
  const create = useCreateInvoice();
  const remove = useDeleteInvoice();
  const { confirm, dialogProps } = useConfirm();
  const latest = useRef({ vehicleId, activeTarget, draft, dispute, importOpen, disputeOpen, disputeTarget });
  latest.current = { vehicleId, activeTarget, draft, dispute, importOpen, disputeOpen, disputeTarget };

  const handleRemove = async (row: ChargingInvoice) => {
    const workspace = workspaceRevision.current;
    const ok = await confirm({
      title: t('ownership.reconcile.delete.title', 'Delete this invoice?'),
      message: t(
        'ownership.reconcile.delete.message',
        'Invoice “{{name}}” and its reconciled lines will be removed permanently. This cannot be undone.',
        { name: row.invoice_ref },
      ),
      variant: 'danger',
      confirmLabel: t('common.delete', 'Delete'),
    });
    if (!ok || latest.current.vehicleId !== row.vehicle_id
      || workspaceRevision.current !== workspace) return;
    const selected = latest.current.activeTarget;
    remove.mutate(row.id, {
      onSuccess: () => {
        if (latest.current.vehicleId === row.vehicle_id
          && workspaceRevision.current === workspace
          && latest.current.activeTarget === selected
          && selected?.id === row.id && selected.vehicleId === row.vehicle_id) {
          setActiveTarget(null);
        }
      },
    });
  };
  const openDispute = useCreateDispute(disputeTarget?.id ?? null);

  const invoices = useMemo(() => invoicesQuery.data?.items ?? [], [invoicesQuery.data?.items]);
  const exportInvoices = (format: 'csv' | 'json') => {
    const rows = invoices.map((row) => ({
      invoice_ref: row.invoice_ref,
      provider: row.provider,
      period_start: row.period_start,
      period_end: row.period_end,
      billed_total_minor: row.billed_total_minor,
      currency: row.currency,
      line_count: row.line_count,
      status: row.status,
    }));
    if (format === 'csv') downloadCSV('charging-invoices', objectsToCSV(rows));
    else downloadJSON('charging-invoices', rows);
  };
  const report = reportQuery.data?.invoice.id === activeInvoice
    && reportQuery.data.invoice.vehicle_id === activeTarget?.vehicleId
    ? reportQuery.data : undefined;
  const latestReport = useRef(report);
  latestReport.current = report;
  const selectedRegisterInvoice = invoices.find((row) => row.id === activeInvoice);
  const reportCurrent = report != null && activeTarget?.vehicleId === vehicleId
    && (selectedRegisterInvoice == null || selectedRegisterInvoice.version === report.invoice.version);
  const disputeCurrent = reportCurrent && disputeTarget != null
    && disputeTarget.id === activeInvoice && disputeTarget.vehicleId === vehicleId
    && disputeTarget.currency === report.invoice.currency
    && disputeTarget.version === report.invoice.version
    && disputeTarget.digest === report.dispute_packet_digest;
  const latestDisputeCurrent = useRef(disputeCurrent);
  latestDisputeCurrent.current = disputeCurrent;
  const contextMessage = (target: string) => t(
    'annotation.contextChanged',
    'This form belongs to {{target}}. Return to that context to save, or cancel and open a new form.',
    { target },
  );
  const varianceDescription = `${t('ownership.reconcile.line.billed', 'Billed')} − ${t('ownership.reconcile.line.expected', 'Expected')} = ${t('ownership.reconcile.stat.variance', 'Net variance')}. ${t('ownership.reconcile.unsupported.tax', 'Tax and idle-fee legality, which vary by site contract')}`;
  const exportContext = report ? {
    currency: report.invoice.currency,
    invoice_id: report.invoice.id,
    invoice_ref: report.invoice.invoice_ref,
    vehicle_id: report.invoice.vehicle_id,
    provider: report.invoice.provider,
    period_start: report.invoice.period_start,
    period_end: report.invoice.period_end,
    invoice_version: report.invoice.version,
    dispute_packet_digest: report.dispute_packet_digest,
  } : null;
  const currency = report?.invoice.currency ?? draft.currency;
  const money = (minor: number | null | undefined) =>
    formatCurrencyMinor(minor, currency, units.unitPrefs.locale);

  const lines = useMemo(() => report?.lines ?? [], [report?.lines]);
  const buckets = useMemo(() => report?.variance_buckets ?? [], [report?.variance_buckets]);
  const uninvoiced = useMemo(
    () => report?.uninvoiced_sessions ?? [],
    [report?.uninvoiced_sessions],
  );
  const allocationUnsupported = draft.lines.some((line) =>
    line.billed_total_minor !== line.billed_energy_minor + line.billed_idle_minor + line.billed_tax_minor);

  const submitInvoice = (event: FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement) || !form.reportValidity()) return;
    if (importing.current || create.isPending || allocationUnsupported || importVehicleId == null
      || vehicleId !== importVehicleId || draft.billed_total_minor == null
      || !draft.period_start || !draft.period_end
      || draft.period_start > draft.period_end) return;
    const submittedDraft = draft;
    const targetVehicle = importVehicleId;
    const activation = importActivation.current;
    const workspace = workspaceRevision.current;
    const selected = activeTarget;
    importing.current = true;
    create.mutate(
      { ...draft, billed_total_minor: draft.billed_total_minor, vehicle_id: targetVehicle },
      {
        onSuccess: (created) => {
          if (created.vehicle_id !== targetVehicle || latest.current.vehicleId !== targetVehicle
            || latest.current.activeTarget !== selected
            || latest.current.draft !== submittedDraft || !latest.current.importOpen
            || importActivation.current !== activation || workspaceRevision.current !== workspace) return;
          setImportOpen(false);
          setImportVehicleId(null);
          setActiveTarget({ id: created.id, vehicleId: created.vehicle_id });
          setDraft((current) => ({ ...current, invoice_ref: '', lines: [blankLine()] }));
        },
        onSettled: () => { importing.current = false; },
      },
    );
  };

  const submitDispute = (event: FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement) || !form.reportValidity()) return;
    if (disputing.current || openDispute.isPending || !disputeCurrent
      || dispute.claimed_minor == null || disputeTarget == null) return;
    const submittedDraft = dispute;
    const target = disputeTarget;
    const activation = disputeActivation.current;
    const workspace = workspaceRevision.current;
    const selected = activeTarget;
    disputing.current = true;
    openDispute.mutate(
      {
        claimed_minor: dispute.claimed_minor,
        note: dispute.note,
        reasons: dispute.reasons,
        confirmed: true,
      },
      {
        onSuccess: (created) => {
          const currentReport = latestReport.current;
          if (created.invoice_id !== target.id || latest.current.vehicleId !== target.vehicleId
            || !latestDisputeCurrent.current
            || latest.current.activeTarget?.id !== target.id
            || latest.current.activeTarget !== selected
            || latest.current.disputeTarget !== target
            || latest.current.dispute !== submittedDraft || !latest.current.disputeOpen
            || disputeActivation.current !== activation
            || workspaceRevision.current !== workspace
            || currentReport?.invoice.version !== target.version
            || currentReport.invoice.currency !== target.currency
            || currentReport.dispute_packet_digest !== target.digest) return;
          setDisputeOpen(false);
          setDisputeTarget(null);
          setDispute({ claimed_minor: 0, note: '', reasons: [] });
        },
        onSettled: () => { disputing.current = false; },
      },
    );
  };

  const invoiceColumns: Column<ChargingInvoice>[] = [
    {
      key: 'ref',
      header: t('ownership.reconcile.invoice.ref', 'Invoice'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.invoice_ref}
          </Text>
          <Text as="p" variant="caption">
            {row.provider}
          </Text>
        </div>
      ),
    },
    {
      key: 'period',
      header: t('ownership.reconcile.invoice.period', 'Billing period'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.period_start)} → {formatDateTime(row.period_end)}
        </Text>
      ),
    },
    {
      key: 'total',
      header: t('ownership.reconcile.invoice.total', 'Billed'),
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.billed_total_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'lines',
      header: t('ownership.reconcile.invoice.lines', 'Lines'),
      align: 'right',
      render: (row) => <span className="tabular-nums">{fmtInt(row.line_count)}</span>,
    },
    {
      key: 'status',
      header: t('ownership.reconcile.invoice.status', 'Status'),
      render: (row) => <VerdictBadge value={row.status} />,
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeInvoice === row.id ? 'primary' : 'secondary'}
            size="sm"
            className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
            wrapLabel
            onClick={() => setActiveTarget({ id: row.id, vehicleId: row.vehicle_id })}
          >
            {t('ownership.reconcile.invoice.audit', 'Audit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
            wrapLabel
            icon={<Icon icon={Trash2} />}
            loading={remove.isPending && remove.variables === row.id}
            onClick={() => void handleRemove(row)}
          >
            {t('ownership.action.remove', 'Remove')}
          </Button>
        </div>
      ),
    },
  ];

  const lineColumns: Column<ReconciledLine>[] = [
    {
      key: 'ref',
      header: t('ownership.reconcile.line.ref', 'Line'),
      filterValue: (row) => row.line.id,
      filterValueLabel: (_value, row) => row.line.line_ref || t('ownership.reconcile.line.unnamed', 'Unnamed line'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.line.line_ref || t('ownership.reconcile.line.unnamed', 'Unnamed line')}
          </Text>
          <Text as="p" variant="caption">
            {row.line.location || '—'} · {formatDateTime(row.line.occurred_at)}
          </Text>
          {row.session_id != null && <Text as="p" variant="caption">
            {t('ownership.reconcile.uninvoiced.session', 'Session')} #{row.session_id}
            {row.session_started_at != null ? ` · ${formatDateTime(row.session_started_at)}` : ''}
          </Text>}
        </div>
      ),
    },
    {
      key: 'match',
      filterValue: (row) => row.match_state,
      header: t('ownership.reconcile.line.match', 'Match'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <VerdictBadge value={row.match_state} />
          {row.ambiguous && row.match_state !== 'ambiguous' && <VerdictBadge value="ambiguous" />}
          <Text as="span" variant="caption" className="tabular-nums">
            {formatPct(row.match_confidence_pct)}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'billedEnergy',
      align: 'right',
      filterValue: (row) => row.line.billed_energy_wh,
      filterValueLabel: (_value, row) => units.formatEnergy(row.line.billed_energy_wh),
      header: t('ownership.reconcile.line.billedEnergy', 'Billed energy'),
      render: (row) => (
        <span className="tabular-nums">{units.formatEnergy(row.line.billed_energy_wh)}</span>
      ),
    },
    {
      key: 'measuredEnergy',
      align: 'right',
      filterValue: (row) => row.measured_energy_wh,
      filterValueLabel: (_value, row) => row.measured_energy_wh != null ? units.formatEnergy(row.measured_energy_wh) : '—',
      header: t('ownership.reconcile.line.measuredEnergy', 'Measured energy'),
      render: (row) =>
        row.measured_energy_wh != null ? (
          <span className="tabular-nums">{units.formatEnergy(row.measured_energy_wh)}</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'energyDelta',
      align: 'right',
      filterValue: (row) => row.energy_delta_pct,
      filterValueLabel: (_value, row) => row.energy_delta_pct != null ? formatPct(row.energy_delta_pct) : '—',
      header: t('ownership.reconcile.line.energyDelta', 'Energy Δ'),
      render: (row) =>
        row.energy_delta_pct != null ? (
          <span
            className={cn('tabular-nums', Math.abs(row.energy_delta_pct) > 5 && severityTokens.warn.fg)}
          >
            {formatPct(row.energy_delta_pct)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'timeDelta',
      align: 'right',
      filterValue: (row) => row.time_delta_s,
      filterValueLabel: (_value, row) => row.time_delta_s != null ? formatSpan(row.time_delta_s) : '—',
      header: t('ownership.reconcile.line.timeDelta', 'Time Δ'),
      render: (row) => (row.time_delta_s != null ? formatSpan(row.time_delta_s) : '—'),
    },
    {
      key: 'billed',
      header: t('ownership.reconcile.line.billed', 'Billed'),
      align: 'right',
      filterValue: (row) => row.line.billed_total_minor,
      filterValueLabel: (_value, row) => money(row.line.billed_total_minor),
      render: (row) => <span className="tabular-nums">{money(row.line.billed_total_minor)}</span>,
    },
    {
      key: 'expected',
      header: t('ownership.reconcile.line.expected', 'Expected'),
      align: 'right',
      filterValue: (row) => row.expected_cost_minor,
      filterValueLabel: (_value, row) => money(row.expected_cost_minor),
      render: (row) => <span className="tabular-nums">{money(row.expected_cost_minor)}</span>,
    },
    {
      key: 'variance',
      header: t('ownership.reconcile.line.variance', 'Variance'),
      align: 'right',
      filterValue: (row) => row.variance_minor,
      filterValueLabel: (_value, row) => money(row.variance_minor),
      render: (row) => (
        <span
          className={cn('tabular-nums', row.variance_minor > 0 ? severityTokens.critical.fg : row.variance_minor < 0 ? severityTokens.success.fg : undefined)}
        >
          {money(row.variance_minor)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'reasons',
      header: t('ownership.reconcile.line.reasons', 'Attribution'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {(row.variance_reasons ?? []).map((reason) => (
            <Badge key={reason} variant={row.recoverable ? 'warning' : 'neutral'}>
              {reason.replace(/_/g, ' ')}
            </Badge>
          ))}
          {(row.variance_reasons ?? []).length === 0 ? (
            <Text as="span" variant="caption">
              —
            </Text>
          ) : null}
        </div>
      ),
    },
  ];

  const bucketColumns: Column<VarianceBucket>[] = [
    {
      key: 'label',
      header: t('ownership.reconcile.bucket.label', 'Discrepancy category'),
      render: (row) => <Text as="span" variant="label">{row.label}</Text>,
    },
    {
      key: 'lines',
      header: t('ownership.reconcile.bucket.lines', 'Lines'),
      align: 'right',
      render: (row) => <span className="tabular-nums">{fmtInt(row.line_count)}</span>,
    },
    {
      key: 'amount',
      header: t('ownership.reconcile.bucket.amount', 'Amount'),
      align: 'right',
      render: (row) => (
        <span className={cn('tabular-nums', row.amount_minor > 0 && severityTokens.critical.fg)}>
          {money(row.amount_minor)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'share',
      header: t('ownership.reconcile.bucket.share', 'Share of variance'),
      align: 'right',
      render: (row) => (
        <div className="min-w-28">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className={cn('h-full rounded-full', severityTokens.warn.dot)}
              style={{ width: `${Math.min(100, Math.max(0, row.share_pct))}%` }}
            />
          </div>
          <Text as="span" variant="caption" className="tabular-nums">
            {formatPct(row.share_pct)}
          </Text>
        </div>
      ),
    },
    {
      key: 'recoverable',
      header: t('ownership.reconcile.bucket.recoverable', 'Recoverable'),
      render: (row) => (
        <VerdictBadge
          value={row.recoverable ? 'keep' : 'unknown'}
          label={
            row.recoverable
              ? t('ownership.reconcile.bucket.yes', 'Disputable')
              : t('ownership.reconcile.bucket.no', 'Explained')
          }
        />
      ),
    },
  ];

  const uninvoicedColumns: Column<UninvoicedSession>[] = [
    {
      key: 'session',
      filterValue: (row) => row.session_id,
      filterValueLabel: (_value, row) => `#${row.session_id}`,
      header: t('ownership.reconcile.uninvoiced.session', 'Session'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            #{row.session_id}
          </Text>
          <Text as="p" variant="caption">
            {formatDateTime(row.started_at)}
          </Text>
        </div>
      ),
    },
    {
      key: 'location',
      filterValue: (row) => row.location || null,
      header: t('ownership.reconcile.uninvoiced.location', 'Location'),
      render: (row) => row.location || '—',
    },
    {
      key: 'energy',
      header: t('ownership.reconcile.uninvoiced.energy', 'Measured energy'),
      align: 'right',
      filterValue: (row) => row.energy_wh,
      filterValueLabel: (_value, row) => units.formatEnergy(row.energy_wh),
      render: (row) => <span className="tabular-nums">{units.formatEnergy(row.energy_wh)}</span>,
      sortable: true,
    },
    {
      key: 'narrative',
      header: t('ownership.reconcile.uninvoiced.narrative', 'Why it matters'),
      render: (row) => (
        <Text as="span" variant="caption">
          {row.narrative}
        </Text>
      ),
    },
  ];

  return (
    <PageLayout
      title={t('ownership.reconcile.title', 'Charging invoice reconciliation')}
      subtitle={t(
        'ownership.reconcile.subtitle',
        'Match every billed line against the session your car actually recorded, attribute the variance to a cause, and assemble a dispute packet you can send to the provider.',
      )}
      query={[invoicesQuery, reportQuery]}
    >
      <AlertBanner
        variant="info"
        title={t('ownership.reconcile.notice.title', 'Your telemetry is the reference')}
      >
        {t(
          'ownership.reconcile.notice.body',
          'Lines are matched on start time and delivered energy, then scored. A line only becomes disputable when the measured session disagrees beyond tolerance — never merely because it was unmatched.',
        )}
      </AlertBanner>
      {activeTarget != null && activeTarget.vehicleId !== vehicleId && (
        <AlertBanner variant="warning">{contextMessage(`#${activeTarget.vehicleId} / #${activeTarget.id}`)}</AlertBanner>
      )}

      <FadeIn>
        <OwnershipPanel
          title={t('ownership.reconcile.invoices.title', 'Provider statements')}
          source={invoicesQuery}
          sourceEnabled={vehicleId != null}
          editing={importOpen}
          description={t(
            'ownership.reconcile.invoices.subtitle',
            'Import a statement, then pick one to audit line by line.',
          )}
          empty={invoices.length === 0 && !importOpen}
          emptyMessage={t(
            'ownership.reconcile.invoices.empty',
            'No statements imported yet for this vehicle.',
          )}
          actions={
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
              wrapLabel
              icon={<Icon icon={Receipt} />}
              aria-expanded={importOpen}
              aria-controls={importOpen ? importEditorId : undefined}
              onClick={() => {
                importActivation.current += 1;
                if (!importOpen && importVehicleId == null) setImportVehicleId(vehicleId);
                setImportOpen((open) => !open);
              }}
            >
              {importOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.reconcile.invoices.import', 'Import statement')}
            </Button>
          }
        >
          {importOpen ? (
            <form id={importEditorId} className="mb-6 space-y-5" onSubmit={submitInvoice}>
              {importVehicleId !== vehicleId && <AlertBanner variant="warning">
                {contextMessage(`#${importVehicleId}`)}
              </AlertBanner>}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Input
                  label={t('ownership.reconcile.form.provider', 'Provider')}
                  value={draft.provider}
                  required
                  maxLength={160}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, provider: event.target.value }))
                  }
                />
                <Input
                  label={t('ownership.reconcile.form.ref', 'Invoice reference')}
                  value={draft.invoice_ref}
                  required
                  maxLength={160}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, invoice_ref: event.target.value }))
                  }
                />
                <Input
                  label={t('ownership.form.currency', 'ISO currency code')}
                  value={draft.currency}
                  minLength={3}
                  maxLength={3}
                  required
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                />
                <Input
                  type="date"
                  label={t('ownership.reconcile.form.periodStart', 'Period start')}
                  value={toDateInput(draft.period_start)}
                  required
                  max={toDateInput(draft.period_end) || undefined}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      period_start: event.target.value ? `${event.target.value}T00:00:00.000Z` : '',
                    }))
                  }
                />
                <Input
                  type="date"
                  label={t('ownership.reconcile.form.periodEnd', 'Period end')}
                  value={toDateInput(draft.period_end)}
                  required
                  min={toDateInput(draft.period_start) || undefined}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      period_end: event.target.value ? `${event.target.value}T00:00:00.000Z` : '',
                    }))
                  }
                />
                <MoneyInput
                  label={t('ownership.reconcile.form.total', 'Statement total')}
                  value={draft.billed_total_minor}
                  currency={draft.currency}
                  locale={units.unitPrefs.locale}
                  required
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, billed_total_minor: value }))
                  }
                />
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Text as="h3" variant="label">
                    {t('ownership.reconcile.form.lines', 'Statement lines')}
                  </Text>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
                    wrapLabel
                    onClick={() =>
                      setDraft((current) => ({ ...current, lines: [...current.lines, blankLine()] }))
                    }
                  >
                    {t('ownership.reconcile.form.addLine', 'Add line')}
                  </Button>
                </div>
                {draft.lines.map((line, index) => (
                  <div
                    key={index}
                    className="grid gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3 md:grid-cols-2 xl:grid-cols-5"
                  >
                    <Input
                      label={t('ownership.reconcile.form.lineRef', 'Line reference')}
                      value={line.line_ref}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, line_ref: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                    <Input
                      type="datetime-local"
                      label={t('ownership.reconcile.form.lineWhen', 'Occurred at')}
                      value={isoUtcToLocalDatetimeInput(line.occurred_at)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  // Cleared/invalid input keeps the previous instant (never throws).
                                  occurred_at: localDatetimeInputToIso(event.target.value) ?? item.occurred_at,
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                    <Input
                      label={t('ownership.reconcile.form.lineLocation', 'Location')}
                      value={line.location}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, location: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                    <Input
                      type="number"
                      label={t('ownership.reconcile.form.lineEnergy', 'Billed energy (Wh)')}
                      value={line.billed_energy_wh}
                      min={0}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, billed_energy_wh: Number(event.target.value) }
                              : item,
                          ),
                        }))
                      }
                    />
                    <MoneyInput
                      label={t('ownership.reconcile.form.lineTotal', 'Line total')}
                      value={line.billed_total_minor}
                      currency={draft.currency}
                      locale={units.unitPrefs.locale}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  billed_total_minor: value ?? 0,
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>

              {allocationUnsupported && <AlertBanner
                variant="warning"
                title={t('ownership.unsupported.title', 'Explicitly not computed')}
              >
                <Text variant="code">billed_energy_minor / billed_idle_minor / billed_tax_minor</Text>
              </AlertBanner>}
              <Button type="submit" className="min-h-11 md:min-h-0" wrapLabel loading={create.isPending} disabled={allocationUnsupported || vehicleId == null || importVehicleId !== vehicleId}>
                {t('ownership.reconcile.form.save', 'Import and reconcile')}
              </Button>
              <MutationError error={create.error} />
            </form>
          ) : null}

          <DataTable
            variant="embedded"
            name={t('ownership.reconcile.invoices.title', 'Provider statements')}
            columns={invoiceColumns}
            rowLabel={(row) => row.invoice_ref}
            mobilePresentation={{
              roles: { ref: 'title', total: 'primary', period: 'meta', lines: 'meta' },
              displayValue: (row, key) => {
                switch (key) {
                  case 'ref': return `${row.invoice_ref} · ${row.provider}`;
                  case 'total': return formatCurrencyMinor(row.billed_total_minor, row.currency, units.unitPrefs.locale);
                  case 'period': return `${formatDateTime(row.period_start)} → ${formatDateTime(row.period_end)}`;
                  case 'lines': return fmtInt(row.line_count);
                  default: return null;
                }
              },
              inlineActions: (row) => invoiceColumns.find((column) => column.key === 'actions')?.render(row),
            }}
            data={invoices}
            keyExtractor={(row) => row.id}
            tableId="ownership-reconcile-invoices"
            exportable
            controls={{
              exports: {
                onExportCsv: () => exportInvoices('csv'),
                onExportJson: () => exportInvoices('json'),
                disabled: invoices.length === 0,
                description: t(
                  'ownership.reconcile.invoices.exportScope',
                  'Exports include all loaded statements, not the server total, with original fields and ISO currency minor amounts, regardless of table search or visible columns.',
                ),
              },
            }}
            emptyMessage={t('ownership.reconcile.invoices.empty', 'No statements imported yet for this vehicle.')}
          />
          {invoicesQuery.data != null && invoicesQuery.data.limit > 0
            && Number.isSafeInteger(invoicesQuery.data.total) && (
            <div className="mt-4 space-y-3">
              <Text variant="caption">
                {t('table.filter.loadedRowCount', '{{filtered}} matching / {{loaded}} loaded rows', {
                  filtered: fmtInt(invoices.length), loaded: fmtInt(invoices.length),
                })}
              </Text>
              <Pagination
                page={Math.floor(invoicesQuery.data.offset / invoicesQuery.data.limit) + 1}
                pageSize={invoicesQuery.data.limit}
                total={invoicesQuery.data.total}
                onPageChange={(page) => setRegisterPage({
                  vehicleId, offset: (page - 1) * invoicesQuery.data!.limit,
                })}
              />
            </div>
          )}
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.reconcile.audit.title', 'Reconciliation result')}
          source={reportQuery}
          sourceEnabled={activeInvoice != null}
          description={varianceDescription}
          empty={!report}
          preserveSummary
          emptyMessage={t(
            'ownership.reconcile.audit.empty',
            'Select a statement above to run the audit.',
          )}
        >
          <OwnershipBrief
            title={t('ownership.reconcile.brief.title', 'Statement amounts and variance')}
            description={varianceDescription}
            scope={t('ownership.reconcile.brief.scope', 'Selected statement and matched telemetry; amounts retain the statement currency')}
            source={reportQuery} enabled={activeInvoice != null}
            window={report ? { from: report.invoice.period_start, to: report.invoice.period_end } : undefined}
            metrics={[
              {
                occurrenceId: 'billed', metricId: 'currency',
                label: t('ownership.reconcile.stat.billed', 'Billed total'),
                rawValue: report?.billed_total_minor,
                display: specialistDisplay(money),
              },
              {
                occurrenceId: 'expected', metricId: 'currency',
                label: t('ownership.reconcile.stat.expected', 'Expected from telemetry'),
                rawValue: report?.expected_total_minor,
                display: specialistDisplay(money),
              },
              {
                occurrenceId: 'variance', metricId: 'currency',
                label: t('ownership.reconcile.stat.variance', 'Net variance'),
                rawValue: report?.net_variance_minor,
                display: specialistDisplay(money),
                tone: (report?.net_variance_minor ?? 0) > 0 ? 'critical' : 'positive',
              },
              {
                occurrenceId: 'recoverable', metricId: 'currency',
                label: t('ownership.reconcile.stat.recoverable', 'Disputable amount'),
                rawValue: report?.recoverable_minor,
                display: specialistDisplay(money),
                tone: (report?.recoverable_minor ?? 0) > 0 ? 'warning' : 'default',
              },
            ]}
          />
          <div className="mt-3">
            <OwnershipBrief
              title={t('ownership.reconcile.energyBrief.title', 'Statement matching and energy')}
              description={t('ownership.reconcile.energyBrief.description', 'Matched and unmatched lines remain separate; measured energy is retained beside the energy variance.')}
              scope={t('ownership.reconcile.brief.scope', 'Selected statement and matched telemetry; amounts retain the statement currency')}
              source={reportQuery} enabled={activeInvoice != null}
              window={report ? { from: report.invoice.period_start, to: report.invoice.period_end } : undefined}
              metrics={[
                {
                  occurrenceId: 'matched', metricId: 'count',
                  label: t('ownership.reconcile.stat.matched', 'Matched lines'),
                  rawValue: report?.matched_line_count,
                  display: specialistDisplay(fmtInt),
                  tone: 'positive',
                },
                {
                  occurrenceId: 'unmatched', metricId: 'count',
                  label: t('ownership.reconcile.stat.unmatched', 'Unmatched lines'),
                  rawValue: report?.unmatched_line_count,
                  display: specialistDisplay(fmtInt),
                  tone: (report?.unmatched_line_count ?? 0) > 0 ? 'warning' : 'default',
                },
                {
                  occurrenceId: 'billedEnergy', metricId: 'energy',
                  label: t('ownership.reconcile.stat.billedEnergy', 'Billed energy'),
                  rawValue: report?.billed_energy_wh,
                  display: specialistDisplay(units.formatEnergy),
                },
                {
                  occurrenceId: 'energyVariance', metricId: 'energy',
                  label: t('ownership.reconcile.stat.energyVariance', 'Energy variance'),
                  rawValue: report?.energy_variance_wh,
                  display: specialistDisplay(units.formatEnergy),
                  context: report?.measured_energy_wh == null ? '—' : units.formatEnergy(report.measured_energy_wh),
                },
              ]}
            />
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.reconcile.lines.title', 'Line-by-line audit')}
          source={reportQuery}
          sourceEnabled={activeInvoice != null}
          empty={lines.length === 0}
          emptyMessage={t(
            'ownership.reconcile.lines.empty',
            'This statement has no lines to reconcile.',
          )}
        >
          <DataTable
            variant="embedded"
            name={t('ownership.reconcile.lines.title', 'Line-by-line audit')}
            columns={lineColumns}
            enableValueFilters
            rowLabel={(row) => row.line.line_ref || t('ownership.reconcile.line.unnamed', 'Unnamed line')}
            mobilePresentation={{
              roles: { ref: 'title', variance: 'primary', billedEnergy: 'meta', measuredEnergy: 'meta' },
              displayValue: (row, key) => {
                switch (key) {
                  case 'ref': return row.line.line_ref || t('ownership.reconcile.line.unnamed', 'Unnamed line');
                  case 'variance': return money(row.variance_minor);
                  case 'billedEnergy': return units.formatEnergy(row.line.billed_energy_wh);
                  case 'measuredEnergy': return row.measured_energy_wh == null ? null : units.formatEnergy(row.measured_energy_wh);
                  default: return null;
                }
              },
            }}
            data={lines}
            keyExtractor={(row) => row.line.id || row.line.line_ref}
            tableId="ownership-reconcile-lines"
            exportable
            exportFilename="charging-reconciliation-lines"
            onExport={(format, rows) => exportSourceRows(format, 'charging-reconciliation-lines', rows.map((row) => ({
              line_ref: row.line.line_ref,
              location: row.line.location,
              occurred_at: row.line.occurred_at,
              match_state: row.match_state,
              match_confidence_pct: row.match_confidence_pct,
              billed_energy_wh: row.line.billed_energy_wh,
              measured_energy_wh: row.measured_energy_wh,
              energy_delta_pct: row.energy_delta_pct,
              time_delta_s: row.time_delta_s,
              billed_total_minor: row.line.billed_total_minor,
              expected_cost_minor: row.expected_cost_minor,
              variance_minor: row.variance_minor,
              recoverable: row.recoverable,
              variance_reasons: row.variance_reasons,
              ...exportContext,
              session_id: row.session_id,
              session_started_at: row.session_started_at,
              energy_delta_wh: row.energy_delta_wh,
              ambiguous: row.ambiguous,
            })))}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.reconcile.buckets.title', 'Variance attribution')}
          source={reportQuery}
          sourceEnabled={activeInvoice != null}
          description={t(
            'ownership.reconcile.buckets.subtitle',
            'Every currency unit of disagreement is assigned a cause, so a dispute never rests on "the number looks wrong".',
          )}
          empty={buckets.length === 0}
          emptyMessage={t(
            'ownership.reconcile.buckets.empty',
            'No material variance was attributed on this statement.',
          )}
          actions={<Icon icon={FileWarning} className={severityTokens.warn.fg} />}
        >
          <DataTable
            variant="embedded"
            name={t('ownership.reconcile.buckets.title', 'Variance attribution')}
            columns={bucketColumns}
            rowLabel={(row) => row.label}
            mobilePresentation={{
              roles: { label: 'title', amount: 'primary', lines: 'meta', share: 'meta' },
              displayValue: (row, key) => {
                switch (key) {
                  case 'label': return row.label;
                  case 'amount': return money(row.amount_minor);
                  case 'lines': return fmtInt(row.line_count);
                  case 'share': return formatPct(row.share_pct);
                  default: return null;
                }
              },
            }}
            data={buckets}
            keyExtractor={(row) => row.reason}
            tableId="ownership-reconcile-buckets"
            exportable
            exportFilename="charging-variance-attribution"
            onExport={(format, rows) => exportSourceRows(format, 'charging-variance-attribution', rows.map((row) => ({
              category: row.label,
              reason: row.reason,
              line_count: row.line_count,
              amount_minor: row.amount_minor,
              share_pct: row.share_pct,
              recoverable: row.recoverable,
              ...exportContext,
            })))}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel
          title={t('ownership.reconcile.uninvoiced.title', 'Sessions the provider never billed')}
          source={reportQuery}
          sourceEnabled={activeInvoice != null}
          description={t(
            'ownership.reconcile.uninvoiced.subtitle',
            'Measured sessions inside the billing period with no matching line. Usually free or home charging — occasionally a statement that is genuinely incomplete.',
          )}
          empty={uninvoiced.length === 0}
          emptyMessage={t(
            'ownership.reconcile.uninvoiced.empty',
            'Every measured session in this period appears on the statement.',
          )}
        >
          <DataTable
            variant="embedded"
            name={t('ownership.reconcile.uninvoiced.title', 'Sessions the provider never billed')}
            columns={uninvoicedColumns}
            enableValueFilters
            rowLabel={(row) => `#${row.session_id}`}
            mobilePresentation={{
              roles: { session: 'title', energy: 'primary', location: 'meta' },
              displayValue: (row, key) => {
                switch (key) {
                  case 'session': return `#${row.session_id} · ${formatDateTime(row.started_at)}`;
                  case 'energy': return units.formatEnergy(row.energy_wh);
                  case 'location': return row.location || null;
                  default: return null;
                }
              },
            }}
            data={uninvoiced}
            keyExtractor={(row) => row.session_id}
            tableId="ownership-reconcile-uninvoiced"
            exportable
            exportFilename="charging-uninvoiced-sessions"
            onExport={(format, rows) => exportSourceRows(format, 'charging-uninvoiced-sessions', rows.map((row) => ({
              session_id: row.session_id,
              started_at: row.started_at,
              location: row.location,
              energy_wh: row.energy_wh,
              narrative: row.narrative,
              ...exportContext,
            })))}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <OwnershipPanel
          title={t('ownership.reconcile.dispute.title', 'Dispute desk')}
          source={reportQuery}
          sourceEnabled={activeInvoice != null}
          editing={disputeOpen}
          description={t(
            'ownership.reconcile.dispute.subtitle',
            'The packet digest fixes exactly which lines and measurements your claim rests on.',
          )}
          empty={!report}
          emptyMessage={t(
            'ownership.reconcile.dispute.empty',
            'Audit a statement before opening a dispute.',
          )}
          actions={
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
              wrapLabel
              icon={<Icon icon={Gavel} />}
              aria-expanded={disputeOpen}
              aria-controls={disputeOpen ? disputeEditorId : undefined}
              disabled={!reportCurrent && !disputeOpen}
              onClick={() => {
                disputeActivation.current += 1;
                if (!disputeOpen && disputeTarget == null && report != null) {
                  setDisputeTarget({
                    id: report.invoice.id, vehicleId: report.invoice.vehicle_id,
                    currency: report.invoice.currency, version: report.invoice.version,
                    digest: report.dispute_packet_digest,
                  });
                  setDispute({
                    claimed_minor: report.recoverable_minor, note: '',
                    reasons: buckets.filter((b) => b.recoverable).map((b) => b.reason),
                  });
                }
                setDisputeOpen((open) => !open);
              }}
            >
              {disputeOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.reconcile.dispute.open', 'Open dispute')}
            </Button>
          }
        >
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-4">
            <Text as="p" variant="caption">
              {t('ownership.reconcile.dispute.digest', 'Dispute packet digest')}
            </Text>
            <Text as="p" variant="code" className="mt-1 break-all">
              {report?.dispute_packet_digest || '—'}
            </Text>
          </div>

          {disputeOpen ? (
            <form id={disputeEditorId} className="mt-4 space-y-4" onSubmit={submitDispute}>
              {!disputeCurrent && <AlertBanner variant="warning">
                {contextMessage(`#${disputeTarget?.vehicleId} / #${disputeTarget?.id} / ${disputeTarget?.currency} / ${disputeTarget?.version} / ${disputeTarget?.digest}`)}
              </AlertBanner>}
              <div className="grid gap-4 md:grid-cols-2">
                <MoneyInput
                  label={t('ownership.reconcile.dispute.claimed', 'Amount claimed')}
                  value={dispute.claimed_minor}
                  currency={disputeTarget?.currency ?? currency}
                  locale={units.unitPrefs.locale}
                  required
                  onChange={(value) =>
                    setDispute((current) => ({ ...current, claimed_minor: value }))
                  }
                />
                <div className="flex flex-wrap items-end gap-1">
                  {dispute.reasons.map((reason) => (
                    <Badge key={reason} variant="warning">
                      {reason.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                  {dispute.reasons.length === 0 ? (
                    <Text as="span" variant="caption">
                      {t('ownership.reconcile.dispute.noReasons', 'No recoverable category found')}
                    </Text>
                  ) : null}
                </div>
              </div>
              <Textarea
                label={t('ownership.reconcile.dispute.note', 'Note to the provider')}
                value={dispute.note}
                rows={3}
                onChange={(event) =>
                  setDispute((current) => ({ ...current, note: event.target.value }))
                }
              />
              <Button type="submit" className="min-h-11 md:min-h-0" wrapLabel loading={openDispute.isPending} disabled={!disputeCurrent}>
                {t('ownership.reconcile.dispute.submit', 'Record dispute')}
              </Button>
              <MutationError error={openDispute.error} />
            </form>
          ) : null}

          <div className="mt-4 space-y-2">
            {(report?.disputes ?? []).map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3"
              >
                <div>
                  <Text as="p" variant="label">
                    {money(item.claimed_minor)} ·{' '}
                    {t('ownership.reconcile.dispute.recovered', 'recovered {{value}}', {
                      value: money(item.recovered_minor),
                    })}
                  </Text>
                  <Text as="p" variant="caption">
                    {formatDateTime(item.opened_at)} · {item.note || '—'}
                  </Text>
                </div>
                <VerdictBadge value={item.status} />
              </div>
            ))}
            {(report?.disputes ?? []).length === 0 && report ? (
              <Text as="p" variant="caption">
                {t('ownership.reconcile.dispute.none', 'No disputes recorded on this statement.')}
              </Text>
            ) : null}
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <EvidencePanel
          source={reportQuery}
          sourceEnabled={activeInvoice != null}
          quality={report?.quality}
          evidence={report?.evidence}
          unsupported={[
            t(
              'ownership.reconcile.unsupported.submit',
              'Submitting the dispute to the provider — the packet is prepared, not sent',
            ),
            t(
              'ownership.reconcile.unsupported.tax',
              'Tax and idle-fee legality, which vary by site contract',
            ),
          ]}
        />
      </FadeIn>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageLayout>
  );
}
