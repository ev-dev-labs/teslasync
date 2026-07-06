/**
 * SignalGapDetectorPage — full-width signal-freshness cockpit.
 *
 * Orchestrates a responsive bento: a KPI band, a hero staleness-distribution
 * chart beside a freshness gauge + worst-offender list, and the full signal
 * catalog table (search / filter / sort). Every section owns its loading,
 * empty, and error state; nothing is gated behind a single data check.
 *
 * Data comes exclusively from `useSignalGapAnalysis`, which shares the
 * `useSignalGaps` query with the catalog panel so the whole page is served
 * from one realtime request. Vehicle selection is driven by the global
 * `useSelectedVehicle` store.
 */

import { useTranslation } from 'react-i18next';
import { Info, RefreshCw } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import { SignalCatalogPanel } from '../components/SignalCatalogPanel';
import { SignalGapKpis } from '../components/SignalGapKpis';
import { SignalGapHealthPanel } from '../components/SignalGapHealthPanel';
import { SignalGapFreshnessPanel } from '../components/SignalGapFreshnessPanel';
import { useSignalGapAnalysis } from '../hooks/useSignalGapAnalysis';

export default function SignalGapDetectorPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalGap.title', 'Signal Gaps'));

  const { vehicleId } = useSelectedVehicle();
  const vid = vehicleId != null && vehicleId > 0 ? vehicleId : 0;
  const hasVehicle = vid > 0;

  const analysis = useSignalGapAnalysis(vid);
  const { query, buckets, freshnessPct } = analysis;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <VehicleSelect />
      <Button
        variant="ghost"
        onClick={() => query.refetch()}
        disabled={!hasVehicle}
        aria-label={t('signalGap.refresh', 'Refresh signals')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('signalGap.title', 'Signal Gaps')}
      subtitle={t('signalGap.subtitle', 'Identify signals that have stopped arriving or have gaps')}
      actions={actions}
      query={hasVehicle ? query : undefined}
    >
      {!hasVehicle && (
        <AlertBanner variant="info" icon={<Info className="h-5 w-5" aria-hidden="true" />}>
          {t('signalGap.selectVehiclePrompt', 'Select a vehicle to inspect its signal freshness.')}
        </AlertBanner>
      )}

      {/* 1 — KPI band: full-width staleness summary */}
      <SignalGapKpis buckets={buckets} freshnessPct={freshnessPct} hasVehicle={hasVehicle} />

      {/* 2 — Hero bento: distribution chart + freshness gauge */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('signalGap.healthSection', 'Signal health')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="xl:col-span-2">
            <SignalGapHealthPanel analysis={analysis} hasVehicle={hasVehicle} />
          </div>
          <SignalGapFreshnessPanel analysis={analysis} hasVehicle={hasVehicle} />
        </section>
      </FadeIn>

      {/* 3 — Detail band: full-width signal catalog table */}
      <FadeIn delay={0.2}>
        <SignalCatalogPanel
          vehicleId={vid}
          showSummary={false}
          title={t('signalGap.catalogTitle', 'Signal Catalog')}
        />
      </FadeIn>
    </PageContainer>
  );
}
