import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useDrivingCoach } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import { WidgetTipCards, type TipItem } from './shared';
import { safeArray } from '@/lib/safeArray';
import { useDataState } from '@/hooks/useDataState';
import type { WidgetProps } from './types';

export default function DrivingCoachWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = useDrivingCoach(vehicleIdStr);

  const isCompact = size.cols <= 1;

  const recommendations = useMemo(() => safeArray(data?.recommendations), [data?.recommendations]);
  const trust = useDataState({
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  }, { provenance: 'inferred' });

  const tips: TipItem[] = useMemo(
    () =>
      recommendations.map((rec, i) => ({
        id: i,
        icon: <Lightbulb className="h-4 w-4" aria-hidden="true" />,
        title: rec.category ?? '—',
        description: rec.tip ?? '—',
      })),
    [recommendations],
  );

  const shellProps = {
    dataState: trust.hasData ? trust : undefined,
    loading: isLoading,
    error: trust.fatalError?.message ?? null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell title={t('widget.drivingCoach.title', 'Driving coach')} {...shellProps}>
        <div className="flex h-full flex-col items-center justify-center gap-2 min-h-[44px]">
          {recommendations.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Lightbulb className="h-5 w-5" aria-hidden="true" />}
              message={t('widget.drivingCoach.noTips', 'No tips available')}
              className="py-2"
            />
          ) : (
            <WidgetTipCards
              tips={tips}
              maxTips={1}
              compact
              emptyMessage={t('widget.drivingCoach.noTips', 'No tips available')}
              emptyIcon={<Lightbulb className="h-5 w-5" aria-hidden="true" />}
            />
          )}
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.drivingCoach.title', 'Driving coach')}
      icon={<Lightbulb className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />}
      {...shellProps}
    >
      <div className="flex min-h-full min-w-0 flex-col gap-3">
        <div className="flex-1 min-h-0">
          <WidgetTipCards
            tips={tips}
            maxTips={3}
            compact={false}
            emptyMessage={t('widget.drivingCoach.noTips', 'No tips available')}
            emptyIcon={<Lightbulb className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
      </div>
    </WidgetShell>
  );
}
