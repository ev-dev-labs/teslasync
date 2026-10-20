import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, DataTable, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { safeArray } from '@/lib/safeArray';
import type { FsdObservatoryCommuteChapter, FsdObservatoryCommuteStory } from '@/types/fsd';
import { FSD_DEFAULT_PAGE_SIZE, FSD_PAGE_SIZE_OPTIONS } from './useClientPagination';

interface ChapterRow {
  key: string;
  story: FsdObservatoryCommuteStory;
  chapter: FsdObservatoryCommuteChapter | null;
}

const pagination = { defaultPageSize: FSD_DEFAULT_PAGE_SIZE, pageSizeOptions: FSD_PAGE_SIZE_OPTIONS };

export function FsdCommuteStoriesTable({ stories }: { stories: FsdObservatoryCommuteStory[] }) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const rows = useMemo(() => stories.flatMap<ChapterRow>(story => {
    const chapters = safeArray(story.chapters);
    return chapters.length > 0
      ? chapters.map((chapter, index) => ({ key: `${story.route_key}:${index}`, story, chapter }))
      : [{ key: `${story.route_key}:unknown`, story, chapter: null }];
  }), [stories]);
  const columns = useMemo<Column<ChapterRow>[]>(() => [
    {
      key: 'route',
      header: t('fsd.observatory.columns.route', 'Route'),
      defaultWidth: 280,
      render: row => row.story.route_label,
    },
    {
      key: 'routeDrives',
      header: t('fsd.observatory.columns.routeDrives', 'Route drives'),
      align: 'right',
      render: row => fmtInt(row.story.drive_count),
    },
    {
      key: 'firmware',
      header: t('fsd.observatory.columns.firmware', 'Firmware'),
      defaultWidth: 160,
      render: row => <Badge variant="info" size="sm">
        {row.chapter?.firmware_version ?? t('fsd.observatory.unknownFirmware', 'Unknown firmware')}
      </Badge>,
    },
    {
      key: 'chapterDrives',
      header: t('fsd.observatory.columns.chapterDrives', 'Chapter drives'),
      align: 'right',
      render: row => row.chapter == null ? '—' : fmtInt(row.chapter.drive_count),
    },
    {
      key: 'reportedFsd',
      header: t('fsd.observatory.columns.reportedFsd', 'Reported FSD'),
      align: 'right',
      render: row => row.chapter?.fsd_distance_m == null
        ? t('fsd.notMeasured', 'Not measured') : formatDistance(row.chapter.fsd_distance_m),
    },
    {
      key: 'share',
      header: t('fsd.observatory.columns.share', 'FSD share'),
      align: 'right',
      render: row => row.chapter?.fsd_share_pct == null ? '—'
        : t('fsd.kpi.sharePct', '{{value}}%', { value: fmtNumber(row.chapter.fsd_share_pct) }),
    },
    {
      key: 'unknown',
      header: t('fsd.observatory.columns.unknown', 'Unknown drives'),
      align: 'right',
      render: row => row.chapter == null ? '—' : fmtInt(row.chapter.unknown_count),
    },
    {
      key: 'ambiguous',
      header: t('fsd.observatory.columns.ambiguous', 'Ambiguous drives'),
      align: 'right',
      render: row => row.chapter == null ? '—' : fmtInt(row.chapter.ambiguous_count),
    },
    {
      key: 'resets',
      header: t('fsd.observatory.resets', 'Counter resets'),
      align: 'right',
      render: row => row.chapter == null ? '—' : fmtInt(row.chapter.reset_breaks),
    },
  ], [t, fmtInt, fmtNumber, formatDistance]);

  return (
    <div data-testid="fsd-observatory-commute" className="min-w-0">
      <DataTable
        tableId="fsd:observatory-commute-chapters"
        name={t('fsd.observatory.commute', 'Commute stories')}
        caption={t('fsd.observatory.commute', 'Commute stories')}
        variant="embedded"
        density="compact"
        columns={columns}
        data={rows}
        keyExtractor={row => row.key}
        pagination={pagination}
        maxHeight={480}
      />
    </div>
  );
}
