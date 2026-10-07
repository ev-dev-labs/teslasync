import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Accordion } from './Accordion';
import { Badge } from './Badge';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import { Input } from './Input';
import { ErrorText, Text } from './Typography';

export interface TableFilterValue {
  value: string;
  label: string;
  count: number;
  keys?: string[];
}

export function DataTableValueFilter({ options, selected, onChange, condition, conditionActive = false, conditionLabel, invalid = false }: {
  options: TableFilterValue[];
  selected: string[] | null;
  onChange: (values: string[] | null) => void;
  condition?: ReactNode;
  conditionActive?: boolean;
  conditionLabel?: string;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [conditionOpen, setConditionOpen] = useState(conditionActive);
  const shown = useMemo(() => options.filter((option) =>
    option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ), [options, search]);
  const keys = (option: TableFilterValue) => option.keys ?? [option.value];
  const allKeys = useMemo(() => Array.from(new Set(options.flatMap((option) => option.keys ?? [option.value]))), [options]);
  const checked = useMemo(() => new Set(selected ?? allKeys), [selected, allKeys]);
  const shownKeys = shown.flatMap(keys);
  const selectedShown = shownKeys.filter((value) => checked.has(value)).length;
  const change = (values: string[], enabled: boolean) => {
    const next = new Set(checked);
    values.forEach((value) => { if (enabled) next.add(value); else next.delete(value); });
    onChange(allKeys.length > 0 && allKeys.every((value) => next.has(value)) ? null : Array.from(next));
  };

  return (
    <div className="space-y-3">
      {invalid && <ErrorText>{t('table.filter.invalidValues', 'This saved value filter is invalid. Clear it to reset.')}</ErrorText>}
      <Input
        ref={searchRef}
        size="sm"
        icon={<Search className="h-4 w-4" aria-hidden="true" />}
        suffix={search ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={t('table.filter.resetSearch', 'Clear search')} onClick={() => {
            setSearch('');
            searchRef.current?.focus();
          }}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        ) : undefined}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label={t('table.filter.searchValues', 'Search values')}
        placeholder={t('table.filter.searchValues', 'Search values')}
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <Checkbox
          checked={shownKeys.length > 0 && selectedShown === shownKeys.length}
          indeterminate={selectedShown > 0 && selectedShown < shownKeys.length}
          disabled={shown.length === 0}
          label={t('table.filter.selectShown', 'Select all shown values')}
          onChange={(enabled) => change(shownKeys, enabled)}
        />
        <Badge variant="neutral" size="sm" className="tabular-nums" title={t('table.filter.values', 'Available values')}>{shown.length}</Badge>
      </div>
      <div role="group" aria-label={t('table.filter.values', 'Available values')} className="max-h-52 overflow-y-auto overscroll-contain rounded-lg border border-[var(--border-subtle)] p-1">
        {shown.map((option) => (
          <Checkbox
            key={option.value}
            checked={keys(option).every((value) => checked.has(value))}
            indeterminate={keys(option).some((value) => checked.has(value)) && !keys(option).every((value) => checked.has(value))}
            aria-label={option.label}
            onChange={(enabled) => change(keys(option), enabled)}
            className={cn(
              'flex w-full rounded-md px-2 py-2 transition-colors hover:bg-[var(--control-bg-hover)] focus-within:bg-[var(--control-bg-hover)] [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1',
              selected != null && keys(option).some((value) => checked.has(value)) && 'bg-[var(--control-bg)]',
            )}
            label={(
              <span className="flex min-w-0 items-center justify-between gap-3">
                <span className="truncate" title={option.label}>{option.label}</span>
                <Badge variant="neutral" size="sm" className="min-w-6 justify-center tabular-nums">{option.count}</Badge>
              </span>
            )}
          />
        ))}
        {shown.length === 0 && (
          <div className="px-2 py-4">
            <Text size="xs" color="muted">{t('table.filter.noValues', 'No matching values')}</Text>
          </div>
        )}
      </div>
      <Text as="p" size="xs" color="muted" className="px-1">
        {t('table.filter.valueCount', '{{selected}} of {{total}} loaded values selected', {
          selected: options.filter((option) => keys(option).every((value) => checked.has(value))).length,
          total: options.length,
        })}
      </Text>
      {selected?.some((value) => !allKeys.includes(value)) && (
        <Text size="xs" color="muted">{t('table.filter.unavailableLoadedValues', 'Some saved selections are not present in the loaded rows. Clear the filter to reset them.')}</Text>
      )}
      {condition && (
        <Accordion
          title={conditionLabel ?? t('table.filter.conditions', 'Conditions')}
          open={conditionOpen}
          onOpenChange={setConditionOpen}
          className="border-[var(--border-subtle)]"
          headerClassName="px-2 py-2"
          bodyClassName="p-2"
        >
          {condition}
        </Accordion>
      )}
    </div>
  );
}
