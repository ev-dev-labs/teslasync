import { useTranslation } from 'react-i18next';
import { CarFront, CheckCircle2, AlertCircle } from 'lucide-react';
import { Badge, Text } from '@/components/ui';
import { ProgressRing } from '@/components/data-display';
import { Grid, LayoutCard } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import type { VehiclePlanResult } from '../lib/types';

interface VehicleReadinessPanelProps {
  vehicles: VehiclePlanResult[];
}

/** Per-vehicle readiness: progress toward target SoC, delivered/unmet energy, and deadline outcome. */
export function VehicleReadinessPanel({ vehicles }: VehicleReadinessPanelProps) {
  const { t } = useTranslation();
  const { formatEnergy } = useUnits();

  return (
    <LayoutCard title={t('homeEnergy.readiness.title', 'Per-vehicle readiness')}>
      {vehicles.length === 0 ? (
        <EmptyState
          icon={<CarFront className="h-8 w-8" />}
          message={t('homeEnergy.readiness.empty', 'No vehicles are part of this plan.')}
          actionTo={{ label: t('homeEnergy.readiness.addVehicle', 'Add a vehicle'), to: '/vehicles' }}
        />
      ) : (
        <Grid cols={{ default: 1, sm: 2, lg: 3 }} gap={4}>
          {vehicles.map((v) => (
            <div
              key={v.vehicleId}
              className="flex min-w-0 flex-wrap items-center gap-4 rounded-lg border border-[var(--border-subtle)] p-3"
            >
              <ProgressRing
                value={v.finalSocPct}
                max={100}
                size={64}
                strokeWidth={6}
                color={v.readinessAchieved ? '#10b981' : '#f59e0b'}
                ariaLabel={t('homeEnergy.readiness.ringAria', '{{name}} projected state of charge', { name: v.name })}
                centerLabel={`${Math.round(v.finalSocPct)}%`}
                centerSubLabel={t('homeEnergy.readiness.ofTarget', 'of {{target}}%', { target: Math.round(v.targetSocPct) })}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Text variant="bodySm" weight="medium" className="min-w-0 break-words">{v.name}</Text>
                  <Badge variant={v.readinessAchieved ? 'success' : 'warning'} size="sm">
                    {v.readinessAchieved ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    {v.readinessAchieved
                      ? t('homeEnergy.readiness.ready', 'Ready')
                      : t('homeEnergy.readiness.notReady', 'Not ready')}
                  </Badge>
                </div>
                <Text as="p" variant="caption" color="muted">
                  {t('homeEnergy.readiness.delivered', 'Delivered {{delivered}} of {{needed}} needed', {
                    delivered: formatEnergy(v.deliveredWh),
                    needed: formatEnergy(v.neededWh),
                  })}
                </Text>
                {v.unmetWh > 0 && (
                  <Text as="p" variant="caption" weight="medium" className="text-amber-300">
                    {t('homeEnergy.readiness.unmet', 'Unmet: {{amount}}', { amount: formatEnergy(v.unmetWh) })}
                  </Text>
                )}
                <Text as="p" variant="caption" color="muted">
                  {v.departureSlot != null
                    ? t('homeEnergy.readiness.departureSlot', 'Departure slot #{{slot}}', { slot: v.departureSlot })
                    : t('homeEnergy.readiness.noDeadline', 'Opportunistic (no deadline)')}
                </Text>
              </div>
            </div>
          ))}
        </Grid>
      )}
    </LayoutCard>
  );
}
