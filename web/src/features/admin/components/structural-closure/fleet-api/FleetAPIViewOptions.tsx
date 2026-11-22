import { useRef, useState } from 'react';
import { Button, Caption, Popover } from '@/components/ui';
import type { FleetGrouping, useFleetAPIPage } from '../../../hooks/useFleetAPIPage';

type Props = { controller: ReturnType<typeof useFleetAPIPage> };

export function FleetAPIViewOptions({ controller }: Props) {
  const { t, groupBy, setGroupBy } = controller;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const label = t('fleetApi.viewOptions', 'View options');
  const groups: { key: FleetGrouping; label: string }[] = [
    { key: 'category', label: t('fleetApi.controls.byCategory', 'Category') },
    { key: 'method', label: t('fleetApi.controls.byMethod', 'HTTP method') },
    { key: 'none', label: t('fleetApi.redesign.noGrouping', 'No grouping') },
  ];

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
            {groups.map(group => <Button key={group.key} size="sm" wrapLabel
              variant={groupBy === group.key ? 'primary' : 'secondary'}
              className="min-h-11 md:min-h-9" aria-pressed={groupBy === group.key}
              onClick={() => setGroupBy(group.key)}>{group.label}</Button>)}
          </div>
        </div>
      </Popover>
    </>
  );
}
