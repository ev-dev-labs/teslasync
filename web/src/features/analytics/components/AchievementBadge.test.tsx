/**
 * AchievementBadge — behaviour + hardening contract.
 *
 * The badge renders one lifetime achievement in two mutually-exclusive states:
 *   - unlocked → a bright gold tile, the emoji at full opacity, no progress ring,
 *     and the localized "✓ Unlocked" caption (never a "%" figure);
 *   - locked   → a muted tile with a <ProgressRing> behind a dimmed/grayscaled
 *     emoji and a "{pct}%" caption. When progress ≥ 0.8 the tile pulses and the
 *     ring switches from grey (#6b7280) to amber (#eab308).
 *
 * These tests also pin the null-safety hardening this file added. Achievements
 * come from a partial `stats?.achievements` payload, so the API's non-null
 * typing is not a runtime guarantee:
 *   - a nullish `progress` must degrade to "0%" (regression guard: it used to
 *     render "NaN%" and a `strokeDashoffset="NaN"` ring — `Math.round(undefined
 *     * 100)` is NaN);
 *   - an out-of-range `progress` (>1 or <0) must clamp into [0, 100]%;
 *   - a missing `name` must still yield a placeholder ("—") and a meaningful
 *     accessible name for the icon (falls back to the description, then a
 *     generic label);
 *   - a missing `icon` must fall back to a default glyph so the badge is never
 *     visually blank.
 *
 * `react-i18next` is mocked to echo the English fallback so the "✓ Unlocked"
 * caption and the generic aria-label are deterministic (mirrors the
 * SummaryStats / FleetCostKpis convention). The component has no interactive
 * controls, so there is no userEvent surface to exercise.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { AchievementBadge, type AchievementData } from './AchievementBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

function makeAchievement(overrides: Partial<AchievementData> = {}): AchievementData {
  return {
    id: 'road-warrior',
    name: 'Road Warrior',
    description: 'Drive 10,000 km',
    icon: '🏆',
    unlocked: false,
    unlocked_at: null,
    progress: 0.5,
    target: 10000,
    current: 5000,
    ...overrides,
  } as AchievementData;
}

describe('AchievementBadge', () => {
  describe('unlocked state', () => {
    it('shows the gold tile, the "✓ Unlocked" caption, and no ring or percentage', () => {
      const { container } = render(
        <AchievementBadge
          achievement={makeAchievement({
            unlocked: true,
            unlocked_at: '2024-01-01T00:00:00Z',
            name: 'Century',
            icon: '💯',
            progress: 1,
          })}
        />,
      );

      expect(screen.getByText('Century')).toBeInTheDocument();
      expect(screen.getByText('Drive 10,000 km')).toBeInTheDocument();
      expect(screen.getByText('✓ Unlocked')).toBeInTheDocument();

      // Unlocked badges never render the progress ring nor the "%" figure.
      expect(container.querySelector('svg')).toBeNull();
      expect(screen.queryByText(/%$/)).not.toBeInTheDocument();

      // Gold tile + full-opacity, non-grayscaled emoji labelled by its name.
      expect(container.firstChild).toHaveClass('bg-yellow-500/[0.08]');
      const icon = screen.getByRole('img', { name: 'Century' });
      expect(icon).toHaveTextContent('💯');
      expect(icon).not.toHaveClass('grayscale');
    });

    it('never pulses when unlocked, even at full progress', () => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ unlocked: true, progress: 1 })} />,
      );
      expect(container.firstChild).not.toHaveClass('animate-pulse');
    });
  });

  describe('locked state', () => {
    it('renders the ring behind a dimmed emoji and a rounded percentage caption', () => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ progress: 0.5 })} />,
      );

      expect(container.querySelector('svg')).not.toBeNull();
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.queryByText('✓ Unlocked')).not.toBeInTheDocument();

      // Muted tile + grayscaled, half-opacity emoji.
      expect(container.firstChild).toHaveClass('bg-white/[0.03]');
      const icon = screen.getByRole('img', { name: 'Road Warrior' });
      expect(icon).toHaveClass('grayscale');
      expect(icon).toHaveClass('opacity-50');
    });

    it('rounds the progress fraction to a whole percentage', () => {
      render(<AchievementBadge achievement={makeAchievement({ progress: 0.856 })} />);
      // Math.round(85.6) → 86.
      expect(screen.getByText('86%')).toBeInTheDocument();
    });

    it('pulses and paints the ring amber when near completion (progress ≥ 0.8)', () => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ progress: 0.9 })} />,
      );

      expect(container.firstChild).toHaveClass('animate-pulse');
      expect(container.querySelector('circle[stroke="#eab308"]')).not.toBeNull();
      expect(screen.getByText('90%')).toBeInTheDocument();
    });

    it('keeps the grey ring and no pulse for mid progress', () => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ progress: 0.4 })} />,
      );

      expect(container.firstChild).not.toHaveClass('animate-pulse');
      expect(container.querySelector('circle[stroke="#6b7280"]')).not.toBeNull();
      expect(container.querySelector('circle[stroke="#eab308"]')).toBeNull();
    });
  });

  describe('null-safety hardening', () => {
    it('degrades a nullish progress to "0%" instead of "NaN%"', () => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ progress: undefined })} />,
      );

      expect(screen.getByText('0%')).toBeInTheDocument();
      expect(container.textContent).not.toContain('NaN');
      // The ring's dash offset must be a real number, never "NaN".
      const progressCircle = container.querySelector('circle[stroke="#6b7280"]');
      expect(progressCircle?.getAttribute('stroke-dashoffset')).not.toContain('NaN');
    });

    it('clamps an over-range progress down to 100%', () => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ progress: 1.5 })} />,
      );
      expect(within(container).getByText('100%')).toBeInTheDocument();
      expect(within(container).queryByText('150%')).not.toBeInTheDocument();
    });

    it('clamps a negative progress up to 0%', () => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ progress: -0.3 })} />,
      );
      expect(within(container).getByText('0%')).toBeInTheDocument();
    });

    it('falls back to the description for the icon label and shows "—" for a missing name', () => {
      render(
        <AchievementBadge
          achievement={makeAchievement({ name: '', description: 'Complete a night drive' })}
        />,
      );

      // aria-label falls back to the description when the name is empty.
      expect(screen.getByRole('img', { name: 'Complete a night drive' })).toBeInTheDocument();
      // Visible name shows the placeholder dash rather than an empty slot.
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('uses a generic accessible label when both name and description are empty', () => {
      render(<AchievementBadge achievement={makeAchievement({ name: '', description: '' })} />);
      expect(screen.getByRole('img', { name: 'Achievement' })).toBeInTheDocument();
    });

    it('falls back to a default glyph when the icon is missing', () => {
      render(<AchievementBadge achievement={makeAchievement({ icon: '', name: 'No Icon' })} />);
      expect(screen.getByRole('img', { name: 'No Icon' })).toHaveTextContent('🏆');
    });
  });

  describe('size variants', () => {
    it('scales the emoji and gap for sm and lg', () => {
      const { container, rerender } = render(
        <AchievementBadge achievement={makeAchievement()} size="sm" />,
      );
      expect(screen.getByRole('img', { name: 'Road Warrior' })).toHaveClass('text-xl');
      expect(container.firstChild).toHaveClass('gap-1');

      rerender(<AchievementBadge achievement={makeAchievement()} size="lg" />);
      expect(screen.getByRole('img', { name: 'Road Warrior' })).toHaveClass('text-4xl');
      expect(container.firstChild).toHaveClass('gap-3');
    });

    it('defaults to the md size when no size prop is provided', () => {
      render(<AchievementBadge achievement={makeAchievement()} />);
      expect(screen.getByRole('img', { name: 'Road Warrior' })).toHaveClass('text-3xl');
    });
  });
});
