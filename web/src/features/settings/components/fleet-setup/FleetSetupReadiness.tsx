/**
 * Domain / CA readiness — partner public key + TLS explanation.
 * Always visible. Advanced Fleet API tools stay on Developer Tools.
 */
import { useId } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Globe, Hammer } from 'lucide-react'
import {
  Accordion,
  Badge,
  BUTTON_BASE,
  BUTTON_VARIANTS,
  GlassPanel,
  HelperText,
  IconBox,
  PanelTitle,
  Text,
} from '@/components/ui'
import { KVList } from '@/components/data-display'
import { SourceContent, type SourceState } from '@/components/layout'
import { cn } from '@/lib/cn'
import type { PublicKeyStatus } from '@/api/hooks/useFleetSetup'

interface FleetSetupReadinessProps {
  publicKey: PublicKeyStatus | undefined
  state?: SourceState
  error?: unknown
  onRetry?: () => void
}

export function FleetSetupReadiness({ publicKey, state = 'ready', error, onRetry }: FleetSetupReadinessProps) {
  const { t } = useTranslation('settings')
  const titleId = useId()
  const configured = publicKey?.configured === true
  const dash = t('common.dash', '—')

  return (
    <GlassPanel className="h-full space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="purple">
          <Globe className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div>
          <PanelTitle id={titleId}>{t('fleetSetup.readiness.title', 'Domain & certificates')}</PanelTitle>
          <HelperText>
            {t(
              'fleetSetup.readiness.subtitle',
              'Tesla verifies your telemetry host with TLS, and your partner key at a well-known URL.',
            )}
          </HelperText>
        </div>
      </div>

      <SourceContent
        state={state}
        label={t('fleetSetup.readiness.title', 'Domain & certificates')}
        emptyMessage={t('fleetSetup.readiness.unavailable', 'Partner public-key status unavailable.')}
        errorMessage={t('fleetSetup.readiness.unavailable', 'Partner public-key status unavailable.')}
        error={error}
        errorRecovery={{ onRetry }}
      >
      <div className="flex flex-wrap items-center gap-2">
        {configured ? (
          <Badge variant="success" size="sm" dot>
            {t('fleetSetup.readiness.keyOn', 'Public key stored')}
          </Badge>
        ) : (
          <Badge variant="warning" size="sm" dot>
            {t('fleetSetup.readiness.keyOff', 'Public key not stored')}
          </Badge>
        )}
      </div>
      </SourceContent>

      <KVList
        items={[
          {
            label: t('fleetSetup.readiness.wellKnown', 'Well-known path'),
            value:
              publicKey?.well_known_path ||
              '/.well-known/appspecific/com.tesla.3p.public-key.pem',
          },
          {
            label: t('fleetSetup.readiness.fingerprint', 'Fingerprint'),
            value: publicKey?.fingerprint || dash,
          },
          {
            label: t('fleetSetup.readiness.ca', 'Default telemetry CA'),
            value: t('fleetSetup.readiness.caValue', 'Let’s encrypt ISRG root X1'),
          },
        ]}
      />

      <Text variant="bodySm" as="p">
        {t(
          'fleetSetup.readiness.body',
          'Subscribe leaves hostname and CA empty on purpose: TeslaSync sends FLEET_TELEMETRY_HOST (port 4443) and the Let’s Encrypt root. Override those only if your telemetry endpoint uses a different certificate.',
        )}
      </Text>

      <Accordion title={t('fleetSetup.readiness.advancedTitle', 'Partner key vs virtual key')}>
        <Text variant="bodySm" as="p">
          {t(
            'fleetSetup.readiness.advancedBody',
            'The well-known PEM is for Tesla partner registration and virtual-key pairing. Telemetry streaming does not wait on a phone key pair. Pairing is only required if you want TeslaSync to send vehicle commands.',
          )}
        </Text>
      </Accordion>

      <Link
        to="/dev-tools?tab=fleet-api"
        className={cn(BUTTON_BASE, BUTTON_VARIANTS.secondary, 'h-auto min-h-11 max-w-full whitespace-normal break-words px-4 py-2')}
      >
        <Hammer className="h-4 w-4" aria-hidden="true" />
        {t('fleetSetup.readiness.openDevTools', 'Open Fleet API tools')}
      </Link>
    </GlassPanel>
  )
}

export default FleetSetupReadiness
