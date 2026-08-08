import { type FormEvent, useMemo, useState } from 'react';
import { CheckCircle2, FilePlus2, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  useCreateWarranty,
  useCreateWarrantyClaim,
  useDeleteWarranty,
  useWarranties,
  useWarrantyOverview,
} from '@/api/hooks/useOwnership';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, DataTable, Input, Select, Text, Textarea } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type {
  ClaimStatus,
  ReadinessCheck,
  Warranty,
  WarrantyClaim,
  WarrantyCoverage,
  WarrantyKind,
} from '@/types/ownership';
import {
  EvidencePanel,
  MoneyInput,
  MutationError,
  OwnershipPanel,
  SiNumberInput,
  StatGrid,
  VerdictBadge,
} from '../components';
import {
  daysToSeconds,
  formatCurrencyMinor,
  formatPct,
  formatSpan,
  fromDateInput,
  toDateInput,
} from '../formatters';

const KINDS: WarrantyKind[] = [
  'basic',
  'drivetrain',
  'battery',
  'corrosion',
  'tires',
  'aftermarket',
  'extended',
];

/** Mirrors the warranty_claims_status_check database constraint. */
const CLAIM_STATUSES: ClaimStatus[] = ['draft', 'submitted', 'approved', 'denied', 'closed'];

const CLAIM_STATUS_LABELS: Record<ClaimStatus, (t: TFunction) => string> = {
  draft: (t) => t('ownership.warranty.status.draft', 'Draft'),
  submitted: (t) => t('ownership.warranty.status.submitted', 'Submitted'),
  approved: (t) => t('ownership.warranty.status.approved', 'Approved'),
  denied: (t) => t('ownership.warranty.status.denied', 'Denied'),
  closed: (t) => t('ownership.warranty.status.closed', 'Closed'),
};

function severityTone(severity: string): 'danger' | 'warning' | 'neutral' {
  if (severity === 'critical') return 'danger';
  if (severity === 'high') return 'warning';
  return 'neutral';
}

function UsageBar({ label, pct, hint }: { label: string; pct: number; hint: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const tone = clamped >= 90 ? 'bg-rose-400/70' : clamped >= 70 ? 'bg-amber-400/70' : 'bg-cyan-400/70';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Text as="span" variant="caption">
          {label}
        </Text>
        <span className="tabular-nums text-xs text-[var(--text-secondary)]">
          {formatPct(clamped, 0)}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
      <Text as="p" variant="caption">
        {hint}
      </Text>
    </div>
  );
}

