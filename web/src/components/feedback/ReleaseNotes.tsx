import { useState } from 'react'
import { GlassPanel } from '../ui/GlassPanel'
import { Gift, ChevronDown, ChevronUp } from 'lucide-react'

interface Release {
  version: string
  date: string
  badge: 'latest' | 'stable' | 'beta'
  highlights: string[]
}

const releases: Release[] = [
  {
    version: '2.10.0',
    date: '2024-12-15',
    badge: 'latest',
    highlights: [
      'Prometheus metrics and request tracing',
      'Startup readiness probe with delay',
      'Carbon offset tracker',
      'Trip planner with battery estimation',
      'Onboarding wizard for new users',
      'Favorite vehicles feature',
    ],
  },
  {
    version: '2.9.0',
    date: '2024-11-20',
    badge: 'stable',
    highlights: [
      'API key management',
      'Audit logging',
      'Tire pressure monitoring',
      'Vampire drain analysis',
    ],
  },
  {
    version: '2.8.0',
    date: '2024-10-10',
    badge: 'stable',
    highlights: [
      'Real-time SSE event stream',
      'Chatbot assistant',
      'Software update tracking',
      'Notification channels',
    ],
  },
]

const badgeStyles: Record<string, { bg: string; text: string; border: string }> = {
  latest: { bg: 'rgba(0, 240, 255, 0.1)', text: '#00f0ff', border: 'rgba(0, 240, 255, 0.3)' },
  stable: { bg: 'rgba(16, 185, 129, 0.1)', text: '#10b981', border: 'rgba(16, 185, 129, 0.3)' },
  beta: { bg: 'rgba(245, 158, 11, 0.1)', text: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' },
}

export default function ReleaseNotes() {
  const [expanded, setExpanded] = useState<string | null>(releases[0]?.version ?? null)

  return (
    <div className="space-y-3">
      {releases.map((release) => {
        const isExpanded = expanded === release.version
        const badge = badgeStyles[release.badge]
        return (
          <GlassPanel key={release.version} className="overflow-hidden">
            <button
              onClick={() => setExpanded(isExpanded ? null : release.version)}
              className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-white/[0.02]"
            >
              <div className="flex items-center gap-3">
                <Gift className="h-4 w-4" style={{ color: badge.text }} />
                <span className="text-sm font-semibold text-white/90">
                  v{release.version}
                </span>
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: badge.bg, color: badge.text, border: `1px solid ${badge.border}` }}
                >
                  {release.badge}
                </span>
                <span className="text-xs text-[var(--text-muted)]">{release.date}</span>
              </div>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
              ) : (
                <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
              )}
            </button>
            {isExpanded && (
              <div className="border-t border-white/[0.06] px-4 pb-4 pt-3">
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                  What&apos;s New
                </p>
                <ul className="space-y-1.5">
                  {release.highlights.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: badge.text }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </GlassPanel>
        )
      })}
    </div>
  )
}
