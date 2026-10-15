import { useTranslation } from 'react-i18next';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, Button, Text } from '@/components/ui';

interface WeekNavigationProps {
  weekLabel: string;
  isCurrentWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

/** Independent digest navigation, not a duplicate workspace date picker. */
export function WeekNavigation({
  weekLabel,
  isCurrentWeek,
  onPrevWeek,
  onNextWeek,
}: WeekNavigationProps) {
  const { t } = useTranslation();
  const label = weekLabel || '—';
  return (
    <LayoutCard title={t('analytics.weeklyDigest.title', 'Weekly digest')}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
          <Text size="sm" weight="semibold" color="primary" className="break-words" title={label}>
            {label}
          </Text>
          {isCurrentWeek && (
            <Badge variant="info" size="sm">
              {t('analytics.weeklyDigest.current', 'Current')}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
            className="min-h-11 min-w-11"
            onClick={onPrevWeek}
            aria-label={t('analytics.weeklyDigest.prevWeek', 'Previous')}
          >
            {t('analytics.weeklyDigest.prevWeek', 'Previous')}
          </Button>
          <Button
            variant="ghost"
            icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
            className="min-h-11 min-w-11"
            onClick={onNextWeek}
            disabled={isCurrentWeek}
            aria-label={t('analytics.weeklyDigest.nextWeek', 'Next')}
          >
            {t('analytics.weeklyDigest.nextWeek', 'Next')}
          </Button>
        </div>
      </div>
    </LayoutCard>
  );
}
