import { describe, expect, it } from 'vitest';
import {
  createSourceFile, forEachChild, isJsxAttribute, isJsxOpeningElement,
  isJsxSelfClosingElement, ScriptKind, ScriptTarget, type Node,
} from 'typescript';

function pageHeaderAttributes(source: string) {
  const attributes: string[] = [];
  const file = createSourceFile('page.tsx', source, ScriptTarget.Latest, true, ScriptKind.TSX);
  const visit = (node: Node) => {
    if ((isJsxOpeningElement(node) || isJsxSelfClosingElement(node))
      && /^(PageLayout|PageContainer)$/.test(node.tagName.getText(file))) {
      for (const attribute of node.attributes.properties) {
        if (isJsxAttribute(attribute)) attributes.push(attribute.name.getText(file));
      }
    }
    forEachChild(node, visit);
  };
  visit(file);
  return attributes;
}

const sources = import.meta.glob<string>([
  './*.tsx',
  '../../charging/pages/*.tsx',
  '../../battery/pages/*.tsx',
  '../../trips/pages/*.tsx',
], { eager: true, query: '?raw', import: 'default' });

const pages = Object.entries(sources).filter(([path]) =>
  !/\.(test|spec)\./.test(path)
  && !/\/(DriveDetailPage|DrivesListPage|TeslaChargingSessionsMap)\.tsx$/.test(path)
  && path !== './TripReplayPage.tsx',
);
const pageByName = Object.fromEntries(pages.map(([path, source]) => [
  path.slice(path.lastIndexOf('/') + 1), source,
]));

const slots = [
  ['DriveAnomaliesPage', 'contextActions'],
  ['EfficiencyLandscapePage', 'contextActions'],
  ['EnergyAnatomyPage', 'contextActions'],
  ['DriveComparePage', 'contextActions'],
  ['DriveDNAPage', 'contextActions'],
  ['EfficiencyTargetPage', 'contextActions'],
  ['JourneyFragmentationPage', 'contextActions'],
  ['WhatIfPage', 'contextActions'],
  ['ChargeAdvisorPage', 'contextActions'],
  ['TeslaChargingHistoryPage', 'contextActions'],
  ['TeslaChargingHistoryPage', 'primaryAction'],
  ['DriveScorePage', 'secondaryActions'],
  ['ChargingHeatmapPage', 'secondaryActions'],
  ['PowersharePage', 'secondaryActions'],
  ['PowerFlowDashboardPage', 'secondaryActions'],
  ['VampireDrainPage', 'secondaryActions'],
  ['TripReplayPage', 'secondaryActions'],
  ['EfficiencyPage', 'overflowActions'],
  ['CostAnalysisPage', 'overflowActions'],
  ['ChargingDetailPage', 'overflowActions'],
  ['TripListPage', 'overflowActions'],
  ['EnergyProductsPage', 'primaryAction'],
  ['BatteryDegradationPage', 'metadataActions'],
  ['TripListPage', 'metadataActions'],
  ['TripDetailPage', 'metadataActions'],
  ['TripReplayPage', 'metadataActions'],
  ['ChargingDetailPage', 'metadataActions'],
] as const;

describe('Owned mobility page headers', () => {
  it('accounts for every production UI page, excluding delegated pages and non-page helpers', () => {
    expect(pages).toHaveLength(63);
    expect(sources['./TripReplayPage.tsx']).toContain('@/features/trips/pages/TripReplayPage');
  });

  it.each(pages)('%s uses the shared compact header without a legacy action rail', (_path, source) => {
    expect(source).toMatch(/<(?:PageLayout|PageContainer)\b/);
    expect(source).not.toMatch(/compactHeader\s*=\s*\{false\}/);
    expect(pageHeaderAttributes(source)).not.toContain('actions');
    expect(source).not.toMatch(/<h1\b|<PageHeader\b|<PageTitle\b/);
  });

  it.each(slots)('%s preserves its %s in the shared header', (page, slot) => {
    expect(pageByName[`${page}.tsx`]).toContain(`${slot}=`);
  });

  it.each([
    'DriveAnomaliesPage',
    'EfficiencyLandscapePage',
    'EnergyAnatomyPage',
    'RangeSimulatorPage',
  ])('%s does not duplicate the global vehicle picker', (page) => {
    expect(pageByName[`${page}.tsx`]).not.toMatch(/<VehicleSelect\b/);
  });

  it.each([
    'DriveAnomaliesPage',
    'EfficiencyLandscapePage',
    'EnergyAnatomyPage',
  ])('%s keeps its date control where the workspace does not own a range', (page) => {
    expect(pageByName[`${page}.tsx`]).toMatch(/<RangePicker\b/);
  });
});
