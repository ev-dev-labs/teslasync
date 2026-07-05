/**
 * Hero status panel — the primary surface of the two-factor page.
 *
 * Pure presentation: it reflects the current credential state and
 * forwards user intent (enroll / regenerate / disable) to callbacks
 * owned by `useTotpEnrollmentFlow`. Preserves the original
 * `data-testid` hooks so the section contract test is unaffected.
 */
import { useTranslation } from 'react-i18next'
import { ShieldCheck, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { GlassPanel, IconBox, Button, Badge, Heading, Text, HelperText } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'

interface TotpStatusHeroProps {
  activated: boolean
  lastUsedAt?: string
  backupRemaining: number
  enrolling: boolean
  regenerating: boolean
  onEnroll: () => void
  onRegenerate: () => void
  onDisable: () => void
}

export function TotpStatusHero({
  activated,
  lastUsedAt,
  backupRemaining,
  enrolling,
  regenerating,
  onEnroll,
  onRegenerate,
  onDisable,
}: TotpStatusHeroProps) {
  const { t } = useTranslation('settings')
  const { formatDateTime } = useDateFormat()

  // Null-safe, range-sane count: a missing or negative value from an upstream
  // data bug must never surface a blank or nonsensical "-1" cell.
  const safeBackupRemaining = Math.max(0, backupRemaining ?? 0)
  // A blank/whitespace timestamp is treated as "never used" rather than being
  // formatted into an "Invalid Date" string.
  const hasLastUsed = typeof lastUsedAt === 'string' && lastUsedAt.trim().length > 0

  return (
    <GlassPanel className="h-full space-y-5 p-4 sm:p-5" data-testid="totp-section">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <IconBox color={activated ? 'green' : 'cyan'}>
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </IconBox>
          <div>
            <Heading level="panel">{t('totp.title', 'Two-factor authentication')}</Heading>
            <HelperText>
              {t(
                'totp.subtitle',
                'TOTP codes from your authenticator app are required for the sudo step-up before destructive admin actions.',
              )}
            </HelperText>
          </div>
        </div>
        <Badge variant={activated ? 'success' : 'neutral'} data-testid="totp-status-pill">
          {activated
            ? t('totp.status.active', 'Active')
            : t('totp.status.notEnrolled', 'Not enrolled')}
        </Badge>
      </div>

      {activated ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-0.5">
              <Text variant="label">{t('totp.lastUsed.label', 'Last used')}</Text>
              <Text variant="bodySm" as="p">
                {hasLastUsed ? formatDateTime(lastUsedAt) : t('totp.lastUsed.never', 'Never')}
              </Text>
            </div>
            <div className="space-y-0.5">
              <Text variant="label">
                {t('totp.backupCodesRemaining.label', 'Backup codes remaining')}
              </Text>
              <Text variant="bodySm" as="p" data-testid="totp-backup-remaining">
                {safeBackupRemaining}
              </Text>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              onClick={onRegenerate}
              loading={regenerating}
              data-testid="totp-regenerate"
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('totp.actions.regenerate', 'Regenerate backup codes')}
            </Button>
            <Button variant="danger" onClick={onDisable} data-testid="totp-disable">
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('totp.actions.disable', 'Disable')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={onEnroll}
            loading={enrolling}
            data-testid="totp-enroll"
          >
            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('totp.actions.enroll', 'Enable TOTP')}
          </Button>
          <HelperText>
            {t(
              'totp.actions.enrollHint',
              'Compatible with Google Authenticator, 1Password, Bitwarden, Authy and other RFC 6238 clients.',
            )}
          </HelperText>
        </div>
      )}
    </GlassPanel>
  )
}

export default TotpStatusHero
