import { useMemo } from 'react';
import { type PillItem } from '@/components/forms';
import type { DriveFsdInsight } from '@/types/fsd';
import type { useDrivesListPageData } from './useDrivesListPageData';
import type { useDrivesListPageFilters } from './useDrivesListPageFilters';

type CollectionsInput = ReturnType<typeof useDrivesListPageData>
  & ReturnType<typeof useDrivesListPageFilters>;

export function useDrivesListPageCollections(input: CollectionsInput) {
  const {
    t, hasDrivePayload, fsdDataAvailable, fsdByDriveID, dateFilteredDrives,
    anomalyDrives, notableDrives, commuteDrives, collection, fsdFilter, filteredDrives,
  } = input;

  /* ---- Collection filters ---- */
  const collectionPills: PillItem[] = useMemo(() => [
    { key: 'all',       label: t('drives.coll.all', 'All'),             count: hasDrivePayload ? dateFilteredDrives.length : undefined },
    { key: 'anomalies', label: t('drives.coll.anomalies', 'Anomalies'), count: hasDrivePayload ? anomalyDrives.length : undefined },
    { key: 'notable',   label: t('drives.coll.notable', 'Notable'),     count: hasDrivePayload ? notableDrives.length : undefined },
    { key: 'commutes',  label: t('drives.coll.commutes', 'Commutes'),   count: hasDrivePayload ? commuteDrives.length : undefined },
    { key: 'tagged',    label: t('drives.coll.tagged', 'Tagged'),       count: 0, disabled: true },
  ], [t, hasDrivePayload, dateFilteredDrives.length, anomalyDrives.length, notableDrives.length, commuteDrives.length]);

  const fsdPills: PillItem[] = useMemo(() => {
    const count = (predicate: (insight: DriveFsdInsight | undefined) => boolean) =>
      fsdDataAvailable && hasDrivePayload ? dateFilteredDrives.reduce(
        (total, drive) => total + (predicate(fsdByDriveID.get(drive.id)) ? 1 : 0),
        0,
      ) : undefined;
    return [
      {
        key: 'all',
        label: t('drives.fsdFilter.all', 'All FSD data'),
        count: hasDrivePayload ? dateFilteredDrives.length : undefined,
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
  }, [dateFilteredDrives, hasDrivePayload, fsdByDriveID, fsdDataAvailable, t]);

  /* ---- Compact summary for the sticky bar ---- */
  const collectionLabel = collectionPills.find(p => p.key === collection)?.label ?? t('drives.coll.all', 'All');
  const fsdFilterLabel = fsdPills.find(p => p.key === fsdFilter)?.label ?? t('drives.fsdFilter.all', 'All FSD data');
  const combinedFilters = collection !== 'all' && fsdFilter !== 'all';
  const filterPills: PillItem[] = [
    collectionPills[0],
    ...collectionPills.slice(1).map((pill) => ({ ...pill, key: `coll:${pill.key}` })),
    ...fsdPills.slice(1).map((pill) => ({ ...pill, key: `fsd:${pill.key}` })),
    ...(combinedFilters
      ? [{ key: 'combined', label: `${collectionLabel} + ${fsdFilterLabel}`, count: filteredDrives.length }]
      : []),
  ];
  const activeFilterKey = combinedFilters
    ? 'combined'
    : fsdFilter !== 'all'
      ? `fsd:${fsdFilter}`
      : collection === 'all' ? 'all' : `coll:${collection}`;

  return { collectionLabel, fsdFilterLabel, filterPills, activeFilterKey };
}
