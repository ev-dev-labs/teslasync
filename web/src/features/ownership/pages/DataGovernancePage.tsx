import { type FormEvent, useMemo, useState } from 'react';
import { Database, Lock, PlayCircle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useDeleteRetentionPolicy,
  useGovernanceOverview,
  useRetentionRuns,
  useSimulateGovernance,
  useUpsertRetentionPolicy,
} from '@/api/hooks/useOwnership';
import { AlertBanner } from '@/components/feedback';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, DataTable, Input, Select, Text, Toggle } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import type {
  DatasetInventory,
  RetentionImpact,
  RetentionPolicy,
  RetentionRun,
} from '@/types/ownership';
import { EvidencePanel, MutationError, OwnershipPanel, StatGrid } from '../components';
import { daysToSeconds, formatBytes, formatPct, formatSpan, secondsToDays } from '../formatters';

export default function DataGovernancePage() {
  const { t } = useTranslation();
  const [formOpen, setFormOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState({
    dataset: '',
    retention_days: 365,
    downsample_after_days: null as number | null,
    downsample_bucket_s: null as number | null,
    legal_hold: false,
    enabled: true,
  });

  usePageTitle(t('ownership.governance.navTitle', 'Data Retention Governance'));

  const overviewQuery = useGovernanceOverview();
  const runsQuery = useRetentionRuns(50, 0);
  const upsert = useUpsertRetentionPolicy();
  const remove = useDeleteRetentionPolicy();
  const simulate = useSimulateGovernance();

  const overview = overviewQuery.data;
  const inventory = useMemo(() => overview?.inventory ?? [], [overview?.inventory]);
  const policies = useMemo(() => overview?.policies ?? [], [overview?.policies]);
  const runs = useMemo(() => runsQuery.data?.items ?? [], [runsQuery.data?.items]);
  const impacts = useMemo(() => simulate.data?.impacts ?? [], [simulate.data?.impacts]);

  const datasetOptions = useMemo(
    () => inventory.map((row) => ({ value: row.dataset, label: row.label })),
    [inventory],
  );

  const toggleDataset = (dataset: string) => {
    setSelected((current) =>
      current.includes(dataset)
        ? current.filter((item) => item !== dataset)
        : [...current, dataset],
    );
  };

  const submitPolicy = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.dataset) return;
    upsert.mutate(
      {
        dataset: draft.dataset,
        retention_s: daysToSeconds(draft.retention_days),
        downsample_after_s:
          draft.downsample_after_days == null ? null : daysToSeconds(draft.downsample_after_days),
        downsample_bucket_s: draft.downsample_bucket_s,
        legal_hold: draft.legal_hold,
        enabled: draft.enabled,
      },
      { onSuccess: () => setFormOpen(false) },
    );
  };

  const runSimulation = () => {
    const datasets = selected.length > 0 ? selected : policies.map((policy) => policy.dataset);
    if (datasets.length === 0) return;
    simulate.mutate({ datasets, confirmed: true });
  };

  const inventoryColumns: Column<DatasetInventory>[] = [
    {
      key: 'select',
      header: t('ownership.governance.inventory.select', 'Plan'),
      render: (row) => (
        <Button
          variant={selected.includes(row.dataset) ? 'primary' : 'secondary'}
          size="sm"
          disabled={!row.governed}
          onClick={() => toggleDataset(row.dataset)}
        >
          {selected.includes(row.dataset)
            ? t('ownership.governance.inventory.included', 'In plan')
            : t('ownership.governance.inventory.include', 'Include')}
        </Button>
      ),
    },
    {
      key: 'dataset',
      header: t('ownership.governance.inventory.dataset', 'Dataset'),
      render: (row) => (
        <div>
          <div className="flex items-center gap-2">
            <Text as="span" variant="label">
              {row.label}
            </Text>
            {row.is_hypertable ? (
              <Badge variant="info">
                {t('ownership.governance.inventory.hypertable', 'hypertable')}
              </Badge>
            ) : null}
            {row.governed ? null : (
              <Badge variant="warning">
                {t('ownership.governance.inventory.ungoverned', 'no policy')}
              </Badge>
            )}
          </div>
          <Text as="p" variant="caption">
            {row.dataset}
          </Text>
        </div>
      ),
    },
    {
      key: 'rows',
      header: t('ownership.governance.inventory.rows', 'Rows'),
      render: (row) => <span className="tabular-nums">{fmtNumber(row.row_count, 0)}</span>,
      sortable: true,
    },
    {
      key: 'bytes',
      header: t('ownership.governance.inventory.bytes', 'On disk'),
      render: (row) => <span className="tabular-nums">{formatBytes(row.total_bytes)}</span>,
      sortable: true,
    },
    {
      key: 'perRow',
      header: t('ownership.governance.inventory.perRow', 'Bytes / row'),
      render: (row) =>
        row.bytes_per_row != null ? (
          <span className="tabular-nums">{fmtNumber(row.bytes_per_row, 0)}</span>
        ) : (
          '—'
        ),
    },
    {
      key: 'span',
      header: t('ownership.governance.inventory.span', 'History span'),
      render: (row) => (
        <div>
          <Text as="p" variant="caption">
            {row.span_s != null ? formatSpan(row.span_s) : '—'}
          </Text>
          <Text as="p" variant="caption">
            {row.oldest_at ? formatDateTime(row.oldest_at) : '—'}
          </Text>
        </div>
      ),
    },
  ];

  const policyColumns: Column<RetentionPolicy>[] = [
    {
      key: 'dataset',
      header: t('ownership.governance.policy.dataset', 'Dataset'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Text as="span" variant="label">
            {row.dataset}
          </Text>
          {row.legal_hold ? (
            <Badge variant="danger" dot>
              {t('ownership.governance.policy.hold', 'legal hold')}
            </Badge>
          ) : null}
          {row.enabled ? null : (
            <Badge variant="neutral">
              {t('ownership.governance.policy.disabled', 'disabled')}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'retention',
      header: t('ownership.governance.policy.retention', 'Retention'),
      render: (row) => formatSpan(row.retention_s),
      sortable: true,
    },
    {
      key: 'downsample',
      header: t('ownership.governance.policy.downsample', 'Downsample after'),
      render: (row) => (row.downsample_after_s != null ? formatSpan(row.downsample_after_s) : '—'),
    },
    {
      key: 'bucket',
      header: t('ownership.governance.policy.bucket', 'Bucket'),
      render: (row) => (row.downsample_bucket_s != null ? formatSpan(row.downsample_bucket_s) : '—'),
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft({
                dataset: row.dataset,
                retention_days: secondsToDays(row.retention_s) ?? 365,
                downsample_after_days: secondsToDays(row.downsample_after_s),
                downsample_bucket_s: row.downsample_bucket_s,
                legal_hold: row.legal_hold,
                enabled: row.enabled,
              });
              setFormOpen(true);
            }}
          >
            {t('ownership.action.edit', 'Edit')}
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

  const impactColumns: Column<RetentionImpact>[] = [
    {
      key: 'dataset',
      header: t('ownership.governance.impact.dataset', 'Dataset'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.label}
          </Text>
          <Text as="p" variant="caption">
            {t('ownership.governance.impact.retention', 'Keeping {{span}}', {
              span: formatSpan(row.retention_s),
            })}
          </Text>
        </div>
      ),
    },
    {
      key: 'expiring',
      header: t('ownership.governance.impact.expiring', 'Rows expiring'),
      render: (row) => (
        <div>
          <span className="tabular-nums">{fmtNumber(row.rows_expiring, 0)}</span>
          <Text as="p" variant="caption">
            {t('ownership.governance.impact.retained', '{{count}} retained', {
              count: row.rows_retained,
            })}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'downsampling',
      header: t('ownership.governance.impact.downsampling', 'Rows downsampled'),
      render: (row) => <span className="tabular-nums">{fmtNumber(row.rows_downsampling, 0)}</span>,
    },
    {
      key: 'reclaim',
      header: t('ownership.governance.impact.reclaim', 'Reclaimable'),
      render: (row) => (
        <div>
          <span className="tabular-nums text-emerald-300">{formatBytes(row.bytes_reclaimable)}</span>
          <Text as="p" variant="caption">
            {formatPct(row.reclaim_share_pct)}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'fidelity',
      header: t('ownership.governance.impact.fidelity', 'Fidelity lost'),
      render: (row) => (
        <span
          className={`tabular-nums ${row.fidelity_loss_pct > 25 ? 'text-rose-300' : row.fidelity_loss_pct > 5 ? 'text-amber-300' : ''}`}
        >
          {formatPct(row.fidelity_loss_pct)}
        </span>
      ),
    },
    {
      key: 'runway',
      header: t('ownership.governance.impact.runway', 'Growth runway'),
      render: (row) => (
        <div>
          <Text as="p" variant="caption">
            {row.runway_days != null
              ? t('ownership.governance.impact.runwayDays', '{{count}} days', {
                  count: Math.round(row.runway_days),
                })
              : '—'}
          </Text>
          <Text as="p" variant="caption">
            {row.projected_daily_growth_bytes != null
              ? t('ownership.governance.impact.growth', '{{value}} / day', {
                  value: formatBytes(row.projected_daily_growth_bytes),
                })
              : '—'}
          </Text>
        </div>
      ),
    },
    {
      key: 'flags',
      header: t('ownership.governance.impact.flags', 'Flags'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.blocked_by_legal_hold ? (
            <Badge variant="danger">{t('ownership.governance.impact.blocked', 'legal hold')}</Badge>
          ) : null}
          {(row.warnings ?? []).map((warning) => (
            <Badge key={warning} variant="warning">
              {warning.replace(/_/g, ' ')}
            </Badge>
          ))}
          {!row.blocked_by_legal_hold && (row.warnings ?? []).length === 0 ? (
            <Text as="span" variant="caption">
              —
            </Text>
          ) : null}
        </div>
      ),
    },
  ];

  const runColumns: Column<RetentionRun>[] = [
    {
      key: 'executed',
      header: t('ownership.governance.run.executed', 'Executed'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.executed_at)}
        </Text>
      ),
      sortable: true,
    },
    {
      key: 'dataset',
      header: t('ownership.governance.run.dataset', 'Dataset'),
      render: (row) => row.dataset,
    },
    {
      key: 'mode',
      header: t('ownership.governance.run.mode', 'Mode'),
      render: (row) => <Badge variant="info">{row.mode.replace(/_/g, ' ')}</Badge>,
    },
    {
      key: 'expiring',
      header: t('ownership.governance.run.expiring', 'Expiring'),
      render: (row) => <span className="tabular-nums">{fmtNumber(row.rows_expiring, 0)}</span>,
    },
    {
      key: 'bytes',
      header: t('ownership.governance.run.bytes', 'Reclaimable'),
      render: (row) => <span className="tabular-nums">{formatBytes(row.bytes_reclaimable)}</span>,
    },
    {
      key: 'fidelity',
      header: t('ownership.governance.run.fidelity', 'Fidelity lost'),
      render: (row) => formatPct(row.fidelity_loss_pct),
    },
  ];

  return (
    <PageContainer
      title={t('ownership.governance.title', 'Data Retention & Lifecycle Governance')}
      subtitle={t(
        'ownership.governance.subtitle',
        'See exactly what every table costs you on disk, model a retention policy, and quantify the analytical fidelity you would trade away — before anything is deleted.',
      )}
      loading={overviewQuery.isLoading}
      error={overviewQuery.error as Error | null}
      actions={
        <Button
          variant="primary"
          size="sm"
          icon={<PlayCircle className="h-4 w-4" aria-hidden="true" />}
          loading={simulate.isPending}
          onClick={runSimulation}
        >
          {t('ownership.governance.simulate', 'Run dry-run plan')}
        </Button>
      }
    >
      <AlertBanner
        variant="warning"
        title={t('ownership.governance.notice.title', 'Plan only — nothing is ever deleted here')}
      >
        {t(
          'ownership.governance.notice.body',
          'Every run on this page is a read-only dry run. TeslaSync computes what a policy would remove and records the plan in the ledger; it never issues a delete. Enforcement remains a deliberate, separate operator action outside this screen.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel title={t('ownership.governance.summary.title', 'Storage posture')}>
          <StatGrid
            stats={[
              {
                key: 'total',
                label: t('ownership.governance.stat.total', 'Total governed footprint'),
                value: formatBytes(overview?.total_bytes ?? 0),
              },
              {
                key: 'governed',
                label: t('ownership.governance.stat.governed', 'Under a policy'),
                value: formatBytes(overview?.governed_bytes ?? 0),
                hint: formatPct(overview?.governed_share_pct ?? 0),
                tone: 'positive',
              },
              {
                key: 'ungoverned',
                label: t('ownership.governance.stat.ungoverned', 'No policy'),
                value: formatBytes(overview?.ungoverned_bytes ?? 0),
                tone: (overview?.ungoverned_bytes ?? 0) > 0 ? 'warning' : 'default',
              },
              {
                key: 'holds',
                label: t('ownership.governance.stat.holds', 'Legal holds'),
                value: fmtNumber(overview?.legal_hold_count ?? 0, 0),
                hint: t('ownership.governance.stat.holdsHint', 'Exempt from every plan'),
              },
              {
                key: 'mode',
                label: t('ownership.governance.stat.mode', 'Enforcement mode'),
                value: overview?.plan_only
                  ? t('ownership.governance.stat.planOnly', 'Plan only')
                  : t('ownership.governance.stat.enforcing', 'Enforcing'),
                tone: 'positive',
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.governance.inventory.title', 'Dataset inventory')}
          description={t(
            'ownership.governance.inventory.subtitle',
            'Live sizes read from the database catalog. Toggle datasets to scope the dry run.',
          )}
          empty={inventory.length === 0}
          emptyMessage={t(
            'ownership.governance.inventory.empty',
            'No governable datasets were found.',
          )}
          actions={<Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
        >
          <DataTable
            columns={inventoryColumns}
            data={inventory}
            keyExtractor={(row) => row.dataset}
            tableId="ownership-governance-inventory"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.governance.policies.title', 'Retention policies')}
          description={t(
            'ownership.governance.policies.subtitle',
            'A policy declares intent. It becomes a plan only when you run the simulation.',
          )}
          empty={policies.length === 0 && !formOpen}
          emptyMessage={t('ownership.governance.policies.empty', 'No retention policies defined.')}
          actions={
            <Button variant="secondary" size="sm" onClick={() => setFormOpen((open) => !open)}>
              {formOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.governance.policies.add', 'Define policy')}
            </Button>
          }
        >
          {formOpen ? (
            <form className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submitPolicy}>
              <Select
                label={t('ownership.governance.form.dataset', 'Dataset')}
                value={draft.dataset}
                options={datasetOptions}
                placeholder={t('ownership.governance.form.pickDataset', 'Select a dataset')}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, dataset: event.target.value }))
                }
              />
              <Input
                type="number"
                label={t('ownership.governance.form.retention', 'Retention (days)')}
                value={draft.retention_days}
                min={1}
                required
                onChange={(event) =>
                  setDraft((current) => ({ ...current, retention_days: Number(event.target.value) }))
                }
              />
              <Input
                type="number"
                label={t('ownership.governance.form.downsampleAfter', 'Downsample after (days)')}
                value={draft.downsample_after_days ?? ''}
                min={1}
                hint={t(
                  'ownership.governance.form.downsampleHint',
                  'Leave blank to keep full resolution',
                )}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    downsample_after_days:
                      event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              />
              <Input
                type="number"
                label={t('ownership.governance.form.bucket', 'Downsample bucket (seconds)')}
                value={draft.downsample_bucket_s ?? ''}
                min={1}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    downsample_bucket_s:
                      event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              />
              <div className="flex items-end gap-6">
                <Toggle
                  label={t('ownership.governance.form.hold', 'Legal hold')}
                  checked={draft.legal_hold}
                  onChange={(checked) =>
                    setDraft((current) => ({ ...current, legal_hold: checked }))
                  }
                />
                <Toggle
                  label={t('ownership.governance.form.enabled', 'Enabled')}
                  checked={draft.enabled}
                  onChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <Button type="submit" loading={upsert.isPending} disabled={!draft.dataset}>
                  {t('ownership.governance.form.save', 'Save policy')}
                </Button>
                <MutationError error={upsert.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={policyColumns}
            data={policies}
            keyExtractor={(row) => row.id}
            tableId="ownership-governance-policies"
            emptyMessage={t('ownership.governance.policies.empty', 'No retention policies defined.')}
          />
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.governance.impact.title', 'Dry-run impact')}
          description={t(
            'ownership.governance.impact.subtitle',
            'Fidelity loss is the share of analytical resolution the plan would remove — not the share of rows.',
          )}
          empty={impacts.length === 0}
          emptyMessage={t(
            'ownership.governance.impact.empty',
            'Run the dry-run plan above to see what a policy would reclaim.',
          )}
        >
          <StatGrid
            columns={4}
            stats={[
              {
                key: 'rows',
                label: t('ownership.governance.impactStat.rows', 'Rows in plan'),
                value: fmtNumber(simulate.data?.total_rows_expiring ?? 0, 0),
              },
              {
                key: 'bytes',
                label: t('ownership.governance.impactStat.bytes', 'Reclaimable'),
                value: formatBytes(simulate.data?.total_bytes_reclaimable ?? 0),
                tone: 'positive',
              },
              {
                key: 'fidelity',
                label: t('ownership.governance.impactStat.fidelity', 'Fidelity traded away'),
                value: formatPct(simulate.data?.total_fidelity_loss_pct ?? 0),
                tone: (simulate.data?.total_fidelity_loss_pct ?? 0) > 20 ? 'warning' : 'default',
              },
              {
                key: 'mode',
                label: t('ownership.governance.impactStat.mode', 'Executed'),
                value: t('ownership.governance.impactStat.never', 'Never — dry run'),
              },
            ]}
          />
          <div className="mt-4">
            <DataTable
              columns={impactColumns}
              data={impacts}
              keyExtractor={(row) => row.dataset}
              tableId="ownership-governance-impact"
            />
          </div>
          <MutationError error={simulate.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel
          title={t('ownership.governance.runs.title', 'Plan ledger')}
          description={t(
            'ownership.governance.runs.subtitle',
            'An append-only history of every plan computed, so retention decisions are auditable after the fact.',
          )}
          empty={runs.length === 0}
          emptyMessage={t('ownership.governance.runs.empty', 'No plans recorded yet.')}
          actions={<Lock className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
        >
          <DataTable
            columns={runColumns}
            data={runs}
            keyExtractor={(row) => row.id}
            tableId="ownership-governance-runs"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <EvidencePanel
          quality={overview?.quality}
          evidence={overview?.evidence}
          unsupported={[
            t(
              'ownership.governance.unsupported.delete',
              'Actually deleting rows — this screen is deliberately read-only',
            ),
            t(
              'ownership.governance.unsupported.index',
              'Index and TOAST overhead attribution below table granularity',
            ),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
