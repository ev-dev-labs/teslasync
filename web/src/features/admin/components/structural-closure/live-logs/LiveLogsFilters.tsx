import { Filter } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Input, Select } from '@/components/ui';
import { type LogStreamLevel } from '@/api/hooks/useLogStream';
import type { useLiveLogsPage } from '../../../hooks/useLiveLogsPage';
import { LEVEL_OPTIONS } from './helpers';

type Props = { controller: ReturnType<typeof useLiveLogsPage> };

export function LiveLogsFilters({ controller }: Props) {
  const { t, level, setLevel, grepDraft, setGrepDraft, vehicleFilter, setVehicleFilter, commitVehicleFilter, applyGrep } = controller;

  return (
<div className="min-w-0" data-testid="livelogs-filters">
      <LayoutCard
        title={t('liveLogs.section.filters', 'Filters')}
        actions={<Filter className="h-4 w-4 text-cyan-300" aria-hidden />}
      >
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-4">
        <Select
          label={t('liveLogs.filters.level', 'Minimum level')}
          value={level}
          onChange={(e) =>
            setLevel((e.target.value as LogStreamLevel) ?? 'info')
          }
          options={LEVEL_OPTIONS.map((o) => ({
            value: o.value,
            label: t(o.i18nKey, o.defaultLabel),
          }))}
          data-testid="livelogs-level-select"
        />
        <div className="md:col-span-2">
          <Input
            label={t('liveLogs.filters.grep', 'Grep (regular expression)')}
            value={grepDraft}
            onChange={(e) => setGrepDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyGrep();
              }
            }}
            onBlur={applyGrep}
            placeholder={t(
              'liveLogs.filters.grepPlaceholder',
              'e.g. mqtt|signal_log',
            )}
            hint={t(
              'liveLogs.filters.grepHelp',
              'Server-side filter. Maximum 256 characters. Invalid expressions are rejected before connecting.',
            )}
            maxLength={256}
            data-testid="livelogs-grep-input"
          />
        </div>
        <Input
          label={t('liveLogs.filters.vehicleId', 'Vehicle ID')}
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value.trim())}
          onBlur={commitVehicleFilter}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitVehicleFilter();
            }
          }}
          placeholder={t(
            'liveLogs.filters.vehicleIdPlaceholder',
            'Numeric — applied client-side',
          )}
          data-testid="livelogs-vehicle-input"
          inputMode="numeric"
        />
      </div>
      </LayoutCard>
    </div>
  );
}
