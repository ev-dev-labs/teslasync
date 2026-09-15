import { useTranslation } from 'react-i18next';
import { Button, GlassPanel, Input, PanelTitle, Text, Toggle } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { Icons } from '@/lib/icons';
import type { DayLogLayer } from '@/api/types';
import { DAY_LOG_LAYER_LABEL, DAY_LOG_LAYERS, addDaysYmd, isValidYmd, todayYmd } from '../../lib/daylog';

export interface DayLogControlsProps {
  date: string;
  timezone: string;
  layers: DayLogLayer[];
  onDateChange: (date: string) => void;
  onToggleLayer: (layer: DayLogLayer) => void;
}

/**
 * Section 1 — day scope controls. The date is a plain `YYYY-MM-DD`
 * calendar string end to end: the native date input, the URL param, and
 * the API `date` field all carry the same string, so there is no
 * UTC-midnight footgun anywhere in the chain.
 */
export function DayLogControls({
  date,
  timezone,
  layers,
  onDateChange,
  onToggleLayer,
}: DayLogControlsProps) {
  const { t } = useTranslation();
  const PrevIcon = Icons.previous;
  const NextIcon = Icons.next;
  const CalendarIcon = Icons.calendar;

  const stepDay = (delta: number) => {
    const next = addDaysYmd(isValidYmd(date) ? date : todayYmd(timezone), delta);
    if (next) onDateChange(next);
  };

  return (
    <GlassPanel className="p-6" data-testid="daylog-controls">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <PanelTitle>{t('dayLog.controls.title', 'Day')}</PanelTitle>
          <Text variant="caption">
            {t('dayLog.controls.timezoneNote', 'Day boundaries in {{tz}}', { tz: timezone })}
          </Text>
        </div>
        <VehicleSelect withIcon data-testid="daylog-vehicle" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
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

      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <Text size="xs" weight="medium" color="muted">
          {t('dayLog.controls.layersTitle', 'Optional layers')}
        </Text>
        <Text variant="caption" className="mt-0.5">
          {t('dayLog.controls.layersHint', 'Off by default — too noisy for the everyday view.')}
        </Text>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DAY_LOG_LAYERS.map((layer) => (
            <Toggle
              key={layer}
              size="sm"
              label={t(`dayLog.layers.${layer}`, DAY_LOG_LAYER_LABEL[layer])}
              checked={layers.includes(layer)}
              onChange={() => onToggleLayer(layer)}
            />
          ))}
        </div>
      </div>
    </GlassPanel>
  );
}
