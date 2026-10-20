import { useTranslation } from 'react-i18next';
import { Globe, PlugZap, ShieldCheck, Clock } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { StatGridSkeleton } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { RegionKpiBandProps } from '../tesla-region/RegionKpiBand';

export function RegionSummary({ known, ...props }: RegionKpiBandProps & { known: boolean }) {
  const { t } = useTranslation('settings');
  const { formatRelative } = useDateFormat();
  if (props.isLoading && !known) return <StatGridSkeleton cards={4} />;
  const regionSubtitle = props.regionLabel?.trim() ? props.regionLabel : t('region.kpi.regionUnknown', 'Not detected');
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <MetricCard label={t('region.kpi.region', 'Region')} value={props.regionKey?.toUpperCase() ?? '—'} subtitle={known ? regionSubtitle : '—'}
        icon={<Globe className="h-5 w-5" aria-hidden />} color="cyan" />
      <MetricCard label={t('region.kpi.status', 'Endpoint')}
        value={!known ? '—' : props.configured ? t('region.status.configured', 'Configured') : t('region.status.pending', 'Not configured')}
        subtitle={t('region.kpi.source', 'Tesla Fleet API')} icon={<PlugZap className="h-5 w-5" aria-hidden />} color={props.configured ? 'green' : 'amber'} />
      <MetricCard label={t('region.kpi.protocol', 'Protocol')} value={props.scheme?.toUpperCase() ?? '—'}
        subtitle={t('region.kpi.protocolHint', 'Secure transport')} icon={<ShieldCheck className="h-5 w-5" aria-hidden />} color="blue" />
      <MetricCard label={t('region.kpi.synced', 'Last synced')} value={props.fetchedAt ? formatRelative(new Date(props.fetchedAt)) : '—'}
        subtitle={t('region.kpi.syncedHint', 'From Tesla account')} icon={<Clock className="h-5 w-5" aria-hidden />} color="purple" />
    </div>
  );
}
