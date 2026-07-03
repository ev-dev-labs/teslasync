import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ScrollText,
  ClipboardList,
  Timer,
  KeyRound,
  ShieldCheck,
  LogOut,
} from 'lucide-react'

import { GlassPanel, PanelTitle, Text } from '@/components/ui'

interface PolicyItem {
  icon: ReactNode
  title: string
  body: string
}

/**
 * Full-width "how impersonation works" reading band. The panel spans the
 * page width; only the inner prose column is constrained (`max-w-3xl`) for
 * legibility. Each guarantee restates a real constraint enforced by the
 * backend impersonation handler (audit log, 15-minute TTL, sudo step-up,
 * forward-auth requirement) so admins understand the blast radius.
 */
export function ImpersonationPolicyPanel() {
  const { t } = useTranslation()

  const items: PolicyItem[] = [
    {
      icon: <ClipboardList />,
      title: t('impersonation.policy.audit.title', 'Every session is audit-logged'),
      body: t(
        'impersonation.policy.audit.body',
        'Starting and ending a session writes an immutable entry to the admin audit log with the actor and the target.',
      ),
    },
    {
      icon: <Timer />,
      title: t('impersonation.policy.ttl.title', '15-minute time limit'),
      body: t(
        'impersonation.policy.ttl.body',
        'A session expires automatically after 15 minutes so a forgotten session cannot linger.',
      ),
    },
    {
      icon: <KeyRound />,
      title: t('impersonation.policy.sudo.title', 'Step-up auth to start'),
      body: t(
        'impersonation.policy.sudo.body',
        'Starting a session requires a fresh re-authentication prompt; ending one never does.',
      ),
    },
    {
      icon: <ShieldCheck />,
      title: t('impersonation.policy.forwardAuth.title', 'Forward-auth required'),
      body: t(
        'impersonation.policy.forwardAuth.body',
        'Per-subject identity only exists when the proxy runs in forward-auth mode. Open-mode installs cannot impersonate.',
      ),
    },
    {
      icon: <LogOut />,
      title: t('impersonation.policy.exit.title', 'End it any time'),
      body: t(
        'impersonation.policy.exit.body',
        'The global banner at the top of the screen ends the active session immediately and restores your own view.',
      ),
    },
  ]

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('impersonation.policy.title', 'How impersonation works')}
      </PanelTitle>

      <div className="max-w-3xl">
        <Text as="p" variant="bodySm" className="mb-4">
          {t(
            'impersonation.policy.intro',
            'Impersonation lets an admin view TeslaSync exactly as another subject to reproduce a support issue. It is deliberately constrained:',
          )}
        </Text>

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.title}
              className="flex gap-3 rounded-lg bg-white/[0.02] p-3 ring-1 ring-white/[0.04]"
            >
              <span
                className="mt-0.5 shrink-0 text-cyan-300 [&>svg]:h-4 [&>svg]:w-4"
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <div className="min-w-0">
                <Text as="p" variant="bodySm" className="font-medium text-[var(--text-primary)]">
                  {item.title}
                </Text>
                <Text as="p" variant="caption" className="mt-0.5">
                  {item.body}
                </Text>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  )
}
