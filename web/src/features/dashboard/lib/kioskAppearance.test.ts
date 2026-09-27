import { describe, expect, it } from 'vitest';
import { kioskBackgroundStyle, kioskPanelStyle } from './kioskAppearance';

describe('kiosk appearance', () => {
  it('sets theme-relative opacity for the live surface and its preview', () => {
    expect(kioskBackgroundStyle(0.75)).toEqual({ '--kiosk-background-opacity': '75%' });
    expect(kioskPanelStyle(0.5)).toEqual({
      '--kiosk-panel-opacity': '50%',
      backdropFilter: 'blur(10.0px)',
    });
  });

  it('bounds corrupt persisted opacity values without emitting invalid CSS', () => {
    expect(kioskBackgroundStyle(Number.NaN)['--kiosk-background-opacity']).toBe('100%');
    expect(kioskBackgroundStyle(-1)['--kiosk-background-opacity']).toBe('0%');
    expect(kioskPanelStyle(2)['--kiosk-panel-opacity']).toBe('100%');
  });
});
