import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartTimeRangeProvider } from '@/components/charts';
import { Text } from '@/components/ui';
import type { DriveFsdInsight } from '@/types/fsd';
import { DriveDetailSection } from '../drive-detail/DriveDetailSection';
import {
  HeroGauges, DrivePhysicsDebriefPanel, SupervisedDrivingPanel, GearTheaterPanel,
  SilentCounterPanel, DriveLedgerCompactPanel, MoreDetailsPanel, CostSavingsPanel,
  RouteMapSection, JourneyDetailsPanel, DriveOverviewChart, SocChart, ElevationChart,
  TemperatureSection, SpeedHistogramChart, PowerProfileChart, TirePressureSection,
  WhyEndedPanel, RoadAnomalyPanel,
} from '../drive-detail';
import type { useDriveDetailData } from '../drive-detail';
import { PreservedPanelGrid } from './PreservedPanelGrid';

export interface DriveReportContentProps {
  id?: string;
  data: Pick<ReturnType<typeof useDriveDetailData>,
    'drive' | 'stats' | 'chartData' | 'routeSource' | 'trail' | 'startPos' |
    'endPos' | 'centerPos' | 'speedSegments' | 'speedHistData'>;
  meaningful: boolean;
  sections: readonly { id: string; label: string }[];
  fsdInsight?: DriveFsdInsight;
  fsdLoading: boolean;
  fsdError: unknown;
  speedInsights: ReactNode;
  coaching: ReactNode;
}

/** Presentation only: historical sources, charts and panel actions retain
 * their existing owners. Missing data never removes the report outline. */
