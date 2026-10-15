import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { useChartSync } from '@/components/charts';
import { Text } from '@/components/ui';
import {
  HeroGauges, RouteMapSection, MoreDetailsPanel, CostSavingsPanel, DriveOverviewChart,
  SocChart, SpeedHistogramChart, PowerProfileChart, ElevationChart, TemperatureSection,
  TirePressureSection, SupervisedDrivingPanel, GearTheaterPanel, SilentCounterPanel,
  DriveLedgerCompactPanel, WhyEndedPanel, RoadAnomalyPanel, DrivePhysicsDebriefPanel,
} from '../drive-detail';
import { DriveReportContent } from './index';
import { reportFixture } from './reportFixtures';
import { installResizeHarness } from './resizeHarness';

vi.mock('../drive-detail', () => {
  const leaf = (name: string) => vi.fn(function EvidenceProbe(_props: Record<string, unknown>) {
    const sync = useChartSync();
    return <Text data-testid={name} data-sync-id={sync?.syncId ?? ''} data-sync-method={sync?.syncMethod ?? ''}>{name}</Text>;
  });
  return {
    HeroGauges: leaf('hero'),
    JourneyDetailsPanel: leaf('journey-panel'),
    RouteMapSection: leaf('map'),
    MoreDetailsPanel: leaf('energy-panel'),
    CostSavingsPanel: leaf('cost-panel'),
    SupervisedDrivingPanel: leaf('fsd-panel'),
    SilentCounterPanel: leaf('silent-panel'),
    DriveOverviewChart: leaf('overview-chart'),
    SocChart: leaf('soc-chart'),
    SpeedHistogramChart: leaf('speed-chart'),
    PowerProfileChart: leaf('power-chart'),
    ElevationChart: leaf('elevation-chart'),
    TemperatureSection: leaf('temperature-chart'),
    TirePressureSection: leaf('tire-chart'),
    DrivePhysicsDebriefPanel: leaf('physics-panel'),
    DriveLedgerCompactPanel: leaf('ledger-panel'),
    GearTheaterPanel: leaf('gear-panel'),
    RoadAnomalyPanel: leaf('road-panel'),
    WhyEndedPanel: leaf('why-ended-panel'),
  };
});
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

const sectionIds = [
  'overview', 'journey', 'route', 'energy-evidence', 'cost-estimate',
  'fsd-evidence', 'silent-counter', 'telemetry', 'battery-trace', 'speed-distribution',
  'power-trace', 'elevation-trace', 'temperature-trace', 'tire-trace', 'speed-insights',
  'physics-debrief', 'physics-ledger', 'coaching', 'gear-theater', 'road-analysis', 'why-ended',
];

