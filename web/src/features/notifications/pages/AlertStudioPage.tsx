import { Navigate, useSearchParams } from 'react-router-dom'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from 'react-i18next'
import { AlertRuleEditor } from '../components/AlertRuleEditor'

/** Studio only creates rules; existing-rule links belong on the Rules page. */
export default function AlertStudioPage() {
  const { t } = useTranslation()
  usePageTitle(t('notifications.alertStudio.title', 'Alert Studio'))
  const [searchParams] = useSearchParams()
  const requestedRuleId = searchParams.get('rule')
  if (requestedRuleId) {
    const id = Number(requestedRuleId)
    return <Navigate to={Number.isSafeInteger(id) && id > 0
      ? `/notifications/rules?rule=${id}` : '/notifications/rules'} replace />
  }
  return <AlertRuleEditor rule={null} />
}
