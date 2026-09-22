import { useTranslation } from 'react-i18next';
import { Button, Input, Text } from '@/components/ui';
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
  const CalendarIcon = Icons.calendar;

  const stepDay = (delta: number) => {
    const next = addDaysYmd(isValidYmd(date) ? date : todayYmd(timezone), delta);
    if (next) onDateChange(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="daylog-controls">
      <div className="flex flex-wrap items-center gap-2">
        <VehicleSelect withIcon data-testid="daylog-vehicle" />
        <Button
          variant="secondary"
          aria-label={t('dayLog.controls.prevDay', 'Previous day')}
          onClick={() => stepDay(-1)}
          data-testid="daylog-prev"
        >
          <PrevIcon className="h-4 w-4" />
        </Button>
        <Input
          type="date"
          aria-label={t('dayLog.controls.dateLabel', 'Day')}
          value={isValidYmd(date) ? date : ''}
          max={todayYmd(timezone)}
          onChange={(e) => onDateChange(e.target.value)}
          icon={<CalendarIcon className="h-4 w-4" />}
          data-testid="daylog-date"
        />
        <Button
          variant="secondary"
          aria-label={t('dayLog.controls.nextDay', 'Next day')}
          onClick={() => stepDay(1)}
          data-testid="daylog-next"
        >
          <NextIcon className="h-4 w-4" />
        </Button>
        <Button variant="ghost" onClick={() => onDateChange(todayYmd(timezone))} data-testid="daylog-today">
          {t('dayLog.controls.today', 'Today')}
        </Button>
      </div>
      <Text variant="caption">
        {t('dayLog.controls.timezoneNote', 'Day boundaries in {{tz}}', { tz: timezone })}
      </Text>
    </div>
  );
}
