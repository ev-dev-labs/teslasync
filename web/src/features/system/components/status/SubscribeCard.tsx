/**
 * SubscribeCard — Phase-2 alert-channel discoverability on /system-status.
 *
 * Self-hosted operators already configure email / Slack / Discord /
 * webhook channels via /notifications/channels, and browser push via
 * the existing "Enable browser notifications" surface in Settings.
 * This card is just a discoverability tile linking to those — it
 * deliberately doesn't reimplement subscription management.
 *
 * The aim is simple: when the operator lands on /system-status and
 * thinks "how do I get notified about this", there's a one-click route
 * to all the channel setups in one place.
 */

import { Bell, MessageSquare, Hash, Webhook, Mail, Smartphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { GlassPanel } from '@/components/ui'

interface ChannelTileProps {
  to: string
  icon: typeof Bell
  label: string
  description: string
}

function ChannelTile({ to, icon: Icon, label, description }: ChannelTileProps) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-cyan-300" aria-hidden />
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)]">{label}</div>
        <div className="text-xs text-[var(--text-muted)]">{description}</div>
      </div>
    </Link>
  )
}

export function SubscribeCard() {
  return (
    <GlassPanel className="p-3">
      <h3 className="px-2 pb-2 text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
        <Bell className="h-4 w-4" />
        Get notified about incidents
      </h3>
      <p className="px-2 pb-3 text-xs text-[var(--text-muted)]">
        Self-hosted: configure your own channels for status events.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ChannelTile to="/notifications/channels" icon={Mail}        label="Email"      description="SMTP-based delivery" />
        <ChannelTile to="/notifications/channels" icon={MessageSquare} label="Slack"     description="Webhook channel" />
        <ChannelTile to="/notifications/channels" icon={Hash}         label="Discord"    description="Webhook channel" />
        <ChannelTile to="/notifications/channels" icon={Webhook}      label="Webhook"    description="Custom HTTP endpoint" />
        <ChannelTile to="/settings/notifications" icon={Smartphone}   label="Browser push" description="Opt-in PWA notifications" />
      </div>
    </GlassPanel>
  )
}
