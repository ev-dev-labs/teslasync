import { localDayKey } from '@/lib/drivesAggregation';
import { buildDrivesListNarrative } from '../components/drives-orchestrator/drivesListNarrative';
import { buildDrivesListHighlights } from '../components/drives-orchestrator/drivesListHighlights';
import { useDrivesListPageData } from './useDrivesListPageData';
import { useDrivesListPageFilters } from './useDrivesListPageFilters';
import { useDrivesListPageSelection } from './useDrivesListPageSelection';
import { useDrivesListPageSummary } from './useDrivesListPageSummary';
import { useDrivesListPageCollections } from './useDrivesListPageCollections';

export function useDrivesListPage() {
  const data = useDrivesListPageData();
  const filters = useDrivesListPageFilters(data);
  const input = { ...data, ...filters };
  const selection = useDrivesListPageSelection(input);
  const summary = useDrivesListPageSummary(input);
  const collections = useDrivesListPageCollections(input);
  const narrative = buildDrivesListNarrative({ ...input, ...summary });
  const highlightRows = buildDrivesListHighlights(input);
  const previewFrom = localDayKey(data.previewDrive?.startTs, data.tz);
  const previewTo = localDayKey(data.previewDrive?.endTs ?? data.previewDrive?.startTs, data.tz) ?? previewFrom;

  return {
    ...input, ...selection, ...summary, ...collections,
    narrative, highlightRows, previewFrom, previewTo,
  };
}

export type DrivesListPageController = ReturnType<typeof useDrivesListPage>;
