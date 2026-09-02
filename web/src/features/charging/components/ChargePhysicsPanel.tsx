import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Clock3, PlugZap, Timer } from 'lucide-react';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { AlertBanner, QueryError, Skeleton } from '@/components/feedback';
import { useChargePhysics } from '@/api/hooks/useTeslaPhysics';
import { useDataState } from '@/hooks/useDataState';
import { formatDateTime } from '@/lib/dateFormat';

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function ChargePhysicsPanel({ sessionId }: { sessionId: string | undefined }) {
  const { t } = useTranslation();
  const query = useChargePhysics(sessionId);
  const state = useDataState(query, { provenance: 'historical' });
  const physics = state.data;

  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5" data-testid="charge-physics">
      <PanelTitle className="flex items-center gap-2">
        <PlugZap className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        {t('charging.physics.title', 'Charge physics')}
      </PanelTitle>
      {state.status === 'initial' ? (
        <Skeleton className="h-28" />
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => { void query.refetch(); }} />
      ) : physics ? (
        <>
          <Text as="p" variant="caption">{physics.honesty}</Text>
          <ol className="flex flex-wrap gap-2">
            {physics.story.map((phase) => (
              <li key={`${phase.state}-${phase.started_at}`}>
                <Badge variant={phase.at_limit ? 'success' : 'neutral'} size="sm">
                  {phase.state}
                  {phase.at_limit
                    ? ` · ${t('charging.physics.atLimit', 'at limit')}`
                    : ''}
                </Badge>
              </li>
            ))}
          </ol>
          {physics.at_limit_still_plugged_s != null && (
            <Text as="p" className="flex items-center gap-2 text-sm">
              <Timer className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('charging.physics.stillPlugged', 'At limit, still plugged {{duration}}.', {
                duration: formatDuration(physics.at_limit_still_plugged_s),
              })}
            </Text>
          )}
          {physics.etiquette.applicable && (
            <Text as="p" className="flex items-center gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {physics.etiquette.dwell_s == null
                ? t('charging.physics.etiquettePending', 'DC session reached Complete; unplug not observed yet.')
                : t('charging.physics.etiquette', 'Supercharger dwell after Complete: {{duration}}.', {
                    duration: formatDuration(physics.etiquette.dwell_s),
                  })}
            </Text>
          )}
          <Text as="p" variant="caption">{physics.etiquette.honesty}</Text>
          {physics.schedule.unknown || physics.schedule.waited_for_schedule == null ? (
            <Text as="p" variant="caption">{physics.schedule.honesty}</Text>
          ) : physics.schedule.charged_anyway ? (
            <AlertBanner variant="warning" title={t('charging.physics.chargedAnyway', 'Charged before the scheduled window')}>
              {physics.schedule.scheduled_start_at
                ? t('charging.physics.scheduledAt', 'Scheduled start {{when}}', {
                    when: formatDateTime(physics.schedule.scheduled_start_at),
                  })
                : physics.schedule.honesty}
            </AlertBanner>
          ) : physics.schedule.waited_for_schedule ? (
            <Text as="p" variant="caption">
              {t('charging.physics.waited', 'Stopped waited for the scheduled window.')}
            </Text>
          ) : (
            <Text as="p" variant="caption">{physics.schedule.honesty}</Text>
          )}
          <Link to="/physics-cockpit" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
            {t('charging.physics.cockpit', 'Open Tesla physics cockpit')}
          </Link>
        </>
      ) : null}
    </GlassPanel>
  );
}
