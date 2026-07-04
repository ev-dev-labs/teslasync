import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { Clock, Loader, CircleCheck, CircleX, CalendarX } from 'lucide-react';

import type { GDPRArtifactStatus } from '@/types/admin-operator-confidence';
import { STATUS_VARIANT, STATUS_ICON, STATUS_COLOR } from './constants';

// ---------------------------------------------------------------------------
// gdpr-export/constants — status-presentation contract.
//
// constants.ts is a data-only module (no components, hooks or side effects):
// three parallel Record<GDPRArtifactStatus, …> maps that drive every visual
// cue for a GDPR export artifact. The value of a test here is to LOCK the
// exact invariants each consumer silently relies on, so a copy-paste edit to
// one map can't regress the UI without a red test. Each block mirrors how a
// real consumer reads the constant:
//   STATUS_VARIANT → GDPRExportPage   (`<Badge variant={STATUS_VARIANT[status] ?? 'neutral'}>`)
//   STATUS_ICON    → GDPRExportPage   (`const StatusIcon = STATUS_ICON[status]; <StatusIcon/>`)
//   STATUS_COLOR   → GDPRLifecyclePanel(`{ color: STATUS_COLOR.queued }` → Timeline dot inline style)
//
// The render blocks additionally prove the icon entries are genuinely
// mountable React components (the invariant GDPRExportPage's `<StatusIcon/>`
// depends on) and that each colour is a DOM-valid CSS colour string (the
// invariant Timeline's `style={{ backgroundColor: item.color }}` depends on).
// ---------------------------------------------------------------------------

/** The five lifecycle states the backend emits (mirrors the `GDPRArtifactStatus`
 *  union in admin-operator-confidence.ts). Declared explicitly so the tests
 *  fail loudly if the union — and therefore a map's key set — ever changes. */
const ALL_STATUSES: GDPRArtifactStatus[] = ['queued', 'running', 'complete', 'failed', 'expired'];

/** Badge variant keys — mirrors the `variants` map in
 *  web/src/components/ui/Badge.tsx. `Badge` does `variants[variant]` with NO
 *  fallback, so a STATUS_VARIANT value outside this set renders an unstyled
 *  badge. This is a hard contract, not a suggestion. */
const BADGE_VARIANTS = ['info', 'success', 'warning', 'danger', 'neutral'] as const;

/** Timeline / lifecycle dots consume STATUS_COLOR as a raw inline CSS colour,
 *  so every value must be a concrete 6-digit hex (not a token / class). */
const HEX6 = /^#[0-9a-f]{6}$/i;

