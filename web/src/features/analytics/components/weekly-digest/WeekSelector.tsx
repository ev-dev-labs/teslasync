import { useTranslation } from 'react-i18next';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { GlassPanel, Badge, Button, Text } from '@/components/ui';

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

  // Display-boundary guard: an empty/missing label degrades to an em-dash so the
  // navigation band never collapses into a blank strip (mirrors MiniStat's
  // headline guard). The label is `truncate`d, so surface the full range via
  // `title` for hover / assistive-tech discoverability.
  const label = weekLabel || '—';

  return (
    <GlassPanel className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
      <Button
        variant="ghost"
        size="sm"
        icon={<ChevronLeft className="h-4 w-4" />}
        onClick={onPrevWeek}
        aria-label={t('analytics.weeklyDigest.prevWeek', 'Previous')}
      >
        <span className="hidden sm:inline">{t('analytics.weeklyDigest.prevWeek', 'Previous')}</span>
      </Button>
      <span className="flex min-w-0 items-center gap-2">
        <Calendar className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
        <Text size="sm" weight="semibold" color="primary" className="truncate" title={label}>
          {label}
        </Text>
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
        aria-label={t('analytics.weeklyDigest.nextWeek', 'Next')}
      >
        <span className="hidden sm:inline">{t('analytics.weeklyDigest.nextWeek', 'Next')}</span>
      </Button>
    </GlassPanel>
  );
}
