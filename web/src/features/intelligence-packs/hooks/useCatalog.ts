import { useMemo } from 'react';

import { useInstalledPacks } from './useInstalledPacks';
import { CATALOG_ENTRIES, type CatalogEntry } from '../lib/catalogFixtures';

export interface CatalogEntryWithStatus extends CatalogEntry {
  installedVersion: string | null;
  isUpToDate: boolean;
}

/**
 * The curated local catalog (bundled fixtures — never fetched over a
 * network), annotated with each entry's local install status so the UI can
 * show "Install" vs. "Up to date" vs. "Upgrade available" without a second
 * lookup pass in every component.
 */
export function useCatalog(): { entries: CatalogEntryWithStatus[]; isLoading: boolean } {
  const installedQuery = useInstalledPacks();
  const installedByPackId = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of installedQuery.data ?? []) map.set(record.packId, record.envelope.manifest.version);
    return map;
  }, [installedQuery.data]);

  const entries = useMemo<CatalogEntryWithStatus[]>(
    () =>
      CATALOG_ENTRIES.map((entry) => {
        const installedVersion = installedByPackId.get(entry.envelope.manifest.id) ?? null;
        return {
          ...entry,
          installedVersion,
          isUpToDate: installedVersion === entry.envelope.manifest.version,
        };
      }),
    [installedByPackId],
  );

  return { entries, isLoading: installedQuery.isLoading };
}
