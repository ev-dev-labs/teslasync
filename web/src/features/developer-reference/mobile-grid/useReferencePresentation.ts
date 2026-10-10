import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime, formatDateShort } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { MobileField, MobileGroup, MobileRow, MobileRole } from '@/components/ui/mobile-grid-reference';
import type { ReferenceRecord } from './fixtures';

export interface ReferenceFieldDefinition { key: keyof ReferenceRecord; label: string; role: MobileRole }
export function useReferencePresentation(rows: readonly ReferenceRecord[], keyValue: boolean) {
  const { t } = useTranslation();
  const units = useUnits();
  return useMemo(() => {
    const definitions: ReferenceFieldDefinition[] = [
      { key: 'id', label: t('developerReference.mobileGrid.fields.id', 'Record identifier'), role: 'hidden' },
      { key: 'place', label: t('developerReference.mobileGrid.fields.place', 'Location'), role: 'title' },
      { key: 'timestamp', label: t('developerReference.mobileGrid.fields.timestamp', 'Timestamp (UTC)'), role: 'hidden' },
      { key: 'cost_usd', label: t('developerReference.mobileGrid.fields.cost', 'Cost (USD)'), role: 'primary' },
      { key: 'energy_wh', label: t('developerReference.mobileGrid.fields.energy', 'Energy'), role: 'meta' },
      { key: 'duration_s', label: t('developerReference.mobileGrid.fields.duration', 'Duration'), role: 'meta' },
      { key: 'distance_m', label: t('developerReference.mobileGrid.fields.distance', 'Distance'), role: 'meta' },
      { key: 'temperature_c', label: t('developerReference.mobileGrid.fields.temperature', 'Temperature'), role: 'hidden' },
      { key: 'power_w', label: t('developerReference.mobileGrid.fields.power', 'Power'), role: 'hidden' },
      { key: 'start_percent', label: t('developerReference.mobileGrid.fields.start', 'Starting battery'), role: 'progress' },
      { key: 'end_percent', label: t('developerReference.mobileGrid.fields.end', 'Ending battery'), role: 'hidden' },
      { key: 'score', label: t('developerReference.mobileGrid.fields.score', 'Battery score'), role: 'badge' },
      { key: 'raw_field', label: t('developerReference.mobileGrid.fields.raw', 'Raw field name'), role: 'hidden' },
      { key: 'note', label: t('developerReference.mobileGrid.fields.note', 'Notes'), role: 'hidden' },
      { key: 'status', label: t('developerReference.mobileGrid.fields.status', 'Status'), role: 'hidden' },
    ];
    const display = new Map<string, MobileRow>();
    const missing = t('developerReference.mobileGrid.values.missing', '—');
    for (const row of rows) {
      const place = row.note === 'long'
        ? t('developerReference.mobileGrid.values.longPlace', 'Reference home with an extraordinarily long location name that must remain reachable without horizontal scrolling')
        : row.place === 'home'
          ? t('developerReference.mobileGrid.values.home', 'Reference home')
          : t('developerReference.mobileGrid.values.supercharger', 'Reference Supercharger');
      const values: Record<keyof ReferenceRecord, string> = {
        id: row.id,
        place,
        timestamp: formatDateTime(row.timestamp, { tz: 'UTC', locale: units.unitPrefs.locale }),
        cost_usd: row.cost_usd != null
          ? t('developerReference.mobileGrid.values.usd', '${{value}}', { value: fmtNumber(row.cost_usd) }) : missing,
        energy_wh: units.formatEnergy(row.energy_wh),
        duration_s: units.formatDuration(row.duration_s),
        distance_m: units.formatDistance(row.distance_m),
        temperature_c: units.formatTemperature(row.temperature_c),
        power_w: units.formatPower(row.power_w),
        start_percent: row.start_percent != null ? t('developerReference.mobileGrid.values.percent', '{{value}}%', { value: fmtNumber(row.start_percent, 0) }) : missing,
        end_percent: row.end_percent != null ? t('developerReference.mobileGrid.values.percent', '{{value}}%', { value: fmtNumber(row.end_percent, 0) }) : missing,
        score: row.score ?? missing,
        raw_field: row.raw_field,
        note: row.note === 'long'
          ? t('developerReference.mobileGrid.values.longNote', 'A long diagnostic value with all original information preserved in the reference detail dialog, including configuration fields and actions.')
          : t('developerReference.mobileGrid.values.note', 'Synthetic SI reference record'),
        status: row.status === 'complete'
          ? t('developerReference.mobileGrid.values.complete', 'Complete')
          : t('developerReference.mobileGrid.values.pending', 'Pending'),
      };
      const details: MobileField[] = definitions.map(field => ({ key: field.key, label: field.label, value: values[field.key] }));
      display.set(row.id, {
        key: row.id,
        title: keyValue ? t('developerReference.mobileGrid.values.batteryLabel', 'Battery level') : t('developerReference.mobileGrid.values.rowTitle', '{{place}} · {{number}}', { place, number: row.id.split('-').pop() }),
        primary: keyValue ? values.end_percent : values.cost_usd,
        tag: keyValue ? undefined : row.place === 'supercharger'
          ? t('developerReference.mobileGrid.values.dc', 'DC') : t('developerReference.mobileGrid.values.ac', 'AC'),
        meta: keyValue ? [] : details.filter(field => definitions.find(definition => definition.key === field.key)?.role === 'meta'),
        badge: row.score ? { value: row.score, label: t('developerReference.mobileGrid.values.scoreLabel', 'Battery score {{score}}', { score: row.score }) } : undefined,
        progress: row.start_percent != null && row.end_percent != null ? {
          from: row.start_percent, to: row.end_percent,
          label: t('developerReference.mobileGrid.values.progressLabel', 'Battery from {{from}}% to {{to}}%', { from: row.start_percent, to: row.end_percent }),
        } : undefined,
        rawLabel: keyValue ? row.raw_field : undefined,
        details,
      });
    }
    function groupRows(allMatching: readonly ReferenceRecord[], visible: readonly ReferenceRecord[], grouped: boolean): MobileGroup[] {
      const keys = [...new Set(visible.map(row => grouped ? row.timestamp : 'all'))];
      return keys.map(key => {
        const members = allMatching.filter(row => !grouped || row.timestamp === key);
        const shown = visible.filter(row => !grouped || row.timestamp === key);
        const groupRows = shown.flatMap(row => { const value = display.get(row.id); return value ? [value] : []; });
        const knownEnergy = members.every(row => row.energy_wh != null);
        return {
          key, rows: groupRows, memberCount: members.length,
          label: grouped ? keyValue ? formatDateTime(key, { tz: 'UTC', locale: units.unitPrefs.locale })
            : t('developerReference.mobileGrid.groups.date', '{{date}} · {{relative}}', { date: formatDateShort(key, { tz: 'UTC', locale: units.unitPrefs.locale }),
              relative: key.startsWith('2026-10-03')
                ? t('developerReference.mobileGrid.groups.yesterday', 'Yesterday')
                : t('developerReference.mobileGrid.groups.twoDays', 'Two days ago') }) : undefined,
          summary: grouped && members.length >= 2 && !keyValue
            ? t('developerReference.mobileGrid.groups.summary', '{{count}} · {{energy}}', {
              count: members.length, energy: knownEnergy ? units.formatEnergy(members.reduce((sum, row) => sum + (row.energy_wh ?? 0), 0)) : missing }) : undefined,
        };
      });
    }
    return { display, definitions, groupRows };
  }, [rows, keyValue, t, units]);
}
