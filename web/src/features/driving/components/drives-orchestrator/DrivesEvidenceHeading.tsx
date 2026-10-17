import { Route, ArrowUpDown, ArrowDown } from 'lucide-react';
import { SectionTitle, Text, Button, Icon } from '@/components/ui';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  't' | 'hasDrivePayload' | 'fmtCompact' | 'sortedDrives' | 'desktopEvidence'
  | 'fsdDataAvailable' | 'sortBy' | 'setUrlBatch'>;

export function DrivesEvidenceHeading({
  t, hasDrivePayload, fmtCompact, sortedDrives, desktopEvidence,
  fsdDataAvailable, sortBy, setUrlBatch,
}: Props) {
  return (
    <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <SectionTitle className="flex min-w-0 flex-wrap items-center gap-2 break-words">
        <Icon icon={Route} className="text-[var(--text-secondary)]" />
        {t('drives.driveEvidence', 'Drive evidence')}
        <Text as="span" size="xs" weight="regular" color="muted">
          ({hasDrivePayload ? fmtCompact(sortedDrives.length) : '—'})
        </Text>
      </SectionTitle>
      {sortedDrives.length > 0 && (
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {!desktopEvidence && (
            <>
              <Icon icon={ArrowUpDown} size="sm" className="text-[var(--text-muted)]" />
              {(['date', 'distance', 'efficiency', 'fsd'] as const).map((s) => (
                <Button
                  key={s}
                  variant={sortBy === s ? 'secondary' : 'ghost'}
                  size="sm"
                  wrapLabel
                  disabled={s === 'fsd' && !fsdDataAvailable}
                  onClick={() => setUrlBatch({ sort: s === 'date' ? null : s, sortdir: null, page: null })}
                  className="min-h-11 min-w-11 md:min-h-9"
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
                  <span className="inline-flex min-w-0 items-center gap-1 break-words">
                    {s === 'date'
                      ? t('drives.sortRecent', 'Recent')
                      : s === 'distance'
                        ? t('drives.sortDistance', 'Distance')
                        : s === 'efficiency'
                          ? t('drives.sortEfficiency', 'Efficiency')
                          : t('drives.sortFsd', 'FSD share')}
                    {sortBy === s && (
                      <Icon icon={ArrowDown} size="xs" />
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
