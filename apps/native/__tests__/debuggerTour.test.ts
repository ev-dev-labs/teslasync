import {
  DEBUGGER_TOUR,
  nativeDebuggerTourCapabilities,
  setTourNavigator,
  type TourStep,
} from '../src/web-parity/features/onboarding/tours/debuggerTour';

/**
 * Native parity contract for the debugger onboarding tour definition.
 *
 * The web definition (web/src/features/onboarding/tours/debuggerTour.ts) is
 * pure data — four walkthrough steps plus registry metadata — with a single
 * navigation side effect on the first step. The web `navigate` used the browser
 * History API; the native port delegates to a shell-registered navigator. These
 * tests assert the ported data is byte-faithful and the navigation side effect
 * routes through the injected navigator.
 */

afterEach(() => {
  setTourNavigator(null);
});

describe('DEBUGGER_TOUR registry metadata', () => {
  it('preserves the identity and i18n keys/fallbacks verbatim', () => {
    expect(DEBUGGER_TOUR.id).toBe('debugger');
    expect(DEBUGGER_TOUR.version).toBe(1);
    expect(DEBUGGER_TOUR.titleKey).toBe('tour.tours.debugger.title');
    expect(DEBUGGER_TOUR.titleFallback).toBe('State machine debugger');
    expect(DEBUGGER_TOUR.descriptionKey).toBe('tour.tours.debugger.description');
    expect(DEBUGGER_TOUR.descriptionFallback).toBe(
      'Timeline, layered sources, freeze/step, deep links.',
    );
  });

  it('does not opt into auto-start (launcher-only, like the web original)', () => {
    expect(DEBUGGER_TOUR.autoStart).toBeUndefined();
  });

  it('matches every debugger route via the routeMatch RegExp', () => {
    const routeMatch = DEBUGGER_TOUR.routeMatch;
    expect(routeMatch).toBeInstanceOf(RegExp);
    const re = routeMatch as RegExp;
    for (const path of [
      '/state-debugger',
      '/live-monitor',
      '/signal-explorer',
      '/signal-diff',
      '/signal-gaps',
      '/mqtt-inspector',
      '/signal-log',
      '/redis-signals',
    ]) {
      expect(re.test(path)).toBe(true);
    }
    expect(re.test('/dashboard')).toBe(false);
  });
});

describe('DEBUGGER_TOUR steps', () => {
  it('keeps all four steps with their anchors and placements', () => {
    expect(DEBUGGER_TOUR.steps).toHaveLength(4);

    const shape = DEBUGGER_TOUR.steps.map((s: TourStep) => ({
      target: s.target,
      placement: s.placement,
    }));
    expect(shape).toEqual([
      {target: '[data-tour="debugger-timeline"]', placement: 'bottom'},
      {target: '[data-tour="debugger-source-badges"]', placement: 'right'},
      {target: '[data-tour="debugger-controls"]', placement: 'top'},
      {target: '[data-tour="debugger-share"]', placement: 'left'},
    ]);
  });

  it('carries the source-layer badge copy on the second step', () => {
    expect(DEBUGGER_TOUR.steps[1].title).toBe('Source-layer badges');
    expect(DEBUGGER_TOUR.steps[1].description).toContain(
      'L1 = in-process Store, L2 = Redis, LOG = signal_log, STALE = stale Redis',
    );
  });

  it('only the first step has an onShow side effect', () => {
    expect(typeof DEBUGGER_TOUR.steps[0].onShow).toBe('function');
    expect(DEBUGGER_TOUR.steps[1].onShow).toBeUndefined();
    expect(DEBUGGER_TOUR.steps[2].onShow).toBeUndefined();
    expect(DEBUGGER_TOUR.steps[3].onShow).toBeUndefined();
  });
});

describe('first-step navigation side effect', () => {
  it('routes /state-debugger through the registered navigator', () => {
    const calls: string[] = [];
    setTourNavigator(href => calls.push(href));

    DEBUGGER_TOUR.steps[0].onShow?.();

    expect(calls).toEqual(['/state-debugger']);
  });

  it('is a no-op when no navigator is registered (web SSR-guard parity)', () => {
    setTourNavigator(null);
    expect(() => DEBUGGER_TOUR.steps[0].onShow?.()).not.toThrow();
  });
});

describe('nativeDebuggerTourCapabilities', () => {
  it('honestly reports the History API as unavailable on native', () => {
    expect(nativeDebuggerTourCapabilities.historyApiAvailable).toBe(false);
    expect(nativeDebuggerTourCapabilities.pluggableNavigator).toBe(true);
  });
});
