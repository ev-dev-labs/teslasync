import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { Activity, Battery, Car, Shield, Wind, Zap } from 'lucide-react';
import type { TFunction } from 'i18next';

import {
  HEALTH_ICONS,
  HEALTH_FALLBACK_ICON,
  healthSeverity,
  anomalyTypeLabel,
} from './anomalyHelpers';
import { severityTokens } from '@/lib/tokens';
import type { AnomalyEntry } from '@/api/hooks/useAnomalies';

// ---------------------------------------------------------------------------
// anomalyHelpers — presentation layer for the Anomaly Dashboard.
//
// These pure helpers translate the raw anomaly API payload into the display
// primitives SystemHealthCard + AnomalyTimelineCard consume: a per-category
// icon (+ safe fallback), a color-independent Severity tone for the health
// grid, and an i18n-aware label for each detector type.
//
// The real status/type domains come straight from the Go handler
// (internal/api/anomaly/handler.go):
//   health_summary values → 'normal' | 'info' | 'warning' | 'critical'
//     (every category is seeded 'normal', then upgraded to an anomaly
//      severity — critical/warning/info — as anomalies are folded in)
//   anomaly type           → 'z_score' | 'range' | 'trend'
//
// A wrong branch here is not cosmetic: mapping an 'info'-level category to a
// green `success` paints a checkmark over a category that actually has an
// anomaly, and a mis-keyed Severity would throw at `severityTokens[sev]`.
// ---------------------------------------------------------------------------

/**
 * i18next-style translator: returns the caller-supplied English default,
 * falling back to the raw key. Kept as the raw spy so `t` calls can be
 * asserted; cast to {@link TFunction} at the call boundary where the helper's
 * real signature is exercised.
 */
function makeT() {
  return vi.fn((key: string, defaultValue?: string) => defaultValue ?? key);
}

describe('HEALTH_ICONS', () => {
  it('maps each of the five canonical backend categories to its Lucide icon', () => {
    expect(HEALTH_ICONS.battery).toBe(Battery);
    expect(HEALTH_ICONS.tires).toBe(Car);
    expect(HEALTH_ICONS.motors).toBe(Zap);
    expect(HEALTH_ICONS.hvac).toBe(Wind);
    expect(HEALTH_ICONS.charging).toBe(Activity);
  });

  it('covers exactly the five seeded categories (handler.go parity)', () => {
    expect(Object.keys(HEALTH_ICONS).sort()).toEqual([
      'battery',
      'charging',
      'hvac',
      'motors',
      'tires',
    ]);
  });

  it('has no direct entry for an unknown category (caller falls back)', () => {
    expect(HEALTH_ICONS.suspension).toBeUndefined();
    expect(HEALTH_ICONS['']).toBeUndefined();
  });

  it('renders every mapped icon as an accessible svg element', () => {
    for (const [category, Icon] of Object.entries(HEALTH_ICONS)) {
      const { container, unmount } = render(
        createElement(Icon, { 'aria-label': category }),
      );
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(container.querySelector('[aria-label]')).not.toBeNull();
      unmount();
    }
  });
});

