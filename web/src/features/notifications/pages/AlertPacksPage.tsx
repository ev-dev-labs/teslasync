import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { PageLayout } from '@/components/layout'
import { usePageTitle } from '@/hooks/usePageTitle'
import AlertPacksPanel from '../components/packs/AlertPacksPanel'

export default function AlertPacksPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const title = t('alertPacks.title', 'Alert packs')
  usePageTitle(title)

  return (
    <PageLayout
      title={title}
      subtitle={t('alertPacks.intro', 'Start with a goal, not a blank rule. Preview a curated group, choose your vehicles and install ordinary, independently editable rules.')}
    >
      <AlertPacksPanel onEditRule={id => navigate(`/notifications/rules?rule=${id}`)} />
    </PageLayout>
  )
}
