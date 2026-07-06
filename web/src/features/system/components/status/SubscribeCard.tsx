/**
 * SubscribeCard — alert-channel discoverability on /system-status.
 *
 * Self-hosted operators already configure email / Slack / Discord /
 * webhook channels via /notifications/channels, and browser push via
 * the dedicated Browser Notifications surface (/notifications/browser).
 * This card is just a discoverability tile linking to those — it
 * deliberately doesn't reimplement subscription management.
 *
 * The aim is simple: when the operator lands on /system-status and
 * thinks "how do I get notified about this", there's a one-click route
 * to all the channel setups in one place.
 */

import { useId } from 'react'
import { Bell, MessageSquare, Hash, Webhook, Mail, Smartphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { GlassPanel } from '@/components/ui'

interface ChannelTileProps {
  to: string
  icon: typeof Bell
  label: string
  description: string
}

const CHANNELS: readonly ChannelTileProps[] = [
  { to: '/notifications/channels', icon: Mail, label: 'Email', description: 'SMTP-based delivery' },
  { to: '/notifications/channels', icon: MessageSquare, label: 'Slack', description: 'Webhook channel' },
  { to: '/notifications/channels', icon: Hash, label: 'Discord', description: 'Webhook channel' },
  { to: '/notifications/channels', icon: Webhook, label: 'Webhook', description: 'Custom HTTP endpoint' },
  // Browser push has its own surface at /notifications/browser. This tile
  // previously pointed at /settings/notifications, which is not a registered
  // route and fell through to the 404 catch-all in App.tsx.
  { to: '/notifications/browser', icon: Smartphone, label: 'Browser push', description: 'Opt-in PWA notifications' },
]

function ChannelTile({ to, icon: Icon, label, description }: ChannelTileProps) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
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
  const headingId = useId()
  return (
    <GlassPanel
      className="p-3"
      role="group"
      aria-labelledby={headingId}
      data-testid="subscribe-card"
    >
      <h3
        id={headingId}
        className="px-2 pb-2 text-sm font-semibold text-[var(--text-primary)] inline-flex items-center gap-2"
      >
        <Bell className="h-4 w-4" aria-hidden />
        Get notified about incidents
      </h3>
      <p className="px-2 pb-3 text-xs text-[var(--text-muted)]">
        Self-hosted: configure your own channels for status events.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CHANNELS.map((channel) => (
          <ChannelTile key={channel.label} {...channel} />
        ))}
      </div>
    </GlassPanel>
  )
}
