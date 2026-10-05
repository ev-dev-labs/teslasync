import { deriveDataState, type DataStateSource } from '@/api/dataState';

/** Both histories are required for a comparison. Empty resolved histories are
 * valid answers; an absent history must never become an invented zero sample.
 * Refresh failures keep the exact retained inputs and therefore comparisons. */
export function firmwareImpactState<D, U>(
  drivesQuery: DataStateSource<D>,
  updatesQuery: DataStateSource<U>,
) {
  const drives = deriveDataState(drivesQuery, { provenance: 'historical' });
  const updates = deriveDataState(updatesQuery, { provenance: 'historical' });
  const hasInputs = drives.hasData && updates.hasData;
  const fatalError = drives.fatalError ?? updates.fatalError;

  return {
    drives,
    updates,
    hasInputs,
    loading: !fatalError && !hasInputs && (
      (!drives.hasData && Boolean(drivesQuery.isLoading || drivesQuery.isPending))
      || (!updates.hasData && Boolean(updatesQuery.isLoading || updatesQuery.isPending))
    ),
    // This replaces only dependent comparisons, never the page or source notices.
    fatalError,
    retained: hasInputs && (
      drives.status === 'stale' || updates.status === 'stale'
    ),
  };
}

export type FirmwareImpactState = ReturnType<typeof firmwareImpactState>;
