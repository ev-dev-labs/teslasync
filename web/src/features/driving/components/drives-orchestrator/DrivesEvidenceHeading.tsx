import { Route, ArrowUpDown, ArrowDown } from 'lucide-react';
import { SectionTitle, Text, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  't' | 'hasDrivePayload' | 'fmtCompact' | 'sortedDrives' | 'desktopEvidence'
  | 'fsdDataAvailable' | 'sortBy' | 'setUrlBatch'>;

export function DrivesEvidenceHeading({
  t, hasDrivePayload, fmtCompact, sortedDrives, desktopEvidence,
  fsdDataAvailable, sortBy, setUrlBatch,
}: Props) {
  return (
    <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
      <SectionTitle className="flex items-center gap-2">
        <Route className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
        {t('drives.driveEvidence', 'Drive evidence')}
        <Text as="span" size="xs" weight="regular" color="muted">
          ({hasDrivePayload ? fmtCompact(sortedDrives.length) : '—'})
        </Text>
      </SectionTitle>
      {sortedDrives.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {!desktopEvidence && (
            <>
              <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
              {(['date', 'distance', 'efficiency', 'fsd'] as const).map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  size="sm"
                  wrapLabel
                  disabled={s === 'fsd' && !fsdDataAvailable}
                  onClick={() => setUrlBatch({ sort: s === 'date' ? null : s, sortdir: null, page: null })}
                  className={cn(
                    sortBy === s
                      ? 'bg-cyan-500/10 text-cyan-300'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                  )}
                  aria-label={t('drives.sortByAria', 'Sort by {{field}}', {
                    field: s === 'date'
                      ? t('drives.sortRecent', 'Recent')
                      : s === 'distance'
                        ? t('drives.sortDistance', 'Distance')
                        : s === 'efficiency'
                          ? t('drives.sortEfficiency', 'Efficiency')
                          : t('drives.sortFsd', 'FSD share'),
                  })}
                  aria-pressed={sortBy === s}
                >
                  <span className="inline-flex items-center gap-1">
                    {s === 'date'
                      ? t('drives.sortRecent', 'Recent')
                      : s === 'distance'
                        ? t('drives.sortDistance', 'Distance')
                        : s === 'efficiency'
                          ? t('drives.sortEfficiency', 'Efficiency')
                          : t('drives.sortFsd', 'FSD share')}
                    {sortBy === s && (
                      <ArrowDown className="h-3 w-3 opacity-80" aria-hidden />
                    )}
                  </span>
                </Button>
              ))}
              <span className="mx-1 h-4 w-px bg-[var(--surface-2)]" aria-hidden="true" />
            </>
          )}
        </div>
      )}
    </div>
  );
}
