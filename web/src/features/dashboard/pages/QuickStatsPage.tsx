import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Car } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useAnalyticsSummary } from '@/api/hooks/useAnalytics';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtInt } from '@/lib/numberFormat';

export default function QuickStatsPage() {
  const { t } = useTranslation();
  usePageTitle(t('quickStats.title', 'Quick Stats'));

  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const { data: analytics, isLoading: analyticsLoading, error } = useAnalyticsSummary(30);
  const { convertDistance, distanceUnit } = useSettings();

  const isLoading = vehiclesLoading || analyticsLoading;
  const vehicle = vehicles?.[0];

  return (
    <PageContainer
      title={t('quickStats.title', 'Quick Stats')}
      loading={isLoading}
      error={error instanceof Error ? error : null}
      className="min-h-screen flex flex-col items-center justify-center p-4"
    >
      <div className="w-full max-w-md space-y-4">
        {/* Vehicle card */}
        <FadeIn>
          <GlassPanel className="p-4">
            {vehicle ? (
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-cyan-500/10 flex items-center justify-center">
                  <Car className="h-5 w-5 text-cyan-400" />
                </div>
                <div>
                  <p className="text-lg font-bold text-white/90">
                    {vehicle.display_name || t('quickStats.defaultName', 'Tesla')}
                  </p>
                  <p className="text-xs text-white/40">
                    {vehicle.model} · {vehicle.state}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState message={t('quickStats.noVehicle', 'No vehicle found')} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Key metrics */}
        <FadeIn delay={0.05}>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              label={t('quickStats.distance', '{{unit}} Driven', { unit: distanceUnit })}
              value={fmtInt(convertDistance(analytics?.totalDistanceKm ?? 0))}
              color="cyan"
            />
            <MetricCard
              label={t('quickStats.drives', 'Drives')}
              value={analytics?.totalDrives ?? 0}
              color="green"
            />
            <MetricCard
              label={t('quickStats.energy', 'kWh Used')}
              value={fmtInt(analytics?.totalEnergyKwh ?? 0)}
              color="amber"
            />
            <MetricCard
              label={t('quickStats.cost', 'Total Cost')}
              value={`$${fmtInt(analytics?.totalCost ?? 0)}`}
              color="purple"
            />
          </div>
        </FadeIn>

        {/* Footer */}
        <FadeIn delay={0.1}>
          <p className="text-center text-[10px] text-white/30">
            {t('quickStats.footer', 'Powered by TeslaSync')} ·{' '}
            <Link to="/" className="text-cyan-400 hover:underline">
              {t('quickStats.openDashboard', 'Open Dashboard')}
            </Link>
          </p>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
