import { useTranslation } from 'react-i18next'
import type { SearchHitType } from '@/api/types'
import { AlertBanner } from '@/components/feedback'
import { Text } from '@/components/ui'
import { searchSectionLabel } from './searchHelpers'

export function SearchCoverage({
  scope, failedTypes, limited,
}: { scope: string; failedTypes: SearchHitType[]; limited: boolean }) {
  const { t } = useTranslation()
  return (
    <AlertBanner variant="warning" role="status" title={t('search.completeness.title', 'Search coverage is limited')}>
      <Text variant="bodySm">{scope}</Text>
      {failedTypes.length > 0 && (
        <Text variant="bodySm">
          {t('search.completeness.failed', 'Some sources did not respond: {{types}}. Available hits remain visible; no matches does not prove there are none.', {
            types: failedTypes.map(type => searchSectionLabel(type, t)).join(', '),
          })}
        </Text>
      )}
      {limited && (
        <Text variant="bodySm">
          {t('search.completeness.limited', 'A search result limit was reached. Additional matches may exist; counts describe only returned hits.')}
        </Text>
      )}
    </AlertBanner>
  )
}