describe('live drive report layout preservation', () => {
  it('retains all 21 section targets, complete jump links and panel reading order at each responsive band', () => {
    const harness = installResizeHarness();
    const fixture = reportFixture();
    const { container } = render(<DriveReportContent {...fixture}
      speedInsights={<Text>Opt-in speed insights</Text>} coaching={<Text>Opt-in coaching</Text>} />);
    const sections = Array.from(container.querySelectorAll('section[id]'));
    expect(sections.map(section => section.id)).toEqual(sectionIds);
    const nav = screen.getByRole('navigation', { name: 'Drive report sections' });
    expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href')))
      .toEqual(['#overview', '#journey', '#route', '#energy', '#telemetry', '#supervised', '#physics', '#diagnostics']);
    for (const link of within(nav).getAllByRole('link')) {
      const href = link.getAttribute('href');
      expect(href && container.querySelector(href)).toBeInTheDocument();
    }
    for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]) {
      harness.resize(width);
      expect(Array.from(container.querySelectorAll('section[id]'))).toEqual(sections);
      expect(screen.getByText('Opt-in speed insights')).toBeVisible();
      expect(screen.getByText('Opt-in coaching')).toBeVisible();
      expect(screen.getByRole('region', { name: 'Why did this drive end?' })).toBeVisible();
      expect(screen.getByRole('region', { name: 'Possible road-surface anomalies' })).toBeVisible();
    }
    expect(screen.getByTestId('hero')).toHaveAttribute('data-sync-id', '');
    for (const chart of ['overview-chart', 'soc-chart', 'speed-chart', 'power-chart', 'elevation-chart', 'temperature-chart', 'tire-chart']) {
      expect(screen.getByTestId(chart)).toHaveAttribute('data-sync-id', 'drive-detail');
      expect(screen.getByTestId(chart)).toHaveAttribute('data-sync-method', 'index');
    }
  });

  it('passes the exact original source objects to every map, aggregate and chart owner', () => {
    installResizeHarness();
    const fixture = reportFixture();
    render(<DriveReportContent {...fixture} />);
    const hero = vi.mocked(HeroGauges).mock.calls.at(-1)?.[0];
    expect(hero?.drive).toBe(fixture.data.drive);
    expect(hero?.stats).toBe(fixture.data.stats);
    expect(hero?.chartData).toBe(fixture.data.chartData);
    expect(hero?.meaningful).toBe(true);
    const map = vi.mocked(RouteMapSection).mock.calls.at(-1)?.[0];
    expect(map?.drive).toBe(fixture.data.drive);
    expect(map?.trail).toBe(fixture.data.trail);
    expect(map?.startPos).toBe(fixture.data.startPos);
    expect(map?.endPos).toBe(fixture.data.endPos);
    expect(map?.centerPos).toBe(fixture.data.centerPos);
    expect(map?.routePoints).toBe(fixture.data.routeSource);
    expect(map?.speedSegments).toBe(fixture.data.speedSegments);
    expect(map?.fsdEvidence).toBe(fixture.fsdInsight?.evidence);
    expect(vi.mocked(SupervisedDrivingPanel).mock.calls.at(-1)?.[0].insight).toBe(fixture.fsdInsight);
    expect(vi.mocked(DrivePhysicsDebriefPanel).mock.calls.at(-1)?.[0].fsdInsight).toBe(fixture.fsdInsight);
    expect(vi.mocked(MoreDetailsPanel).mock.calls.at(-1)?.[0].stats).toBe(fixture.data.stats);
    expect(vi.mocked(CostSavingsPanel).mock.calls.at(-1)?.[0].drive).toBe(fixture.data.drive);
    expect(vi.mocked(DriveOverviewChart).mock.calls.at(-1)?.[0].chartData).toBe(fixture.data.chartData);
    expect(vi.mocked(SocChart).mock.calls.at(-1)?.[0].chartData).toBe(fixture.data.chartData);
    expect(vi.mocked(SpeedHistogramChart).mock.calls.at(-1)?.[0].speedHistData).toBe(fixture.data.speedHistData);
    expect(vi.mocked(PowerProfileChart).mock.calls.at(-1)?.[0].chartData).toBe(fixture.data.chartData);
    expect(vi.mocked(ElevationChart).mock.calls.at(-1)?.[0].chartData).toBe(fixture.data.chartData);
    expect(vi.mocked(TemperatureSection).mock.calls.at(-1)?.[0].chartData).toBe(fixture.data.chartData);
    expect(vi.mocked(TirePressureSection).mock.calls.at(-1)?.[0].chartData).toBe(fixture.data.chartData);
    for (const panel of [GearTheaterPanel, SilentCounterPanel, DriveLedgerCompactPanel, WhyEndedPanel, RoadAnomalyPanel]) {
      expect(vi.mocked(panel).mock.calls.at(-1)?.[0].driveId).toBe('42');
    }
  });

  it('isolates unavailable FSD while retaining usable historical neighbors and zero-valued evidence', () => {
    installResizeHarness();
    const fixture = reportFixture();
    const fsdError = new Error('FSD refresh unavailable');
    const zeroData = {
      ...fixture.data,
      drive: fixture.data.drive ? { ...fixture.data.drive, distanceM: 0, energyUsedWh: 0 } : null,
      stats: fixture.data.stats ? { ...fixture.data.stats, energyWh: 0, maxSpd: 0 } : null,
      chartData: fixture.data.chartData.map(point => ({ ...point, speed: 0, power: 0, battery: 0 })),
    };
    render(<DriveReportContent {...fixture} data={zeroData} meaningful={false} fsdError={fsdError} />);
    expect(vi.mocked(SupervisedDrivingPanel).mock.calls.at(-1)?.[0].error).toBe(fsdError);
    expect(screen.getByTestId('map')).toBeVisible();
    expect(screen.getByTestId('energy-panel')).toBeVisible();
    expect(screen.getByTestId('ledger-panel')).toBeVisible();
    expect(screen.getByTestId('overview-chart')).toBeVisible();
    const props = vi.mocked(DrivePhysicsDebriefPanel).mock.calls.at(-1)?.[0];
    expect(props?.chartData).toBe(zeroData.chartData);
    expect(vi.mocked(HeroGauges).mock.calls.at(-1)?.[0].meaningful).toBe(false);
    expect(vi.mocked(CostSavingsPanel).mock.calls.at(-1)?.[0].stats.energyWh).toBe(0);
  });

  it('keeps the entire report outline when the record is absent; record-independent diagnostics retain their scoped id', () => {
    installResizeHarness();
    const fixture = reportFixture();
    const { container, rerender } = render(<DriveReportContent {...fixture}
      data={{ ...fixture.data, drive: null, stats: null, chartData: [], routeSource: [], trail: [], speedSegments: [], speedHistData: [] }}
      meaningful={false} />);
    expect(Array.from(container.querySelectorAll('section[id]')).map(section => section.id)).toEqual(sectionIds);
    expect(screen.getByText('No Overview data is available for this drive.')).toBeVisible();
    expect(screen.getByText('No Route data is available for this drive.')).toBeVisible();
    expect(screen.getByText('No SOC data is available for this drive.')).toBeVisible();
    expect(screen.getByTestId('road-panel')).toBeVisible();
    expect(vi.mocked(RoadAnomalyPanel).mock.calls.at(-1)?.[0].driveId).toBe('42');
    expect(vi.mocked(WhyEndedPanel).mock.calls.at(-1)?.[0].driveId).toBe('42');
    rerender(<DriveReportContent {...fixture} id={undefined}
      data={{ ...fixture.data, drive: null, stats: null }} meaningful={false} />);
    expect(Array.from(container.querySelectorAll('section[id]')).map(section => section.id)).toEqual(sectionIds);
    expect(screen.queryByTestId('road-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('why-ended-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Why did this drive end?' })).toBeVisible();
  });
});
