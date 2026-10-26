import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { DataProvenanceBadge } from '@/components/data-display';

import { PageLayout, SourceContent } from '@/components/layout';
import { AlertBanner, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { CopyButton, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ElectrochemPanel,
  NotebookPanel,
  ThermalPanel,
  TiresPanel,
  WeatherPanel,
} from '@/features/science/components/SciencePanels';
import { ScienceEvidenceOverview } from '@/features/science/components/ScienceEvidenceOverview';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDateFormat } from '@/hooks/useDateFormat';

type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;


export default function ScienceLabPage() {
  const { formatDateTime, tz: timezone } = useDateFormat();
  const { t: translate } = useTranslation();
  const t: Translate = (key, fallback, options) => String(translate(key, fallback, options));
  const { start, end, startInstant, endInstantExclusive } = useRangeState({ timezone });
  const window = { start: startInstant, end: endInstantExclusive };
  const rangeSupported = Date.parse(window.end) > Date.parse(window.start)
    && Date.parse(window.end) - Date.parse(window.start) <= 30 * 86_400_000;
  const location = useLocation();

  const title = t('science.title', 'Science lab');
  usePageTitle(title);
  const { vehicleId, vehicles, vehiclesState } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const fleetLabel = t('dataSources.labels.vehicleRegistry', 'Vehicle registry');
  const fleetFeedback = (
    <>
      <StaleRefreshWarning state={vehiclesState} label={fleetLabel} />
      {vehiclesState.fatalError ? (
        <QueryError error={vehiclesState.fatalError} onRetry={vehiclesState.retry ?? undefined} resourceName={fleetLabel} />
      ) : !vehiclesState.hasData ? (
        <SourceContent
          state="loading"
          label={fleetLabel}
          emptyMessage=""
          errorMessage=""
          loadingContent={vehiclesState.isRefreshBlocked ? (
            <Text as="p" color="secondary">
              {t('system.outage.pausedSource', 'Waiting for a connection before this source can load. Missing evidence remains unknown.')}
            </Text>
          ) : undefined}
        >
          {null}
        </SourceContent>
      ) : null}
    </>
  );

  if (vehicleId == null) {
    if (vehiclesState.status === 'unavailable' && vehicles.length === 0) {
      return <NoVehicleSelected pageTitle={title} />;
    }
    return <PageLayout title={title}>{fleetFeedback}</PageLayout>;
  }

  if (!rangeSupported) {
    return <PageLayout title={title}>{fleetFeedback}<AlertBanner variant="warning">{t('science.rangeLimit', 'Choose a workspace range of at most 30 days to view science evidence.')}</AlertBanner></PageLayout>;
  }

  const scope = { vehicleId: vehicleIdStr, start: window.start, end: window.end };
  const copyUrl = new URL(location.pathname, globalThis.window.location.origin);
  copyUrl.search = location.search;
  copyUrl.hash = location.hash;
  copyUrl.searchParams.set('vehicle_id', String(vehicleId));
  copyUrl.searchParams.set('from', start);
  copyUrl.searchParams.set('to', end);
  copyUrl.searchParams.delete('start');
  copyUrl.searchParams.delete('end');

  return (
    <PageLayout
      title={title}
      subtitle={t('science.subtitle', 'Every claim is a fit: n, uncertainty, firmware epoch, holdout.')}
      overflowActions={(
        <CopyButton
          text={copyUrl.toString()}
          ariaLabel={t('common.copyLink.label', 'Copy link to this view')}
          iconOnly
          withToast
          className="h-11 w-11 justify-center p-0 md:h-9 md:w-9"
        />
      )}
      metadataActions={(
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DataProvenanceBadge provenance="historical" />
        </div>
      )}
    >
      {fleetFeedback}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('science.window.label', 'Window')}>
        <Text as="span" size="sm" color="secondary">
          {formatDateTime(window.start)} → {formatDateTime(window.end)}
        </Text>
      </div>

      <div className="space-y-6">
        <ScienceEvidenceOverview window={scope} />
        <section id="science-electrochem" className="scroll-mt-24"><ElectrochemPanel window={scope} /></section>
        <section id="science-thermal" className="scroll-mt-24"><ThermalPanel window={scope} /></section>
        <section id="science-weather" className="scroll-mt-24"><WeatherPanel window={scope} /></section>
        <section id="science-tires" className="scroll-mt-24"><TiresPanel window={scope} /></section>
        <section id="science-notebook" className="scroll-mt-24"><NotebookPanel window={scope} /></section>
      </div>
    </PageLayout>
  );
}
