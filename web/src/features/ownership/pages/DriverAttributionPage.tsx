import { type FormEvent, useMemo, useState } from 'react';
import { Fingerprint, Trash2, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAssignDrive,
  useCreateDriverProfile,
  useDeleteDriverProfile,
  useDriverAttribution,
  useDriverProfiles,
} from '@/api/hooks/useOwnership';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
  chartMargin,
} from '@/components/charts';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, DataTable, Input, Select, Text, Toggle } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveFingerprint, DriverCluster, DriverProfile } from '@/types/ownership';
import {
  EvidencePanel,
  MutationError,
  OwnershipPanel,
  StatGrid,
  VerdictBadge,
} from '../components';
import { formatCurrencyMinor, formatEfficiencyFromSI, formatPct, formatSpan } from '../formatters';

const WINDOW_OPTIONS = [30, 60, 90, 180, 365];
const ACCENTS = ['cyan', 'emerald', 'amber', 'purple', 'rose', 'indigo'];

const ACCENT_HEX: Record<string, string> = {
  cyan: '#22d3ee',
  emerald: '#34d399',
  amber: '#fbbf24',
  purple: '#c084fc',
  rose: '#fb7185',
  indigo: '#818cf8',
};

function accentText(accent: string): string {
  switch (accent) {
    case 'emerald':
      return 'text-emerald-300';
    case 'amber':
      return 'text-amber-300';
    case 'purple':
      return 'text-purple-300';
    case 'rose':
      return 'text-rose-300';
    case 'indigo':
      return 'text-indigo-300';
    default:
      return 'text-cyan-300';
  }
}

