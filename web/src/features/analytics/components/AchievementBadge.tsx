import { cn } from '@/lib/cn';
import { ProgressRing } from '@/components/data-display';
import { Text } from '@/components/ui';
import { type TypographySize } from '@/lib/tokens';
import { useTranslation } from 'react-i18next';

export interface AchievementData {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number;
  target: number;
  current: number;
}

interface AchievementBadgeProps {
  achievement: AchievementData;
  size?: 'sm' | 'md' | 'lg';
}

const sizeConfig: Record<
  'sm' | 'md' | 'lg',
  { ring: number; stroke: number; iconSize: string; gap: string; textSize: TypographySize }
> = {
  sm: { ring: 56, stroke: 3, iconSize: 'text-xl', gap: 'gap-1', textSize: 'xs' },
  md: { ring: 72, stroke: 4, iconSize: 'text-3xl', gap: 'gap-2', textSize: 'sm' },
  lg: { ring: 96, stroke: 5, iconSize: 'text-4xl', gap: 'gap-3', textSize: 'base' },
};

export function AchievementBadge({ achievement, size = 'md' }: AchievementBadgeProps) {
  const { t } = useTranslation();
  const cfg = sizeConfig[size] ?? sizeConfig.md;

  // Achievements arrive from a partial `stats?.achievements` payload, so the
  // API's non-null typing isn't a runtime guarantee. Coalesce before the
  // arithmetic so the ring and the percentage label never render `NaN`, and
  // clamp into [0, 100] to survive an out-of-range backend value.
  const progress = achievement.progress ?? 0;
  const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
  const isNearComplete = !achievement.unlocked && progress >= 0.8;

  const displayName = achievement.name || '—';
  const iconGlyph = achievement.icon || '🏆';
  const iconLabel =
    achievement.name || achievement.description || t('lifetime.achievementBadge', 'Achievement');

  return (
    <div
      className={cn(
        'relative flex flex-col items-center rounded-xl p-3 transition-all duration-normal',
        cfg.gap,
        achievement.unlocked
          ? 'bg-yellow-500/[0.08] border border-yellow-500/30'
          : 'bg-white/[0.03] border border-white/[0.06]',
        isNearComplete && 'animate-pulse',
      )}
    >
      {/* Badge circle */}
      <div className="relative">
        {!achievement.unlocked && (
          <ProgressRing
            value={pct}
            max={100}
            size={cfg.ring}
            strokeWidth={cfg.stroke}
            color={isNearComplete ? '#eab308' : '#6b7280'}
          />
        )}
        <span
          className={cn(
            cfg.iconSize,
            'select-none',
            achievement.unlocked ? '' : 'absolute inset-0 flex items-center justify-center opacity-50 grayscale',
          )}
          role="img"
          aria-label={iconLabel}
        >
          {iconGlyph}
        </span>
      </div>

      {/* Name */}
      <Text
        as="span"
        size={cfg.textSize}
        weight="semibold"
        className={cn(
          'text-center leading-tight',
          achievement.unlocked ? 'text-yellow-400' : 'text-[var(--text-secondary)]',
        )}
      >
        {displayName}
      </Text>

      {/* Description */}
      <Text as="span" size="xs" color="muted" className="text-center leading-tight">
        {achievement.description ?? ''}
      </Text>

      {/* Progress or unlocked status */}
      {achievement.unlocked ? (
        <Text as="span" size="xs" weight="medium" className="text-yellow-500/70">
          {t('lifetime.unlocked', '✓ Unlocked')}
        </Text>
      ) : (
        <Text as="span" size="xs" color="muted" className="tabular-nums">
          {pct}%
        </Text>
      )}
    </div>
  );
}
