import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { EmptyState } from '@/components/feedback'

/**
 * Full-width placeholder shown when the backend reports AUTH_MODE_OPEN — the
 * install runs without a forward-auth header, so per-device sessions can't be
 * tracked. Mirrors the inline placeholder other security primitives render
 * until the `<RequiresAuth capability="session_list">` wrapper ships.
 */
export function SessionsOpenModeNotice() {
  const { t } = useTranslation('settings')

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="active-sessions-open-mode">
      <EmptyState
        icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
        title={t('account.sessions.openMode.title', 'Session tracking unavailable')}
        message={t(
          'account.sessions.openMode.message',
          'Active session tracking requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User, then reload.',
        )}
      />
    </GlassPanel>
  )
}

export default SessionsOpenModeNotice
