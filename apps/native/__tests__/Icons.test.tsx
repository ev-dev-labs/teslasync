import { createElement } from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { Icons, type IconKey } from '../src/web-parity/lib/icons';
import { getSemanticIconDefinition } from '../src/components/icons/SemanticIcon';

// The exact concept set (and order) of the web web/src/lib/icons.ts `Icons`
// registry. Kept here so the native port can never silently drop or reorder a
// concept relative to the source of truth.
const WEB_ICON_CONCEPTS = [
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
] as const;

describe('web-parity icons registry', () => {
  it('exposes every web concept key in source order', () => {
    expect(Object.keys(Icons)).toEqual([...WEB_ICON_CONCEPTS]);
  });

  it('maps every concept to a renderable native icon component', () => {
    for (const key of WEB_ICON_CONCEPTS) {
      const Component = Icons[key];
      expect(typeof Component).toBe('function');
      // The factory tags each component for debugging parity with lucide names.
      expect((Component as { displayName?: string }).displayName).toBe(
        `Icon(${key})`,
      );
    }
  });

  it('renders a concept as its canonical SemanticIcon glyph with size/color', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        createElement(Icons.batteryCharging, {
          size: 24,
          color: '#abcdef',
          accessibilityLabel: 'Battery charging',
          accessible: true,
          accessibilityRole: 'image',
        }),
      );
    });

    const json = tree?.toJSON();
    const serialized = JSON.stringify(json);

    // The glyph text comes from the canonical native source of truth.
    expect(serialized).toContain(
      getSemanticIconDefinition('batteryCharging').glyph,
    );
    // Numeric size + colour flow through to the rendered text style.
    expect(serialized).toContain('#abcdef');
    expect(serialized).toContain('"lineHeight":24');
    // Accessibility props supplied by the shared Icon wrapper are forwarded.
    expect(serialized).toContain('Battery charging');
  });

  it('defaults to a 16px box and primary text colour when unspecified', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(createElement(Icons.search, {}));
    });

    const serialized = JSON.stringify(tree?.toJSON());

    expect(serialized).toContain(getSemanticIconDefinition('search').glyph);
    expect(serialized).toContain('"lineHeight":16');
    expect(serialized).toContain('"fontSize":10'); // round(16 * 0.6)
  });

  it('keeps IconKey assignable to the registry keys', () => {
    const key: IconKey = 'vehicle';
    expect(Icons[key]).toBe(Icons.vehicle);
  });
});
