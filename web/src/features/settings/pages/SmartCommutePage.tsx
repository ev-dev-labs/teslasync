import { useTranslation } from 'react-i18next'
import { PageLayout } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { PersonalDeliverySettings } from '../components/personal-delivery/PersonalDeliverySettings'
import { SmartCommuteSettings } from '../components/smart-commute/SmartCommuteSettings'

export default function SmartCommutePage() {
  const { t } = useTranslation()
  const title = t('smartCommute.title', 'Smart Commute')
  usePageTitle(title)

  return (
    <PageLayout title={title} subtitle={t('smartCommute.pageSubtitle', 'Recurring drives and local analysis')} copyLink>
      <FadeIn>
        <div className="space-y-5">
          <SmartCommuteSettings active />
          <PersonalDeliverySettings active family="commute" />
        </div>
      </FadeIn>
    </PageLayout>
  )
}
