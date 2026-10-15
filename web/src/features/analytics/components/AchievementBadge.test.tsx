/**
 * AchievementBadge — behaviour + hardening contract.
 *
 * The badge renders one lifetime achievement in two mutually-exclusive states:
 *   - unlocked → a semantic success tile, the emoji at full opacity, no progress ring,
 *     and the localized "✓ Unlocked" caption (never a "%" figure);
 *   - locked   → a muted tile with a <ProgressRing> behind a dimmed/grayscaled
 *     emoji and a "{pct}%" caption. When progress ≥ 0.8 the tile and ring use
 *     static semantic warning emphasis, without decorative looping.
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
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { AchievementBadge, type AchievementData } from './AchievementBadge';

const translations = vi.hoisted(() => new Map<string, string>());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      translations.get(key) ?? (typeof fallback === 'string' ? fallback : key),
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
  beforeEach(() => translations.clear());

  describe('achievement identity localization', () => {
    it.each([
      'first-drive', 'century', 'thousand', 'ten-thousand', 'fifty-thousand',
      'hundred-thousand', 'first-charge', 'megawatt', 'gigawatt', 'hundred-saved',
      'thousand-saved', 'five-thousand-saved', 'ton-co2', 'tree-planter',
      'marathon', 'earth-orbit', 'supercharger',
    ])('localizes the known ID %s for visible and accessible names without changing source data', (id) => {
      translations.set(`lifetime.achievementNames.${id}`, 'Localized milestone');
      const achievement = makeAchievement({
        id, name: 'Source milestone', description: 'Save $100 or drive 100 km',
        target: 123, current: 42, progress: 0.856,
      });
      const original = { ...achievement };
      render(<AchievementBadge achievement={achievement} />);

      expect(screen.getByText('Localized milestone')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Localized milestone' })).toBeInTheDocument();
      expect(screen.getByText('Save $100 or drive 100 km')).toBeInTheDocument();
      expect(screen.getByText('86%')).toBeInTheDocument();
      expect(achievement).toEqual(original);
    });

    it('retains source text when a known identity has no translation', () => {
      render(<AchievementBadge achievement={makeAchievement({ id: 'century', name: 'Source century' })} />);
      expect(screen.getByText('Source century')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Source century' })).toBeInTheDocument();
    });

    it.each(['custom-milestone', 'toString', '__proto__'])('does not translate unknown ID %s or arbitrary weekday text', (id) => {
      translations.set(`lifetime.achievementNames.${id}`, 'Not source text');
      translations.set('common.days.long.monday', 'Localized Monday');
      render(<AchievementBadge achievement={makeAchievement({ id, name: 'Monday', description: 'My Monday trip' })} />);
      expect(screen.getByText('Monday')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Monday' })).toBeInTheDocument();
      expect(screen.getByText('My Monday trip')).toBeInTheDocument();
      expect(screen.queryByText('Not source text')).not.toBeInTheDocument();
    });

    it('preserves the missing-name fallback even for a known ID', () => {
      translations.set('lifetime.achievementNames.century', 'Localized milestone');
      render(<AchievementBadge achievement={makeAchievement({ id: 'century', name: '' })} />);
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Drive 10,000 km' })).toBeInTheDocument();
    });
  });

  describe('unlocked state', () => {
    it('shows the success tile, the "✓ Unlocked" caption, and no ring or percentage', () => {
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

      // Success tile + full-opacity, non-grayscaled emoji labelled by its name.
      expect(container.firstChild).toHaveClass('bg-[var(--semantic-success-bg)]');
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
      expect(container.firstChild).toHaveClass('bg-[var(--surface-2)]');
      const icon = screen.getByRole('img', { name: 'Road Warrior' });
      expect(icon).toHaveClass('grayscale');
      expect(icon).toHaveClass('opacity-50');
    });

    it('rounds the progress fraction to a whole percentage', () => {
      render(<AchievementBadge achievement={makeAchievement({ progress: 0.856 })} />);
      // Math.round(85.6) → 86.
      expect(screen.getByText('86%')).toBeInTheDocument();
    });

    it.each([0.8, 0.9, 1])('uses static warning emphasis at progress %s without claiming it is unlocked', (progress) => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ progress })} />,
      );

      expect(container.firstChild).toHaveClass(
        'bg-[var(--semantic-warning-bg)]', 'border-[var(--semantic-warning-border)]',
      );
      expect(container.firstChild).not.toHaveClass('animate-pulse');
      expect(container.querySelector('circle[stroke="var(--semantic-warning)"]')).not.toBeNull();
      expect(screen.getByText(`${Math.round(progress * 100)}%`)).toBeInTheDocument();
      expect(screen.queryByText('✓ Unlocked')).not.toBeInTheDocument();
    });

    it.each([0.4, 0.799])('keeps the neutral ring and no pulse below the near-complete threshold at %s', (progress) => {
      const { container } = render(
        <AchievementBadge achievement={makeAchievement({ progress })} />,
      );

      expect(container.firstChild).not.toHaveClass('animate-pulse');
      expect(container.firstChild).toHaveClass('bg-[var(--surface-2)]');
      expect(container.querySelector('circle[stroke="var(--text-secondary)"]')).not.toBeNull();
      expect(container.querySelector('circle[stroke="var(--semantic-warning)"]')).toBeNull();
    });

    it('replaces near-complete emphasis with success when the achievement unlocks', () => {
      const { container, rerender } = render(
        <AchievementBadge achievement={makeAchievement({ progress: 0.9 })} />,
      );

      rerender(
        <AchievementBadge achievement={makeAchievement({ progress: 1, unlocked: true })} />,
      );

      expect(container.firstChild).toHaveClass(
        'bg-[var(--semantic-success-bg)]', 'border-[var(--semantic-success-border)]',
      );
      expect(container.firstChild).not.toHaveClass('bg-[var(--semantic-warning-bg)]', 'animate-pulse');
      expect(screen.getByText('✓ Unlocked')).toBeInTheDocument();
      expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
      expect(container.querySelector('svg')).toBeNull();
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
      const progressCircle = container.querySelector('circle[stroke="var(--text-secondary)"]');
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
