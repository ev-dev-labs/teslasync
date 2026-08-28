import { useTranslation } from 'react-i18next'
import { ExternalLink, Activity, BookOpen, Settings2, Stethoscope } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Text } from '@/components/ui/Typography'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { classifyError, type ErrorKind } from '@/lib/errorClassification'
import { helpLinksForError, type ErrorHelpLink, type HelpLinkKind } from '@/lib/errorHelpLinks'
import { MaybeLink } from './_MaybeLink'

/**
 * Turns a failure into somewhere to go (HELP-05).
 *
 * Renders the ranked destinations for a classified error — status, config,
 * diagnostics, runbook — each with the reason it is relevant, so the user
 * chooses instead of guessing. Runbook links are absolute repository URLs and
 * are only emitted when a docs base URL is configured, so this component never
 * renders a link it knows is dead.
 */
export interface ErrorHelpLinksProps {
  /** The error to classify. Ignored when `kind` is supplied. */
  error?: unknown
  /** Pre-classified kind, for callers that already ran the classifier. */
  kind?: ErrorKind
  className?: string
  /** Section heading. Pass `null` to render the list bare. */
  title?: string | null
}

const KIND_ICON: Record<HelpLinkKind, typeof Activity> = {
  status: Activity,
  config: Settings2,
  diagnostics: Stethoscope,
  runbook: BookOpen,
}

function LinkRow({ link }: { link: ErrorHelpLink }) {
  const { t } = useTranslation()
  const Icon = KIND_ICON[link.kind]
  const label = t(link.labelKey, link.labelFallback)
  const reason = t(link.reasonKey, link.reasonFallback)

  const body = (
    <>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--theme-primary)]" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-medium text-[var(--text-primary)]">
          {label}
          {link.href && <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />}
        </span>
        <Text as="span" variant="bodySm" color="muted" className="block">
          {reason}
        </Text>
      </span>
    </>
  )

  const rowClass =
    'flex items-start gap-2.5 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] p-2.5 text-left transition-colors hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]'

  if (link.href) {
    return (
      <li>
        <a
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={rowClass}
          data-error-help-link={link.id}
        >
          {body}
        </a>
      </li>
    )
  }

  return (
    <li>
      <MaybeLink to={link.to ?? '/'} className={rowClass} data-error-help-link={link.id}>
        {body}
      </MaybeLink>
    </li>
  )
}

export function ErrorHelpLinks({ error, kind, className, title }: ErrorHelpLinksProps) {
  const { t } = useTranslation()
  const online = useOnlineStatus()
  const resolvedKind = kind ?? (error != null ? classifyError(error, online) : null)
  const links = resolvedKind ? helpLinksForError(resolvedKind) : []

  if (links.length === 0) return null

  return (
    <div className={cn('space-y-2', className)} data-testid="error-help-links">
      {title !== null && (
        <Text as="p" variant="caption">
          {title ?? t('errorHelp.title', 'Where to look next')}
        </Text>
      )}
      <ul className="space-y-1.5">
        {links.map((link) => (
          <LinkRow key={link.id} link={link} />
        ))}
      </ul>
    </div>
  )
}
