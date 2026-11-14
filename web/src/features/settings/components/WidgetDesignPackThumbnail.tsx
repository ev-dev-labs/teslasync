import { useTranslation } from 'react-i18next';
import { Sparkline } from '@/components/charts';
import { GlassPanel, MetricValue, Text } from '@/components/ui';
import { APPLICATION_DESIGNS, getAppDesignAttributes } from '@/components/ui/app-designs/designs';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import { cn } from '@/lib/cn';

const SAMPLE_TREND = [3, 5, 4, 7, 6, 9];

export default function WidgetDesignPackThumbnail({ packId, chartColor }: { packId: PackId; chartColor: string }) {
  const { t } = useTranslation('settings');
  const verticalNavigation = ['rail', 'sidebar'].includes(APPLICATION_DESIGNS[packId].navigation);
  return <div aria-hidden="true" data-app-design-thumbnail={packId} data-app-design-preview=""
    {...getAppDesignAttributes(packId)}
    className="@container pointer-events-none h-64 min-w-0 w-full shrink-0 overflow-hidden rounded-shape-md border border-[var(--border-subtle)] bg-[var(--bg-app)]">
    <div data-app-part="shell" className={cn('flex h-full min-w-0', !verticalNavigation && 'flex-col')}>
      <div data-app-part="shell-sidebar navigation" className={cn(
        'flex shrink-0 gap-1 border-[var(--border-default)] bg-[var(--surface-1)] p-1',
        verticalNavigation ? 'w-10 flex-col border-e' : 'border-b',
      )}>
        {[0, 1, 2].map(item => (
          <div key={item} data-app-part="nav-item" aria-current={item === 0 ? 'page' : undefined}
            className="flex min-h-4 min-w-0 items-center rounded-shape-sm px-1">
            <span className="h-1 w-5 rounded-pill bg-[var(--text-secondary)]" />
          </div>
        ))}
      </div>
      <div data-app-part="shell-main page" className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 p-2">
        <div data-app-part="page-header" className="flex min-w-0 items-center">
          <Text data-app-part="page-title" size="sm" weight="semibold" color="primary" className="truncate">
            {t('theme.appDesignPreview.overview', 'Overview')}
          </Text>
        </div>
        <div data-app-part="page-content grid" className="grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-1">
          <GlassPanel data-app-part="panel metric" data-app-metric="stat-card" padding="sm"
            className="flex min-h-0 min-w-0 flex-col justify-between gap-1 overflow-hidden">
            <Text data-app-part="metric-label" variant="caption" className="truncate">
              {t('theme.widgetDesignPacks.battery', 'Battery')}
            </Text>
            <MetricValue data-app-part="metric-value">72%</MetricValue>
            <div data-app-part="metric" data-app-metric="bar" className="h-1 rounded-pill bg-[var(--surface-2)]">
              <div data-metric-fill className="h-full w-3/4 rounded-pill bg-[var(--theme-primary)]" />
            </div>
          </GlassPanel>
          <GlassPanel data-app-part="panel chart" padding="sm"
            className="flex min-h-0 min-w-0 flex-col justify-between gap-1 overflow-hidden">
            <Text variant="caption" className="truncate">{t('theme.widgetDesignPacks.history', 'History')}</Text>
            <Sparkline data={SAMPLE_TREND} color={chartColor} />
          </GlassPanel>
        </div>
      </div>
    </div>
  </div>;
}
