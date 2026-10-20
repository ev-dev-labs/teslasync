import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout';
import { Badge, Text, Caption } from '@/components/ui';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

interface ScoreAchievement {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  unlocked: boolean;
}

export function ScoreAchievements({ items, sourceFallback }: {
  items: readonly ScoreAchievement[];
  sourceFallback: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <LayoutCard title={t('driveScore.achievements.title', 'Achievements')}>
      {sourceFallback ?? (
        <ul className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,11rem),1fr))]">
          {items.map((achievement) => (
            <li key={achievement.id} className={cn(
              'flex min-w-0 flex-col items-center rounded-xl border p-4 text-center transition-colors',
              achievement.unlocked
                ? 'border-amber-500/30 bg-amber-500/10'
                : 'border-[var(--border-subtle)] bg-[var(--surface-2)]',
            )}>
              <div className={cn(
                'mb-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                achievement.unlocked ? 'bg-amber-500/20 text-amber-300' : typography.color.muted,
              )}>{achievement.icon}</div>
              <Text as="span" variant="body" className={cn(
                'break-words', typography.weight.semibold,
                achievement.unlocked ? typography.color.primary : typography.color.muted,
              )}>{achievement.label}</Text>
              <Caption className="mt-1 break-words">{achievement.description}</Caption>
              {achievement.unlocked && (
                <Badge variant="success" size="sm" className="mt-2">
                  {t('driveScore.achievements.unlocked', 'Unlocked')}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </LayoutCard>
  );
}
