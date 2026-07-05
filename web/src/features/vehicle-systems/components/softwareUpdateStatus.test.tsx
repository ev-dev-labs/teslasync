/**
 * softwareUpdateStatus — status-metadata registry + resolver tests.
 *
 * This module is the single source of truth for the per-status colour token,
 * gradient hex, glyph, Badge variant, and i18n label shared by the Software
 * Updates timeline cards and the status-breakdown panel. The suite locks:
 *
 *   1. Registry integrity — every UpdateStatusKey has a complete, internally
 *      consistent meta whose `color` resolves against the shared neon token
 *      map, whose `hex` is a real gradient value, and whose `badgeVariant` is
 *      actually accepted by the shared <Badge>.
 *   2. Ordering — UPDATE_STATUS_ORDER enumerates each key exactly once so the
 *      breakdown panel renders deterministically.
 *   3. Resolver safety — getUpdateStatus() maps known / unknown / nullish wire
 *      strings to the right meta AND, critically, never leaks an inherited
 *      Object.prototype member (constructor/toString/…) as a "status", which
 *      would hand consumers a meta with an undefined icon/color/hex.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { neonColorMap } from '@/lib/tokens';
import { Badge } from '@/components/ui';

import {
  UPDATE_STATUS,
  UPDATE_STATUS_ORDER,
  getUpdateStatus,
  type UpdateStatusMeta,
} from './softwareUpdateStatus';

// The five variants the shared <Badge> knows how to paint. Kept in sync with
// components/ui/Badge.tsx's `variants` map — a status pointing at anything else
// would render an unstyled chip.
const VALID_BADGE_VARIANTS = ['info', 'success', 'warning', 'danger', 'neutral'] as const;

const HEX_RE = /^#[0-9a-f]{6}$/i;

const META_FIELDS: Array<keyof UpdateStatusMeta> = [
  'color',
  'hex',
  'icon',
  'badgeVariant',
  'labelKey',
  'labelFallback',
];

describe('UPDATE_STATUS registry', () => {
  it('defines a complete meta for every ordered status key', () => {
    for (const key of UPDATE_STATUS_ORDER) {
      const meta = UPDATE_STATUS[key];
      expect(meta, key).toBeDefined();
      for (const field of META_FIELDS) {
        expect(meta[field], `${key}.${String(field)}`).toBeDefined();
      }
      // Lucide icons are React components — functions, or forwardRef/memo
      // exotic objects. Either is a valid, renderable element type.
      expect(meta.icon).toBeTruthy();
      expect(['function', 'object']).toContain(typeof meta.icon);
    }
  });

  it('uses only neon colour tokens that exist in the shared token map', () => {
    const known = Object.keys(neonColorMap);
    expect(known.length).toBeGreaterThan(0);
    for (const key of UPDATE_STATUS_ORDER) {
      expect(known, key).toContain(UPDATE_STATUS[key].color);
    }
  });

  it('uses 6-digit hex gradients for the dynamic MetricBar', () => {
    for (const key of UPDATE_STATUS_ORDER) {
      expect(UPDATE_STATUS[key].hex, key).toMatch(HEX_RE);
    }
  });

  it('points every status at a Badge variant the shared component accepts', () => {
    for (const key of UPDATE_STATUS_ORDER) {
      expect(VALID_BADGE_VARIANTS, key).toContain(UPDATE_STATUS[key].badgeVariant);
    }
  });

  it('namespaces every i18n label under softwareUpdates.status with a non-empty fallback', () => {
    for (const key of UPDATE_STATUS_ORDER) {
      const meta = UPDATE_STATUS[key];
      expect(meta.labelKey).toBe(`softwareUpdates.status.${key}`);
      expect(meta.labelFallback.length).toBeGreaterThan(0);
    }
  });
});

describe('UPDATE_STATUS_ORDER', () => {
  it('enumerates every registry key exactly once', () => {
    const registryKeys = Object.keys(UPDATE_STATUS).sort();
    const ordered = [...UPDATE_STATUS_ORDER].sort();
    expect(ordered).toEqual(registryKeys);
    // No accidental duplicate that would render the same MetricBar twice.
    expect(new Set(UPDATE_STATUS_ORDER).size).toBe(UPDATE_STATUS_ORDER.length);
  });

  it('keeps the documented installed→scheduled reading order', () => {
    expect(UPDATE_STATUS_ORDER[0]).toBe('installed');
    expect(UPDATE_STATUS_ORDER[UPDATE_STATUS_ORDER.length - 1]).toBe('scheduled');
  });
});

describe('getUpdateStatus', () => {
  it('resolves each known wire status to its exact registry meta', () => {
    for (const key of UPDATE_STATUS_ORDER) {
      // Referential equality: no copy, no re-derivation — the same singleton.
      expect(getUpdateStatus(key), key).toBe(UPDATE_STATUS[key]);
    }
  });

  it('falls back to `available` for nullish, empty, or unknown statuses', () => {
    expect(getUpdateStatus(null)).toBe(UPDATE_STATUS.available);
    expect(getUpdateStatus(undefined)).toBe(UPDATE_STATUS.available);
    expect(getUpdateStatus('')).toBe(UPDATE_STATUS.available);
    expect(getUpdateStatus('pending-reboot')).toBe(UPDATE_STATUS.available);
    // Resolution is exact-match / case-sensitive: a mismatched case is unknown.
    expect(getUpdateStatus('INSTALLED')).toBe(UPDATE_STATUS.available);
  });

  it('never leaks inherited Object.prototype members as a status (regression)', () => {
    // A bare `UPDATE_STATUS[key] ?? available` lookup walks the prototype chain,
    // so these inherited members resolve to truthy Object.prototype functions
    // and slip past the fallback — handing consumers a meta whose icon/color/hex
    // are undefined and crashing the timeline-card render.
    const inherited = [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      '__proto__',
      '__defineGetter__',
    ];
    for (const key of inherited) {
      const meta = getUpdateStatus(key);
      expect(meta, key).toBe(UPDATE_STATUS.available);
      // And the returned meta is genuinely usable, not a stray function.
      expect(meta.icon).toBeTruthy();
      expect(['function', 'object']).toContain(typeof meta.icon);
      expect(meta.color).toBeDefined();
      expect(meta.hex).toMatch(HEX_RE);
    }
  });

  it('always returns a fully-populated meta for arbitrary input', () => {
    const inputs: Array<string | null | undefined> = [
      'installed',
      'garbage',
      '',
      null,
      undefined,
      'toString',
    ];
    for (const input of inputs) {
      const meta = getUpdateStatus(input);
      for (const field of META_FIELDS) {
        expect(meta[field], `${String(input)}.${String(field)}`).toBeDefined();
      }
    }
  });
});

describe('metadata integrates with shared UI primitives', () => {
  it('renders every status glyph as an accessible svg', () => {
    for (const key of UPDATE_STATUS_ORDER) {
      const meta = UPDATE_STATUS[key];
      const Icon = meta.icon;
      const { container, unmount } = render(<Icon aria-label={meta.labelFallback} />);
      const svg = container.querySelector('svg');
      expect(svg, key).not.toBeNull();
      // The accessible name we passed survives lucide's prop spread.
      expect(svg?.getAttribute('aria-label')).toBe(meta.labelFallback);
      unmount();
    }
  });

  it('drives the shared <Badge> with an accepted variant for every status', () => {
    for (const key of UPDATE_STATUS_ORDER) {
      const meta = UPDATE_STATUS[key];
      const { getByText, unmount } = render(
        <Badge variant={meta.badgeVariant}>{meta.labelFallback}</Badge>,
      );
      // Renders without throwing (variant is in Badge's map) and shows its label.
      expect(getByText(meta.labelFallback)).toBeInTheDocument();
      unmount();
    }
  });
});
