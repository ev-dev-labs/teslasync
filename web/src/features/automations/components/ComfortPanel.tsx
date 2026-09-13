/**
 * Cabin Comfort panel — arm calendar-aware preconditioning, set the target
 * temperature + lead time + ICS subscription, precondition now on demand,
 * and review recent runs. Mirrors StormGuardPanel structure so the two
 * autopilots read as one product.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';

import {
  GlassPanel,
  Button,
  Input,
  Slider,
  Toggle,
  Badge,
  PanelTitle,
  Text,
  Caption,
  ErrorText,
} from '@/components/ui';
import { QueryError, Skeleton } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import {
  useComfortNext,
  useComfortRuns,
  useSaveComfortConfig,
  usePreconditionNow,
} from '@/api/hooks/useComfort';

export function ComfortPanel() {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { formatTemperature } = useUnits();
  const { vehicleId } = useSelectedVehicle();

  const nextQuery = useComfortNext(vehicleId);
  const nextState = useDataState(nextQuery);
  const runsQuery = useComfortRuns(vehicleId);
  const saveMutation = useSaveComfortConfig();
  const nowMutation = usePreconditionNow();

  const stored = nextQuery.data?.config;
  const [enabled, setEnabled] = useState(false);
  const [targetTemp, setTargetTemp] = useState(21);
  const [leadMinutes, setLeadMinutes] = useState(20);
  const [icsUrl, setIcsUrl] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (stored && !hydrated) {
      setEnabled(stored.enabled);
      setTargetTemp(stored.target_temp_c);
      setLeadMinutes(stored.lead_minutes);
      setIcsUrl(stored.ics_url);
      setHydrated(true);
    }
  }, [stored, hydrated]);

  // When the selected vehicle changes, re-hydrate from its config.
  useEffect(() => {
    setHydrated(false);
  }, [vehicleId]);

  const nextEvent = nextQuery.data?.event;
  const runs = runsQuery.data ?? [];

  const handleSave = () => {
    if (vehicleId == null) return;
    saveMutation.mutate({
      vehicle_id: vehicleId,
      enabled,
      target_temp_c: targetTemp,
      lead_minutes: leadMinutes,
      ics_url: icsUrl.trim(),
    });
  };

  const saveError =
    saveMutation.isError
      ? (saveMutation.error as Error)?.message || t('comfort.saveError', 'Save failed')
      : '';
  const nowError =
    nowMutation.isError
      ? (nowMutation.error as Error)?.message || t('comfort.nowError', 'Precondition failed')
      : '';

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Icons.climateHot className="h-4 w-4 text-orange-300" aria-hidden="true" />
          {t('comfort.title', 'Cabin Comfort Autopilot')}
        </PanelTitle>
        {stored && (
          <Badge variant={enabled ? 'success' : 'neutral'} size="sm">
            {enabled
              ? t('comfort.armed', 'Armed')
              : t('comfort.disarmed', 'Off')}
          </Badge>
        )}
      </div>

      {vehicleId == null ? (
        <Text variant="bodySm" color="secondary">
          {t('comfort.noVehicle', 'Select a vehicle to configure cabin comfort.')}
        </Text>
      ) : nextQuery.isLoading ? (
        <Skeleton height={180} />
      ) : nextState.fatalError ? (
        <QueryError error={nextState.fatalError} onRetry={() => nextState.retry?.()} />
      ) : (
        <>
          {nextEvent ? (
            <div className="flex items-center gap-2 text-sm">
              <Icons.calendarClock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              <Text variant="bodySm" className="truncate">
                {t('comfort.nextEvent', '{{title}} at {{when}} — {{where}}', {
                  title: nextEvent.title || t('comfort.untitled', 'Untitled event'),
                  when: formatDateTime(nextEvent.starts_at),
                  where: nextEvent.location,
                })}
              </Text>
            </div>
          ) : (
            <Caption>
              {stored?.ics_url
                ? t('comfort.noUpcoming', 'No offsite events inside the lead window.')
                : t('comfort.noFeed', 'Add a calendar subscription to watch for events.')}
            </Caption>
          )}

          <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
            <Toggle
              label={t('comfort.arm', 'Precondition before calendar events')}
              checked={enabled}
              onChange={setEnabled}
            />
            <Input
              label={t('comfort.icsUrl', 'Calendar subscription URL (ICS)')}
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://calendar.example.com/feed.ics"
              inputMode="url"
            />
            <Slider
              label={t('comfort.targetTemp', 'Cabin target temperature')}
              value={targetTemp}
              min={15}
              max={28}
              onChange={setTargetTemp}
              formatValue={(v) => formatTemperature(v)}
            />
            <Slider
              label={t('comfort.lead', 'Precondition lead time')}
              value={leadMinutes}
              min={5}
              max={120}
              step={5}
              onChange={setLeadMinutes}
              formatValue={(v) => `${v} min`}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                loading={saveMutation.isPending}
              >
                {t('comfort.save', 'Save Autopilot')}
              </Button>
              <Button
                variant="secondary"
                onClick={() => vehicleId != null && nowMutation.mutate(vehicleId)}
                disabled={nowMutation.isPending}
                loading={nowMutation.isPending}
                icon={<Icons.charging className="h-4 w-4" aria-hidden="true" />}
                className="gap-2"
              >
                {t('comfort.now', 'Precondition now')}
              </Button>
            </div>
            {saveError && <ErrorText>{saveError}</ErrorText>}
            {nowError && <ErrorText>{nowError}</ErrorText>}
          </div>

          {runs.length > 0 && (
            <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
              <Text variant="bodySm" className="font-medium">
                {t('comfort.recent', 'Recent runs')}
              </Text>
              <ul className="space-y-1.5">
                {runs.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <Caption className="truncate">
                      {r.event_title || t('comfort.untitled', 'Untitled event')}
                    </Caption>
                    <Caption className="shrink-0 tabular-nums">
                      {formatDateTime(r.acted_at)}
                    </Caption>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </GlassPanel>
  );
}