export function DriveReportContent({
  id, data, meaningful, sections, fsdInsight, fsdLoading, fsdError, speedInsights, coaching,
}: DriveReportContentProps) {
  const { t } = useTranslation();
  const {
    drive, stats, chartData, routeSource, trail, startPos, endPos,
    centerPos, speedSegments, speedHistData,
  } = data;
  const available = drive != null && stats != null;
  const label = (sectionId: string) => sections.find(section => section.id === sectionId)?.label
    ?? t('driveDetail.title', 'Drive detail');
  // Preserve the established jump-link order, including energy before
  // telemetry. The supervised panels still precede telemetry in source order.
  const navigation = ['overview', 'journey', 'route', 'energy', 'telemetry', 'supervised', 'physics', 'diagnostics'];
  return (
    <>
      <nav aria-label={t('driveDetail.report.sections', 'Drive report sections')} data-print-hide
        className="sticky top-0 z-20 flex items-center gap-2 overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-1)] p-2 shadow-sm">
        {navigation.map(sectionId => (
          <a key={sectionId} href={`#${sectionId}`}
            className="shrink-0 rounded-lg px-3 py-2 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
            <Text as="span" variant="bodySm">{label(sectionId)}</Text>
          </a>
        ))}
      </nav>
      <DriveDetailSection id="overview" testId="drive-detail-summary" title={label('overview')} available={available}>
        {drive && stats ? <HeroGauges drive={drive} stats={stats} chartData={chartData} meaningful={meaningful} /> : null}
      </DriveDetailSection>
      <PreservedPanelGrid label={t('driveDetail.journeyDetails', 'Journey details')} items={[
        { id: 'journey', size: 'half', content: (
          <DriveDetailSection id="journey" title={label('journey')} available={drive != null}>
            {drive ? <JourneyDetailsPanel drive={drive} /> : null}
          </DriveDetailSection>
        ) },
        { id: 'route', size: 'half', content: (
          <DriveDetailSection id="route" testId="drive-detail-route" title={label('route')} available={drive != null}>
            {drive ? <RouteMapSection drive={drive} trail={trail} startPos={startPos} endPos={endPos}
              centerPos={centerPos} speedSegments={speedSegments} routePoints={routeSource} fsdEvidence={fsdInsight?.evidence} /> : null}
          </DriveDetailSection>
        ) },
      ]} />
      <div id="energy" className="min-w-0 scroll-mt-24">
        <PreservedPanelGrid label={label('energy')} items={[
          { id: 'energy-evidence', size: 'half', content: (
            <DriveDetailSection id="energy-evidence" title={t('driveDetail.moreDetails', 'More details')} available={available}>
              {drive && stats ? <MoreDetailsPanel drive={drive} stats={stats} chartData={chartData} /> : null}
            </DriveDetailSection>
          ) },
          { id: 'cost-estimate', size: 'half', content: (
            <DriveDetailSection id="cost-estimate" title={t('driveDetail.costSavings', 'Cost and savings')} available={available}>
              {drive && stats ? <CostSavingsPanel drive={drive} stats={stats} /> : null}
            </DriveDetailSection>
          ) },
        ]} />
      </div>
      <div id="supervised" className="min-w-0 scroll-mt-24">
        <PreservedPanelGrid label={label('supervised')} items={[
          { id: 'fsd-evidence', size: 'half', content: (
            <DriveDetailSection id="fsd-evidence" title={label('supervised')}>
              <SupervisedDrivingPanel insight={fsdInsight} isLoading={fsdLoading} error={fsdError} isOngoing={!!drive && !drive.endTs} />
            </DriveDetailSection>
          ) },
          { id: 'silent-counter', size: 'half', content: (
            <DriveDetailSection id="silent-counter" title={t('driveDetail.silent.title', 'Counter silent while moving')}>
              <SilentCounterPanel driveId={id} />
            </DriveDetailSection>
          ) },
        ]} />
      </div>
      {/* Keep the aggregate overview outside the sample-index sync provider. */}
      <ChartTimeRangeProvider syncId="drive-detail">
        <div data-testid="drive-detail-evidence" className="min-w-0 space-y-4">
          <DriveDetailSection id="telemetry" title={label('telemetry')} available={drive != null}>
            {drive ? <DriveOverviewChart drive={drive} chartData={chartData} /> : null}
          </DriveDetailSection>
          <PreservedPanelGrid label={label('telemetry')} items={[
            { id: 'battery-trace', size: 'half', content: (
              <DriveDetailSection id="battery-trace" title={t('driveDetail.soc', 'SOC')} available={available}>
                <SocChart chartData={chartData} />
              </DriveDetailSection>
            ) },
            { id: 'speed-distribution', size: 'half', content: (
              <DriveDetailSection id="speed-distribution" title={t('driveDetail.speedHistogram', 'Speed histogram')} available={available}>
                <SpeedHistogramChart speedHistData={speedHistData} />
              </DriveDetailSection>
            ) },
            { id: 'power-trace', size: 'half', content: (
              <DriveDetailSection id="power-trace" title={t('driveDetail.powerProfile', 'Power profile')} available={available}>
                {stats ? <PowerProfileChart chartData={chartData} stats={stats} drive={drive ?? undefined} /> : null}
              </DriveDetailSection>
            ) },
            { id: 'elevation-trace', size: 'half', content: (
              <DriveDetailSection id="elevation-trace" title={t('driveDetail.elevProfile', 'Elevation profile')} available={available}>
                {stats ? <ElevationChart chartData={chartData} stats={stats} /> : null}
              </DriveDetailSection>
            ) },
            { id: 'temperature-trace', size: 'half', content: (
              <DriveDetailSection id="temperature-trace" title={t('driveDetail.temperatures', 'Temperatures')} available={available}>
                {stats ? <TemperatureSection chartData={chartData} stats={stats} /> : null}
              </DriveDetailSection>
            ) },
            { id: 'tire-trace', size: 'half', content: (
              <DriveDetailSection id="tire-trace" title={t('driveDetail.tirePressure', 'Tire pressure during drive')} available={available}>
                {stats ? <TirePressureSection chartData={chartData} stats={stats} /> : null}
              </DriveDetailSection>
            ) },
          ]} />
          {/* ADR-015 gating remains inside the original AI owners. */}
          <DriveDetailSection id="speed-insights" title={t('driveDetail.report.speedInsights', 'Helix speed-profile insights')}>
            {speedInsights}
          </DriveDetailSection>
        </div>
      </ChartTimeRangeProvider>
      <div id="physics" className="min-w-0 space-y-4 scroll-mt-24">
        <DriveDetailSection id="physics-debrief" title={label('physics')}>
          <DrivePhysicsDebriefPanel stats={stats} chartData={chartData} fsdInsight={fsdInsight} />
        </DriveDetailSection>
        <DriveDetailSection id="physics-ledger" title={t('driveDetail.ledger.title', 'Energy ledger')}>
          <DriveLedgerCompactPanel driveId={id} />
        </DriveDetailSection>
        <DriveDetailSection id="coaching" title={t('driveDetail.report.coaching', 'Helix drive coaching')}>
          {coaching}
        </DriveDetailSection>
      </div>
      <div id="diagnostics" className="min-w-0 space-y-4 scroll-mt-24">
        <DriveDetailSection id="gear-theater" title={t('driveDetail.theater.title', 'Gear theater')}>
          <GearTheaterPanel driveId={id} />
        </DriveDetailSection>
        <DriveDetailSection id="road-analysis" title={t('driveDetail.road.title', 'Possible road-surface anomalies')} available={!!id}>
          {id ? <RoadAnomalyPanel driveId={id} /> : null}
        </DriveDetailSection>
        <DriveDetailSection id="why-ended" title={t('driveDetail.whyEnded.title', 'Why did this drive end?')} available={!!id}>
          {id ? <WhyEndedPanel driveId={id} /> : null}
        </DriveDetailSection>
      </div>
    </>
  );
}
