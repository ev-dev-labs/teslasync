/**
 * NotificationFilterBar — controls for the notifications inbox.
 *
 * Wired controls:
 *   - Severity chips (info/warn/critical) — multi-select
 *   - Vehicle <Select> (single, "All vehicles" option)
 *   - Rule <Select>    (single, "All rules" option)
 *   - SearchInput      (debounced, message text search)
 *
 * The parent owns the `NotificationFilters` state; this component is fully
 * controlled and emits `onChange` patches that the parent merges in.
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import { Button, Select } from '@/components/ui';
import {
  FilterBar,
  SearchInput,
  ActiveFilterChips,
  type FilterChipDescriptor,
} from '@/components/forms';
import type { NotificationFilters } from '@/api/hooks/useNotifications';
import type { Vehicle, AlertRule } from '@/api/types';

const SEVERITY_OPTIONS = [
  { value: 'info', label: 'Info', Icon: Info },
  { value: 'warn', label: 'Warn', Icon: AlertTriangle },
  { value: 'critical', label: 'Critical', Icon: AlertOctagon },
] as const;

type Severity = (typeof SEVERITY_OPTIONS)[number]['value'];

export interface NotificationFilterBarProps {
  filters: NotificationFilters;
  onChange: (next: NotificationFilters) => void;
  vehicles: Vehicle[];
  rules: AlertRule[];
}

export function NotificationFilterBar({
  filters,
  onChange,
  vehicles,
  rules,
}: NotificationFilterBarProps) {
  const { t } = useTranslation();

  const toggleSeverity = useCallback(
    (sev: Severity) => {
      const current = filters.severity ?? [];
      const next = current.includes(sev)
        ? current.filter(s => s !== sev)
        : [...current, sev];
      onChange({ ...filters, severity: next.length ? next : undefined });
    },
    [filters, onChange],
  );

  const setVehicle = useCallback(
    (value: string) => {
      const id = value ? Number(value) : undefined;
      onChange({ ...filters, vehicle_id: id ? [id] : undefined });
    },
    [filters, onChange],
  );

  const setRule = useCallback(
    (value: string) => {
      const id = value ? Number(value) : undefined;
      onChange({ ...filters, rule_id: id ? [id] : undefined });
    },
    [filters, onChange],
  );
  const setSource = useCallback(
    (value: string) => onChange({ ...filters, source: value === 'rule' ? 'rule' : undefined }),
    [filters, onChange],
  );

  const setQuery = useCallback(
    (q: string) => {
      onChange({ ...filters, q: q.trim() ? q : undefined });
    },
    [filters, onChange],
  );

  const selectedSeverities = useMemo(
    () => new Set<Severity>(filters.severity ?? []),
    [filters.severity],
  );

  const vehicleOptions = useMemo(
    () => [
      { value: '', label: t('notifications.inbox.filter.allVehicles', 'All vehicles') },
      ...(vehicles ?? []).map(v => ({ value: String(v.id), label: v.display_name || `#${v.id}` })),
    ],
    [vehicles, t],
  );

  const ruleOptions = useMemo(
    () => [
      { value: '', label: t('notifications.inbox.filter.allRules', 'All rules') },
      ...(rules ?? []).map(r => ({ value: String(r.id), label: r.name })),
    ],
    [rules, t],
  );

  const activeFilterChips = useMemo<FilterChipDescriptor[]>(() => {
    const chips: FilterChipDescriptor[] = [];
    const severityLabels: Record<Severity, string> = {
      info: t('notifications.inbox.filter.severity.info', 'Info'),
      warn: t('notifications.inbox.filter.severity.warn', 'Warn'),
      critical: t('notifications.inbox.filter.severity.critical', 'Critical'),
    };
    if (filters.severity?.length) {
      const summary = filters.severity.map(s => severityLabels[s]).join(', ');
      chips.push({
        key: 'severity',
        label: t('notifications.inbox.filter.severity', 'Severity'),
        value: summary,
        onRemove: () => onChange({ ...filters, severity: undefined }),
      });
    }
    if (filters.vehicle_id?.length) {
      const id = filters.vehicle_id[0];
      const match = (vehicles ?? []).find(v => v.id === id);
      chips.push({
        key: 'vehicle_id',
        label: t('notifications.inbox.filter.vehicle', 'Vehicle'),
        value: match?.display_name || `#${id}`,
        onRemove: () => onChange({ ...filters, vehicle_id: undefined }),
      });
    }
    if (filters.rule_id?.length) {
      const id = filters.rule_id[0];
      const match = (rules ?? []).find(r => r.id === id);
      chips.push({
        key: 'rule_id',
        label: t('notifications.inbox.filter.rule', 'Rule'),
        value: match?.name || `#${id}`,
        onRemove: () => onChange({ ...filters, rule_id: undefined }),
      });
    }
    if (filters.source === 'rule') {
      chips.push({
        key: 'source',
        label: t('notifications.inbox.filter.source', 'Source'),
        value: t('notifications.inbox.filter.ruleTriggers', 'Rule triggers'),
        onRemove: () => onChange({ ...filters, source: undefined }),
      });
    }
    if (filters.q) {
      chips.push({
        key: 'q',
        label: t('notifications.inbox.filter.searchLabel', 'Search'),
        value: filters.q,
        onRemove: () => onChange({ ...filters, q: undefined }),
      });
    }
    return chips;
  }, [filters, vehicles, rules, onChange, t]);

  const handleClearAll = useCallback(() => {
    onChange({
      ...filters,
      severity: undefined,
      vehicle_id: undefined,
      rule_id: undefined,
      source: undefined,
      q: undefined,
    });
  }, [filters, onChange]);

  return (
    <div className="space-y-3">
      <FilterBar>
        <div
          role="group"
          aria-label={t('notifications.inbox.filter.severity', 'Severity')}
          className="flex flex-wrap items-center gap-1"
        >
          {SEVERITY_OPTIONS.map(opt => {
            const active = selectedSeverities.has(opt.value);
            const Icon = opt.Icon;
            return (
              <Button
                key={opt.value}
                type="button"
                variant={active ? 'primary' : 'outline'}
                size="sm"
                onClick={() => toggleSeverity(opt.value)}
                aria-pressed={active}
                className="gap-1 rounded-shape-sm px-2.5 text-xs"
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                <span>{t(`notifications.inbox.filter.severity.${opt.value}`, opt.label)}</span>
              </Button>
            );
          })}
        </div>

        <Select
          options={vehicleOptions}
          value={filters.vehicle_id?.[0] ? String(filters.vehicle_id[0]) : ''}
          onChange={e => setVehicle(e.target.value)}
          aria-label={t('notifications.inbox.filter.vehicle', 'Vehicle')}
          className="min-w-[10rem]"
        />

        <Select
          options={ruleOptions}
          value={filters.rule_id?.[0] ? String(filters.rule_id[0]) : ''}
          onChange={e => setRule(e.target.value)}
          aria-label={t('notifications.inbox.filter.rule', 'Rule')}
          className="min-w-[10rem]"
        />
        <Select
          options={[
            { value: '', label: t('notifications.inbox.filter.allSources', 'All sources') },
            { value: 'rule', label: t('notifications.inbox.filter.ruleTriggers', 'Rule triggers') },
          ]}
          value={filters.source ?? ''}
          onChange={e => setSource(e.target.value)}
          aria-label={t('notifications.inbox.filter.source', 'Source')}
          className="min-w-[10rem]"
        />

        <SearchInput
          value={filters.q ?? ''}
          onChange={setQuery}
          placeholder={t('notifications.inbox.filter.searchPlaceholder', 'Search messages…')}
          className="w-full sm:w-72"
          historyScope="notifications"
        />
      </FilterBar>

      <ActiveFilterChips filters={activeFilterChips} onClearAll={handleClearAll} />
    </div>
  );
}
