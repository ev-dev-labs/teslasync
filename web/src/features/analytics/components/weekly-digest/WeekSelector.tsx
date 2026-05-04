import { useTranslation } from 'react-i18next';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { GlassPanel, Badge, Button } from '@/components/ui';

interface WeekSelectorProps {
  weekLabel: string;
  isCurrentWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

export function WeekSelector({
  weekLabel,
  isCurrentWeek,
  onPrevWeek,
  onNextWeek,
}: WeekSelectorProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="flex items-center justify-between px-5 py-3">
      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronLeft className="h-4 w-4" />}
        onClick={onPrevWeek}
      >
        {t('analytics.weeklyDigest.prevWeek', 'Previous')}
      </Button>
      <span className="flex items-center gap-2 text-sm font-semibold text-white">
        <Calendar className="h-4 w-4 text-[var(--text-secondary)]" />
        {weekLabel}
        {isCurrentWeek && (
          <Badge variant="info" size="sm">
            {t('analytics.weeklyDigest.current', 'Current')}
          </Badge>
        )}
      </span>
      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronRight className="h-4 w-4" />}
        onClick={onNextWeek}
        disabled={isCurrentWeek}
      >
        {t('analytics.weeklyDigest.nextWeek', 'Next')}
      </Button>
    </GlassPanel>
  );
}
