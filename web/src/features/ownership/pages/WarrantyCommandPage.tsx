import { type FormEvent, useMemo, useRef, useState } from 'react';
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
import { MetricBar } from '@/components/data-display';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Card, ConfirmDialog, DataTable, Icon, Input, Select, Text, Textarea } from '@/components/ui';
import type { Column } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { gaugeTone, severityTokens } from '@/lib/tokens';

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
  VerdictBadge,
} from '../components';
import { OwnershipBrief } from '../components/operationalbrief-all/OwnershipBrief';
import { specialistDisplay } from '../components/operationalbrief-all/specialistDisplay';
import {
  daysToSeconds,
  formatCurrencyMinor,
  formatPct,
  formatSpan,
  fromDateInput,
  toDateInput,
} from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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

const KIND_LABELS: Record<WarrantyKind, (t: TFunction) => string> = {
  basic: (t) => t('ownership.warranty.kind.basic', 'Basic'),
  drivetrain: (t) => t('ownership.warranty.kind.drivetrain', 'Drivetrain'),
  battery: (t) => t('ownership.warranty.kind.battery', 'Battery'),
  corrosion: (t) => t('ownership.warranty.kind.corrosion', 'Corrosion'),
  tires: (t) => t('ownership.warranty.kind.tires', 'Tires'),
  aftermarket: (t) => t('ownership.warranty.kind.aftermarket', 'Aftermarket'),
  extended: (t) => t('ownership.warranty.kind.extended', 'Extended'),
};

const BINDING_LABELS = {
  time: (t: TFunction) => t('ownership.warranty.binding.time', 'Time'),
  distance: (t: TFunction) => t('ownership.warranty.binding.distance', 'Distance'),
  capacity: (t: TFunction) => t('ownership.warranty.binding.capacity', 'Capacity'),
};

const SEVERITY_LABELS = {
  critical: (t: TFunction) => t('ownership.warranty.severity.critical', 'Critical'),
  high: (t: TFunction) => t('ownership.warranty.severity.high', 'High'),
  medium: (t: TFunction) => t('ownership.warranty.severity.medium', 'Medium'),
  low: (t: TFunction) => t('ownership.warranty.severity.low', 'Low'),
};

const COVERAGE_STATUS_LABELS = {
  active: (t: TFunction) => t('ownership.verdict.active', 'Active'),
  expiring: (t: TFunction) => t('ownership.warranty.status.expiring', 'Expiring'),
  expired: (t: TFunction) => t('ownership.verdict.expired', 'Expired'),
};

function enumLabel(value: string, labels: Record<string, (t: TFunction) => string>, t: TFunction): string {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value](t) : value;
}

function severityTone(severity: string): 'danger' | 'warning' | 'neutral' {
  if (severity === 'critical') return 'danger';
  if (severity === 'high') return 'warning';
  return 'neutral';
}

function UsageBar({ label, pct, hint }: { label: string; pct: number; hint: string }) {
  useNumberFormatting();
  const clamped = Math.min(100, Math.max(0, pct));
  const tone = clamped >= 90 ? gaugeTone.danger : clamped >= 70 ? gaugeTone.warning : gaugeTone.info;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Text as="span" variant="caption">
          {label}
        </Text>
        <span className="tabular-nums text-xs text-[var(--text-secondary)]">
          {Number.isFinite(pct) ? formatPct(clamped) : '—'}
        </span>
      </div>
      <div className="mt-1">
        <MetricBar value={pct} max={100} color={tone} ariaLabel={label}
          showHeader={false} size="slim" fill="solid" />
      </div>
      <Text as="p" variant="caption">
        {hint}
      </Text>
    </div>
  );
}

