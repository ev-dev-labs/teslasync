import { useMemo } from 'react';
import { type PillItem } from '@/components/forms';
import type { DriveFsdInsight } from '@/types/fsd';
import type { useDrivesListPageData } from './useDrivesListPageData';
import type { useDrivesListPageFilters } from './useDrivesListPageFilters';
import type { useDrivesListRange } from './useDrivesListRange';

type CollectionsInput = ReturnType<typeof useDrivesListPageData>
  & ReturnType<typeof useDrivesListPageFilters> & ReturnType<typeof useDrivesListRange>;

export function useDrivesListPageCollections(input: CollectionsInput) {
  const {
    t, hasDrivePayload, fsdDataAvailable, fsdByDriveID, currentStats,
    anomalyCount, notableCount, commuteCount, collection, fsdFilter, matchingTotal,
  } = input;
  const rangeTotal = currentStats.count;

  /* ---- Collection filters ---- */
  const collectionPills: PillItem[] = useMemo(() => [
    { key: 'all',       label: t('drives.coll.allPill', 'All'),         count: hasDrivePayload ? rangeTotal : undefined },
    { key: 'anomalies', label: t('drives.coll.anomalies', 'Anomalies'), count: hasDrivePayload ? anomalyCount : undefined },
    { key: 'notable',   label: t('drives.coll.notable', 'Notable'),     count: hasDrivePayload ? notableCount : undefined },
    { key: 'commutes',  label: t('drives.coll.commutes', 'Commutes'),   count: hasDrivePayload ? commuteCount : undefined },
    { key: 'tagged',    label: t('drives.coll.tagged', 'Tagged'),       count: 0, disabled: true },
  ], [t, hasDrivePayload, rangeTotal, anomalyCount, notableCount, commuteCount]);

  const fsdPills: PillItem[] = useMemo(() => {
    const count = (predicate: (insight: DriveFsdInsight) => boolean) =>
      fsdDataAvailable ? Array.from(fsdByDriveID.values()).filter(predicate).length : undefined;
    return [
      {
        key: 'all',
        label: t('drives.fsdFilter.all', 'All FSD data'),
        count: hasDrivePayload ? rangeTotal : undefined,
      },
      {
        key: 'reported',
        label: t('drives.fsdFilter.reported', 'FSD'),
        count: count((insight) => insight != null
          && insight.confidence !== 'unknown'
          && insight.fsd_distance_m != null),
        disabled: !fsdDataAvailable,
      },
      {
        key: 'high',
        label: t('drives.fsdFilter.high', 'High confidence'),
        count: count((insight) => insight?.confidence === 'high'),
        disabled: !fsdDataAvailable,
      },
      {
        key: 'estimated',
        label: t('drives.fsdFilter.estimated', 'Estimated'),
        count: count((insight) => insight?.confidence === 'estimated'),
        disabled: !fsdDataAvailable,
      },
      {
        key: 'ambiguous',
        label: t('drives.fsdFilter.ambiguous', 'Ambiguous'),
        count: count((insight) => insight?.confidence === 'ambiguous'),
        disabled: !fsdDataAvailable,
      },
      {
        key: 'unknown',
        label: t('drives.fsdFilter.unknown', 'Unknown'),
        count: count((insight) => insight?.confidence === 'unknown'),
        disabled: !fsdDataAvailable,
      },
    ];
  }, [rangeTotal, hasDrivePayload, fsdByDriveID, fsdDataAvailable, t]);

  /* ---- Compact summary for the sticky bar ---- */
  const collectionLabel = collectionPills.find(p => p.key === collection)?.label ?? t('drives.coll.allPill', 'All');
  const fsdFilterLabel = fsdPills.find(p => p.key === fsdFilter)?.label ?? t('drives.fsdFilter.all', 'All FSD data');
  const combinedFilters = collection !== 'all' && fsdFilter !== 'all';
  const filterPills: PillItem[] = [
    collectionPills[0],
    ...collectionPills.slice(1).map((pill) => ({ ...pill, key: `coll:${pill.key}` })),
    ...fsdPills.slice(1).map((pill) => ({ ...pill, key: `fsd:${pill.key}` })),
    ...(combinedFilters
      ? [{ key: 'combined', label: `${collectionLabel} + ${fsdFilterLabel}`, count: matchingTotal }]
      : []),
  ];
  const activeFilterKey = combinedFilters
    ? 'combined'
    : fsdFilter !== 'all'
      ? `fsd:${fsdFilter}`
      : collection === 'all' ? 'all' : `coll:${collection}`;

  return { collectionLabel, fsdFilterLabel, collectionPills, fsdPills, filterPills, activeFilterKey };
}
