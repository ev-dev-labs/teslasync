import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Avatar, avatarColorIndex, avatarInitials } from '../Avatar';
import { CHART_COLORS_CB_SAFE } from '@/lib/colors';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('avatarInitials', () => {
  it('takes the first letter of the first two words for "John Doe"', () => {
    expect(avatarInitials('John Doe')).toBe('JD');
  });

  it('takes the first two characters for a single-word name like "Cher"', () => {
    expect(avatarInitials('Cher')).toBe('CH');
  });

  it('returns "?" for empty input', () => {
    expect(avatarInitials('')).toBe('?');
  });

  it('returns "?" for whitespace-only input', () => {
    expect(avatarInitials('   ')).toBe('?');
  });

  it('returns "?" for null input', () => {
    expect(avatarInitials(null)).toBe('?');
  });

  it('returns "?" for undefined input', () => {
    expect(avatarInitials(undefined)).toBe('?');
  });

  it('uppercases lowercase initials', () => {
    expect(avatarInitials('alice bob')).toBe('AB');
  });

  it('handles names with multiple internal spaces', () => {
    expect(avatarInitials('Mary   Jane')).toBe('MJ');
  });

  it('truncates to first two words when more are present', () => {
    expect(avatarInitials('Foo Bar Baz Qux')).toBe('FB');
  });

  it('handles single-character names', () => {
    expect(avatarInitials('X')).toBe('X');
  });
});

describe('avatarColorIndex', () => {
  it('maps the same seed to the same index across calls', () => {
    const a = avatarColorIndex('user-42');
    const b = avatarColorIndex('user-42');
    expect(a).toBe(b);
  });

  it('returns an index in palette range', () => {
    for (const seed of ['a', 'something-much-longer', '42', 'u@example.com']) {
      const idx = avatarColorIndex(seed);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(CHART_COLORS_CB_SAFE.length);
    }
  });

  it('produces different indices for distinct inputs (smoke check)', () => {
    // Not a strict requirement of the hash, but verifies we are not
    // collapsing every input to the same bucket.
    const indices = new Set(
      ['alice', 'bob', 'carol', 'dan', 'erin', 'frank', 'grace'].map(avatarColorIndex),
    );
    expect(indices.size).toBeGreaterThan(1);
  });
});

