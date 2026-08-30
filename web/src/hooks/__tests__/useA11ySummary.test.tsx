/**
 * Screen-reader summary contract (A11Y-10).
 *
 * These sentences are the entire non-visual representation of a map, a
 * gauge, a state machine, and a timeline — so the rules that matter are
 * about what they REFUSE to say: no invented values, no "unknown"
 * filler, and no scaffolding before the answer.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import '@/i18n';
import { useA11ySummary } from '@/hooks/useA11ySummary';

function builders() {
  return renderHook(() => useA11ySummary()).result.current;
}

describe('useA11ySummary', () => {
  it('returns a referentially stable API', () => {
    const { result, rerender } = renderHook(() => useA11ySummary());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  describe('describeRoute', () => {
    it('leads with the endpoints when both are known', () => {
      const summary = builders().describeRoute({
        pointCount: 412,
        distance: '12.4 mi',
        duration: '28 min',
        start: 'Home',
        end: 'Office',
      });
      expect(summary).toContain('Home');
      expect(summary).toContain('Office');
      expect(summary).toContain('12.4 mi');
      expect(summary).toContain('28 min');
      expect(summary).toContain('412');
    });

    it('omits the endpoints rather than inventing them', () => {
      const summary = builders().describeRoute({ pointCount: 5 });
      expect(summary).not.toMatch(/undefined|null|unknown/i);
      expect(summary).toContain('5');
    });

    it('says the map is empty rather than describing a zero-length route', () => {
      const summary = builders().describeRoute({ pointCount: 0, distance: '0 mi' });
      expect(summary.toLowerCase()).toContain('no location data');
      // A "0 mi" route would imply the car did not move; the truth is
      // that nothing was recorded.
      expect(summary).not.toContain('0 mi');
    });
  });

  describe('describeGauge', () => {
    it('leads with the value, then the judgement', () => {
      const summary = builders().describeGauge({
        label: 'Battery health',
        value: '92%',
        min: '0%',
        max: '100%',
        status: 'Healthy',
      });
      expect(summary.indexOf('92%')).toBeLessThan(summary.indexOf('Healthy'));
      expect(summary).toContain('Battery health');
    });

    it('omits the scale when only one bound is known', () => {
      const summary = builders().describeGauge({
        label: 'Efficiency',
        value: '3.4 mi/kWh',
        min: '0',
      });
      expect(summary).not.toMatch(/scale/i);
    });

    it('never emits filler for a missing status', () => {
      const summary = builders().describeGauge({ label: 'Range', value: '212 mi' });
      expect(summary).not.toMatch(/undefined|null/i);
    });
  });

  describe('describeStateMachine', () => {
    it('names the current state first', () => {
      const summary = builders().describeStateMachine({
        label: 'Vehicle state',
        current: 'Charging',
        since: '12 minutes',
        previous: 'Parked',
        next: ['Parked', 'Driving'],
      });
      expect(summary.startsWith('Vehicle state: Charging')).toBe(true);
      expect(summary).toContain('12 minutes');
      expect(summary).toContain('Parked');
      expect(summary).toContain('Driving');
    });

    it('omits the reachable-states clause when there are none', () => {
      const summary = builders().describeStateMachine({
        label: 'Vehicle state',
        current: 'Asleep',
        next: [],
      });
      expect(summary).not.toMatch(/can move to/i);
    });
  });

  describe('describeTimeline', () => {
    it('reports the count and span', () => {
      const summary = builders().describeTimeline({
        label: 'Drive events',
        count: 7,
        start: '08:12',
        end: '08:40',
      });
      expect(summary).toContain('7');
      expect(summary).toContain('08:12');
      expect(summary).toContain('08:40');
    });

    it('reports emptiness explicitly', () => {
      const summary = builders().describeTimeline({ label: 'Drive events', count: 0 });
      expect(summary.toLowerCase()).toContain('no entries');
    });

    it('omits the span when only one endpoint is known', () => {
      const summary = builders().describeTimeline({
        label: 'Drive events',
        count: 3,
        start: '08:12',
      });
      expect(summary).not.toMatch(/from/i);
    });
  });
});
