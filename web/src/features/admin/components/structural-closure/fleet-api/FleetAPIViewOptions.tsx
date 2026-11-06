import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button, Caption, Popover, Select } from '@/components/ui';
import type { useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIViewOptions({ controller }: Props) {
  const { t, groupBy, setGroupBy, sortBy, setSortBy, sortDescending, setSortDescending } = controller;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const label = t('fleetApi.viewOptions', 'View options');

  return (
    <>
      <Button ref={anchor} size="sm" variant="secondary" className="min-h-11 md:min-h-9"
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {label}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="end"
        ariaLabel={label} avoidMobileChrome className="w-72 max-w-[calc(100vw-1rem)] space-y-3 p-3">
        <div className="space-y-2" role="group" aria-label={t('fleetApi.controls.groupBy', 'Group by')}>
          <Caption>{t('fleetApi.controls.groupBy', 'Group by')}</Caption>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={groupBy === 'category' ? 'primary' : 'secondary'}
              className="h-11 min-w-11 md:h-9 md:min-w-0" aria-pressed={groupBy === 'category'}
              onClick={() => setGroupBy('category')}>
              {t('fleetApi.controls.byCategory', 'Category')}
            </Button>
            <Button size="sm" variant={groupBy === 'method' ? 'primary' : 'secondary'}
              className="h-11 min-w-11 md:h-9 md:min-w-0" aria-pressed={groupBy === 'method'}
              onClick={() => setGroupBy('method')}>
              {t('fleetApi.controls.byMethod', 'HTTP method')}
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Select size="sm" aria-label={t('fleetApi.controls.sortBy', 'Sort routes by')}
            value={sortBy} onChange={(event) => {
              const value = event.target.value as typeof sortBy;
              setSortBy(value);
              setSortDescending(value === 'access' || value === 'auto');
            }}
            options={[
              { value: 'name', label: t('fleetApi.controls.sortName', 'Operation') },
              { value: 'path', label: t('fleetApi.controls.sortPath', 'API path') },
              { value: 'method', label: t('fleetApi.controls.sortMethod', 'HTTP method') },
              { value: 'access', label: t('fleetApi.controls.sortAccess', 'Access state') },
              { value: 'auto', label: t('fleetApi.controls.sortAuto', 'Auto-poll state') },
            ]} />
          <Button size="sm" variant="secondary" onClick={() => setSortDescending(!sortDescending)}
            className="h-11 min-w-11 md:h-9 md:min-w-0"
            aria-label={sortDescending
              ? t('fleetApi.controls.sortAscending', 'Sort ascending')
              : t('fleetApi.controls.sortDescending', 'Sort descending')}>
            {sortDescending ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </Popover>
    </>
  );
}
