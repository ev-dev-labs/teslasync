import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Badge, Heading, Text, type BadgeProps } from '@/components/ui'
import { type NeonColor, neonColorMap, typography } from '@/lib/tokens'

export interface SafetySettingCardProps {
  /**
   * The setting's i18n title key. Used verbatim to build the deterministic
   * `safety-settings-row-<key>` / `safety-settings-value-<key>` test IDs that
   * the AI-OFF static-help contract asserts against — do NOT reshape it.
   */
  testKey: string
  /** Decorative leading icon (paired with the visible title + status text). */
  icon: ReactNode
  /** Toned icon accent — purely decorative, never the sole status signal. */
  accent?: NeonColor
  /** Human-readable setting name (already translated by the caller). */
  title: string
  /** Current value on this install (already translated by the caller). */
  value: string
  /** Status colour for the value chip. Text always accompanies the colour. */
  valueVariant?: BadgeProps['variant']
  /** Plain-English explanation of what the setting does. */
  description: string
  /** Canonical documentation link for the setting. */
  docsHref: string
  /** Visible label for the docs link. */
  docsLabel: string
  /** Accessible name for the docs link (includes the setting name for context). */
  docsAriaLabel: string
}

/**
 * SafetySettingCard renders one safety-related setting as a self-contained
 * bento tile: an accent icon, the setting name (h3), a status chip showing the
 * current value, a plain-English description, and a docs deep-link. It is a
 * list item (`<li>`) so the listing composes it inside a semantic `<ul>`.
 */
export function SafetySettingCard({
  testKey,
  icon,
  accent = 'cyan',
  title,
  value,
  valueVariant = 'info',
  description,
  docsHref,
  docsLabel,
  docsAriaLabel,
}: SafetySettingCardProps) {
  // Fall back to the cyan accent when an out-of-range value slips past the
  // type system (e.g. from untyped/dynamic row config) so the tile degrades to
  // a valid style instead of crashing on `c.bg`/`c.ring`/`c.text`.
  const c = neonColorMap[accent] ?? neonColorMap.cyan
  return (
    <li
      data-testid={`safety-settings-row-${testKey}`}
      className="flex h-full flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.08]"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1',
            c.bg,
            c.ring,
            c.text,
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
          <Heading level="panel" className="min-w-0 break-words">
            {title}
          </Heading>
          <Badge
            variant={valueVariant}
            size="sm"
            data-testid={`safety-settings-value-${testKey}`}
          >
            {value || '—'}
          </Badge>
        </div>
      </div>

      <Text variant="bodySm" as="p" className="flex-1">
        {description}
      </Text>

      <a
        href={docsHref}
        target="_blank"
        rel="noreferrer"
        aria-label={docsAriaLabel}
        className={cn(
          'inline-flex items-center gap-1 self-start rounded hover:underline',
          typography.size.xs,
          typography.weight.medium,
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40',
          c.text,
        )}
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        {docsLabel}
      </a>
    </li>
  )
}
