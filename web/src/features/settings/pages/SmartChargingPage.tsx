import { useTranslation } from 'react-i18next'
import { PageLayout } from '@/components/layout'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { PersonalDeliverySettings } from '../components/personal-delivery/PersonalDeliverySettings'
import { SmartChargingSettings } from '../components/smart-charging/SmartChargingSettings'

export default function SmartChargingPage() {
  const { t } = useTranslation()
  const title = t('smartCharging.title', 'Charging readiness')
  usePageTitle(title)

  return (
    <PageLayout title={title} subtitle={t('smartCharging.pageSubtitle', 'Trip plans and charging decisions')} copyLink>
      <FadeIn>
        <div className="space-y-5">
          <SmartChargingSettings active />
          <PersonalDeliverySettings active family="charging" />
        </div>
      </FadeIn>
    </PageLayout>
  )
}
