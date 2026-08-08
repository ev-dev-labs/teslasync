/**
 * Design-system invariant tests.
 *
 * These lock the contracts introduced by the token-layer re-skin so the
 * primitives cannot silently drift apart again. Each test encodes a real
 * defect that existed before the token layer landed:
 *
 *  - GlassPanel and Card disagreed on background, border, radius AND
 *    elevation, so adjacent panels visibly failed to line up.
 *  - Button's neutral variants were pinned to Tailwind's `gray-*` ramp and
 *    rendered identically on all 140 theme presets.
 *  - Custom Tailwind scale keys are invisible to tailwind-merge unless they
 *    are registered, which silently breaks caller overrides.
 *  - A `var()` reference whose token is never declared fails silently at
 *    runtime — there is no build error for a typo'd CSS variable.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlassPanel } from './GlassPanel';
import { Card } from './Card';
import { Button } from './Button';
import { cn } from '@/lib/cn';

// CWD-relative, matching the convention in ForcedColors.contract.test.tsx —
// vitest runs with the `web/` package root as its working directory.
const indexCss = readFileSync(join('src', 'index.css'), 'utf8');
const tailwindConfig = readFileSync('tailwind.config.js', 'utf8');

/** Every `var(--token)` reference appearing in a class list. */
function tokensIn(className: string): string[] {
  return [...className.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
}

/** True when index.css declares the custom property (in any selector block). */
function isDeclared(token: string): boolean {
  return new RegExp(`^\\s*${token}\\s*:`, 'm').test(indexCss);
}

describe('design tokens — panel surface contract', () => {
  it('declares every panel, control, shape and elevation token in index.css', () => {
    const required = [
      '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill',
      '--elevation-0', '--elevation-1', '--elevation-2', '--elevation-3',
      '--panel-bg', '--panel-bg-hover', '--panel-border', '--panel-border-hover',
      '--panel-radius', '--panel-shadow', '--panel-shadow-hover', '--panel-blur',
      '--control-bg', '--control-bg-hover', '--control-border', '--control-border-hover',
      '--control-track-off', '--control-thumb', '--skeleton-bg',
      '--focus-ring', '--focus-ring-width', '--focus-ring-offset',
    ];
    const missing = required.filter((t) => !isDeclared(t));
    expect(missing).toEqual([]);
  });

  it('re-declares the elevation ramp for light mode', () => {
    // Dark-mode shadows use heavy black alphas that read as dirty smudges on a
    // light surface, so light mode must override the ladder rather than inherit.
    const lightBlock = indexCss.slice(indexCss.indexOf(':root.light-mode {'));
    expect(lightBlock).toMatch(/--elevation-1\s*:/);
    expect(lightBlock).toMatch(/--elevation-2\s*:/);
    expect(lightBlock).toMatch(/--elevation-3\s*:/);
  });

  it('resolves GlassPanel and Card from the identical surface tokens', () => {
    render(
      <>
        <GlassPanel data-testid="panel">x</GlassPanel>
        <Card data-testid="card">x</Card>
      </>,
    );
    const panel = screen.getByTestId('panel').className;
    const card = screen.getByTestId('card').className;

    for (const shared of [
      'bg-[var(--panel-bg)]',
      'border-[var(--panel-border)]',
      'rounded-panel',
      'shadow-panel',
    ]) {
      expect(panel, `GlassPanel must use ${shared}`).toContain(shared);
      expect(card, `Card must use ${shared}`).toContain(shared);
    }
  });

  it('never references a CSS variable that index.css does not declare', () => {
    render(
      <>
        <GlassPanel hover glow="cyan" data-testid="panel">x</GlassPanel>
        <Card hover data-testid="card">x</Card>
        <Button variant="secondary">a</Button>
        <Button variant="outline">b</Button>
        <Button variant="ghost">c</Button>
        <Button variant="primary">d</Button>
        <Button variant="danger">e</Button>
      </>,
    );
    const classNames = [
      screen.getByTestId('panel').className,
      screen.getByTestId('card').className,
      ...screen.getAllByRole('button').map((b) => b.className),
    ].join(' ');

    const dangling = [...new Set(tokensIn(classNames))].filter((t) => !isDeclared(t));
    expect(dangling).toEqual([]);
  });
});

describe('design tokens — theme fidelity', () => {
  it('keeps every neutral Button variant free of hardcoded palette colours', () => {
    // `bg-gray-100` / `dark:bg-gray-700` etc. ignored the active preset, so a
    // Dracula or Solarized user got slate-grey chrome that did not belong to
    // their palette. Neutral chrome must resolve from `--control-*`.
    for (const variant of ['secondary', 'outline', 'ghost'] as const) {
      const { unmount } = render(<Button variant={variant}>x</Button>);
      const cls = screen.getByRole('button').className;
      expect(cls, `${variant} must not hardcode gray-*`).not.toMatch(/(^|\s|:)(bg|border|text)-gray-\d/);
      expect(cls, `${variant} must use --control-* tokens`).toMatch(/var\(--control-/);
      unmount();
    }
  });

  it('keeps every shared neutral primitive off the fixed gray-* ramp', () => {
    // Button was not the only offender: Badge/neutral, StatusBadge, Tabs,
    // Toggle, Skeleton, Timeline and EmptyState's link CTA each pinned a
    // Tailwind grey, so seven shared primitives rendered identical slate chrome
    // on all 140 presets. Only *surface* greys are forbidden — mid greys
    // (300-600) remain legal as the neutral member of the semantic status
    // palette (see types/fsm/theme.ts), which is why the pattern is anchored to
    // the light/dark extremes rather than the whole ramp.
    const SURFACE_GRAY = /(?:^|\s|:)(?:bg|border)-gray-(?:950|900|800|700|200|100|50)(?![0-9])/;
    const sources: Array<[string, string]> = [
      ['Badge', join('src', 'components', 'ui', 'Badge.tsx')],
      ['Tabs', join('src', 'components', 'ui', 'Tabs.tsx')],
      ['Toggle', join('src', 'components', 'ui', 'Toggle.tsx')],
      ['Skeleton', join('src', 'components', 'feedback', 'Skeleton.tsx')],
      ['EmptyState', join('src', 'components', 'feedback', 'EmptyState.tsx')],
      ['StatusBadge', join('src', 'components', 'data-display', 'StatusBadge.tsx')],
      ['Timeline', join('src', 'components', 'data-display', 'Timeline.tsx')],
      ['ChartContainer', join('src', 'components', 'charts', 'ChartContainer.tsx')],
    ];
    for (const [name, path] of sources) {
      const code = readFileSync(path, 'utf8')
        .split(/\r?\n/)
        // Doc comments legitimately *describe* the banned pattern.
        .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
        // Print styles render onto white paper, where a fixed grey is correct.
        .filter((l) => !l.includes('print:'))
        .join('\n');
      expect(SURFACE_GRAY.test(code), `${name} must not pin a surface gray-*`).toBe(false);
    }
  });

  it('derives EmptyState link CTA chrome from the shared Button constants', () => {
    // The link CTA hand-copied Button's classes and silently drifted when the
    // neutral variants moved onto `--control-*`, leaving it on the old ramp
    // while every real <button> re-skinned. Deriving it makes drift impossible.
    const code = readFileSync(join('src', 'components', 'feedback', 'EmptyState.tsx'), 'utf8');
    expect(code).toMatch(/BUTTON_BASE/);
    expect(code).toMatch(/BUTTON_VARIANTS\.secondary/);
  });

  it('gives every Button the same accent focus ring regardless of variant', () => {
    for (const variant of ['primary', 'secondary', 'outline', 'ghost'] as const) {
      const { unmount } = render(<Button variant={variant}>x</Button>);
      expect(
        screen.getByRole('button').className,
        `${variant} lost the unified focus ring`,
      ).toContain('focus-visible:ring-[var(--focus-ring)]');
      unmount();
    }
  });

  it('keeps the destructive focus ring red on the danger variant', () => {
    // Deliberate exception: a destructive action should not look identical to
    // a benign one at the moment of keyboard focus.
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('focus-visible:ring-red-500');
  });

  it('drives light-mode panels from tokens instead of pinning them to white', () => {
    // Hardcoding `rgba(255,255,255,.7)` forced all 11 light presets
    // (Solarized Light's cream, Gruvbox Light, Rosé Pine Dawn, Ayu Light…) to
    // render pure-white panels that clashed with their own page background.
    const lightPanel = indexCss.match(/:root\.light-mode \.glass-panel \{[^}]*\}/)?.[0] ?? '';
    expect(lightPanel).not.toMatch(/rgba\(255,\s*255,\s*255/);
    expect(lightPanel).toContain('var(--panel-bg)');
  });
});

describe('design tokens — tailwind + tailwind-merge wiring', () => {
  it('registers the token-backed scales in tailwind.config.js', () => {
    for (const key of [
      "'shape-xs'", "'shape-sm'", "'shape-md'", "'shape-lg'", "'shape-xl'",
      "'pill'", "'panel'", "'e1'", "'e2'", "'e3'", "'panel-hover'",
    ]) {
      expect(tailwindConfig, `tailwind.config.js is missing ${key}`).toContain(key);
    }
  });

  it('leaves Tailwind\'s own radius scale untouched so existing components keep their shape', () => {
    // The re-skin propagates through the shared primitives, NOT by redefining
    // `rounded-sm|md|lg|xl` under 651 components' feet.
    expect(tailwindConfig).not.toMatch(/^\s*'?(sm|md|lg|xl)'?:\s*'var\(--radius-/m);
  });

  it('lets a caller className override the token-backed radius and shadow', () => {
    // Custom scale keys are invisible to tailwind-merge unless registered in a
    // class group; without that, both classes survive and CSS order decides.
    expect(cn('rounded-panel', 'rounded-lg')).toBe('rounded-lg');
    expect(cn('rounded-shape-sm', 'rounded-full')).toBe('rounded-full');
    expect(cn('shadow-panel', 'shadow-md')).toBe('shadow-md');
    expect(cn('shadow-e1', 'shadow-e3')).toBe('shadow-e3');
  });

  it('does not merge away a hover-state shadow that pairs with a base shadow', () => {
    expect(cn('shadow-panel', 'hover:shadow-panel-hover')).toBe(
      'shadow-panel hover:shadow-panel-hover',
    );
  });

  it('honours a caller radius override on the real primitives', () => {
    render(<GlassPanel className="rounded-full" data-testid="panel">x</GlassPanel>);
    const cls = screen.getByTestId('panel').className;
    expect(cls).toContain('rounded-full');
    expect(cls).not.toContain('rounded-panel');
  });
});

describe('design tokens — glassmorphism dial', () => {
  it('defaults the panel blur to zero so surfaces render flat', () => {
    // The whole aesthetic is reversible from one variable: raising
    // `--panel-blur` restores frosted glass app-wide with no component edits.
    expect(indexCss).toMatch(/--panel-blur:\s*0px/);
  });

  it('routes the .glass-* component classes through the same panel tokens', () => {
    const layer = indexCss.slice(
      indexCss.indexOf('@layer components {'),
      indexCss.indexOf('.glass-button:focus-visible'),
    );
    // No fixed blur radii, no cyan-pinned hover, no hardcoded shadow.
    expect(layer).not.toMatch(/backdrop-filter:\s*blur\(\d+px\)/);
    expect(layer).not.toMatch(/rgba\(0,\s*240,\s*255/);
    expect(layer).toContain('blur(var(--panel-blur))');
    expect(layer).toContain('var(--panel-shadow)');
  });
});
