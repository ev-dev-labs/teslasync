import {
  TIRE_WIDGETS,
  nativeTireWidgetsCapabilities,
} from '../src/web-parity/features/dashboard/widgets/registry/tires';
import type { WidgetDef } from '../src/web-parity/features/dashboard/widgets/registry';

/**
 * Native parity contract for the "tires" dashboard widget sub-registry.
 *
 * Web web/src/features/dashboard/widgets/registry/tires.ts exports TIRE_WIDGETS
 * — 2 widget definitions, each pairing plain metadata with the lucide-react
 * CircleDot icon and a React.lazy widget loader. The native port reproduces the
 * metadata one-for-one, preserves each icon as its lucide token string, and
 * defers the not-yet-ported widget components (documented in a capability
 * record). These tests assert that contract.
 */

const EXPECTED_IDS = ['tire-pressure-visual', 'tire-pressure-history'];

describe('tire widget sub-registry (native parity)', () => {
  it('exports both tire widgets in the exact web order', () => {
    expect(Array.isArray(TIRE_WIDGETS)).toBe(true);
    expect(TIRE_WIDGETS.map((w) => w.id)).toEqual(EXPECTED_IDS);
  });

  it('tags every entry with the tires category and the CircleDot icon token', () => {
    TIRE_WIDGETS.forEach((widget: WidgetDef) => {
      expect(widget.category).toBe('tires');
      expect(widget.icon).toBe('CircleDot');
    });
  });

  it('preserves the tire-pressure-visual name and description verbatim', () => {
    const visual = TIRE_WIDGETS.find((w) => w.id === 'tire-pressure-visual');
    expect(visual?.name).toBe('Tire Pressure Visual');
    expect(visual?.description).toBe(
      'Four-tire diagram with pressure per tire, color-coded (green/amber/red)',
    );
  });

  it('preserves the tire-pressure-history name and description verbatim', () => {
    const history = TIRE_WIDGETS.find((w) => w.id === 'tire-pressure-history');
    expect(history?.name).toBe('Tire Pressure History');
    expect(history?.description).toBe(
      'Pressure trends for all 4 tires over time with recommended range',
    );
  });

  it('preserves the identical size triple on both tire widgets', () => {
    TIRE_WIDGETS.forEach((widget) => {
      expect(widget.defaultSize).toEqual({ cols: 2, rows: 4 });
      expect(widget.minSize).toEqual({ cols: 2, rows: 4 });
      expect(widget.maxSize).toEqual({ cols: 4, rows: 40 });
    });
  });

  it('leaves every component unset pending its native port', () => {
    TIRE_WIDGETS.forEach((widget) => {
      expect(widget.component).toBeUndefined();
    });
  });

  it('documents every deferred widget component in the capability record', () => {
    expect(nativeTireWidgetsCapabilities.available).toEqual(['TIRE_WIDGETS']);
    const pending = nativeTireWidgetsCapabilities.pending.components;
    expect(Object.keys(pending)).toEqual(EXPECTED_IDS);
    expect(pending['tire-pressure-visual']).toBe('../TirePressureVisualWidget');
    expect(pending['tire-pressure-history']).toBe('../TirePressureHistoryWidget');
  });
});
