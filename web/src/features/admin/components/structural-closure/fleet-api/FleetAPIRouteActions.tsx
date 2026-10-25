import { Activity, Pause, Shield, Search } from 'lucide-react';
import { Toggle, Text, Caption, Label, Input } from '@/components/ui';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIRouteActions({ controller }: Props) {
  const { t, search, setSearch, setSelectedGroup, pollingConfigMut, pollingConfig, catalog, toggleAllAccess, toggleAllAuto, totalCount, enabledCount, autoCount, eligibleCount } = controller;
  const pollingKnown = !!pollingConfig && catalog.length > 0;

  return (
<>
          {pollingKnown && (
            <div className="grid gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-3 sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                <Text as="span" size="sm" weight="medium">{t('fleetApi.controls.accessSummary', '{{count}} routes available on demand', { count: enabledCount })}</Text>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <Text as="span" size="sm" weight="medium">{t('fleetApi.controls.autoSummary', '{{count}} selected for auto-poll', { count: autoCount })}</Text>
              </div>
              <div className="flex items-center gap-2">
                <Pause className="h-4 w-4 text-amber-300" aria-hidden="true" />
                <Text as="span" size="sm" weight="medium">{pollingConfig.auto_polling_enabled
                  ? t('fleetApi.controls.scheduleRunning', 'Schedule running')
                  : t('fleetApi.controls.schedulePaused', 'Schedule paused')}</Text>
              </div>
            </div>
          )}
          {pollingKnown && (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-[var(--border-default)] px-4 py-3">
              <Text as="span" size="sm" weight="medium">{t('fleetApi.controls.bulkTitle', 'All routes')}</Text>
              <Label className="flex items-center gap-2">
                {t('fleetApi.controls.bulkAccess', 'Access all')}
                <Toggle checked={enabledCount === totalCount} onChange={toggleAllAccess}
                  disabled={pollingConfigMut.isPending} size="sm"
                  aria-label={t('fleetApi.controls.bulkAccess', 'Access all')} />
              </Label>
              <Label className="flex items-center gap-2">
                {t('fleetApi.controls.bulkAuto', 'Auto-poll eligible routes')}
                <Toggle checked={eligibleCount > 0 && autoCount === eligibleCount} onChange={toggleAllAuto}
                  disabled={pollingConfigMut.isPending || eligibleCount === 0 || !pollingConfig.auto_polling_enabled} size="sm"
                  aria-label={t('fleetApi.controls.bulkAuto', 'Auto-poll eligible routes')} />
              </Label>
              <Caption>{pollingConfig.auto_polling_enabled
                ? t('fleetApi.controls.bulkHint', 'Auto-poll selects only enabled routes with a scheduled job.')
                : t('fleetApi.controls.pausedHint', 'Turn on Tesla API Polling to change auto-poll selections. Existing selections are retained while paused.')}</Caption>
            </div>
          )}
          {pollingKnown && (
            <div className="flex flex-col gap-2">
              <div className="flex w-full items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <Input value={search} onChange={(e) => { setSearch(e.target.value); if (e.target.value) setSelectedGroup('all'); }}
                    placeholder={t('fleetApi.controls.search', 'Search API routes')}
                    aria-label={t('fleetApi.controls.search', 'Search API routes')} />
                </div>
              </div>
            </div>
          )}
</>
  );
}