export default function WarrantyCommandPage() {
  const { formatDateTime } = useDateFormat();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [formScope, setFormScope] = useState<{ vehicleId: number } | null>(null);
  const formOpen = formScope != null;
  const [claimTarget, setClaimTarget] = useState<Warranty | null>(null);
  const claimFor = claimTarget?.id ?? null;
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
  const initialDraft = useRef(draft);
  const initialClaimDraft = useRef(claimDraft);
  const scope = useRef({ vehicleId, generation: 0 });
  if (scope.current.vehicleId !== vehicleId) {
    scope.current = { vehicleId, generation: scope.current.generation + 1 };
  }
  const editor = useRef({ formScope, draft, claimTarget, claimDraft });
  editor.current = { formScope, draft, claimTarget, claimDraft };

  const openWarranty = () => {
    if (vehicleId == null || formOpen) return;
    setDraft({ ...initialDraft.current });
    setFormScope({ vehicleId });
  };
  const closeWarranty = () => setFormScope(null);
  const closeClaim = () => {
    setClaimTarget(null);
    setClaimDraft({ ...initialClaimDraft.current });
  };

  usePageTitle(t('ownership.warranty.navTitle', 'Warranty command'));

  const overviewQuery = useWarrantyOverview(vehicleId);
  const warrantiesQuery = useWarranties(vehicleId);
  const create = useCreateWarranty();
  const remove = useDeleteWarranty();
  const createClaim = useCreateWarrantyClaim();
  const { confirm, dialogProps } = useConfirm();

  const handleRemove = async (row: Warranty) => {
    const submittedScope = scope.current;
    const ok = await confirm({
      title: t('ownership.warranty.delete.title', 'Delete this warranty?'),
      message: t(
        'ownership.warranty.delete.message',
        '“{{name}}” and its claims will be removed permanently. This cannot be undone.',
        { name: row.label },
      ),
      variant: 'danger',
      confirmLabel: t('common.delete', 'Delete'),
    });
    if (ok && scope.current === submittedScope && row.vehicle_id === scope.current.vehicleId
      && currentWarranties.current.some((warranty) => warranty.id === row.id
        && warranty.vehicle_id === row.vehicle_id)) remove.mutate(row.id);
  };

  const overview = overviewQuery.data;
  const coverages = useMemo(() => overview?.coverages ?? [], [overview?.coverages]);
  const warranties = useMemo(
    () => warrantiesQuery.data?.items ?? [],
    [warrantiesQuery.data?.items],
  );
  const currentWarranties = useRef(warranties);
  currentWarranties.current = warranties;
  const warrantyScopeValid = formScope != null && formScope.vehicleId === vehicleId;
  const claimScopeValid = claimTarget != null && claimTarget.vehicle_id === vehicleId
    && warranties.some((row) => row.id === claimTarget.id && row.vehicle_id === claimTarget.vehicle_id);
  const currency = overview?.currency ?? draft.currency;
  const noCoverage = Array.isArray(overview?.coverages) && coverages.length === 0 && warranties.length === 0;

  const allChecks = useMemo(
    () =>
      coverages.flatMap((coverage) =>
        (coverage.readiness ?? []).map((check) => ({
          ...check,
          warrantyId: coverage.warranty.id,
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
    if (!warrantyScopeValid || formScope == null || create.isPending) return;
    const submittedScope = scope.current;
    const submittedEditor = editor.current;
    create.mutate(
      {
        vehicle_id: formScope.vehicleId,
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
      { onSuccess: () => {
        if (scope.current === submittedScope
          && editor.current.formScope === submittedEditor.formScope
          && editor.current.draft === submittedEditor.draft) closeWarranty();
      } },
    );
  };

  const submitClaim = (event: FormEvent) => {
    event.preventDefault();
    if (!claimScopeValid || claimTarget == null || createClaim.isPending) return;
    const submittedScope = scope.current;
    const submittedEditor = editor.current;
    createClaim.mutate(
      { ...claimDraft, warranty_id: claimTarget.id, confirmed: true },
      {
        onSuccess: () => {
          if (scope.current === submittedScope
            && editor.current.claimTarget === submittedEditor.claimTarget
            && editor.current.claimDraft === submittedEditor.claimDraft
            && currentWarranties.current.some((row) => row.id === submittedEditor.claimTarget?.id
              && row.vehicle_id === submittedEditor.claimTarget?.vehicle_id)) closeClaim();
        },
      },
    );
  };

  const checkColumns: Column<ReadinessCheck & { warrantyId: number; warrantyLabel: string }>[] = [
    {
      key: 'state',
      header: t('ownership.warranty.check.state', 'State'),
      render: (row) =>
        row.satisfied ? (
          <Icon icon={CheckCircle2} className={severityTokens.success.fg} aria-label={t('common.yes', 'Yes')} />
        ) : (
          <Icon icon={XCircle} className={severityTokens.critical.fg} aria-label={t('common.no', 'No')} />
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
      render: (row) => <Badge variant={severityTone(row.severity)}>{enumLabel(row.severity, SEVERITY_LABELS, t)}</Badge>,
    },
  ];

  const claimColumns: Column<WarrantyClaim & { warrantyLabel: string }>[] = [
    {
      key: 'title',
      header: t('ownership.warranty.claim.title', 'Claim'),
      filterValue: (row) => row.id,
      filterValueLabel: (_value, row) => `${row.title} · ${row.warrantyLabel}`,
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
      filterValue: (row) => row.status,
      filterValueLabel: (_value, row) => enumLabel(row.status, CLAIM_STATUS_LABELS, t),
      render: (row) => <VerdictBadge value={row.status} label={enumLabel(row.status, CLAIM_STATUS_LABELS, t)} />,
    },
    {
      key: 'opened',
      filterValue: (row) => row.opened_at,
      filterValueLabel: (_value, row) => formatDateTime(row.opened_at),
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
      align: 'right',
      filterValue: (row) => row.amount_minor,
      filterValueLabel: (_value, row) => formatCurrencyMinor(row.amount_minor, currency, units.unitPrefs.locale),
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
      filterValue: (row) => row.id,
      filterValueLabel: (_value, row) => `${row.label} · ${row.provider}`,
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.label}
          </Text>
          <Text as="p" variant="caption">
            {row.provider} · {enumLabel(row.kind, KIND_LABELS, t)}
          </Text>
        </div>
      ),
    },
    {
      key: 'start',
      filterValue: (row) => row.start_at,
      filterValueLabel: (_value, row) => formatDateTime(row.start_at),
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
      align: 'right',
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
      align: 'right',
      filterValue: (row) => row.capacity_floor_pct,
      filterValueLabel: (_value, row) => row.capacity_floor_pct != null ? formatPct(row.capacity_floor_pct) : '—',
      header: t('ownership.warranty.row.floor', 'Capacity floor'),
      render: (row) =>
        row.capacity_floor_pct != null ? formatPct(row.capacity_floor_pct) : '—',
    },
    {
      key: 'deductible',
      align: 'right',
      filterValue: (row) => `${row.currency}:${row.deductible_minor}`,
      filterValueLabel: (_value, row) => formatCurrencyMinor(row.deductible_minor, row.currency, units.unitPrefs.locale),
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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
            icon={<Icon icon={FilePlus2} />}
            disabled={claimTarget != null || row.vehicle_id !== vehicleId}
            onClick={() => {
              if (claimTarget != null || row.vehicle_id !== vehicleId) return;
              setClaimDraft({ ...initialClaimDraft.current });
              setClaimTarget(row);
            }}
          >
            {t('ownership.warranty.row.claim', 'Claim')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
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

  const renderCoverage = (coverage: WarrantyCoverage) => (
    <Card key={coverage.warranty.id} className="shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon icon={ShieldCheck} className="text-[var(--text-secondary)]" />
            <Text as="h3" variant="label">
              {coverage.warranty.label}
            </Text>
            <VerdictBadge value={coverage.status} label={enumLabel(coverage.status, COVERAGE_STATUS_LABELS, t)} />
          </div>
          <Text as="p" variant="caption">
            {coverage.warranty.provider} · {enumLabel(coverage.warranty.kind, KIND_LABELS, t)}
          </Text>
        </div>
        <div className="text-end">
          <Text as="p" variant="caption">
            {t('ownership.warranty.card.readiness', 'Claim readiness')}
          </Text>
          <p
            className={`tabular-nums text-lg font-semibold ${
              coverage.readiness_score >= 80
                ? severityTokens.success.fg
                : coverage.readiness_score >= 50
                  ? severityTokens.warn.fg
                  : severityTokens.critical.fg
            }`}
          >
            {fmtNumber(coverage.readiness_score)}/100
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
              {enumLabel(coverage.binding_limit, BINDING_LABELS, t)}
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

      {coverage.warranty.kind === 'battery' || coverage.capacity_retention_pct != null ? (
        <Card padding="sm" className="mt-4 shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text as="span" variant="caption">
              {t('ownership.warranty.card.capacity', 'Battery retention vs. warranty floor')}
            </Text>
            <span className="tabular-nums text-sm text-[var(--text-secondary)]">
              {coverage.capacity_retention_pct != null
                ? formatPct(coverage.capacity_retention_pct)
                : t('common.unknown', 'Unknown')} ·{' '}
              {t('ownership.warranty.card.headroom', '{{value}} headroom', {
                value:
                  coverage.capacity_headroom_pct != null
                    ? formatPct(coverage.capacity_headroom_pct)
                    : t('common.unknown', 'Unknown'),
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
        </Card>
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
    </Card>
  );

  return (
    <PageLayout
      title={t('ownership.warranty.title', 'Warranty coverage & claim readiness')}
      subtitle={t(
        'ownership.warranty.subtitle',
        'Track which limit actually ends each coverage — calendar or odometer — at your real measured pace, and know before you call whether your evidence would survive a claim review.',
      )}
      query={[overviewQuery, warrantiesQuery]}
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
        <OwnershipPanel title={t('ownership.warranty.summary.title', 'Coverage posture')}
          source={overviewQuery} sourceEnabled={vehicleId != null} empty={!overview} preserveSummary>
          <OwnershipBrief
            title={t('ownership.warranty.brief.title', 'Recorded warranty coverage and expiry')}
            description={t('ownership.warranty.notice.body', 'TeslaSync does not know your contract. Enter the term as written on your paperwork; every projection below is then computed from your own driving and battery data.')}
            scope={t('ownership.warranty.brief.scope', 'Selected vehicle and recorded coverage terms; expiry projections use recorded driving')}
            source={overviewQuery} enabled={vehicleId != null}
            observedAt={overview?.as_of}
            metrics={[
              {
                occurrenceId: 'active', metricId: 'count',
                label: t('ownership.warranty.stat.active', 'Active coverages'),
                rawValue: overview?.active_count,
                display: specialistDisplay(fmtInt),
                tone: 'positive',
              },
              {
                occurrenceId: 'expiring', metricId: 'count',
                label: t('ownership.warranty.stat.expiring', 'Expiring within 90 days'),
                rawValue: overview?.expiring_soon_count,
                display: specialistDisplay(fmtInt),
                tone: (overview?.expiring_soon_count ?? 0) > 0 ? 'warning' : 'default',
              },
              {
                occurrenceId: 'next', metricId: 'text',
                label: t('ownership.warranty.stat.next', 'Next expiry'),
                rawValue: overview?.next_expiry_at ? formatDateTime(overview.next_expiry_at) : null,
              },
              {
                occurrenceId: 'odometer', metricId: 'distance',
                label: t('ownership.warranty.stat.odometer', 'Odometer'),
                rawValue: overview?.odometer_m,
                display: specialistDisplay(units.formatDistance),
                context: t('ownership.warranty.stat.odometerHint', 'Derived from recorded drives'),
              },
              {
                occurrenceId: 'claimed', metricId: 'currency',
                label: t('ownership.warranty.stat.claimed', 'Total claimed'),
                rawValue: overview?.total_claimed_minor,
                display: specialistDisplay((raw) => formatCurrencyMinor(raw, currency, units.unitPrefs.locale)),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.warranty.coverages.title', 'Coverage burn-down')}
          source={overviewQuery}
          sourceEnabled={vehicleId != null}
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
          source={overviewQuery}
          sourceEnabled={vehicleId != null}
          description={t(
            'ownership.warranty.readiness.subtitle',
            'Each requirement is evaluated against data already on this server, so you know what a reviewer would find.',
          )}
          empty={allChecks.length === 0}
          emptyMessage={noCoverage
            ? t('ownership.warranty.readiness.empty', 'No coverage recorded, so nothing to evaluate.')
            : t('ownership.source.empty', 'No supported data is available yet.')}
          actions={vehicleId != null && overview && allChecks.length === 0 ? (
            noCoverage ? (
              <Button variant="secondary" size="sm" onClick={openWarranty}>
                {t('ownership.warranty.list.add', 'Add coverage')}
              </Button>
            ) : !overviewQuery.error ? (
              <Button variant="secondary" size="sm"
                disabled={overviewQuery.isFetching || overviewQuery.fetchStatus === 'paused'}
                onClick={() => { void overviewQuery.refetch(); }}>
                {t('common.retry', 'Retry')}
              </Button>
            ) : null
          ) : undefined}
        >
          <DataTable
            columns={checkColumns}
            mobilePresentation={{
              roles: { label: 'title', state: 'badge', severity: 'meta' },
              displayValue: (row, key) => {
                switch (key) {
                  case 'label': return `${row.label} · ${row.warrantyLabel}`;
                  case 'state': return row.satisfied ? t('common.yes', 'Yes') : t('common.no', 'No');
                  case 'severity': return enumLabel(row.severity, SEVERITY_LABELS, t);
                  case 'detail': return row.detail;
                  default: return undefined;
                }
              },
            }}
            data={allChecks}
            keyExtractor={(row) => `${row.warrantyId}-${row.code}`}
            tableId="ownership-warranty-readiness"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.warranty.list.title', 'Recorded coverages')}
          source={warrantiesQuery}
          sourceEnabled={vehicleId != null}
          editing={formOpen}
          empty={warranties.length === 0 && !formOpen}
          emptyMessage={t('ownership.warranty.list.empty', 'No warranties recorded yet.')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon icon={ShieldCheck} />}
              disabled={!formOpen && vehicleId == null}
              onClick={formOpen ? closeWarranty : openWarranty}
            >
              {formOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.warranty.list.add', 'Add coverage')}
            </Button>
          }
        >
          {formOpen ? (
            <form className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submitWarranty}>
              {!warrantyScopeValid && (
                <AlertBanner variant="warning">
                  {t('productPreferences.defaultVehicle.unavailable', 'Unavailable vehicle {{id}}', { id: formScope?.vehicleId })}
                </AlertBanner>
              )}
              <Select
                label={t('ownership.warranty.form.kind', 'Coverage type')}
                value={draft.kind}
                options={KINDS.map((kind) => ({ value: kind, label: enumLabel(kind, KIND_LABELS, t) }))}
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
                <Button type="submit" loading={create.isPending} disabled={!warrantyScopeValid || create.isPending}>
                  {t('ownership.warranty.form.save', 'Save coverage')}
                </Button>
                <MutationError error={create.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={warrantyColumns}
            enableValueFilters
            mobilePresentation={{
              roles: { label: 'title', start: 'meta', term: 'meta', deductible: 'primary' },
              displayValue: (row, key) => {
                switch (key) {
                  case 'label': return `${row.label} · ${row.provider} · ${enumLabel(row.kind, KIND_LABELS, t)}`;
                  case 'start': return `${formatDateTime(row.start_at)} · ${units.formatDistance(row.start_odometer_m)}`;
                  case 'term': return `${formatSpan(row.term_s)} · ${units.formatDistance(row.term_distance_m)}`;
                  case 'floor': return row.capacity_floor_pct != null ? formatPct(row.capacity_floor_pct) : '—';
                  case 'deductible': return formatCurrencyMinor(row.deductible_minor, row.currency, units.unitPrefs.locale);
                  default: return undefined;
                }
              },
              inlineActions: (row) => warrantyColumns.find((column) => column.key === 'actions')?.render(row),
            }}
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
          source={overviewQuery}
          sourceEnabled={vehicleId != null}
          editing={claimFor != null}
          description={t(
            'ownership.warranty.claims.subtitle',
            'Record what you asked for and what came back, so the next claim starts from a known history.',
          )}
          empty={allClaims.length === 0 && claimFor == null}
          emptyMessage={t('ownership.warranty.claims.empty', 'No claims recorded yet.')}
        >
          {claimFor != null ? (
            <form
              className="mb-6 grid gap-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-1)] p-4 md:grid-cols-2"
              onSubmit={submitClaim}
            >
              <Text as="p" variant="caption">{claimTarget?.label} · {claimTarget?.vehicle_id}</Text>
              {!claimScopeValid && (
                <AlertBanner variant="warning">
                  {t('productPreferences.defaultVehicle.unavailable', 'Unavailable vehicle {{id}}', { id: claimTarget?.vehicle_id })}
                </AlertBanner>
              )}
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
                currency={claimTarget?.currency ?? currency}
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
                <Button type="submit" loading={createClaim.isPending} disabled={!claimScopeValid || createClaim.isPending}>
                  {t('ownership.warranty.claimForm.submit', 'Record claim')}
                </Button>
                <Button type="button" variant="ghost" onClick={closeClaim}>
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
            enableValueFilters
            mobilePresentation={{
              roles: { title: 'title', status: 'badge', opened: 'meta', amount: 'primary' },
              displayValue: (row, key) => {
                switch (key) {
                  case 'title': return `${row.title} · ${row.warrantyLabel}`;
                  case 'status': return enumLabel(row.status, CLAIM_STATUS_LABELS, t);
                  case 'opened': return formatDateTime(row.opened_at);
                  case 'amount': return formatCurrencyMinor(row.amount_minor, currency, units.unitPrefs.locale);
                  case 'note': return row.evidence_note || '—';
                  default: return undefined;
                }
              },
            }}
            data={allClaims}
            keyExtractor={(row) => row.id}
            tableId="ownership-warranty-claims"
            emptyMessage={t('ownership.warranty.claims.empty', 'No claims recorded yet.')}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <OwnershipPanel title={t('ownership.warranty.bundle.title', 'Evidence bundle')}
          source={overviewQuery} sourceEnabled={vehicleId != null} empty={!overview}>
          <Text as="p" variant="caption">
            {t(
              'ownership.warranty.bundle.body',
              'A stable digest over the coverage terms and readiness state used for this assessment. Quote it when you open a claim so both sides reference the same snapshot.',
            )}
          </Text>
          <p className="mt-2 break-all font-mono text-sm text-[var(--text-secondary)]">
            {overview?.evidence_bundle_hash || '—'}
          </p>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <EvidencePanel
          source={overviewQuery}
          sourceEnabled={vehicleId != null}
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
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageLayout>
  );
}
