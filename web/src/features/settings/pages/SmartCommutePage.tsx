import { useTranslation } from 'react-i18next'
import { PageLayout } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { SmartCommuteSettings } from '../components/smart-commute/SmartCommuteSettings'

export default function SmartCommutePage() {
  const { t } = useTranslation()
  const title = t('smartCommute.title', 'Smart Commute')
  usePageTitle(title)

  return (
    <PageLayout title={title} subtitle={t('smartCommute.pageSubtitle', 'Recurring drives and local analysis')} copyLink>
      <FadeIn>
        <SmartCommuteSettings active />
      </FadeIn>
    </PageLayout>
  )
}
