import { PageHeaderSticky } from '@/components/layout';
import { Text } from '@/components/ui';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  't' | 'periodLabel' | 'collectionLabel' | 'hasDrivePayload'
  | 'fmtCompact' | 'filteredDrives' | 'avgGrade'>;

export function DrivesStickySummary({
  t, periodLabel, collectionLabel, hasDrivePayload, fmtCompact, filteredDrives, avgGrade,
}: Props) {
  return (
    <PageHeaderSticky
      targetId="drives-overview"
      ariaLabel={t('drives.stickyBar.aria', 'Drive history summary')}
      testId="drives-sticky-summary"
    >
      <Text as="span" color="secondary" className="truncate">
        {t('drives.title', 'Drive History')}
      </Text>
      <span className="opacity-50">·</span>
      <span className="truncate">{periodLabel}</span>
      <span className="opacity-50">·</span>
      <Text as="span" color="primary" weight="medium">{collectionLabel}</Text>
      <span className="opacity-50">·</span>
      <Text as="span">{hasDrivePayload ? fmtCompact(filteredDrives.length) : '—'} {t('drives.results', 'results')}</Text>
      {avgGrade.label !== '—' && (
        <>
          <span className="opacity-50">·</span>
          <span>{t('drives.avgGrade', 'efficiency grade')}{' '}
            <Text as="span" weight="semibold" style={{ color: avgGrade.color }}>{avgGrade.label}</Text>
          </span>
        </>
      )}
    </PageHeaderSticky>
  );
}
