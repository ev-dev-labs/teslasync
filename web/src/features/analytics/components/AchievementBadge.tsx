import { cn } from '@/lib/cn';
import { ProgressRing } from '@/components/data-display';
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

const sizeConfig = {
  sm: { ring: 56, stroke: 3, iconSize: 'text-xl', gap: 'gap-1', textSize: 'text-xs' },
  md: { ring: 72, stroke: 4, iconSize: 'text-3xl', gap: 'gap-2', textSize: 'text-sm' },
  lg: { ring: 96, stroke: 5, iconSize: 'text-4xl', gap: 'gap-3', textSize: 'text-base' },
} as const;

export function AchievementBadge({ achievement, size = 'md' }: AchievementBadgeProps) {
  const { t } = useTranslation();
  const cfg = sizeConfig[size];
  const isNearComplete = !achievement.unlocked && achievement.progress >= 0.8;
  const pct = Math.round(achievement.progress * 100);

  return (
    <div
      className={cn(
        'relative flex flex-col items-center rounded-xl p-3 transition-all duration-300',
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
          aria-label={achievement.name}
        >
          {achievement.icon}
        </span>
      </div>

      {/* Name */}
      <span
        className={cn(
          'font-semibold text-center leading-tight',
          cfg.textSize,
          achievement.unlocked ? 'text-yellow-400' : 'text-white/50',
        )}
      >
        {achievement.name}
      </span>

      {/* Description */}
      <span className="text-xs text-white/40 text-center leading-tight">
        {achievement.description}
      </span>

      {/* Progress or unlocked status */}
      {achievement.unlocked ? (
        <span className="text-xs text-yellow-500/70 font-medium">
          {t('lifetime.unlocked', '✓ Unlocked')}
        </span>
      ) : (
        <span className="text-xs text-white/30 tabular-nums">
          {pct}%
        </span>
      )}
    </div>
  );
}