export default function DriverAttributionPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [windowDays, setWindowDays] = useState(90);
  const [profileOpen, setProfileOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    name: '',
    accent: 'cyan',
    is_primary: false,
  });
  const [assignDraft, setAssignDraft] = useState({ drive_id: 0, driver_profile_id: 0 });

  usePageTitle(t('ownership.driver.navTitle', 'Driver Fingerprinting'));

  const driverAttrHidden = useHiddenSeries('driver-attribution-chart');

  const reportQuery = useDriverAttribution(vehicleId, windowDays, 100, 0);
  const profilesQuery = useDriverProfiles(vehicleId);
  const createProfile = useCreateDriverProfile();
  const deleteProfile = useDeleteDriverProfile();
  const assign = useAssignDrive();

  const report = reportQuery.data;
  const clusters = useMemo(() => report?.clusters ?? [], [report?.clusters]);
  const fingerprints = useMemo(() => report?.fingerprints ?? [], [report?.fingerprints]);
  const profiles = useMemo(() => profilesQuery.data?.items ?? [], [profilesQuery.data?.items]);
  const currency = report?.currency ?? 'USD';

  const shareData = useMemo(
    () =>
      clusters.map((cluster) => ({
        name: cluster.driver_name || t('ownership.driver.unnamed', 'Cluster {{id}}', {
          id: cluster.cluster_id + 1,
        }),
        share: Number(cluster.share_pct.toFixed(1)),
        aggression: Number(cluster.aggression_score.toFixed(1)),
        accent: cluster.accent,
      })),
    [clusters, t],
  );

  const submitProfile = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    createProfile.mutate(
      { ...profileDraft, vehicle_id: vehicleId },
      {
        onSuccess: () => {
          setProfileOpen(false);
          setProfileDraft({ name: '', accent: 'cyan', is_primary: false });
        },
      },
    );
  };

  const submitAssignment = (event: FormEvent) => {
    event.preventDefault();
    if (assignDraft.drive_id <= 0 || assignDraft.driver_profile_id <= 0) return;
    assign.mutate(
      { ...assignDraft, confirmed: true },
      { onSuccess: () => setAssignOpen(false) },
    );
  };

  const clusterColumns: Column<DriverCluster>[] = [
    {
      key: 'name',
      header: t('ownership.driver.cluster.name', 'Behaviour cluster'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Fingerprint className={`h-4 w-4 ${accentText(row.accent)}`} aria-hidden="true" />
          <div>
            <Text as="p" variant="label">
              {row.driver_name ||
                t('ownership.driver.unnamed', 'Cluster {{id}}', { id: row.cluster_id + 1 })}
            </Text>
            <Text as="p" variant="caption">
              {row.driver_profile_id != null
                ? t('ownership.driver.cluster.labelled', '{{count}} labelled drives', {
                    count: row.labelled_count,
                  })
                : t('ownership.driver.cluster.unlabelled', 'Not yet named')}
            </Text>
          </div>
        </div>
      ),
    },
    {
      key: 'drives',
      header: t('ownership.driver.cluster.drives', 'Drives'),
      render: (row) => (
        <div>
          <span className="tabular-nums">{fmtNumber(row.drive_count, 0)}</span>
          <Text as="p" variant="caption">
            {formatPct(row.share_pct, 0)}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'distance',
      header: t('ownership.driver.cluster.distance', 'Distance'),
      render: (row) => <span className="tabular-nums">{units.formatDistance(row.distance_m)}</span>,
      sortable: true,
    },
    {
      key: 'efficiency',
      header: t('ownership.driver.cluster.efficiency', 'Efficiency'),
      render: (row) => (
        <span className="tabular-nums">
          {formatEfficiencyFromSI(row.efficiency_wh_per_m, units.unitPrefs)}
        </span>
      ),
    },
    {
      key: 'speed',
      header: t('ownership.driver.cluster.speed', 'Avg speed'),
      render: (row) => (
        <span className="tabular-nums">
          {row.avg_speed_mps != null ? units.formatSpeed(row.avg_speed_mps) : '—'}
        </span>
      ),
    },
    {
      key: 'regen',
      header: t('ownership.driver.cluster.regen', 'Regen share'),
      render: (row) => (
        <span className="tabular-nums">
          {row.regen_share_pct != null ? formatPct(row.regen_share_pct) : '—'}
        </span>
      ),
    },
    {
      key: 'night',
      header: t('ownership.driver.cluster.night', 'Night share'),
      render: (row) => <span className="tabular-nums">{formatPct(row.night_share_pct, 0)}</span>,
    },
    {
      key: 'aggression',
      header: t('ownership.driver.cluster.aggression', 'Aggression'),
      render: (row) => (
        <div className="min-w-[6rem]">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-amber-400/70"
              style={{ width: `${Math.min(100, Math.max(0, row.aggression_score))}%` }}
            />
          </div>
          <span className="tabular-nums text-xs text-[var(--text-muted)]">
            {fmtNumber(row.aggression_score, 0)}/100
          </span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'cost',
      header: t('ownership.driver.cluster.cost', 'Energy cost share'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.cost_share_minor, currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'cohesion',
      header: t('ownership.driver.cluster.cohesion', 'Cohesion'),
      render: (row) => (
        <span className="tabular-nums">{fmtNumber(row.cohesion, 2)}</span>
      ),
    },
  ];

  const fingerprintColumns: Column<DriveFingerprint>[] = [
    {
      key: 'drive',
      header: t('ownership.driver.fp.drive', 'Drive'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            #{row.drive_id}
          </Text>
          <Text as="p" variant="caption">
            {formatDateTime(row.started_at)}
          </Text>
        </div>
      ),
    },
    {
      key: 'attribution',
      header: t('ownership.driver.fp.attribution', 'Attributed to'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Text as="span" variant="label">
            {row.driver_name ||
              t('ownership.driver.unnamed', 'Cluster {{id}}', { id: row.cluster_id + 1 })}
          </Text>
          <Badge variant={row.source === 'labelled' ? 'success' : 'info'}>
            {row.source === 'labelled'
              ? t('ownership.driver.fp.labelled', 'confirmed')
              : t('ownership.driver.fp.inferred', 'inferred')}
          </Badge>
          {row.ambiguous ? (
            <Badge variant="warning">{t('ownership.driver.fp.ambiguous', 'ambiguous')}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'confidence',
      header: t('ownership.driver.fp.confidence', 'Confidence'),
      render: (row) => (
        <span
          className={`tabular-nums ${row.confidence_pct >= 75 ? 'text-emerald-300' : row.confidence_pct >= 50 ? 'text-amber-300' : 'text-rose-300'}`}
        >
          {formatPct(row.confidence_pct, 0)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'distance',
      header: t('ownership.driver.fp.distance', 'Distance'),
      render: (row) => <span className="tabular-nums">{units.formatDistance(row.distance_m)}</span>,
      sortable: true,
    },
    {
      key: 'duration',
      header: t('ownership.driver.fp.duration', 'Duration'),
      render: (row) => formatSpan(row.duration_s),
    },
    {
      key: 'margin',
      header: t('ownership.driver.fp.margin', 'Separation margin'),
      render: (row) =>
        row.distance_to_next_centroid != null ? (
          <span className="tabular-nums">
            {fmtNumber(row.distance_to_next_centroid - row.distance_to_own_centroid, 3)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'features',
      header: t('ownership.driver.fp.features', 'Dominant traits'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {(row.features ?? [])
            .slice()
            .sort((a, b) => b.normalised * b.weight - a.normalised * a.weight)
            .slice(0, 3)
            .map((feature) => (
              <Badge key={feature.code} variant="neutral">
                {feature.label}
              </Badge>
            ))}
        </div>
      ),
    },
    {
      key: 'assign',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAssignDraft({
              drive_id: row.drive_id,
              driver_profile_id: profiles[0]?.id ?? 0,
            });
            setAssignOpen(true);
          }}
        >
          {t('ownership.driver.fp.assign', 'Label')}
        </Button>
      ),
    },
  ];

  const profileColumns: Column<DriverProfile>[] = [
    {
      key: 'name',
      header: t('ownership.driver.profile.name', 'Driver'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: ACCENT_HEX[row.accent] ?? ACCENT_HEX.cyan }}
          />
          <Text as="span" variant="label">
            {row.name}
          </Text>
          {row.is_primary ? (
            <Badge variant="info">{t('ownership.driver.profile.primary', 'primary')}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'created',
      header: t('ownership.driver.profile.created', 'Created'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.created_at)}
        </Text>
      ),
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          onClick={() => deleteProfile.mutate(row.id)}
        >
          {t('ownership.action.remove', 'Remove')}
        </Button>
      ),
    },
  ];

  return (
    <PageContainer
      title={t('ownership.driver.title', 'Driver Fingerprinting & Attribution')}
      subtitle={t(
        'ownership.driver.subtitle',
        'Group drives by how they were driven — speed discipline, power draw, regen use and departure hour — then attach a name once and let every future drive inherit it.',
      )}
      loading={reportQuery.isLoading}
      error={reportQuery.error as Error | null}
      actions={
        <div className="flex items-center gap-2">
          <Select
            aria-label={t('ownership.window.label', 'Analysis window')}
            value={String(windowDays)}
            options={WINDOW_OPTIONS.map((days) => ({
              value: String(days),
              label: t('ownership.window.days', '{{count}} days', { count: days }),
            }))}
            onChange={(event) => setWindowDays(Number(event.target.value))}
          />
          <VehicleSelect withIcon />
        </div>
      }
    >
      <AlertBanner
        variant="info"
        title={t('ownership.driver.notice.title', 'Behavioural, never biometric')}
      >
        {t(
          'ownership.driver.notice.body',
          'Clusters are derived only from drive dynamics already stored on this server. No cameras, no seat sensors, no accounts. A cluster stays anonymous until you choose to name it.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel title={t('ownership.driver.summary.title', 'Separation quality')}>
          <StatGrid
            stats={[
              {
                key: 'clusters',
                label: t('ownership.driver.stat.clusters', 'Distinct clusters'),
                value: fmtNumber(clusters.length, 0),
              },
              {
                key: 'separation',
                label: t('ownership.driver.stat.separation', 'Separation score'),
                value:
                  report?.separation_score != null
                    ? fmtNumber(report.separation_score, 2)
                    : '—',
                hint: report?.separation_verdict,
                tone:
                  report?.separation_verdict === 'strong'
                    ? 'positive'
                    : report?.separation_verdict === 'weak'
                      ? 'warning'
                      : 'default',
              },
              {
                key: 'labelled',
                label: t('ownership.driver.stat.labelled', 'Confirmed drives'),
                value: fmtNumber(report?.labelled_drive_count ?? 0, 0),
                tone: 'positive',
              },
              {
                key: 'inferred',
                label: t('ownership.driver.stat.inferred', 'Inferred drives'),
                value: fmtNumber(report?.inferred_drive_count ?? 0, 0),
              },
              {
                key: 'ambiguous',
                label: t('ownership.driver.stat.ambiguous', 'Ambiguous drives'),
                value: fmtNumber(report?.ambiguous_drive_count ?? 0, 0),
                tone: (report?.ambiguous_drive_count ?? 0) > 0 ? 'warning' : 'default',
                hint: t(
                  'ownership.driver.stat.ambiguousHint',
                  'Two clusters fit almost equally well',
                ),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.driver.chart.title', 'Cluster mix and driving intensity')}
          empty={shareData.length === 0}
          emptyMessage={t(
            'ownership.driver.chart.empty',
            'Not enough drives in this window to separate behaviour clusters.',
          )}
        >
          <ChartContainer
            title={t('ownership.driver.chart.inner', 'Share of drives by cluster')}
            ariaLabel={t(
              'ownership.driver.chart.aria',
              'Bar chart of drive share and aggression score per behaviour cluster',
            )}
            data={shareData}
            dataColumns={[
              { key: 'name', label: t('ownership.driver.chart.col.cluster', 'Cluster') },
              {
                key: 'share',
                label: t('ownership.driver.chart.col.share', 'Share of drives'),
                format: (v) => formatPct(v as number, 1),
              },
              {
                key: 'aggression',
                label: t('ownership.driver.chart.col.aggression', 'Aggression score'),
                format: (v) => fmtNumber(v as number, 1),
              },
            ]}
            height={280}
            chartKey="driver-attribution-chart"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={shareData} margin={chartMargin}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="name" tick={axisTick} />
                <YAxis tick={axisTick} unit="%" />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={driverAttrHidden} />
                <Bar
                  dataKey="share"
                  name={t('ownership.driver.chart.col.share', 'Share of drives')}
                  radius={[4, 4, 0, 0]}
                  hide={driverAttrHidden.isHidden('share')}
                >
                  {shareData.map((entry, index) => (
                    <Cell
                      key={`share-${index}`}
                      fill={ACCENT_HEX[entry.accent] ?? ACCENT_HEX.cyan}
                    />
                  ))}
                </Bar>
                <Bar
                  dataKey="aggression"
                  name={t('ownership.driver.chart.col.aggression', 'Aggression score')}
                  fill="rgba(251,191,36,0.35)"
                  radius={[4, 4, 0, 0]}
                  hide={driverAttrHidden.isHidden('aggression')}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.driver.clusters.title', 'Cluster characteristics')}
          description={t(
            'ownership.driver.clusters.subtitle',
            'Cohesion is the mean feature distance inside the cluster — lower is tighter.',
          )}
          empty={clusters.length === 0}
          emptyMessage={t('ownership.driver.clusters.empty', 'No clusters formed yet.')}
        >
          <DataTable
            columns={clusterColumns}
            data={clusters}
            keyExtractor={(row) => row.cluster_id}
            tableId="ownership-driver-clusters"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.driver.profiles.title', 'Named drivers')}
          description={t(
            'ownership.driver.profiles.subtitle',
            'Name a cluster once by labelling any drive it contains; the whole cluster inherits the name.',
          )}
          empty={profiles.length === 0 && !profileOpen}
          emptyMessage={t('ownership.driver.profiles.empty', 'No driver profiles created yet.')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setProfileOpen((open) => !open)}
            >
              {profileOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.driver.profiles.add', 'Add driver')}
            </Button>
          }
        >
          {profileOpen ? (
            <form className="mb-6 grid gap-4 md:grid-cols-3" onSubmit={submitProfile}>
              <Input
                label={t('ownership.driver.form.name', 'Display name')}
                value={profileDraft.name}
                required
                maxLength={80}
                onChange={(event) =>
                  setProfileDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
              <Select
                label={t('ownership.driver.form.accent', 'Accent colour')}
                value={profileDraft.accent}
                options={ACCENTS.map((accent) => ({ value: accent, label: accent }))}
                onChange={(event) =>
                  setProfileDraft((current) => ({ ...current, accent: event.target.value }))
                }
              />
              <div className="flex items-end gap-4">
                <Toggle
                  label={t('ownership.driver.form.primary', 'Primary driver')}
                  checked={profileDraft.is_primary}
                  onChange={(checked) =>
                    setProfileDraft((current) => ({ ...current, is_primary: checked }))
                  }
                />
                <Button type="submit" loading={createProfile.isPending} disabled={vehicleId == null}>
                  {t('ownership.action.save', 'Save')}
                </Button>
              </div>
              <div className="md:col-span-3">
                <MutationError error={createProfile.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={profileColumns}
            data={profiles}
            keyExtractor={(row) => row.id}
            tableId="ownership-driver-profiles"
            emptyMessage={t('ownership.driver.profiles.empty', 'No driver profiles created yet.')}
          />
          <MutationError error={deleteProfile.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel
          title={t('ownership.driver.fingerprints.title', 'Drive fingerprints')}
          description={t(
            'ownership.driver.fingerprints.subtitle',
            'Every drive scored against each cluster centroid. Labelling one drive re-anchors the whole cluster.',
          )}
          empty={fingerprints.length === 0}
          emptyMessage={t(
            'ownership.driver.fingerprints.empty',
            'No drives with sufficient telemetry in this window.',
          )}
        >
          {assignOpen ? (
            <form
              className="mb-6 grid gap-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4 md:grid-cols-3"
              onSubmit={submitAssignment}
            >
              <Input
                type="number"
                label={t('ownership.driver.assign.drive', 'Drive ID')}
                value={assignDraft.drive_id}
                min={1}
                required
                onChange={(event) =>
                  setAssignDraft((current) => ({
                    ...current,
                    drive_id: Number(event.target.value),
                  }))
                }
              />
              <Select
                label={t('ownership.driver.assign.driver', 'Driver')}
                value={String(assignDraft.driver_profile_id)}
                options={profiles.map((profile) => ({
                  value: String(profile.id),
                  label: profile.name,
                }))}
                placeholder={t('ownership.driver.assign.pick', 'Select a driver')}
                onChange={(event) =>
                  setAssignDraft((current) => ({
                    ...current,
                    driver_profile_id: Number(event.target.value),
                  }))
                }
              />
              <div className="flex items-end gap-2">
                <Button type="submit" loading={assign.isPending} disabled={profiles.length === 0}>
                  {t('ownership.driver.assign.submit', 'Confirm label')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAssignOpen(false)}>
                  {t('ownership.action.cancel', 'Cancel')}
                </Button>
              </div>
              <div className="md:col-span-3">
                <MutationError error={assign.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={fingerprintColumns}
            data={fingerprints}
            keyExtractor={(row) => row.drive_id}
            tableId="ownership-driver-fingerprints"
          />
          {report && report.total > fingerprints.length ? (
            <Text as="p" variant="caption">
              {t('ownership.driver.fingerprints.more', 'Showing {{shown}} of {{total}} drives', {
                shown: fingerprints.length,
                total: report.total,
              })}
            </Text>
          ) : null}
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <OwnershipPanel title={t('ownership.driver.verdict.title', 'Interpretation')}>
          <div className="flex flex-wrap items-center gap-3">
            <VerdictBadge value={report?.separation_verdict ?? 'unknown'} />
            <Text as="p" variant="bodySm">
              {report?.separation_verdict === 'strong'
                ? t(
                    'ownership.driver.verdict.strong',
                    'Clusters are well separated — attributions can be trusted for cost splitting.',
                  )
                : report?.separation_verdict === 'moderate'
                  ? t(
                      'ownership.driver.verdict.moderate',
                      'Clusters overlap somewhat. Label a few more drives per cluster to sharpen the boundary.',
                    )
                  : t(
                      'ownership.driver.verdict.weak',
                      'Behaviour is too similar to separate reliably. Treat attributions as indicative only.',
                    )}
            </Text>
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <EvidencePanel
          quality={report?.quality}
          evidence={report?.evidence}
          unsupported={[
            t(
              'ownership.driver.unsupported.identity',
              'Proving who was physically in the seat — this infers behaviour, not identity',
            ),
            t(
              'ownership.driver.unsupported.passengers',
              'Distinguishing a driver who deliberately changes style from a second driver',
            ),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
