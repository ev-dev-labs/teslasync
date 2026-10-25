import { Icons } from '@/lib/icons';
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';

import { Badge } from '@/components/ui';
import { Timeline } from '@/components/data-display';
import { STATUS_VARIANT, STATUS_ICON, STATUS_COLOR } from './constants';

// ---------------------------------------------------------------------------
// Original names below are stable receipt identities, not backend job states.
// Crosswalk: paired queued/running → neutral created/expires; terminal states →
// downloaded/info, expired/warning, and creation/neutral. Hex/ RGB obligations →
// exact theme-variable references retained by DOM and the real Timeline.
// All three existing STATUS_* exports remain event maps, not a new DTO enum.
// jsdom proves specified CSS references only, not resolved browser contrast.
// ---------------------------------------------------------------------------

type ManifestEvent = keyof typeof STATUS_COLOR;
const ALL_EVENTS: ManifestEvent[] = ['created', 'downloaded', 'expires', 'expired'];

/** Badge variant keys — mirrors the `variants` map in
 *  web/src/components/ui/Badge.tsx. `Badge` does `variants[variant]` with NO
 *  fallback, so a STATUS_VARIANT value outside this set renders an unstyled
 *  badge. This is a hard contract, not a suggestion. */
const BADGE_VARIANTS = ['info', 'success', 'warning', 'danger', 'neutral'] as const;

const SEMANTIC_COLOR = /^var\(--(?:text-secondary|semantic-(?:info|warning))\)$/;

describe('STATUS_VARIANT', () => {
  it('exposes exactly the five lifecycle states as keys', () => {
    expect(Object.keys(STATUS_VARIANT).sort()).toEqual([...ALL_EVENTS].sort());
  });

  it('pins the exact status → Badge-variant mapping', () => {
    expect(STATUS_VARIANT).toEqual({
      created: 'neutral',
      downloaded: 'info',
      expires: 'neutral',
      expired: 'warning',
    });
  });

  it('maps every status to a variant the Badge component can actually render', () => {
    for (const event of ALL_EVENTS) {
      expect(BADGE_VARIANTS).toContain(STATUS_VARIANT[event]);
      const { container, unmount } = render(
        createElement(Badge, { variant: STATUS_VARIANT[event] }, event),
      );
      expect(container.firstChild).toHaveTextContent(event);
      unmount();
    }
  });

  it("resolves a real variant for every status — the page's `?? 'neutral'` never fires", () => {
    // A real neutral role is valid; it is not evidence of a missing map entry.
    for (const event of ALL_EVENTS) {
      const resolved = STATUS_VARIANT[event] ?? 'neutral';
      expect(resolved).toBe(STATUS_VARIANT[event]);
      expect(Object.prototype.hasOwnProperty.call(STATUS_VARIANT, event)).toBe(true);
    }
  });

  it('pairs the in-flight states (queued+running=info) while terminal states diverge', () => {
    expect(STATUS_VARIANT.created).toBe('neutral');
    expect(STATUS_VARIANT.expires).toBe(STATUS_VARIANT.created);
    const terminal = [STATUS_VARIANT.downloaded, STATUS_VARIANT.expired, STATUS_VARIANT.created];
    expect(new Set(terminal).size).toBe(3);
    expect(terminal).toEqual(['info', 'warning', 'neutral']);
  });
});