export default function WarrantyCommandPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [formOpen, setFormOpen] = useState(false);
  const [claimFor, setClaimFor] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    kind: 'basic' as WarrantyKind,
    label: '',
    provider: '',
    start_at: new Date().toISOString(),
    start_odometer_m: 0,
    term_days: 1460,
    term_distance_m: 80467,
    capacity_floor_pct: null as number | null,
    deductible_minor: 0,
    currency: 'USD',
    notes: '',
  });
  const [claimDraft, setClaimDraft] = useState({
    title: '',
    status: 'draft' as ClaimStatus,
    amount_minor: 0,
    evidence_note: '',
  });

  usePageTitle(t('ownership.warranty.navTitle', 'Warranty Command'));

  const overviewQuery = useWarrantyOverview(vehicleId);
  const warrantiesQuery = useWarranties(vehicleId);
  const create = useCreateWarranty();
  const remove = useDeleteWarranty();
  const createClaim = useCreateWarrantyClaim();

  const overview = overviewQuery.data;
  const coverages = useMemo(() => overview?.coverages ?? [], [overview?.coverages]);
  const warranties = useMemo(
    () => warrantiesQuery.data?.items ?? [],
    [warrantiesQuery.data?.items],
  );
  const currency = overview?.currency ?? draft.currency;

  const allChecks = useMemo(
    () =>
      coverages.flatMap((coverage) =>
        (coverage.readiness ?? []).map((check) => ({
          ...check,
          warrantyLabel: coverage.warranty.label,
        })),
      ),
    [coverages],
  );

  const allClaims = useMemo(
    () =>
      coverages.flatMap((coverage) =>
        (coverage.claims ?? []).map((claim) => ({
          ...claim,
          warrantyLabel: coverage.warranty.label,
        })),
      ),
    [coverages],
  );

  const submitWarranty = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    create.mutate(
      {
        vehicle_id: vehicleId,
        kind: draft.kind,
        label: draft.label,
        provider: draft.provider,
        start_at: draft.start_at,
        start_odometer_m: draft.start_odometer_m,
        term_s: daysToSeconds(draft.term_days),
        term_distance_m: draft.term_distance_m,
        capacity_floor_pct: draft.capacity_floor_pct,
        deductible_minor: draft.deductible_minor,
        currency: draft.currency,
        notes: draft.notes,
      },
      { onSuccess: () => setFormOpen(false) },
    );
  };

  const submitClaim = (event: FormEvent) => {
    event.preventDefault();
    if (claimFor == null) return;
    createClaim.mutate(
      { ...claimDraft, warranty_id: claimFor, confirmed: true },
      {
        onSuccess: () => {
          setClaimFor(null);
          setClaimDraft({ title: '', status: 'draft' as ClaimStatus, amount_minor: 0, evidence_note: '' });
        },
      },
    );
  };

  const checkColumns: Column<ReadinessCheck & { warrantyLabel: string }>[] = [
    {
      key: 'state',
      header: t('ownership.warranty.check.state', 'State'),
      render: (row) =>
        row.satisfied ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        ) : (
          <XCircle className="h-4 w-4 text-rose-300" aria-hidden="true" />
        ),
    },
    {
      key: 'label',
      header: t('ownership.warranty.check.label', 'Requirement'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.label}
          </Text>
          <Text as="p" variant="caption">
            {row.warrantyLabel}
          </Text>
        </div>
      ),
    },
    {
      key: 'detail',
      header: t('ownership.warranty.check.detail', 'What the data shows'),
      render: (row) => (
        <Text as="span" variant="caption">
          {row.detail}
        </Text>
      ),
    },
    {
      key: 'severity',
      header: t('ownership.warranty.check.severity', 'If unmet'),
      render: (row) => <Badge variant={severityTone(row.severity)}>{row.severity}</Badge>,
    },
  ];

  const claimColumns: Column<WarrantyClaim & { warrantyLabel: string }>[] = [
    {
      key: 'title',
      header: t('ownership.warranty.claim.title', 'Claim'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.title}
          </Text>
          <Text as="p" variant="caption">
            {row.warrantyLabel}
          </Text>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('ownership.warranty.claim.status', 'Status'),
      render: (row) => <VerdictBadge value={row.status} />,
    },
    {
      key: 'opened',
      header: t('ownership.warranty.claim.opened', 'Opened'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.opened_at)}
        </Text>
      ),
      sortable: true,
    },
    {
      key: 'amount',
      header: t('ownership.warranty.claim.amount', 'Amount'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.amount_minor, currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'note',
      header: t('ownership.warranty.claim.note', 'Evidence note'),
      render: (row) => (
        <Text as="span" variant="caption">
          {row.evidence_note || '—'}
        </Text>
      ),
    },
  ];

  const warrantyColumns: Column<Warranty>[] = [
    {
      key: 'label',
      header: t('ownership.warranty.row.label', 'Coverage'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.label}
          </Text>
          <Text as="p" variant="caption">
            {row.provider} · {row.kind}
          </Text>
        </div>
      ),
    },
    {
      key: 'start',
      header: t('ownership.warranty.row.start', 'Starts'),
      render: (row) => (
        <div>
          <Text as="p" variant="caption">
            {formatDateTime(row.start_at)}
          </Text>
          <Text as="p" variant="caption">
            {units.formatDistance(row.start_odometer_m)}
          </Text>
        </div>
      ),
    },
    {
      key: 'term',
      header: t('ownership.warranty.row.term', 'Term'),
      render: (row) => (
        <div>
          <Text as="p" variant="caption">
            {formatSpan(row.term_s)}
          </Text>
          <Text as="p" variant="caption">
            {units.formatDistance(row.term_distance_m)}
          </Text>
        </div>
      ),
    },
    {
      key: 'floor',
      header: t('ownership.warranty.row.floor', 'Capacity floor'),
      render: (row) =>
        row.capacity_floor_pct != null ? formatPct(row.capacity_floor_pct, 0) : '—',
    },
    {
      key: 'deductible',
      header: t('ownership.warranty.row.deductible', 'Deductible'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.deductible_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<FilePlus2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setClaimFor(row.id)}
          >
            {t('ownership.warranty.row.claim', 'Claim')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => remove.mutate(row.id)}
          >
            {t('ownership.action.remove', 'Remove')}
          </Button>
        </div>
      ),
    },
  ];

  const renderCoverage = (coverage: WarrantyCoverage) => (
    <div
      key={coverage.warranty.id}
      className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <Text as="h3" variant="label">
              {coverage.warranty.label}
            </Text>
            <VerdictBadge value={coverage.status} />
          </div>
          <Text as="p" variant="caption">
            {coverage.warranty.provider} · {coverage.warranty.kind}
          </Text>
        </div>
        <div className="text-right">
          <Text as="p" variant="caption">
            {t('ownership.warranty.card.readiness', 'Claim readiness')}
          </Text>
          <p
            className={`tabular-nums text-lg font-semibold ${
              coverage.readiness_score >= 80
                ? 'text-emerald-300'
                : coverage.readiness_score >= 50
                  ? 'text-amber-300'
                  : 'text-rose-300'
            }`}
          >
            {fmtNumber(coverage.readiness_score, 0)}/100
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <UsageBar
          label={t('ownership.warranty.card.time', 'Time consumed')}
          pct={coverage.time_used_pct}
          hint={t('ownership.warranty.card.timeHint', '{{remaining}} remaining · expires {{when}}', {
            remaining: formatSpan(Math.max(0, coverage.remaining_s)),
            when: formatDateTime(coverage.time_expiry_at),
          })}
        />
        <UsageBar
          label={t('ownership.warranty.card.distance', 'Distance consumed')}
          pct={coverage.distance_used_pct}
          hint={t('ownership.warranty.card.distanceHint', '{{remaining}} remaining', {
            remaining: units.formatDistance(Math.max(0, coverage.distance_remaining_m)),
          })}
        />
        <div>
          <Text as="span" variant="caption">
            {t('ownership.warranty.card.binding', 'Binding limit')}
          </Text>
          <p className="mt-1">
            <Badge variant={coverage.binding_limit === 'distance' ? 'warning' : 'info'}>
              {coverage.binding_limit}
            </Badge>
          </p>
          <Text as="p" variant="caption">
            {t('ownership.warranty.card.projected', 'Projected end {{when}}', {
              when: formatDateTime(coverage.projected_expiry_at),
            })}
          </Text>
          {coverage.observed_pace_m_per_s != null ? (
            <Text as="p" variant="caption">
              {t('ownership.warranty.card.pace', 'At your measured pace of {{pace}} per year', {
                pace: units.formatDistance(coverage.observed_pace_m_per_s * 31557600),
              })}
            </Text>
          ) : null}
        </div>
      </div>

      {coverage.capacity_retention_pct != null ? (
        <div className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text as="span" variant="caption">
              {t('ownership.warranty.card.capacity', 'Battery retention vs. warranty floor')}
            </Text>
            <span className="tabular-nums text-sm text-[var(--text-secondary)]">
              {formatPct(coverage.capacity_retention_pct)} ·{' '}
              {t('ownership.warranty.card.headroom', '{{value}} headroom', {
                value:
                  coverage.capacity_headroom_pct != null
                    ? formatPct(coverage.capacity_headroom_pct)
                    : '—',
              })}
            </span>
          </div>
          {coverage.capacity_floor_breach_at ? (
            <Text as="p" variant="caption">
              {t('ownership.warranty.card.breach', 'Projected to reach the floor around {{when}}', {
                when: formatDateTime(coverage.capacity_floor_breach_at),
              })}
            </Text>
          ) : null}
        </div>
      ) : null}

      <Text as="p" variant="bodySm">
        {coverage.narrative}
      </Text>

      {coverage.claim_window_closing_s != null ? (
        <div className="mt-3">
          <Badge variant="warning">
            {t('ownership.warranty.card.closing', 'Claim window closes in {{span}}', {
              span: formatSpan(coverage.claim_window_closing_s),
            })}
          </Badge>
        </div>
      ) : null}
    </div>
  );

  return (
    <PageContainer
      title={t('ownership.warranty.title', 'Warranty Coverage & Claim Readiness')}
      subtitle={t(
        'ownership.warranty.subtitle',
        'Track which limit actually ends each coverage — calendar or odometer — at your real measured pace, and know before you call whether your evidence would survive a claim review.',
      )}
      loading={overviewQuery.isLoading}
      error={overviewQuery.error as Error | null}
      actions={<VehicleSelect withIcon />}
    >
      <AlertBanner
        variant="warning"
        title={t('ownership.warranty.notice.title', 'Terms come from your documents')}
      >
        {t(
          'ownership.warranty.notice.body',
          'TeslaSync does not know your contract. Enter the term as written on your paperwork; every projection below is then computed from your own driving and battery data.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel title={t('ownership.warranty.summary.title', 'Coverage posture')}>
          <StatGrid
            stats={[
              {
                key: 'active',
                label: t('ownership.warranty.stat.active', 'Active coverages'),
                value: fmtNumber(overview?.active_count ?? 0, 0),
                tone: 'positive',
              },
              {
                key: 'expiring',
                label: t('ownership.warranty.stat.expiring', 'Expiring within 90 days'),
                value: fmtNumber(overview?.expiring_soon_count ?? 0, 0),
                tone: (overview?.expiring_soon_count ?? 0) > 0 ? 'warning' : 'default',
              },
              {
                key: 'next',
                label: t('ownership.warranty.stat.next', 'Next expiry'),
                value: overview?.next_expiry_at ? formatDateTime(overview.next_expiry_at) : '—',
              },
              {
                key: 'odometer',
                label: t('ownership.warranty.stat.odometer', 'Odometer'),
                value:
                  overview?.odometer_m != null ? units.formatDistance(overview.odometer_m) : '—',
                hint: t('ownership.warranty.stat.odometerHint', 'Derived from recorded drives'),
              },
              {
                key: 'claimed',
                label: t('ownership.warranty.stat.claimed', 'Total claimed'),
                value: formatCurrencyMinor(
                  overview?.total_claimed_minor,
                  currency,
                  units.unitPrefs.locale,
                ),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.warranty.coverages.title', 'Coverage burn-down')}
          empty={coverages.length === 0}
          emptyMessage={t(
            'ownership.warranty.coverages.empty',
            'Add a warranty below to see how fast you are consuming it.',
          )}
        >
          <div className="space-y-4">{coverages.map(renderCoverage)}</div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.warranty.readiness.title', 'Claim readiness checklist')}
          description={t(
            'ownership.warranty.readiness.subtitle',
            'Each requirement is evaluated against data already on this server, so you know what a reviewer would find.',
          )}
          empty={allChecks.length === 0}
          emptyMessage={t(
            'ownership.warranty.readiness.empty',
            'No coverage recorded, so nothing to evaluate.',
          )}
        >
          <DataTable
            columns={checkColumns}
            data={allChecks}
            keyExtractor={(row) => `${row.warrantyLabel}-${row.code}`}
            tableId="ownership-warranty-readiness"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.warranty.list.title', 'Recorded coverages')}
          empty={warranties.length === 0 && !formOpen}
          emptyMessage={t('ownership.warranty.list.empty', 'No warranties recorded yet.')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setFormOpen((open) => !open)}
            >
              {formOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.warranty.list.add', 'Add coverage')}
            </Button>
          }
        >
          {formOpen ? (
            <form className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submitWarranty}>
              <Select
                label={t('ownership.warranty.form.kind', 'Coverage type')}
                value={draft.kind}
                options={KINDS.map((kind) => ({ value: kind, label: kind }))}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, kind: event.target.value as WarrantyKind }))
                }
              />
              <Input
                label={t('ownership.warranty.form.label', 'Label')}
                value={draft.label}
                required
                maxLength={160}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, label: event.target.value }))
                }
              />
              <Input
                label={t('ownership.warranty.form.provider', 'Provider')}
                value={draft.provider}
                maxLength={160}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, provider: event.target.value }))
                }
              />
              <Input
                type="date"
                label={t('ownership.warranty.form.start', 'Coverage start')}
                value={toDateInput(draft.start_at)}
                required
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    start_at: fromDateInput(event.target.value),
                  }))
                }
              />
              <SiNumberInput
                label={t('ownership.warranty.form.startOdo', 'Odometer at start')}
                value={draft.start_odometer_m}
                siUnit="m"
                displayHint={units.formatDistance(draft.start_odometer_m)}
                min={0}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, start_odometer_m: value ?? 0 }))
                }
              />
              <Input
                type="number"
                label={t('ownership.warranty.form.termDays', 'Term (days)')}
                value={draft.term_days}
                min={1}
                required
                hint={t('ownership.warranty.form.termHint', '4 years = 1461 days')}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, term_days: Number(event.target.value) }))
                }
              />
              <SiNumberInput
                label={t('ownership.warranty.form.termDistance', 'Term distance')}
                value={draft.term_distance_m}
                siUnit="m"
                displayHint={units.formatDistance(draft.term_distance_m)}
                min={0}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, term_distance_m: value ?? 0 }))
                }
              />
              <Input
                type="number"
                label={t('ownership.warranty.form.floor', 'Capacity floor (%)')}
                value={draft.capacity_floor_pct ?? ''}
                min={0}
                max={100}
                hint={t(
                  'ownership.warranty.form.floorHint',
                  'Battery coverage only — leave blank otherwise',
                )}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    capacity_floor_pct:
                      event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              />
              <MoneyInput
                label={t('ownership.warranty.form.deductible', 'Deductible')}
                value={draft.deductible_minor}
                currency={draft.currency}
                locale={units.unitPrefs.locale}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, deductible_minor: value ?? 0 }))
                }
              />
              <Input
                label={t('ownership.form.currency', 'ISO currency code')}
                value={draft.currency}
                minLength={3}
                maxLength={3}
                required
                onChange={(event) =>
                  setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                }
              />
              <div className="md:col-span-2 xl:col-span-3">
                <Textarea
                  label={t('ownership.warranty.form.notes', 'Notes')}
                  value={draft.notes}
                  rows={2}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <Button type="submit" loading={create.isPending} disabled={vehicleId == null}>
                  {t('ownership.warranty.form.save', 'Save coverage')}
                </Button>
                <MutationError error={create.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={warrantyColumns}
            data={warranties}
            keyExtractor={(row) => row.id}
            tableId="ownership-warranty-list"
            emptyMessage={t('ownership.warranty.list.empty', 'No warranties recorded yet.')}
          />
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel
          title={t('ownership.warranty.claims.title', 'Claim ledger')}
          description={t(
            'ownership.warranty.claims.subtitle',
            'Record what you asked for and what came back, so the next claim starts from a known history.',
          )}
          empty={allClaims.length === 0 && claimFor == null}
          emptyMessage={t('ownership.warranty.claims.empty', 'No claims recorded yet.')}
        >
          {claimFor != null ? (
            <form
              className="mb-6 grid gap-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4 md:grid-cols-2"
              onSubmit={submitClaim}
            >
              <Input
                label={t('ownership.warranty.claimForm.title', 'Claim title')}
                value={claimDraft.title}
                required
                maxLength={200}
                onChange={(event) =>
                  setClaimDraft((current) => ({ ...current, title: event.target.value }))
                }
              />
              <Select
                label={t('ownership.warranty.claimForm.status', 'Status')}
                value={claimDraft.status}
                options={CLAIM_STATUSES.map((status) => ({
                  value: status,
                  label: CLAIM_STATUS_LABELS[status](t),
                }))}
                onChange={(event) =>
                  setClaimDraft((current) => ({
                    ...current,
                    status: event.target.value as ClaimStatus,
                  }))
                }
              />
              <MoneyInput
                label={t('ownership.warranty.claimForm.amount', 'Amount')}
                value={claimDraft.amount_minor}
                currency={currency}
                locale={units.unitPrefs.locale}
                onChange={(value) =>
                  setClaimDraft((current) => ({ ...current, amount_minor: value ?? 0 }))
                }
              />
              <Textarea
                label={t('ownership.warranty.claimForm.note', 'Evidence note')}
                value={claimDraft.evidence_note}
                rows={2}
                onChange={(event) =>
                  setClaimDraft((current) => ({ ...current, evidence_note: event.target.value }))
                }
              />
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" loading={createClaim.isPending}>
                  {t('ownership.warranty.claimForm.submit', 'Record claim')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setClaimFor(null)}>
                  {t('ownership.action.cancel', 'Cancel')}
                </Button>
              </div>
              <div className="md:col-span-2">
                <MutationError error={createClaim.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={claimColumns}
            data={allClaims}
            keyExtractor={(row) => row.id}
            tableId="ownership-warranty-claims"
            emptyMessage={t('ownership.warranty.claims.empty', 'No claims recorded yet.')}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <OwnershipPanel title={t('ownership.warranty.bundle.title', 'Evidence bundle')}>
          <Text as="p" variant="caption">
            {t(
              'ownership.warranty.bundle.body',
              'A stable digest over the coverage terms and readiness state used for this assessment. Quote it when you open a claim so both sides reference the same snapshot.',
            )}
          </Text>
          <p className="mt-2 break-all font-mono text-sm text-cyan-300">
            {overview?.evidence_bundle_hash || '—'}
          </p>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <EvidencePanel
          quality={overview?.quality}
          evidence={overview?.evidence}
          unsupported={[
            t(
              'ownership.warranty.unsupported.legal',
              'Interpreting contract exclusions — readiness is factual, not legal advice',
            ),
            t(
              'ownership.warranty.unsupported.submit',
              'Filing the claim with the provider on your behalf',
            ),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