describe('Avatar', () => {
  it('renders initials derived from name', () => {
    render(<Avatar name="John Doe" />);
    expect(screen.getByTestId('avatar-initials').textContent).toBe('JD');
  });

  it('renders the same background colour for the same userId across mounts', () => {
    const { unmount } = render(<Avatar userId="u-1" name="Alice" data-testid="a1" />);
    const first = screen.getByTestId('avatar').style.backgroundColor;
    unmount();
    render(<Avatar userId="u-1" name="A Different Name" />);
    const second = screen.getByTestId('avatar').style.backgroundColor;
    expect(first).toBe(second);
    // And it's a real colour (non-empty inline style).
    expect(first.length).toBeGreaterThan(0);
  });

  it('falls back to initials when the image fails to load', () => {
    render(<Avatar src="https://example.test/missing.png" name="Jane Smith" />);
    const img = screen.getByTestId('avatar-image') as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.queryByTestId('avatar-image')).toBeNull();
    expect(screen.getByTestId('avatar-initials').textContent).toBe('JS');
  });

  it('renders a generic User glyph when name is empty (kind=user)', () => {
    render(<Avatar name="" />);
    expect(screen.getByTestId('avatar-glyph')).toBeInTheDocument();
    // Marker for the kind so the chatbot adopter can be verified visually.
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-avatar-kind', 'user');
  });

  it('renders a generic Bot glyph when kind="bot" and no name', () => {
    render(<Avatar kind="bot" />);
    expect(screen.getByTestId('avatar-glyph')).toBeInTheDocument();
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-avatar-kind', 'bot');
  });

  it('does NOT render a status dot when no status prop is set', () => {
    render(<Avatar name="John Doe" />);
    expect(screen.queryByTestId('avatar-status')).toBeNull();
  });

  it('renders an online status dot with a localised aria-label', () => {
    render(<Avatar name="John Doe" status="online" />);
    const dot = screen.getByTestId('avatar-status');
    expect(dot).toHaveAttribute('data-status', 'online');
    expect(dot).toHaveAttribute('aria-label', 'Online');
  });

  it('renders an idle status dot when status="idle"', () => {
    render(<Avatar name="John Doe" status="idle" />);
    expect(screen.getByTestId('avatar-status')).toHaveAttribute('data-status', 'idle');
  });

  it('renders an offline status dot when status="offline"', () => {
    render(<Avatar name="John Doe" status="offline" />);
    expect(screen.getByTestId('avatar-status')).toHaveAttribute('data-status', 'offline');
  });

  it('wraps in a tooltip with the full name when showTooltip is true', () => {
    render(<Avatar name="Jane Doe" showTooltip />);
    // Tooltip renders the content text inside a role="tooltip" element.
    expect(screen.getByRole('tooltip').textContent).toContain('Jane Doe');
  });

  it('uses the localised "Unknown user" tooltip fallback when name is missing', () => {
    render(<Avatar showTooltip />);
    expect(screen.getByRole('tooltip').textContent).toContain('Unknown user');
  });

  it('does not wrap in a tooltip by default', () => {
    render(<Avatar name="Jane Doe" />);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('uses neutral surface (no inline bg colour) for the truly anonymous case', () => {
    render(<Avatar />);
    expect(screen.getByTestId('avatar').style.backgroundColor).toBe('');
  });

  it('uses palette bg when seeded by name even without userId', () => {
    render(<Avatar name="Jane Doe" />);
    expect(screen.getByTestId('avatar').style.backgroundColor.length).toBeGreaterThan(0);
  });

  it('retries a replacement image after the previous URL fails', () => {
    const { rerender } = render(<Avatar name="Jane Smith" src="missing.png" />);
    fireEvent.error(screen.getByTestId('avatar-image'));
    expect(screen.getByRole('img', { name: 'Jane Smith' })).toHaveTextContent('JS');
    rerender(<Avatar name="Jane Smith" src="replacement.png" />);
    expect(screen.getByTestId('avatar-image')).toHaveAttribute('src', 'replacement.png');
    expect(screen.getByTestId('avatar-image')).toHaveAttribute('alt', 'Jane Smith');
    expect(screen.queryByTestId('avatar-initials')).toBeNull();
  });

  it('keeps a successfully loaded image instead of showing initials', () => {
    render(<Avatar name="Jane Smith" src="portrait.png" />);
    fireEvent.load(screen.getByTestId('avatar-image'));
    expect(screen.getByTestId('avatar-image')).toHaveAttribute('src', 'portrait.png');
    expect(screen.queryByTestId('avatar-initials')).toBeNull();
  });

  it('uses a dark foreground on restrained identity fills and system colors in forced colors', () => {
    render(<Avatar name="Jane Smith" />);
    const avatar = screen.getByTestId('avatar');
    expect(avatar).toHaveClass('text-slate-900', 'forced-colors:text-[CanvasText]');
    expect(avatar.style.color).toBe('');
    expect(screen.getByRole('img', { name: 'Jane Smith' })).toHaveTextContent('JS');
  });

  it('keeps all public sizes, rounded shape and caller classes', () => {
    const { rerender } = render(<Avatar size="xs" shape="rounded" className="my-avatar" />);
    for (const [size, dimensions] of [
      ['xs', 'h-4 w-4'], ['sm', 'h-6 w-6'], ['md', 'h-8 w-8'], ['lg', 'h-12 w-12'],
    ] as const) {
      rerender(<Avatar size={size} shape="rounded" className="my-avatar" />);
      expect(screen.getByTestId('avatar')).toHaveClass(...dimensions.split(' '), 'rounded-lg', 'my-avatar');
      expect(screen.getByRole('img', { name: 'Unknown user' })).toBeInTheDocument();
    }
  });

  it.each([
    ['online', 'bg-[var(--semantic-success)]', 'Online'],
    ['idle', 'bg-[var(--semantic-warning)]', 'Idle'],
    ['offline', 'bg-[var(--text-secondary)]', 'Offline'],
  ] as const)('uses semantic presence roles for %s with an accessible label', (status, color, label) => {
    render(<Avatar name="Jane Smith" status={status} />);
    expect(screen.getByTestId('avatar-status')).toHaveClass(color);
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
  });
});