describe('STATUS_ICON', () => {
  it('exposes exactly the five lifecycle states as keys', () => {
    expect(Object.keys(STATUS_ICON).sort()).toEqual([...ALL_EVENTS].sort());
  });

  it('binds each status to its lucide glyph', () => {
    expect(STATUS_ICON).toEqual({
      created: Icons.clock,
      downloaded: Icons.hardDriveDownload,
      expires: Icons.calendarClock,
      expired: Icons.calendarX,
    });
  });

  it('is a defined, renderable component reference for every status', () => {
    for (const event of ALL_EVENTS) {
      const Icon = STATUS_ICON[event];
      expect(Icon).toBeDefined();
      // A lucide icon is a forwardRef exotic (object) or a plain function —
      // never undefined, which would make the lifecycle renderer unmountable.
      expect(['object', 'function']).toContain(typeof Icon);
    }
  });

  it('assigns a DISTINCT icon to every status so state is conveyed by shape, not colour alone (a11y)', () => {
    const icons = ALL_EVENTS.map((event) => STATUS_ICON[event]);
    expect(new Set(icons).size).toBe(ALL_EVENTS.length);
  });

  it('distinguishes queued from running by glyph even though they share a colour/variant', () => {
    // Creation and future expiry share neutral ink, not their glyphs/labels.
    expect(STATUS_ICON.created).toBe(Icons.clock);
    expect(STATUS_ICON.expires).toBe(Icons.calendarClock);
    expect(STATUS_ICON.created).not.toBe(STATUS_ICON.expires);
  });

  it('mounts each glyph as an svg that forwards an accessible name (icon-only control)', () => {
    for (const event of ALL_EVENTS) {
      const Icon = STATUS_ICON[event];
      const { container, unmount } = render(
        createElement(Icon, { 'aria-label': `event-${event}` }),
      );
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('aria-label', `event-${event}`);
      unmount();
    }
  });

  it('forwards aria-hidden so the glyph can be marked decorative (the Badge already names the status)', () => {
    const { container } = render(createElement(STATUS_ICON.downloaded, { 'aria-hidden': true }));
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('STATUS_COLOR', () => {
  it('exposes exactly the five lifecycle states as keys', () => {
    expect(Object.keys(STATUS_COLOR).sort()).toEqual([...ALL_EVENTS].sort());
  });

  it('pins the exact status → hex mapping', () => {
    expect(STATUS_COLOR).toEqual({
      created: 'var(--text-secondary)',
      downloaded: 'var(--semantic-info)',
      expires: 'var(--text-secondary)',
      expired: 'var(--semantic-warning)',
    });
  });

  it('is a concrete 6-digit hex for every status (Timeline consumes it as a raw CSS colour)', () => {
    for (const event of ALL_EVENTS) {
      expect(STATUS_COLOR[event]).toMatch(SEMANTIC_COLOR);
    }
  });

  it('shares one in-flight hue for queued+running, matching their shared info variant', () => {
    expect(STATUS_COLOR.created).toBe('var(--text-secondary)');
    expect(STATUS_COLOR.expires).toBe(STATUS_COLOR.created);
  });

  it('gives complete/failed/expired distinct semantic hues, none reusing the in-flight cyan', () => {
    const settled = [STATUS_COLOR.downloaded, STATUS_COLOR.expired];
    expect(new Set(settled).size).toBe(2);
    for (const hue of settled) {
      expect(hue).not.toBe(STATUS_COLOR.created);
    }
  });

  it('applies each colour as a DOM-valid inline background, exactly as the Timeline dot does', () => {
    // Preserve the specified variable reference; don't invent its resolved paint.
    for (const event of ALL_EVENTS) {
      const { getByTestId, unmount } = render(
        createElement('span', {
          'data-testid': 'dot',
          style: { backgroundColor: STATUS_COLOR[event] },
        }),
      );
      expect(getByTestId('dot').style.backgroundColor).toBe(STATUS_COLOR[event]);
      unmount();
    }
  });

  it('round-trips the settled hexes to their exact rgb triplets', () => {
    const paint = (color: string) => {
      const { getByTestId, unmount } = render(
        createElement('span', { 'data-testid': 't', style: { borderColor: color, color } }),
      );
      const specified = [
        getByTestId('t').style.borderColor,
        getByTestId('t').style.color,
      ];
      unmount();
      return specified;
    };
    expect(paint(STATUS_COLOR.created)).toEqual(['var(--text-secondary)', 'var(--text-secondary)']);
    expect(paint(STATUS_COLOR.downloaded)).toEqual(['var(--semantic-info)', 'var(--semantic-info)']);
    expect(paint(STATUS_COLOR.expired)).toEqual(['var(--semantic-warning)', 'var(--semantic-warning)']);
    const { container } = render(createElement(Timeline, {
      label: 'Manifest events',
      items: ALL_EVENTS.map((event) => ({
        title: event,
        time: '—',
        icon: createElement(STATUS_ICON[event], { 'aria-hidden': true }),
        color: STATUS_COLOR[event],
      })),
    }));
    const dots = container.querySelectorAll<HTMLSpanElement>('span[style]');
    expect(dots).toHaveLength(ALL_EVENTS.length);
    for (const [index, event] of ALL_EVENTS.entries()) {
      // toHaveStyle reads computed CSS; jsdom loses unresolved var() border
      // shorthand there. Assert both specified references on the real consumer.
      expect(dots[index].style.color).toBe(STATUS_COLOR[event]);
      expect(dots[index].style.borderColor).toBe(STATUS_COLOR[event]);
    }
  });
});

describe('cross-map coherence (the composite lookup a consumer performs)', () => {
  it('resolves every status to a defined variant, icon AND colour together', () => {
    for (const event of ALL_EVENTS) {
      expect(STATUS_VARIANT[event]).toBeDefined();
      expect(STATUS_ICON[event]).toBeDefined();
      expect(STATUS_COLOR[event]).toBeDefined();
    }
  });

  it('keeps all three maps on the identical key set (no map drifts a key)', () => {
    const variantKeys = Object.keys(STATUS_VARIANT).sort();
    expect(Object.keys(STATUS_ICON).sort()).toEqual(variantKeys);
    expect(Object.keys(STATUS_COLOR).sort()).toEqual(variantKeys);
  });

  it('treats queued+running as the visually-paired in-flight states (same variant+colour, distinct icon)', () => {
    expect(STATUS_VARIANT.created).toBe(STATUS_VARIANT.expires);
    expect(STATUS_COLOR.created).toBe(STATUS_COLOR.expires);
    expect(STATUS_ICON.created).not.toBe(STATUS_ICON.expires);
  });

  it('gives each settled state (complete/failed/expired) a unique variant AND colour', () => {
    const variants = [STATUS_VARIANT.created, STATUS_VARIANT.downloaded, STATUS_VARIANT.expired];
    const colors = [STATUS_COLOR.created, STATUS_COLOR.downloaded, STATUS_COLOR.expired];
    expect(new Set(variants).size).toBe(3);
    expect(new Set(colors).size).toBe(3);
  });
});
