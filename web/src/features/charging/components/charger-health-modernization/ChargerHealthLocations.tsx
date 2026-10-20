import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { LayoutCard, useCardPlacement } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { Badge, DataTable, HelpTooltip, Text, type Column } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { DataState } from '@/api/dataState';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { ChargerHealthSummary, ChargerSite, SiteStatus } from '../../lib/chargerHealth';
import { ChargerHealthSourceNotice } from './ChargerHealthSourceNotice';

const STATUS_BADGE: Record<SiteStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success', degrading: 'warning', degraded: 'danger', unknown: 'neutral',
};
const STATUS_DEFAULT: Record<SiteStatus, string> = {
  healthy: 'Healthy', degrading: 'Slipping', degraded: 'Degraded', unknown: 'Not enough data',
};

interface ChargerHealthLocationsProps {
  summary: ChargerHealthSummary;
  state: DataState<unknown>;
  loading: boolean;
}

export function ChargerHealthLocations({ summary, state, loading }: ChargerHealthLocationsProps) {
  const { t } = useTranslation();
  const { formatPower, formatEnergy, unitPrefs } = useUnits();
  const { formatDateShort } = useDateFormat();
  const placement = useCardPlacement();
  const sites = summary.sites ?? [];
  const status = (site: ChargerSite) => t(`chargerHealth.status.${site.status}`, STATUS_DEFAULT[site.status]);
  const kind = (site: ChargerSite) => site.kind === 'dc' ? t('chargerHealth.dc', 'DC') : t('chargerHealth.ac', 'AC');
  // The specialist's 0 baseline for an unrated site is a sentinel, not a measurement.
  const baseline = (site: ChargerSite) => site.status === 'unknown' ? '—' : formatPower(site.baselineW);
  const recent = (site: ChargerSite) => site.ratedSessions > 0 ? formatPower(site.recentW) : '—';
  const visits = (site: ChargerSite) => t('chargerHealth.visitsValue', '{{n}} ({{rated}} scored)', {
    n: fmtNumber(site.sessions, 0, unitPrefs.locale),
    rated: fmtNumber(site.ratedSessions, 0, unitPrefs.locale),
  });
  const lastSeen = (site: ChargerSite) => formatDateShort(new Date(site.lastSeenMs));
  const cost = (site: ChargerSite) => site.status === 'unknown' ? '—'
    : t('chargerHealth.costValue', '{{h}} h/year', {
      h: fmtNumber(Math.round(site.hoursLostPerYear), 0, unitPrefs.locale),
    });
  const columns: Column<ChargerSite>[] = [
    { key: 'label', header: t('chargerHealth.col.site', 'Site'), render: site => site.label },
    {
      key: 'status', header: t('chargerHealth.col.status', 'Status'),
      render: site => <Badge variant={STATUS_BADGE[site.status]}>{status(site)}</Badge>,
      exportValue: status,
    },
    {
      key: 'kind', header: t('chargerHealth.locations.kind', 'Inferred AC / DC class'),
      render: site => <Badge variant="neutral" size="sm">{kind(site)}</Badge>, exportValue: kind,
    },
    { key: 'baseline', header: t('chargerHealth.baselinePower', 'Baseline'), render: baseline, exportValue: baseline },
    { key: 'recent', header: t('chargerHealth.recentPower', 'Recent'), render: recent, exportValue: recent },
    {
      key: 'energy', header: t('chargerHealth.energy', 'Energy taken'),
      render: site => formatEnergy(site.totalEnergyWh), exportValue: site => formatEnergy(site.totalEnergyWh),
    },
    { key: 'visits', header: t('chargerHealth.visits', 'Visits'), render: visits, exportValue: visits },
    { key: 'lastSeen', header: t('chargerHealth.lastSeen', 'Last visit'), render: lastSeen, exportValue: lastSeen },
    { key: 'cost', header: t('chargerHealth.cost', 'Costs you'), render: cost, exportValue: cost },
  ];
  const displayValue = (site: ChargerSite, key: string): string | null => {
    switch (key) {
      case 'label': return site.label;
      case 'status': return status(site);
      case 'kind': return kind(site);
      case 'baseline': return baseline(site);
      case 'recent': return recent(site);
      case 'energy': return formatEnergy(site.totalEnergyWh);
      case 'visits': return visits(site);
      case 'lastSeen': return lastSeen(site);
      case 'cost': return cost(site);
      default: return null;
    }
  };

  return <FadeIn delay={0.2} className={cn('min-w-0', placement?.className ?? 'col-span-full')}>
    <LayoutCard
    title={t('chargerHealth.detail', 'Locations')}
    footer={<>
      <Text as="p" variant="bodySm">
        {t('chargerHealth.locations.method', 'The unchanged model requires at least 4 clean sessions, each at least 10 minutes and 2 kWh. Sessions mostly above 80% state of charge are excluded from scoring. The baseline is the high quantile of clean power; recent power averages up to 5 clean sessions. Below 90% is slipping; below 75% is degraded. AC / DC is inferred from observed mean power above 25 kW, not read from charger hardware.')}
      </Text>
      <Text as="p" variant="bodySm">
        {t('chargerHealth.presentation.locationScope',
          'Visits, energy and last visit describe model-admitted sessions only, including tapered sessions. Excluded observations are not included. Annual time loss is a model estimate: rated zero means no modeled loss; unrated remains unknown.')}
      </Text>
    </>}
    actions={<HelpTooltip
      size="sm"
      i18nKey="help.chargerHealth.locationAggregation"
      defaultValue="Sessions are grouped approximately by case-insensitive place name, or by a rounded 0.01-degree coordinate cell when no name is known. A group can combine multiple stalls and AC / DC sessions. Its single AC / DC class is inferred from admitted mean power, not a hardware or individual-stall identity."
      ariaLabel={t('help.chargerHealth.iconLabel', 'More info about site grouping')}
    />}
  >
    <ChargerHealthSourceNotice state={state} />
    {loading ? <Skeleton height={180} /> : state.hasData ? (
      sites.length === 0 ? <EmptyState
        icon={<MapPin className="h-8 w-8" aria-hidden="true" />}
        message={t('chargerHealth.noSites', 'No charging locations recorded yet.')}
        action={state.retry ? { label: t('common.retry', 'Retry'), onClick: state.retry } : undefined}
      /> : <DataTable
        tableId="charging:charger-health-locations"
        name={t('chargerHealth.detail', 'Locations')}
        caption={t('chargerHealth.detail', 'Locations')}
        variant="embedded"
        columns={columns}
        data={sites}
        keyExtractor={site => site.key}
        rowLabel={site => site.label}
        pagination={false}
        searchable={false}
        exportable={false}
        mobileColumns={['label', 'status', 'recent']}
        mobilePresentation={{
          variant: 'cards',
          roles: {
            label: 'title', status: 'badge', recent: 'primary',
            kind: 'meta', baseline: 'meta', energy: 'hidden', visits: 'meta',
            lastSeen: 'hidden', cost: 'hidden',
          },
          displayValue,
          // DataTable's allColumns detail drawer already renders ALL fields,
          // including hidden metadata; allDetails would duplicate those fields.
        }}
      />
    ) : null}
    </LayoutCard>
  </FadeIn>;
}
