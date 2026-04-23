import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, AlertCircle, Info } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Select } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';

import { useVehicles } from '@/api/hooks/useVehicles';

export default function PowersharePage() {
  const { t } = useTranslation();
  usePageTitle(t('powershare.title', 'Powershare'));

  const { data: vehicles } = useVehicles();
  const [vehicleIdStr, setVehicleIdStr] = useState<string>('');

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map(v => ({
        value: String(v.id),
        label: v.display_name ?? `Vehicle ${v.id}`,
      })),
    [vehicles],
  );

  const effectiveId = vehicleIdStr || vehicleOptions[0]?.value || '';

  return (
    <PageContainer
      title={t('powershare.title', 'Powershare')}
      subtitle={t(
        'powershare.subtitle',
        'Monitor your vehicle’s bidirectional power sharing — status, output, remaining runtime, and stop conditions.',
      )}
      actions={
        vehicleOptions.length > 1 ? (
          <Select
            value={effectiveId}
            onChange={e => setVehicleIdStr(e.target.value)}
            options={vehicleOptions}
            aria-label={t('powershare.selectVehicle', 'Select vehicle')}
          />
        ) : null
      }
    >
      {/* Status row */}
      <FadeIn>
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-white/90">
                {t('powershare.statusSection', 'Powershare Status')}
              </h2>
            </div>
            <Badge variant="neutral">{t('common.noData', '—')}</Badge>
          </div>

          <EmptyState
            icon={<Info className="h-8 w-8" />}
            message={t(
              'powershare.noData',
              'Powershare telemetry is not available in the current typed schema. Values will appear here once the signal is ingested.',
            )}
          />
        </GlassPanel>
      </FadeIn>

      {/* Stop reason */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="h-5 w-5 text-rose-400" />
            <h2 className="text-lg font-semibold text-white/90">
              {t('powershare.stopReasonSection', 'Stop Reason')}
            </h2>
          </div>

          <EmptyState
            icon={<Info className="h-8 w-8" />}
            message={t(
              'powershare.noStopReason',
              'No Powershare stop reason available. This signal is not yet surfaced by the typed telemetry schema.',
            )}
          />
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
