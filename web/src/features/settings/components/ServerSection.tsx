/**
 * Server connection section (Settings → Server).
 *
 * Shows which TeslaSync server this app talks to: the browser default
 * (same-origin) or a picked remote server (generic native shells, or a
 * browser pointed elsewhere via /connect). Changing server opens the
 * picker; disconnecting forgets the saved server and token. Both
 * reload the app so every query and stream reboots onto the new
 * origin.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icons } from '@/lib/icons'
import { Button, ErrorText, GlassPanel, HelperText, Text } from '@/components/ui'
import { clearServerConnection, getServerBaseUrl, isRemoteMode } from '@/lib/serverConnection'

export function ServerSection() {
  const { t } = useTranslation()
  const [disconnectError, setDisconnectError] = useState(false)
  const remote = isRemoteMode()
  const current = remote
    ? getServerBaseUrl()
    : t('serverConnect.settings.sameOrigin', 'This server (browser default)')

  const ServerIcon = Icons.server

  const handleChange = () => {
    window.location.href = '/connect'
  }

  const handleDisconnect = () => {
    try {
      clearServerConnection()
      window.location.href = '/'
    } catch {
      setDisconnectError(true)
    }
  }

  return (
    <GlassPanel className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <ServerIcon className="h-5 w-5" aria-hidden="true" />
        <div>
          <Text as="p" variant="caption">
            {t('serverConnect.settings.current', 'Connected to')}
          </Text>
          <Text as="p" variant="body" className="font-medium [overflow-wrap:anywhere]">
            {current}
          </Text>
        </div>
      </div>
      <HelperText>{t('serverConnect.settings.saveHint', 'Changing server reloads the app.')}</HelperText>
      {disconnectError && (
        <ErrorText role="alert">
          {t('serverConnect.settings.disconnectError', 'Could not forget this server. Check whether browser storage is enabled.')}
        </ErrorText>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={handleChange}>
          {t('serverConnect.settings.change', 'Change server')}
        </Button>
        {remote && (
          <Button variant="danger" size="sm" onClick={handleDisconnect} title={t('serverConnect.settings.disconnectHint', 'Forget this server and go back to the browser default.')}>
            {t('serverConnect.settings.disconnect', 'Disconnect')}
          </Button>
        )}
      </div>
    </GlassPanel>
  )
}
