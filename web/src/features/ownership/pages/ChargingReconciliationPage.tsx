import { type FormEvent, useMemo, useState } from 'react';
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
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, DataTable, Input, Text, Textarea } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
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
  StatGrid,
  VerdictBadge,
} from '../components';
import { formatCurrencyMinor, formatPct, formatSpan, fromDateInput, toDateInput } from '../formatters';

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

export default function ChargingReconciliationPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [activeInvoice, setActiveInvoice] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [draft, setDraft] = useState({
    provider: '',
    invoice_ref: '',
    currency: 'USD',
    period_start: new Date(Date.now() - 30 * 86400000).toISOString(),
    period_end: new Date().toISOString(),
    billed_total_minor: 0,
    lines: [blankLine()],
  });
  const [dispute, setDispute] = useState({ claimed_minor: 0, note: '', reasons: [] as string[] });

  usePageTitle(t('ownership.reconcile.title', 'Charging Invoice Reconciliation'));

  const invoicesQuery = useChargingInvoices(vehicleId, 50, 0);
  const reportQuery = useReconciliationReport(activeInvoice);
  const create = useCreateInvoice();
  const remove = useDeleteInvoice();
  const openDispute = useCreateDispute(activeInvoice);

  const invoices = useMemo(() => invoicesQuery.data?.items ?? [], [invoicesQuery.data?.items]);
  const report = reportQuery.data;
  const currency = report?.invoice.currency ?? draft.currency;
  const money = (minor: number | null | undefined) =>
    formatCurrencyMinor(minor, currency, units.unitPrefs.locale);

  const lines = useMemo(() => report?.lines ?? [], [report?.lines]);
  const buckets = useMemo(() => report?.variance_buckets ?? [], [report?.variance_buckets]);
  const uninvoiced = useMemo(
    () => report?.uninvoiced_sessions ?? [],
    [report?.uninvoiced_sessions],
  );

  const submitInvoice = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    create.mutate(
      { ...draft, vehicle_id: vehicleId },
      {
        onSuccess: (created) => {
          setImportOpen(false);
          setActiveInvoice(created.id);
          setDraft((current) => ({ ...current, invoice_ref: '', lines: [blankLine()] }));
        },
      },
    );
  };

  const submitDispute = (event: FormEvent) => {
    event.preventDefault();
    if (activeInvoice == null) return;
    openDispute.mutate(
      {
        claimed_minor: dispute.claimed_minor,
        note: dispute.note,
        reasons: dispute.reasons,
        confirmed: true,
      },
      { onSuccess: () => setDisputeOpen(false) },
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
      render: (row) => <span className="tabular-nums">{fmtNumber(row.line_count, 0)}</span>,
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
        <div className="flex gap-2">
          <Button
            variant={activeInvoice === row.id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setActiveInvoice(row.id)}
          >
            {t('ownership.reconcile.invoice.audit', 'Audit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => {
              if (activeInvoice === row.id) setActiveInvoice(null);
              remove.mutate(row.id);
            }}
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
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.line.line_ref || t('ownership.reconcile.line.unnamed', 'Unnamed line')}
          </Text>
          <Text as="p" variant="caption">
            {row.line.location || '—'} · {formatDateTime(row.line.occurred_at)}
          </Text>
        </div>
      ),
    },
    {
      key: 'match',
      header: t('ownership.reconcile.line.match', 'Match'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <VerdictBadge value={row.match_state} />
          <span className="tabular-nums text-xs text-[var(--text-muted)]">
            {formatPct(row.match_confidence_pct, 0)}
          </span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'billedEnergy',
      header: t('ownership.reconcile.line.billedEnergy', 'Billed energy'),
      render: (row) => (
        <span className="tabular-nums">{units.formatEnergy(row.line.billed_energy_wh)}</span>
      ),
    },
    {
      key: 'measuredEnergy',
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
      header: t('ownership.reconcile.line.energyDelta', 'Energy Δ'),
      render: (row) =>
        row.energy_delta_pct != null ? (
          <span
            className={`tabular-nums ${Math.abs(row.energy_delta_pct) > 5 ? 'text-amber-300' : ''}`}
          >
            {formatPct(row.energy_delta_pct)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'timeDelta',
      header: t('ownership.reconcile.line.timeDelta', 'Time Δ'),
      render: (row) => (row.time_delta_s != null ? formatSpan(row.time_delta_s) : '—'),
    },
    {
      key: 'billed',
      header: t('ownership.reconcile.line.billed', 'Billed'),
      render: (row) => <span className="tabular-nums">{money(row.line.billed_total_minor)}</span>,
    },
    {
      key: 'expected',
      header: t('ownership.reconcile.line.expected', 'Expected'),
      render: (row) => <span className="tabular-nums">{money(row.expected_cost_minor)}</span>,
    },
    {
      key: 'variance',
      header: t('ownership.reconcile.line.variance', 'Variance'),
      render: (row) => (
        <span
          className={`tabular-nums ${row.variance_minor > 0 ? 'text-rose-300' : row.variance_minor < 0 ? 'text-emerald-300' : ''}`}
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
      render: (row) => <span className="tabular-nums">{fmtNumber(row.line_count, 0)}</span>,
    },
    {
      key: 'amount',
      header: t('ownership.reconcile.bucket.amount', 'Amount'),
      render: (row) => (
        <span className={`tabular-nums ${row.amount_minor > 0 ? 'text-rose-300' : ''}`}>
          {money(row.amount_minor)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'share',
      header: t('ownership.reconcile.bucket.share', 'Share of variance'),
      render: (row) => (
        <div className="min-w-[7rem]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-amber-400/70"
              style={{ width: `${Math.min(100, Math.max(0, row.share_pct))}%` }}
            />
          </div>
          <span className="tabular-nums text-xs text-[var(--text-muted)]">
            {formatPct(row.share_pct)}
          </span>
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
      header: t('ownership.reconcile.uninvoiced.location', 'Location'),
      render: (row) => row.location || '—',
    },
    {
      key: 'energy',
      header: t('ownership.reconcile.uninvoiced.energy', 'Measured energy'),
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
    <PageContainer
      title={t('ownership.reconcile.title', 'Charging Invoice Reconciliation')}
      subtitle={t(
        'ownership.reconcile.subtitle',
        'Match every billed line against the session your car actually recorded, attribute the variance to a cause, and assemble a dispute packet you can send to the provider.',
      )}
      loading={invoicesQuery.isLoading}
      error={invoicesQuery.error as Error | null}
      actions={<VehicleSelect withIcon />}
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

      <FadeIn>
        <OwnershipPanel
          title={t('ownership.reconcile.invoices.title', 'Provider statements')}
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
              icon={<Receipt className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setImportOpen((open) => !open)}
            >
              {importOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.reconcile.invoices.import', 'Import statement')}
            </Button>
          }
        >
          {importOpen ? (
            <form className="mb-6 space-y-5" onSubmit={submitInvoice}>
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
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      period_start: fromDateInput(event.target.value),
                    }))
                  }
                />
                <Input
                  type="date"
                  label={t('ownership.reconcile.form.periodEnd', 'Period end')}
                  value={toDateInput(draft.period_end)}
                  required
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      period_end: fromDateInput(event.target.value),
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
                    setDraft((current) => ({ ...current, billed_total_minor: value ?? 0 }))
                  }
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text as="h3" variant="label">
                    {t('ownership.reconcile.form.lines', 'Statement lines')}
                  </Text>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
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
                    className="grid gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 md:grid-cols-2 xl:grid-cols-5"
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
                      value={line.occurred_at.slice(0, 16)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          lines: current.lines.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  occurred_at: new Date(event.target.value).toISOString(),
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
                                  billed_energy_minor: value ?? 0,
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>

              <Button type="submit" loading={create.isPending} disabled={vehicleId == null}>
                {t('ownership.reconcile.form.save', 'Import and reconcile')}
              </Button>
              <MutationError error={create.error} />
            </form>
          ) : null}

          <DataTable
            columns={invoiceColumns}
            data={invoices}
            keyExtractor={(row) => row.id}
            tableId="ownership-reconcile-invoices"
            exportable
            exportFilename="charging-invoices"
            exportRow={(row) => ({
              invoice_ref: row.invoice_ref,
              provider: row.provider,
              period_start: row.period_start,
              period_end: row.period_end,
              billed_total_minor: row.billed_total_minor,
              currency: row.currency,
              line_count: row.line_count,
              status: row.status,
            })}
            emptyMessage={t('ownership.reconcile.invoices.empty', 'No statements imported yet for this vehicle.')}
          />
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.reconcile.audit.title', 'Reconciliation result')}
          description={t(
            'ownership.reconcile.audit.subtitle',
            'Net variance is what the provider owes you (positive) or what you under-paid (negative).',
          )}
          empty={!report}
          emptyMessage={t(
            'ownership.reconcile.audit.empty',
            'Select a statement above to run the audit.',
          )}
        >
          <StatGrid
            stats={[
              {
                key: 'billed',
                label: t('ownership.reconcile.stat.billed', 'Billed total'),
                value: money(report?.billed_total_minor),
              },
              {
                key: 'expected',
                label: t('ownership.reconcile.stat.expected', 'Expected from telemetry'),
                value: money(report?.expected_total_minor),
              },
              {
                key: 'variance',
                label: t('ownership.reconcile.stat.variance', 'Net variance'),
                value: money(report?.net_variance_minor),
                tone: (report?.net_variance_minor ?? 0) > 0 ? 'critical' : 'positive',
              },
              {
                key: 'recoverable',
                label: t('ownership.reconcile.stat.recoverable', 'Disputable amount'),
                value: money(report?.recoverable_minor),
                tone: (report?.recoverable_minor ?? 0) > 0 ? 'warning' : 'default',
              },
            ]}
          />
          <div className="mt-3">
            <StatGrid
              columns={4}
              stats={[
                {
                  key: 'matched',
                  label: t('ownership.reconcile.stat.matched', 'Matched lines'),
                  value: fmtNumber(report?.matched_line_count ?? 0, 0),
                  tone: 'positive',
                },
                {
                  key: 'unmatched',
                  label: t('ownership.reconcile.stat.unmatched', 'Unmatched lines'),
                  value: fmtNumber(report?.unmatched_line_count ?? 0, 0),
                  tone: (report?.unmatched_line_count ?? 0) > 0 ? 'warning' : 'default',
                },
                {
                  key: 'billedEnergy',
                  label: t('ownership.reconcile.stat.billedEnergy', 'Billed energy'),
                  value: units.formatEnergy(report?.billed_energy_wh ?? 0),
                },
                {
                  key: 'energyVariance',
                  label: t('ownership.reconcile.stat.energyVariance', 'Energy variance'),
                  value: units.formatEnergy(report?.energy_variance_wh ?? 0),
                  hint: units.formatEnergy(report?.measured_energy_wh ?? 0),
                },
              ]}
            />
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.reconcile.lines.title', 'Line-by-line audit')}
          empty={lines.length === 0}
          emptyMessage={t(
            'ownership.reconcile.lines.empty',
            'This statement has no lines to reconcile.',
          )}
        >
          <DataTable
            columns={lineColumns}
            data={lines}
            keyExtractor={(row) => row.line.id || row.line.line_ref}
            tableId="ownership-reconcile-lines"
            exportable
            exportFilename="charging-reconciliation-lines"
            exportRow={(row) => ({
              line_ref: row.line.line_ref,
              location: row.line.location ?? '',
              occurred_at: row.line.occurred_at,
              match_state: row.match_state,
              match_confidence_pct: row.match_confidence_pct,
              billed_energy_wh: row.line.billed_energy_wh,
              measured_energy_wh: row.measured_energy_wh ?? '',
              energy_delta_pct: row.energy_delta_pct ?? '',
              time_delta_s: row.time_delta_s ?? '',
              billed_total_minor: row.line.billed_total_minor,
              expected_cost_minor: row.expected_cost_minor,
              variance_minor: row.variance_minor,
              recoverable: row.recoverable,
              variance_reasons: (row.variance_reasons ?? []).join(' '),
            })}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.reconcile.buckets.title', 'Variance attribution')}
          description={t(
            'ownership.reconcile.buckets.subtitle',
            'Every currency unit of disagreement is assigned a cause, so a dispute never rests on "the number looks wrong".',
          )}
          empty={buckets.length === 0}
          emptyMessage={t(
            'ownership.reconcile.buckets.empty',
            'No material variance was attributed on this statement.',
          )}
          actions={<FileWarning className="h-4 w-4 text-amber-300" aria-hidden="true" />}
        >
          <DataTable
            columns={bucketColumns}
            data={buckets}
            keyExtractor={(row) => row.reason}
            tableId="ownership-reconcile-buckets"
            exportable
            exportFilename="charging-variance-attribution"
            exportRow={(row) => ({
              category: row.label,
              reason: row.reason,
              line_count: row.line_count,
              amount_minor: row.amount_minor,
              share_pct: row.share_pct,
              recoverable: row.recoverable,
            })}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel
          title={t('ownership.reconcile.uninvoiced.title', 'Sessions the provider never billed')}
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
            columns={uninvoicedColumns}
            data={uninvoiced}
            keyExtractor={(row) => row.session_id}
            tableId="ownership-reconcile-uninvoiced"
            exportable
            exportFilename="charging-uninvoiced-sessions"
            exportRow={(row) => ({
              session_id: row.session_id,
              started_at: row.started_at,
              location: row.location ?? '',
              energy_wh: row.energy_wh,
              narrative: row.narrative,
            })}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <OwnershipPanel
          title={t('ownership.reconcile.dispute.title', 'Dispute desk')}
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
              icon={<Gavel className="h-4 w-4" aria-hidden="true" />}
              disabled={!report}
              onClick={() => {
                setDispute((current) => ({
                  ...current,
                  claimed_minor: report?.recoverable_minor ?? 0,
                  reasons: buckets.filter((b) => b.recoverable).map((b) => b.reason),
                }));
                setDisputeOpen((open) => !open);
              }}
            >
              {disputeOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.reconcile.dispute.open', 'Open dispute')}
            </Button>
          }
        >
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
            <Text as="p" variant="caption">
              {t('ownership.reconcile.dispute.digest', 'Dispute packet digest')}
            </Text>
            <p className="mt-1 break-all font-mono text-sm text-cyan-300">
              {report?.dispute_packet_digest || '—'}
            </p>
          </div>

          {disputeOpen ? (
            <form className="mt-4 space-y-4" onSubmit={submitDispute}>
              <div className="grid gap-4 md:grid-cols-2">
                <MoneyInput
                  label={t('ownership.reconcile.dispute.claimed', 'Amount claimed')}
                  value={dispute.claimed_minor}
                  currency={currency}
                  locale={units.unitPrefs.locale}
                  required
                  onChange={(value) =>
                    setDispute((current) => ({ ...current, claimed_minor: value ?? 0 }))
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
              <Button type="submit" loading={openDispute.isPending}>
                {t('ownership.reconcile.dispute.submit', 'Record dispute')}
              </Button>
              <MutationError error={openDispute.error} />
            </form>
          ) : null}

          <div className="mt-4 space-y-2">
            {(report?.disputes ?? []).map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3"
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
    </PageContainer>
  );
}
