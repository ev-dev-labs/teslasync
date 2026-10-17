import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import i18n, { loadEnglishNamespace } from '@/i18n';
import { formatDistance, formatDuration, formatEnergy, formatPower, formatTemperature } from '@/lib/unitConversion';
import { useReferenceController } from './useReferenceController';
import { useReferencePresentation } from './useReferencePresentation';
import { makeReferenceRecords } from './fixtures';

// Real production translator and canonical generated resources; no fallback-only translation mock.
vi.unmock('react-i18next');
beforeAll(async () => {
  await i18n.changeLanguage('en');
  await loadEnglishNamespace('developerReference');
});
// Existing SI helpers still perform real conversion; bypass only the settings provider/query.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => {
    const pref = { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 1 } satisfies import('@/lib/unitConversion').UnitPref;
    return {
      unitPrefs: pref,
      formatEnergy: (value: number | null) => formatEnergy(value, pref),
      formatDuration: (value: number | null) => formatDuration(value, pref),
      formatDistance: (value: number | null) => formatDistance(value, pref),
      formatTemperature: (value: number | null) => formatTemperature(value, pref),
      formatPower: (value: number | null) => formatPower(value, pref),
    };
  },
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('interactive REFERENCE FIXTURES controller', () => {
  it.each([0, 1, 2, 21])('uses canonical English export-notice plurals for numeric count %s', count => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReferenceController({
      id: 'dev-test', labelKey: 'test', label: 'Test', count,
    }, 'Test'));
    act(() => result.current.callbacks.onExport('matchingLoaded'));
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.notice).toBe(
      `REFERENCE FIXTURES: Request matching loaded-row export requested for ${count} ${count === 1 ? 'row' : 'rows'}. No file downloaded.`,
    );
    expect(i18n.getResource('en', 'translation', 'developerReference.mobileGrid.exports.notice_one')).toBe(
      'REFERENCE FIXTURES: {{scope}} requested for {{count}} row. No file downloaded.',
    );
    expect(i18n.getResource('en', 'translation', 'developerReference.mobileGrid.exports.notice_other')).toBe(
      'REFERENCE FIXTURES: {{scope}} requested for {{count}} rows. No file downloaded.',
    );
  });
  it('resets the first batch for search, quick filter and named sort', () => {
    const { result } = renderHook(() => useReferenceController({ id: 'dev-test', labelKey: 'test', label: 'Test', count: 21 }, 'Test'));
    const shown = () => result.current.model.groups.reduce((total, group) => total + group.rows.length, 0);
    act(() => result.current.callbacks.onLoadMore());
    expect(shown()).toBe(20);
    act(() => result.current.callbacks.onSearch('Reference'));
    expect(shown()).toBe(10);
    act(() => result.current.callbacks.onLoadMore());
    act(() => result.current.callbacks.onFilter('home'));
    expect(shown()).toBe(10);
    act(() => result.current.callbacks.onLoadMore());
    act(() => result.current.callbacks.onSort('cost'));
    expect(shown()).toBe(10);
  });
  it('three-second loading and retry are bounded, retaining failure data', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReferenceController({ id: 'dev-test', labelKey: 'test', label: 'Test', count: 4, state: 'retained' }, 'Test'));
    expect(result.current.model.state.kind).toBe('error');
    expect(result.current.model.groups[0]?.rows).toHaveLength(4);
    act(() => result.current.callbacks.onRetry());
    expect(result.current.retrying).toBe(true);
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.model.state.kind).toBe('ready');
    act(() => result.current.runLoading());
    expect(result.current.model.state.kind).toBe('loading');
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.model.state.kind).toBe('loading');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.model.state.kind).toBe('ready');
  });
  it('preserves selected loaded rows across filters and reports export request scope honestly', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useReferenceController({ id: 'dev-test', labelKey: 'test', label: 'Test', count: 21, selecting: true }, 'Test'));
    act(() => result.current.callbacks.onFilter('home'));
    expect(result.current.keys).toEqual(['reference-1']);
    act(() => result.current.callbacks.onExport('selectedLoaded'));
    expect(result.current.model.exportBusy).toBe(true);
    act(() => vi.advanceTimersByTime(300));
    expect(result.current.notice).toContain('for 1 row.');
    expect(result.current.notice).toContain('No file downloaded');
    act(() => result.current.callbacks.onSelectionMode(false));
    expect(result.current.keys).toEqual([]);
  });
  it('every source field remains reachable, with a singleton and three-member group', () => {
    const records = makeReferenceRecords(4, true);
    const { result } = renderHook(() => useReferencePresentation(records, false));
    expect(result.current.display.get('reference-1')?.details).toHaveLength(15);
    expect(result.current.display.get('reference-2')?.meta).toHaveLength(3);
    expect(result.current.display.get('reference-1')?.meta.find(field => field.key === 'energy_wh')?.value).toContain('0');
    expect(result.current.display.get('reference-1')?.meta.find(field => field.key === 'duration_s')?.value).toBe('—');
    const groups = result.current.groupRows(records, records, true);
    expect(groups.map(group => group.memberCount)).toEqual([1, 3]);
    expect(groups[0]?.summary).toBeUndefined();
    expect(groups[1]?.summary).toContain('78.9');
  });
  it('empty action adds a fixture and no-match Clear restores results', () => {
    const { result } = renderHook(() => useReferenceController({ id: 'dev-test', labelKey: 'test', label: 'Test', count: 0 }, 'Test'));
    act(() => {
      const state = result.current.model.state;
      if (state.kind === 'empty') state.action?.onAction();
    });
    expect(result.current.source).toHaveLength(1);
    act(() => result.current.callbacks.onSearch('unmatched'));
    expect(result.current.model.state.kind).toBe('noMatch');
    act(() => result.current.callbacks.onClear());
    expect(result.current.model.state.kind).toBe('ready');
  });
});
