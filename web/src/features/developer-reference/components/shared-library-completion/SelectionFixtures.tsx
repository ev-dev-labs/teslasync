import { useState } from 'react';
import { PillFilterBar, WeekdaySelect } from '@/components/forms';
import { Button, Text } from '@/components/ui';
import { FixtureSection } from './FixtureSection';
import { useCompletionLabels } from './useCompletionLabels';

export function SelectionFixtures() {
  const c = useCompletionLabels();
  const [days, setDays] = useState<number[]>([3, 1]);
  const [filter, setFilter] = useState('all');
  const [metric, setMetric] = useState('unresolved');
  const options = [
    { id: 1, label: c.monday, ariaLabel: c.monday },
    { id: 3, label: c.wednesday, ariaLabel: c.wednesday },
    { id: 5, label: c.friday, ariaLabel: c.friday, disabled: true },
    { id: 0, label: c.sunday, ariaLabel: c.sunday },
  ];
  const items = [
    { key: 'all', label: c.all, count: 12 },
    { key: 'unresolved', label: c.unresolved, count: 0 },
    { key: 'unavailable', label: c.unavailable, disabled: true },
  ];
  return (
    <FixtureSection id="selection" title={c.selectionTitle} description={c.selectionDescription}>
      <div data-shared-contract="weekday-select" className="min-w-0 space-y-4">
        <WeekdaySelect options={options} selectedIds={days} onChange={setDays} ariaLabel={c.days} />
        <Text as="p" variant="bodySm" role="status">
          {days.length ? c.selectedDays.replace('{{ids}}', days.join(', ')) : c.none}
        </Text>
        <Button type="button" variant="secondary" onClick={() => setDays([])}>{c.clearDays}</Button>
        <WeekdaySelect options={options} selectedIds={[1]} onChange={setDays} disabled ariaLabel={c.disabledDays} />
      </div>
      <div data-shared-contract="pill-filter-bar" className="min-w-0 space-y-4">
        <PillFilterBar items={items} activeKey={filter} onChange={setFilter} ariaLabel={c.filters}
          semanticMode="filters" variant="tabs" scrollable={false} className="flex-wrap" />
        <Text as="p" variant="bodySm" role="status">
          {c.activeFilter.replace('{{label}}', items.find(item => item.key === filter)?.label ?? '—')}
        </Text>
        <PillFilterBar items={items} activeKey={metric} onChange={setMetric} ariaLabel={c.tabs}
          semanticMode="tabs" variant="pills" />
        <Text as="p" variant="bodySm" role="status">
          {c.activeTab.replace('{{label}}', items.find(item => item.key === metric)?.label ?? '—')}
        </Text>
      </div>
    </FixtureSection>
  );
}
