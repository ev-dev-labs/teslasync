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
      <Text as="span" size="xs" color="secondary" className="min-w-0 break-words">
        {t('drives.title', 'Drive History')}
      </Text>
      <Text as="span" size="xs" color="muted" aria-hidden="true">·</Text>
      <Text as="span" size="xs" color="secondary" className="min-w-0 break-words">{periodLabel}</Text>
      <Text as="span" size="xs" color="muted" aria-hidden="true">·</Text>
      <Text as="span" size="xs" color="primary" weight="medium" className="min-w-0 break-words">{collectionLabel}</Text>
      <Text as="span" size="xs" color="muted" aria-hidden="true">·</Text>
      <Text as="span" size="xs" color="secondary">{hasDrivePayload ? fmtCompact(filteredDrives.length) : '—'} {t('drives.results', 'results')}</Text>
      {avgGrade.label !== '—' && (
        <>
          <Text as="span" size="xs" color="muted" aria-hidden="true">·</Text>
          <Text as="span" size="xs" color="secondary" className="min-w-0 break-words">{t('drives.avgGrade', 'efficiency grade')}{' '}
            <Text as="span" size="xs" weight="semibold" style={{ color: avgGrade.color }}>{avgGrade.label}</Text>
          </Text>
        </>
      )}
    </PageHeaderSticky>
  );
}
