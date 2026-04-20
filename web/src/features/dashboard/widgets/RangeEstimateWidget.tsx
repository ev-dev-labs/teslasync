import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function RangeEstimateWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading } = useVehicleState(id);
  const { convertDistance, distanceUnit } = useSettings();
  const state = stateData?.state;

  return (
    <WidgetShell loading={isLoading}>
      <div className="h-full flex flex-col justify-center">
        {state ? (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">
                {t('widget.ratedRange', 'Rated Range')}
              </p>
              <p className="text-xl font-bold text-neon-cyan">
                {fmtNumber(convertDistance(state.rated_range), 0)} {distanceUnit}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-white/40 uppercase tracking-wider">
                {t('widget.idealRange', 'Ideal Range')}
              </p>
              <p className="text-lg font-semibold text-white/90">
                {fmtNumber(convertDistance(state.ideal_range), 0)} {distanceUnit}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<Gauge className="h-6 w-6" />}
            message={t('widget.noRange', 'No range data')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