describe('STATUS_VARIANT', () => {
  it('exposes exactly the five lifecycle states as keys', () => {
    expect(Object.keys(STATUS_VARIANT).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('pins the exact status → Badge-variant mapping', () => {
    expect(STATUS_VARIANT).toEqual({
      queued: 'info',
      running: 'info',
      complete: 'success',
      failed: 'danger',
      expired: 'warning',
    });
  });

  it('maps every status to a variant the Badge component can actually render', () => {
    for (const status of ALL_STATUSES) {
      expect(BADGE_VARIANTS).toContain(STATUS_VARIANT[status]);
    }
  });

  it("resolves a real variant for every status — the page's `?? 'neutral'` never fires", () => {
    // Mirrors GDPRExportPage: `variant={STATUS_VARIANT[status] ?? 'neutral'}`.
    for (const status of ALL_STATUSES) {
      const resolved = STATUS_VARIANT[status] ?? 'neutral';
      expect(resolved).toBe(STATUS_VARIANT[status]);
      expect(resolved).not.toBe('neutral');
    }
  });

  it('pairs the in-flight states (queued+running=info) while terminal states diverge', () => {
    expect(STATUS_VARIANT.queued).toBe('info');
    expect(STATUS_VARIANT.running).toBe(STATUS_VARIANT.queued);
    // The three settled states each get their own semantic colour.
    const terminal = [STATUS_VARIANT.complete, STATUS_VARIANT.failed, STATUS_VARIANT.expired];
    expect(new Set(terminal).size).toBe(3);
    expect(terminal).toEqual(['success', 'danger', 'warning']);
  });
});

describe('STATUS_ICON', () => {
  it('exposes exactly the five lifecycle states as keys', () => {
    expect(Object.keys(STATUS_ICON).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('binds each status to its lucide glyph', () => {
    expect(STATUS_ICON).toEqual({
      queued: Clock,
      running: Loader,
      complete: CircleCheck,
      failed: CircleX,
      expired: CalendarX,
    });
  });

  it('is a defined, renderable component reference for every status', () => {
    for (const status of ALL_STATUSES) {
      const Icon = STATUS_ICON[status];
      expect(Icon).toBeDefined();
      // A lucide icon is a forwardRef exotic (object) or a plain function —
      // never undefined, or GDPRExportPage's `<StatusIcon/>` renders `<undefined/>`.
      expect(['object', 'function']).toContain(typeof Icon);
    }
  });

  it('assigns a DISTINCT icon to every status so state is conveyed by shape, not colour alone (a11y)', () => {
    const icons = ALL_STATUSES.map((s) => STATUS_ICON[s]);
    expect(new Set(icons).size).toBe(ALL_STATUSES.length);
  });

  it('distinguishes queued from running by glyph even though they share a colour/variant', () => {
    // This is the crux a11y guarantee: the two in-flight states are visually
    // paired on colour, so the icon (Clock vs the spinning Loader) is the
    // ONLY cue a colour-blind operator has to tell them apart.
    expect(STATUS_ICON.queued).toBe(Clock);
    expect(STATUS_ICON.running).toBe(Loader);
    expect(STATUS_ICON.queued).not.toBe(STATUS_ICON.running);
  });

  it('mounts each glyph as an svg that forwards an accessible name (icon-only control)', () => {
    for (const status of ALL_STATUSES) {
      const Icon = STATUS_ICON[status];
      const { container, unmount } = render(
        createElement(Icon, { 'aria-label': `status-${status}` }),
      );
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('aria-label', `status-${status}`);
      unmount();
    }
  });

  it('forwards aria-hidden so the glyph can be marked decorative (the Badge already names the status)', () => {
    const { container } = render(createElement(STATUS_ICON.running, { 'aria-hidden': true }));
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('STATUS_COLOR', () => {
  it('exposes exactly the five lifecycle states as keys', () => {
    expect(Object.keys(STATUS_COLOR).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('pins the exact status → hex mapping', () => {
    expect(STATUS_COLOR).toEqual({
      queued: '#22d3ee',
      running: '#22d3ee',
      complete: '#10b981',
      failed: '#f43f5e',
      expired: '#f59e0b',
    });
  });

  it('is a concrete 6-digit hex for every status (Timeline consumes it as a raw CSS colour)', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_COLOR[status]).toMatch(HEX6);
    }
  });

  it('shares one in-flight hue for queued+running, matching their shared info variant', () => {
    expect(STATUS_COLOR.queued).toBe('#22d3ee');
    expect(STATUS_COLOR.running).toBe(STATUS_COLOR.queued);
  });

  it('gives complete/failed/expired distinct semantic hues, none reusing the in-flight cyan', () => {
    const settled = [STATUS_COLOR.complete, STATUS_COLOR.failed, STATUS_COLOR.expired];
    expect(new Set(settled).size).toBe(3);
    for (const hue of settled) {
      expect(hue).not.toBe(STATUS_COLOR.queued);
    }
  });

  it('applies each colour as a DOM-valid inline background, exactly as the Timeline dot does', () => {
    // jsdom silently drops an invalid CSS colour, leaving backgroundColor === ''.
    // A non-empty rgb(...) therefore proves the hex is a real, paintable colour.
    for (const status of ALL_STATUSES) {
      const { getByTestId, unmount } = render(
        createElement('span', {
          'data-testid': 'dot',
          style: { backgroundColor: STATUS_COLOR[status] },
        }),
      );
      expect(getByTestId('dot').style.backgroundColor).toMatch(/^rgb\(/);
      unmount();
    }
  });

  it('round-trips the settled hexes to their exact rgb triplets', () => {
    const paint = (hex: string) => {
      const { getByTestId, unmount } = render(
        createElement('span', { 'data-testid': 't', style: { backgroundColor: hex } }),
      );
      const rgb = getByTestId('t').style.backgroundColor;
      unmount();
      return rgb;
    };
    expect(paint(STATUS_COLOR.complete)).toBe('rgb(16, 185, 129)');
    expect(paint(STATUS_COLOR.failed)).toBe('rgb(244, 63, 94)');
    expect(paint(STATUS_COLOR.expired)).toBe('rgb(245, 158, 11)');
  });
});

describe('cross-map coherence (the composite lookup a consumer performs)', () => {
  it('resolves every status to a defined variant, icon AND colour together', () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_VARIANT[status]).toBeDefined();
      expect(STATUS_ICON[status]).toBeDefined();
      expect(STATUS_COLOR[status]).toBeDefined();
    }
  });

  it('keeps all three maps on the identical key set (no map drifts a key)', () => {
    const variantKeys = Object.keys(STATUS_VARIANT).sort();
    expect(Object.keys(STATUS_ICON).sort()).toEqual(variantKeys);
    expect(Object.keys(STATUS_COLOR).sort()).toEqual(variantKeys);
  });

  it('treats queued+running as the visually-paired in-flight states (same variant+colour, distinct icon)', () => {
    expect(STATUS_VARIANT.queued).toBe(STATUS_VARIANT.running);
    expect(STATUS_COLOR.queued).toBe(STATUS_COLOR.running);
    expect(STATUS_ICON.queued).not.toBe(STATUS_ICON.running);
  });

  it('gives each settled state (complete/failed/expired) a unique variant AND colour', () => {
    const variants = [STATUS_VARIANT.complete, STATUS_VARIANT.failed, STATUS_VARIANT.expired];
    const colors = [STATUS_COLOR.complete, STATUS_COLOR.failed, STATUS_COLOR.expired];
    expect(new Set(variants).size).toBe(3);
    expect(new Set(colors).size).toBe(3);
  });
});
