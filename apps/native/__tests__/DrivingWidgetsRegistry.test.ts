import {
  DRIVING_WIDGETS,
  nativeDrivingWidgetsCapabilities,
} from '../src/web-parity/features/dashboard/widgets/registry/driving';
import type { WidgetDef } from '../src/web-parity/features/dashboard/widgets/registry';

/**
 * Native parity contract for the "driving" dashboard widget sub-registry.
 *
 * Web web/src/features/dashboard/widgets/registry/driving.ts exports
 * DRIVING_WIDGETS — 13 widget definitions, each pairing plain metadata with a
 * lucide-react icon and a React.lazy widget loader. The native port reproduces
 * the metadata one-for-one, preserves each icon as its lucide token string, and
 * defers the not-yet-ported widget components (documented in a capability
 * record). These tests assert that contract.
 */

const EXPECTED_IDS = [
  'recent-drives',
  'drive-score',
  'recent-drives-list',
  'drive-score-gauge',
  'drive-efficiency-chart',
  'speed-heatmap',
  'driving-dynamics',
  'speed-profile',
  'regen-efficiency',
  'route-efficiency',
  'driving-coach',
  'trip-summary',
  'drive-telemetry',
];

describe('driving widget sub-registry (native parity)', () => {
  it('exports all 13 driving widgets in the exact web order', () => {
    expect(Array.isArray(DRIVING_WIDGETS)).toBe(true);
    expect(DRIVING_WIDGETS.map((w) => w.id)).toEqual(EXPECTED_IDS);
  });

  it('tags every entry with the driving category and a non-empty icon token', () => {
    DRIVING_WIDGETS.forEach((widget: WidgetDef) => {
      expect(widget.category).toBe('driving');
      expect(typeof widget.icon).toBe('string');
      expect(widget.icon && widget.icon.length).toBeGreaterThan(0);
    });
  });

  it('does not import browser-only lucide-react components (icons are tokens)', () => {
    const recent = DRIVING_WIDGETS.find((w) => w.id === 'recent-drives');
    expect(recent?.icon).toBe('Car');
    const heatmap = DRIVING_WIDGETS.find((w) => w.id === 'speed-heatmap');
    expect(heatmap?.icon).toBe('Grid3X3');
  });

  it('preserves the recent-drives size triple verbatim', () => {
    const recent = DRIVING_WIDGETS.find((w) => w.id === 'recent-drives');
    expect(recent?.defaultSize).toEqual({ cols: 2, rows: 4 });
    expect(recent?.minSize).toEqual({ cols: 2, rows: 2 });
    expect(recent?.maxSize).toEqual({ cols: 4, rows: 40 });
  });

  it('preserves the regen-efficiency help i18nKey and defaultValue', () => {
    const regen = DRIVING_WIDGETS.find((w) => w.id === 'regen-efficiency');
    expect(regen?.help?.i18nKey).toBe('help.regenEfficiency.body');
    expect(regen?.help?.defaultValue).toBe(
      'Energy recovered through regenerative braking divided by total energy ' +
        'used during driving. Higher is better — Tesla cars typically reach ' +
        '15–30% recovery in mixed driving.',
    );
  });

  it('leaves every component unset pending its native port', () => {
    DRIVING_WIDGETS.forEach((widget) => {
      expect(widget.component).toBeUndefined();
    });
  });

  it('documents every deferred widget component in the capability record', () => {
    expect(nativeDrivingWidgetsCapabilities.available).toEqual(['DRIVING_WIDGETS']);
    const pending = nativeDrivingWidgetsCapabilities.pending.components;
    expect(Object.keys(pending)).toEqual(EXPECTED_IDS);
    expect(pending['recent-drives']).toBe('../RecentDrivesWidget');
    expect(pending['drive-telemetry']).toBe('../DriveTelemetryWidget');
  });
});
