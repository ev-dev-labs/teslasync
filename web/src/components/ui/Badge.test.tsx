/**
 * Badge primitive contract tests.
 *
 * Badge is a leaf status chip rendered in ~450 call sites, very often with a
 * data-driven `variant`/`size` (`variant={statusVariant(status)}`,
 * `variant={tip.variant}`). These tests lock in:
 *   1. The semantic element (a native <span>) and children pass-through.
 *   2. Every `variant` maps to its colour tokens; `neutral` is the default.
 *   3. Every `size` maps to its padding tokens; `md` is the default.
 *   4. The `dot` indicator is opt-in and, when present, is decorative
 *      (aria-hidden) so screen readers don't announce an empty node.
 *   5. Null-safety: a `variant`/`size` outside the union (which reaches Badge
 *      at runtime from API-fed helpers) degrades to the neutral/md tokens
 *      instead of rendering a colourless, invisible chip.
 *   6. Ref forwarding, className merge via cn(), and arbitrary HTML/ARIA
 *      attribute + event handler pass-through.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { Badge, BADGE_VARIANTS } from './Badge';

describe('Badge', () => {
  it('renders a native <span> carrying its children', () => {
    render(<Badge>Active</Badge>);
    const badge = screen.getByText('Active');
    expect(badge.tagName).toBe('SPAN');
    expect(badge.textContent).toBe('Active');
  });

  it('defaults to the neutral variant and md size when unspecified', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    // neutral background + md horizontal padding are the documented defaults.
    expect(badge.className).toContain(BADGE_VARIANTS.neutral);
    expect(badge.className).toContain('px-2');
    expect(badge.className).toContain('rounded-full');
  });

  it.each([
    ['info', BADGE_VARIANTS.info],
    ['success', BADGE_VARIANTS.success],
    ['warning', BADGE_VARIANTS.warning],
    ['danger', BADGE_VARIANTS.danger],
    ['neutral', BADGE_VARIANTS.neutral],
  ] as const)('applies the %s variant background token', (variant, expected) => {
    render(
      <Badge variant={variant} data-testid="chip">
        {variant}
      </Badge>,
    );
    expect(screen.getByTestId('chip').className).toContain(expected);
  });

  it.each([
    ['sm', 'px-1.5'],
    ['md', 'px-2'],
    ['lg', 'px-2.5'],
    ['auto', 'px-d-pad-x'],
  ] as const)('applies the %s size padding token', (size, expected) => {
    render(
      <Badge size={size} data-testid="chip">
        sized
      </Badge>,
    );
    expect(screen.getByTestId('chip').className).toContain(expected);
  });

  it('renders a decorative, aria-hidden dot when `dot` is set', () => {
    render(<Badge dot>Online</Badge>);
    const badge = screen.getByText('Online');
    const dot = badge.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.tagName).toBe('SPAN');
    // Inherits the chip's text colour and stays a fixed circle in the flex row.
    expect(dot?.className).toContain('bg-current');
    expect(dot?.className).toContain('rounded-full');
    expect(dot?.className).toContain('shrink-0');
  });

  it('omits the dot element entirely when `dot` is falsy', () => {
    render(<Badge>NoDot</Badge>);
    const badge = screen.getByText('NoDot');
    expect(badge.querySelector('[aria-hidden="true"]')).toBeNull();
    // The dot is not exposed to the accessibility tree in either state, so the
    // accessible text is exactly the label.
    expect(badge.textContent).toBe('NoDot');
  });

  it('falls back to neutral tokens for an out-of-union variant (no invisible chip)', () => {
    // Simulates an API status string forwarded through a helper that escapes
    // the compile-time union. Without the null-safety fallback the chip would
    // render with no background/text colour at all.
    render(
      <Badge variant={'bogus' as never} data-testid="chip">
        Weird
      </Badge>,
    );
    const badge = screen.getByTestId('chip');
    expect(badge.className).toContain(BADGE_VARIANTS.neutral);
    expect(badge.className).not.toContain(BADGE_VARIANTS.info);
    expect(badge.className).not.toContain('undefined');
  });

  it('falls back to md tokens for an out-of-union size', () => {
    render(
      <Badge size={'huge' as never} data-testid="chip">
        Big
      </Badge>,
    );
    const badge = screen.getByTestId('chip');
    expect(badge.className).toContain('px-2');
    expect(badge.className).not.toContain('undefined');
  });

  it('merges a caller className with the base classes via cn()', () => {
    render(
      <Badge className="my-custom-chip" data-testid="chip">
        Merged
      </Badge>,
    );
    const badge = screen.getByTestId('chip');
    expect(badge.className).toContain('my-custom-chip');
    expect(badge.className).toContain('rounded-full');
  });

  it('forwards refs to the underlying <span>', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Badge ref={ref}>Ref</Badge>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('SPAN');
    expect(ref.current?.textContent).toBe('Ref');
  });

  it('passes through arbitrary HTML and ARIA attributes', () => {
    render(
      <Badge id="status-chip" role="status" aria-label="Charging" title="tip">
        73%
      </Badge>,
    );
    const badge = screen.getByRole('status', { name: 'Charging' });
    expect(badge.id).toBe('status-chip');
    expect(badge.getAttribute('title')).toBe('tip');
  });

  it('invokes forwarded event handlers', () => {
    const onClick = vi.fn();
    render(
      <Badge onClick={onClick} data-testid="chip">
        Click
      </Badge>,
    );
    fireEvent.click(screen.getByTestId('chip'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('retains the forced-colors border override for High Contrast mode', () => {
    render(<Badge data-testid="chip">HC</Badge>);
    // Guards the Windows High Contrast contract enforced by the
    // forced-colors audit — the chip must keep a system-colour outline.
    expect(screen.getByTestId('chip').className).toMatch(/forced-colors:border/);
  });

  it('exposes the expected displayName for devtools', () => {
    expect(Badge.displayName).toBe('Badge');
  });

  it.each(['info', 'success', 'warning', 'danger'] as const)(
    'uses the existing %s semantic foreground, tint and border roles',
    (variant) => {
      render(<Badge variant={variant} data-testid="chip">{variant}</Badge>);
      const badge = screen.getByTestId('chip');
      expect(badge).toHaveClass(
        `text-[var(--semantic-${variant})]`,
        `bg-[var(--semantic-${variant}-bg)]`,
        `border-[var(--semantic-${variant}-border)]`,
      );
      expect(badge.className).not.toMatch(/(?:neon|glow|text-white|dark:|animate-)/);
      expect(badge.textContent).toBe(variant);
    },
  );

  it.each(['toString', '__proto__', 'constructor'])(
    'falls back for inherited runtime variant and size keys: %s',
    (key) => {
      render(<Badge variant={key as never} size={key as never} data-testid="chip">Unknown</Badge>);
      const badge = screen.getByTestId('chip');
      expect(badge.className).toContain(BADGE_VARIANTS.neutral);
      expect(badge).toHaveClass('px-2', 'text-xs');
      expect(badge.textContent).toBe('Unknown');
    },
  );

  it('keeps long translated labels intact with bounded wrapping and a shrink-free dot', () => {
    const label = 'Verbindung wird hergestellt — Fahrzeugdaten werden synchronisiert '.repeat(8);
    const { rerender } = render(<Badge dot id="connection-status">{label}</Badge>);
    const badge = screen.getByText(label.trim());
    expect(badge.textContent).toBe(label);
    expect(badge).toHaveClass('min-w-0', 'max-w-full', 'whitespace-normal', 'break-words');
    expect(badge.querySelector('[aria-hidden="true"]')).toHaveClass('shrink-0');
    rerender(<Badge dot id="connection-status">Connecting</Badge>);
    expect(screen.getByText('Connecting')).toBe(badge);
    expect(badge.id).toBe('connection-status');
  });

  it('preserves measured zero and absent children without fabricating a status', () => {
    const { rerender } = render(<Badge data-testid="chip">{0}</Badge>);
    const badge = screen.getByTestId('chip');
    expect(badge.textContent).toBe('0');
    rerender(<Badge data-testid="chip">{null}</Badge>);
    expect(badge.textContent).toBe('');
    expect(badge.className).toContain(BADGE_VARIANTS.neutral);
    rerender(<Badge data-testid="chip">{undefined}</Badge>);
    expect(badge.textContent).toBe('');
  });

  it.each(['info', 'success', 'warning', 'danger', 'neutral'] as const)(
    'preserves a system-color outline and textual state for %s in forced colors',
    (variant) => {
      render(<Badge variant={variant} dot data-testid="chip">{variant}</Badge>);
      const badge = screen.getByTestId('chip');
      expect(badge).toHaveClass('forced-colors:border', 'forced-colors:border-[CanvasText]');
      expect(badge.textContent).toBe(variant);
      expect(badge.querySelector('[aria-hidden="true"]')).toHaveClass('bg-current');
    },
  );
});
