import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { ChartSummary } from '../src/components/charts/ChartSummary';
import { ListRow } from '../src/components/data/ListRow';
import { MetricGrid } from '../src/components/data/MetricGrid';
import { SectionHeader } from '../src/components/data/SectionHeader';
import {
  getSemanticIconDefinition,
  semanticIconNames,
  type SemanticIconName,
} from '../src/components/icons/SemanticIcon';
import { getRouteBounds, MapRouteSummary } from '../src/components/maps/MapRouteSummary';

const webIntentIconLabels = [
  'severityCritical',
  'severityWarn',
  'severityInfo',
  'warning',
  'info',
  'alertCircle',
  'success',
  'successFilled',
  'error',
  'helpCircle',
  'battery',
  'batteryCharging',
  'batteryFull',
  'batteryMedium',
  'batteryWarning',
  'charging',
  'charger',
  'bolt',
  'powerShare',
  'vehicle',
  'navigation',
  'navigationAlt',
  'map',
  'mapPinned',
  'location',
  'locate',
  'drive',
  'drives',
  'trip',
  'signpost',
  'fence',
  'flag',
  'fuel',
  'satellite',
  'radar',
  'analytics',
  'trends',
  'pieChart',
  'layoutDashboard',
  'layoutGrid',
  'layoutTemplate',
  'trendUp',
  'trendDown',
  'speed',
  'speedCircle',
  'efficiency',
  'activity',
  'range',
  'target',
  'workflow',
  'award',
  'trophy',
  'star',
  'notifications',
  'notificationsMuted',
  'notificationsActive',
  'notificationsAdd',
  'climate',
  'climateHot',
  'cooling',
  'heating',
  'weather',
  'cabin',
  'cloud',
  'wind',
  'flame',
  'droplets',
  'moon',
  'moonStar',
  'sun',
  'sunMoon',
  'security',
  'securityAlert',
  'securityCheck',
  'securityOff',
  'locked',
  'unlocked',
  'key',
  'keyRound',
  'fingerprint',
  'guard',
  'media',
  'headphones',
  'speaker',
  'volume',
  'volumeLow',
  'volumeOff',
  'maintenance',
  'settings',
  'settingsAlt',
  'preferences',
  'cpu',
  'database',
  'databaseBackup',
  'hardDrive',
  'hardDriveDownload',
  'monitor',
  'terminal',
  'server',
  'network',
  'globe',
  'link',
  'package',
  'shoppingCart',
  'archive',
  'history',
  'stethoscope',
  'bug',
  'scanSearch',
  'recycle',
  'bot',
  'gamepad',
  'palette',
  'keyboard',
  'tv',
  'power',
  'radio',
  'radioTower',
  'wifi',
  'wifiOff',
  'heart',
  'heartPulse',
  'user',
  'users',
  'userCheck',
  'userPlus',
  'userX',
  'home',
  'dollarSign',
  'wallet',
  'receipt',
  'calendar',
  'calendarCheck',
  'calendarClock',
  'calendarPlus',
  'calendarMinus',
  'clock',
  'timer',
  'bedDouble',
  'sparkles',
  'lightbulb',
  'add',
  'remove',
  'close',
  'confirm',
  'next',
  'previous',
  'expand',
  'collapse',
  'expandAll',
  'collapseAll',
  'forward',
  'back',
  'arrowUp',
  'arrowDown',
  'arrowLeftRight',
  'arrowRightLeft',
  'arrowUpDown',
  'arrowUpFromDot',
  'arrowDownToDot',
  'externalLink',
  'drillThrough',
  'drillDown',
  'search',
  'filter',
  'more',
  'moreInline',
  'menu',
  'edit',
  'pencil',
  'delete',
  'copy',
  'save',
  'download',
  'upload',
  'share',
  'send',
  'fileDown',
  'fileText',
  'fileJson',
  'fileSpreadsheet',
  'folderOpen',
  'refresh',
  'undo',
  'undoAlt',
  'redo',
  'loading',
  'play',
  'pause',
  'stop',
  'circleStop',
  'skipBack',
  'skipForward',
  'eraser',
  'show',
  'hide',
  'doorOpen',
  'tirePressure',
  'split',
  'hammer',
  'leaf',
  'dog',
  'tent',
  'gitCompare',
] as const satisfies readonly SemanticIconName[];

test('covers every canonical web icon intent label with native semantics', () => {
  expect(new Set(semanticIconNames)).toEqual(new Set(webIntentIconLabels));

  for (const name of webIntentIconLabels) {
    const definition = getSemanticIconDefinition(name);

    expect(definition.name).toBe(name);
    expect(definition.label.length).toBeGreaterThan(0);
    expect(definition.glyph.length).toBeGreaterThan(0);
    expect(definition.glyph.length).toBeLessThanOrEqual(3);
  }
});

test('renders premium primitives with accessible summaries', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <View>
        <SectionHeader
          title="Fleet overview"
          subtitle="Native premium section header"
          eyebrow="N0002"
          icon="layoutDashboard"
        />
        <MetricGrid
          items={[
            {
              id: 'vehicles',
              label: 'Vehicles online',
              value: 4,
              helper: 'All healthy',
              tone: 'success',
              icon: 'vehicle',
            },
            {
              id: 'alerts',
              label: 'Unread alerts',
              value: 1,
              helper: 'Needs review',
              tone: 'warning',
              icon: 'notifications',
            },
          ]}
        />
        <ListRow
          title="Roadrunner"
          subtitle="Model Y Performance"
          meta="online"
          icon="vehicle"
          onPress={() => undefined}
        />
        <ChartSummary
          title="Energy by day"
          subtitle="Native bar summary"
          metricLabel="Total"
          metricValue="42.0 kWh"
          emptyLabel="Energy data is not available."
          data={[
            {id: 'mon', label: 'Mon', value: 12, formattedValue: '12 kWh'},
            {id: 'tue', label: 'Tue', value: 30, formattedValue: '30 kWh'},
          ]}
        />
        <MapRouteSummary
          title="Drive route"
          subtitle="Native route summary"
          startLabel="Home"
          endLabel="Office"
          distanceLabel="32.4 km"
          durationLabel="38 min"
          emptyLabel="Route geometry is not available."
          points={[
            {latitude: 37.2, longitude: -122.1},
            {latitude: 37.4, longitude: -121.9},
            {latitude: 37.6, longitude: -121.8},
          ]}
        />
      </View>,
    );
  });

  const serialized = JSON.stringify(tree?.toJSON());

  expect(serialized).toContain('Fleet overview');
  expect(serialized).toContain('Vehicles online');
  expect(serialized).toContain('Roadrunner, Model Y Performance, online');
  expect(serialized).toContain('Energy by day chart summary with 2 points');
  expect(serialized).toContain('Drive route route summary from Home to Office');
});

test('computes route bounds from native route points', () => {
  expect(
    getRouteBounds([
      {latitude: 37.2, longitude: -122.1},
      {latitude: 37.6, longitude: -121.8},
      {latitude: 37.4, longitude: -122.3},
    ]),
  ).toEqual({
    minLatitude: 37.2,
    maxLatitude: 37.6,
    minLongitude: -122.3,
    maxLongitude: -121.8,
  });
});