describe('HEALTH_FALLBACK_ICON', () => {
  it('is the neutral Shield icon', () => {
    expect(HEALTH_FALLBACK_ICON).toBe(Shield);
  });

  it('backs the `HEALTH_ICONS[cat] ?? HEALTH_FALLBACK_ICON` lookup', () => {
    // Mirrors SystemHealthCard's resolution: a known category keeps its icon,
    // while a future/unknown category still resolves to a renderable icon
    // instead of `undefined` (which would crash `<Icon />`).
    const resolve = (cat: string) => HEALTH_ICONS[cat] ?? HEALTH_FALLBACK_ICON;
    expect(resolve('battery')).toBe(Battery);
    expect(resolve('teleporter')).toBe(Shield);
    expect(resolve('')).toBe(Shield);
  });

  it('renders as an svg element', () => {
    const { container } = render(
      createElement(HEALTH_FALLBACK_ICON, { 'aria-label': 'unknown system' }),
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('healthSeverity', () => {
  it('maps critical and warning through to their canonical tones', () => {
    expect(healthSeverity('critical')).toBe('critical');
    expect(healthSeverity('warning')).toBe('warn');
  });

  it("surfaces the seeded 'normal' state as a green success (the only healthy tone)", () => {
    expect(healthSeverity('normal')).toBe('success');
  });

  it("maps an 'info'-level category to info, NOT a false green success (regression guard)", () => {
    // BUG FIX: the backend upgrades a category to `info` when an info-severity
    // anomaly is folded in (classifySeverity / the trend path in
    // internal/api/anomaly/handler.go). The old `else → 'success'` branch
    // painted a green checkmark over that category, hiding the anomaly.
    expect(healthSeverity('info')).toBe('info');
    expect(healthSeverity('info')).not.toBe('success');
  });

  it('defaults an unrecognized or empty status to the neutral info tone (never success)', () => {
    // An unknown state (a future backend status, or a dropped value) is not a
    // healthy one — it must not read as a green "all good".
    expect(healthSeverity('degraded')).toBe('info');
    expect(healthSeverity('offline')).toBe('info');
    expect(healthSeverity('')).toBe('info');
  });

  it('matches the backend status literals case-sensitively', () => {
    // The handler emits lowercase literals; a capitalized near-miss is treated
    // as unknown → info, never silently coerced to success.
    expect(healthSeverity('Normal')).toBe('info');
    expect(healthSeverity('CRITICAL')).toBe('info');
  });

  it('only ever returns a key the severityTokens map is defined for', () => {
    // Locks the invariant SystemHealthCard relies on: `severityTokens[sev]`
    // must never be undefined. A raw wire alias like 'warning' would throw.
    const domain = ['normal', 'info', 'warning', 'critical', 'mystery', ''];
    for (const status of domain) {
      const sev = healthSeverity(status);
      expect(severityTokens[sev]).toBeDefined();
    }
    expect(healthSeverity('warning')).not.toBe('warning');
  });
});

describe('anomalyTypeLabel', () => {
  it('labels each known detector type via its i18n key + English default', () => {
    const t = makeT();
    expect(anomalyTypeLabel(t as unknown as TFunction, 'z_score')).toBe('Statistical');
    expect(anomalyTypeLabel(t as unknown as TFunction, 'range')).toBe('Range');
    expect(anomalyTypeLabel(t as unknown as TFunction, 'trend')).toBe('Trend');
  });

  it('passes the correct translation key + fallback to t for each type', () => {
    const t = makeT();
    anomalyTypeLabel(t as unknown as TFunction, 'z_score');
    anomalyTypeLabel(t as unknown as TFunction, 'range');
    anomalyTypeLabel(t as unknown as TFunction, 'trend');
    expect(t).toHaveBeenCalledWith('anomaly.type.z_score', 'Statistical');
    expect(t).toHaveBeenCalledWith('anomaly.type.range', 'Range');
    expect(t).toHaveBeenCalledWith('anomaly.type.trend', 'Trend');
    expect(t).toHaveBeenCalledTimes(3);
  });

  it('honors a real translation instead of hardcoding the English default', () => {
    // Proves the label is i18n-driven: when the catalog carries a localized
    // string, that value (not the English fallback) is returned.
    const t = vi.fn((key: string) =>
      key === 'anomaly.type.z_score' ? 'Statistique' : key,
    ) as unknown as TFunction;
    expect(anomalyTypeLabel(t, 'z_score')).toBe('Statistique');
  });

  it('falls back to the raw type for an unknown detector, without consulting t', () => {
    // A future backend type (e.g. 'seasonal') has no i18n key yet; the raw
    // token is shown verbatim and the translator is never called.
    const t = makeT();
    expect(anomalyTypeLabel(t as unknown as TFunction, 'seasonal')).toBe('seasonal');
    expect(anomalyTypeLabel(t as unknown as TFunction, 'custom_v2')).toBe('custom_v2');
    expect(t).not.toHaveBeenCalled();
  });

  it('covers every AnomalyEntry["type"] union member', () => {
    const t = makeT();
    const cases: Array<[AnomalyEntry['type'], string]> = [
      ['z_score', 'Statistical'],
      ['range', 'Range'],
      ['trend', 'Trend'],
    ];
    for (const [type, expected] of cases) {
      expect(anomalyTypeLabel(t as unknown as TFunction, type)).toBe(expected);
    }
  });
});
