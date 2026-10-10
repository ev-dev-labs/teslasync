/**
 * TeslaAuthCard — dedicated card for Tesla auth status.
 *
 * Promotes Tesla auth from a single Health row to a fuller card with
 * a token-expiry countdown and a primary "Re-authenticate" CTA. The
 * card is always rendered (operator-grade visibility) — the styling
 * intensifies as the situation worsens (healthy → amber when
 * expiring within 7 days → red when expired).
 *
 * Note: the backend's /auth/status does not yet expose
 * last_success_at, so we deliberately don't promise that timestamp
 * here. If the field is added later we can surface it.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, ShieldAlert, ShieldX, ExternalLink } from 'lucide-react'
import { GlassPanel, Badge, PanelTitle, Text } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

interface TeslaAuthCardProps {
  /** Whether the auth check itself is currently authenticated. */
  authenticated: boolean | undefined
  /** ISO string for token expiry, if known. */
  expiresAt: string | undefined
  /** "now" Date.now() — passed in so the page-level tick re-renders the card. */
  now: number
}

type Severity = 'ok' | 'warn' | 'expired' | 'disconnected' | 'unknown'

function severityFor(authenticated: boolean | undefined, expiresAt: string | undefined, now: number): Severity {
  if (authenticated === false) return 'disconnected'
  if (!expiresAt) return authenticated ? 'unknown' : 'unknown'
  const exp = Date.parse(expiresAt)
  if (!Number.isFinite(exp)) return 'unknown'
  const days = Math.floor((exp - now) / (24 * 60 * 60 * 1000))
  if (days < 0) return 'expired'
  if (days <= 7) return 'warn'
  return 'ok'
}

const TONE: Record<Severity, { bar: string; icon: string; Icon: typeof ShieldCheck; label: string; badge: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  ok:           { bar: 'bg-green-500/40',  icon: 'text-green-400',  Icon: ShieldCheck, label: 'Connected',     badge: 'success' },
  warn:         { bar: 'bg-amber-500/50',  icon: 'text-amber-300',  Icon: ShieldAlert, label: 'Expires soon',  badge: 'warning' },
  expired:      { bar: 'bg-red-500/60',    icon: 'text-red-400',    Icon: ShieldX,     label: 'Token expired', badge: 'danger'  },
  disconnected: { bar: 'bg-red-500/60',    icon: 'text-red-400',    Icon: ShieldX,     label: 'Not connected', badge: 'danger'  },
  unknown:      { bar: 'bg-zinc-500/40',   icon: 'text-zinc-400',   Icon: ShieldAlert, label: 'Unknown',       badge: 'neutral' },
}

export function TeslaAuthCard({ authenticated, expiresAt, now }: TeslaAuthCardProps) {
  const { t } = useTranslation()
  const sev = useMemo(() => severityFor(authenticated, expiresAt, now), [authenticated, expiresAt, now])
  const tone = TONE[sev]
  const { Icon } = tone

  const detail = useMemo(() => {
    if (sev === 'disconnected') return t('systemStatus.authDetail.disconnected', 'No Tesla account is currently connected.')
    if (!expiresAt) return t('systemStatus.authDetail.expiryUnknown', 'Token expiry unknown — re-authenticate to refresh.')
    const exp = Date.parse(expiresAt)
    if (!Number.isFinite(exp)) return t('systemStatus.authDetail.expiryInvalid', 'Token expiry unparseable.')
    const ms = exp - now
    if (ms < 0) {
      const ago = Math.floor(-ms / (24 * 60 * 60 * 1000))
      return ago === 0
        ? t('systemStatus.authDetail.expiredToday', 'Expired today — re-authenticate to resume Fleet API calls.')
        : t('systemStatus.authDetail.expiredDays', 'Expired {{days}}d ago — re-authenticate to resume Fleet API calls.', { days: ago })
    }
    const days = Math.floor(ms / (24 * 60 * 60 * 1000))
    if (days === 0) return t('systemStatus.authDetail.expiresToday', 'Token expires later today.')
    if (days === 1) return t('systemStatus.authDetail.expiresTomorrow', 'Token expires in 1 day.')
    return t('systemStatus.authDetail.expiresDays', 'Token expires in {{days}} days.', { days })
  }, [sev, expiresAt, now, t])

  return (
    <GlassPanel className="overflow-hidden" aria-live="polite">
      <div className={`h-1 w-full ${tone.bar}`} aria-hidden />
      <div className="flex flex-wrap items-start gap-3 p-5">
        <div className={`shrink-0 ${tone.icon}`}>
          <Icon className="h-6 w-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex items-center gap-2 flex-wrap">
            <PanelTitle>{t('systemStatus.pipeline.teslaAccount', 'Tesla account')}</PanelTitle>
            <Badge variant={tone.badge}>{t(`systemStatus.authLabels.${sev}`, tone.label)}</Badge>
          </div>
          <Text as="p" variant="bodySm" className="mt-1">{detail}</Text>
        </div>
        <div className="min-w-0 max-w-full">
          <Link
            to="/tesla-account"
            className={cn('inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-1.5 text-cyan-300 ring-1 ring-cyan-400/30 hover:bg-cyan-500/20', typography.size.xs, typography.weight.medium)}
          >
            {sev === 'expired' || sev === 'disconnected'
              ? t('systemStatus.reauthenticate', 'Re-authenticate')
              : t('systemStatus.manage', 'Manage')}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Link>
        </div>
      </div>
    </GlassPanel>
  )
}
