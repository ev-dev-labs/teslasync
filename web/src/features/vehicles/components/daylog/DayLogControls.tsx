import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { Icons } from '@/lib/icons';
import { addDaysYmd, isValidYmd, todayYmd } from '../../lib/daylog';

export interface DayLogControlsProps {
  date: string;
  timezone: string;
  onDateChange: (date: string) => void;
}

/**
 * Header day scope controls. The date is a plain `YYYY-MM-DD`
 * calendar string end to end: the native date input, the URL param, and
 * the API `date` field all carry the same string, so there is no
 * UTC-midnight footgun anywhere in the chain. Category filtering lives
 * with the list itself; this section only scopes vehicle + day.
 */
export function DayLogControls({ date, timezone, onDateChange }: DayLogControlsProps) {
  const { t } = useTranslation();
  const PrevIcon = Icons.previous;
  const NextIcon = Icons.next;

  const stepDay = (delta: number) => {
    const next = addDaysYmd(isValidYmd(date) ? date : todayYmd(timezone), delta);
    if (next) onDateChange(next);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-2" data-testid="daylog-controls">
        <VehicleSelect withIcon data-testid="daylog-vehicle" />
        <Button
          variant="ghost"
          size="sm"
          className="h-11 w-11 shrink-0 p-0 sm:h-9 sm:w-9"
          aria-label={t('dayLog.controls.prevDay', 'Previous day')}
          onClick={() => stepDay(-1)}
          data-testid="daylog-prev"
        >
          <PrevIcon className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          size="sm"
          className="h-11 sm:h-9"
          aria-label={t('dayLog.controls.dateLabel', 'Day')}
          aria-describedby="daylog-timezone"
          value={isValidYmd(date) ? date : ''}
          max={todayYmd(timezone)}
          onChange={(e) => onDateChange(e.target.value)}
          data-testid="daylog-date"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-11 w-11 shrink-0 p-0 sm:h-9 sm:w-9"
          aria-label={t('dayLog.controls.nextDay', 'Next day')}
          onClick={() => stepDay(1)}
          data-testid="daylog-next"
        >
          <NextIcon className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-11 sm:h-9" onClick={() => onDateChange(todayYmd(timezone))} data-testid="daylog-today">
          {t('dayLog.controls.today', 'Today')}
        </Button>
    </div>
  );
}
