/**
 * UsageCard — shared visual primitive for "spend / volume" cards.
 * AI call log usage card.
 * Two consumers share this primitive:
 *   - TeslaApiUsageCard (existing, refactored to feed this primitive).
 *   - AiUsageCard       (new, for the AI provider audit log).
 * The DRY win: both cards have the same skeleton — optional budget
 * bar, three at-a-glance bands, a key/value detail grid, optional
 * top-list breakdowns, optional banner, optional footer links. By
 * separating that skeleton from each consumer's data derivation, we
 * keep the visual contract in one file and let the consumers focus
 * on "what numbers do I have" rather than "how do I render them".
 * Pure presentational: no API calls or domain-derived state.
 * Numeric preferences format the budget's accessible percentage summary.
 * Every dynamic value comes in via props so the card stays trivially
 * testable + Storybook-friendly without mounting a query client.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui/Button'
import { typography } from '@/lib/tokens'

/** Visual intent driving accent colour for bars / banners / values. */
export type UsageCardIntent = 'normal' | 'warn' | 'danger'

/**
 * One at-a-glance band rendered in the 3-column grid below the budget
 * bar. Icon is rendered to the left of the label; value is the large
 * tabular-numeric headline; sub is the small grey subtitle line.
 */
export interface UsageCardBand {
  icon?: ReactNode
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  /** Adds a coloured ring + tinted background. Default 'normal'. */
  intent?: UsageCardIntent
}

/**
 * One key/value cell rendered in the 4-column detail grid below the
 * bands. Used for "useful requests / skipped polls / avg latency /
 * error rate"-style tabular pairs.
 */
export interface UsageCardDetail {
  label: ReactNode
  value: ReactNode
  /** Colours the value text — e.g. red for high error rates. */
  intent?: UsageCardIntent
}

/**
 * One row in a top-list breakdown. label is the left-aligned name
 * (rendered in a monospace font and wrapped in narrow cards), value is the count.
 */
export interface UsageCardTopListItem {
  key: string
  label: ReactNode
  value: ReactNode
}

/**
 * One top-list block rendered in the 2-column block grid below the
 * detail grid. Each block has its own header + list.
 */
export interface UsageCardTopList {
  key: string
  icon?: ReactNode
  title: ReactNode
  items: UsageCardTopListItem[]
}

/**
 * Optional budget progress bar. The card hides this section entirely
 * if budget is undefined, so consumers without a "spend cap" concept
 * (e.g. self-hosted Ollama) skip the bar without a CSS workaround.
 */
export interface UsageCardBudget {
  /** Pre-formatted "spent of total" headline, e.g. "$0.42 of $5.00". */
  headline: ReactNode
  /** Right-side caption, e.g. "8% of monthly credit". */
  rightLabel?: ReactNode
  /** Caption under the bar, e.g. "Day 5 of 30 · resets in 25 days". */
  caption?: ReactNode
  /** Finite values retain accessible overflow; visual width clamps to 0..100. */
  pct: number
  /** Visual intent — drives bar colour. */
  intent?: UsageCardIntent
  /** Required for screen readers — short label naming the budget. */
  ariaLabel: string
}

/**
 * Optional callout banner rendered after the top-lists, before the
 * footer. Used for "over monthly credit" warnings + similar
 * status messages. Defaults to danger intent (red) since most call-
 * outs in this card are warnings rather than informational.
 */
export interface UsageCardBanner {
  title: ReactNode
  description: ReactNode
  intent?: UsageCardIntent
  /** Optional trailing icon override; defaults to AlertTriangle. */
  icon?: ReactNode
}

/**
 * One footer link. internal links use react-router; external links
 * render an anchor tag with the trailing icon.
 */
export interface UsageCardFooterLink {
  key: string
  to: string
  label: ReactNode
  /** Renders as the primary (filled) variant; default secondary. */
  primary?: boolean
  /** Renders as <a target="_blank">; default Link from react-router. */
  external?: boolean
}

export interface UsageCardProps {
  budget?: UsageCardBudget
  bands?: UsageCardBand[]
  details?: UsageCardDetail[]
  topLists?: UsageCardTopList[]
  banner?: UsageCardBanner
  footer?: UsageCardFooterLink[]
  /** Rendered when nothing else is — keeps the panel from being blank. */
  emptyMessage?: ReactNode
  /** Optional className passthrough for the root container. */
  className?: string
}

// ----------------------------------------------------------------------------
// Visual helpers
// ----------------------------------------------------------------------------

const intentBarBg: Record<UsageCardIntent, string> = {
  normal: 'bg-[var(--semantic-info)]',
  warn: 'bg-[var(--semantic-warning)]',
  danger: 'bg-[var(--semantic-danger)]',
}

const intentBandRing: Record<UsageCardIntent, string> = {
  normal: 'bg-[var(--surface-2)]',
  warn: 'bg-[var(--semantic-warning-bg)] border border-[var(--semantic-warning-border)]',
  danger: 'bg-[var(--semantic-danger-bg)] border border-[var(--semantic-danger-border)]',
}

const intentValueText: Record<UsageCardIntent, string> = {
  normal: typography.color.primary,
  warn: 'text-[var(--semantic-warning)]',
  danger: 'text-[var(--semantic-danger)]',
}

const intentBannerBg: Record<UsageCardIntent, string> = {
  normal: 'bg-[var(--semantic-info-bg)] border border-[var(--semantic-info-border)]',
  warn: 'bg-[var(--semantic-warning-bg)] border border-[var(--semantic-warning-border)]',
  danger: 'bg-[var(--semantic-danger-bg)] border border-[var(--semantic-danger-border)]',
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export function UsageCard(props: UsageCardProps) {
  const {
    budget,
    bands,
    details,
    topLists,
    banner,
    footer,
    emptyMessage,
    className,
  } = props

  const hasAnything =
    !!budget ||
    (bands && bands.length > 0) ||
    (details && details.length > 0) ||
    (topLists && topLists.length > 0) ||
    !!banner ||
    (footer && footer.length > 0)

  if (!hasAnything) {
    return (
      <p className={typography.role.bodySm}>
        {emptyMessage ?? 'No data to display yet.'}
      </p>
    )
  }

  return (
    <div className={'min-w-0 space-y-4 break-words ' + (className ?? '')}>
      {budget ? <BudgetSection budget={budget} /> : null}

      {bands && bands.length > 0 ? <BandsSection bands={bands} /> : null}

      {details && details.length > 0 ? <DetailsSection details={details} /> : null}

      {topLists && topLists.length > 0 ? <TopListsSection topLists={topLists} /> : null}

      {banner ? <BannerSection banner={banner} /> : null}

      {footer && footer.length > 0 ? <FooterSection links={footer} /> : null}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Sections (kept private — UsageCard is the public contract)
// ----------------------------------------------------------------------------

function BudgetSection({ budget }: { budget: UsageCardBudget }) {
  const { fmtPercent } = useNumberFormatting()
  const intent = budget.intent ?? 'normal'
  const barColor = intentBarBg[intent]
  // Preserve the unclamped pct in aria-valuenow so screen readers
  // announce "over budget" overflow accurately. The visual width
  // clamps to 100% so the bar doesn't overflow its container.
  const finite = Number.isFinite(budget.pct)
  const widthPct = finite ? Math.max(0, Math.min(100, budget.pct)) : undefined
  const ariaPct = finite ? Math.max(0, Math.round(budget.pct)) : undefined
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <span className={typography.role.body}>{budget.headline}</span>
        {budget.rightLabel != null ? (
          <span
            className={
              intent === 'danger'
                ? typography.role.caption + ' ' + intentValueText.danger + ' tabular-nums'
                : typography.role.caption + ' tabular-nums'
            }
          >
            {budget.rightLabel}
          </span>
        ) : null}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-3)]"
        role="progressbar"
        aria-valuenow={ariaPct}
        aria-valuetext={finite ? fmtPercent(Math.max(0, budget.pct)) : '—'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={budget.ariaLabel}
      >
        {finite ? <div
          className={`h-full ${barColor}`}
          style={{ width: `${widthPct}%` }}
        /> : null}
      </div>
      {budget.caption != null ? (
        <p className={typography.role.caption}>{budget.caption}</p>
      ) : null}
    </div>
  )
}

function BandsSection({ bands }: { bands: UsageCardBand[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {bands.map((b, i) => {
        const intent = b.intent ?? 'normal'
        return (
          <div key={i} className={'min-w-0 rounded-shape-lg p-3 ' + intentBandRing[intent]}>
            <div className={'flex items-center gap-2 ' + typography.role.label}>
              {b.icon ? <span className="inline-flex h-3.5 w-3.5 shrink-0">{b.icon}</span> : null}
              {b.label}
            </div>
            <div className={'mt-1 tabular-nums ' + typography.role.body + ' ' + typography.weight.semibold}>
              {b.value}
            </div>
            {b.sub != null ? (
              <div className={typography.role.caption + ' tabular-nums'}>{b.sub}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function DetailsSection({ details }: { details: UsageCardDetail[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
      {details.map((d, i) => {
        const intent = d.intent ?? 'normal'
        return (
          <div key={i} className="min-w-0">
            <div className={typography.role.caption}>{d.label}</div>
            <div className={typography.size.sm + ' tabular-nums ' + intentValueText[intent]}>{d.value}</div>
          </div>
        )
      })}
    </div>
  )
}

function TopListsSection({ topLists }: { topLists: UsageCardTopList[] }) {
  // grid-cols-2 max so one or two top-lists fit side by side; three or
  // more wrap to the next row (rare in practice).
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {topLists.map((tl) => (
        <div key={tl.key} className="min-w-0 rounded-shape-lg bg-[var(--surface-2)] p-3">
          <div className={'flex items-center gap-2 ' + typography.role.label}>
            {tl.icon ? <span className="inline-flex h-3.5 w-3.5 shrink-0">{tl.icon}</span> : null}
            {tl.title}
          </div>
          <ul className="mt-2 space-y-2">
            {tl.items.map((item) => (
              <li key={item.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                <span className={'min-w-0 break-all ' + typography.role.code}>
                  {item.label}
                </span>
                <span className={typography.role.body + ' tabular-nums'}>{item.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function BannerSection({ banner }: { banner: UsageCardBanner }) {
  const intent = banner.intent ?? 'danger'
  const Icon = banner.icon ?? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
  return (
    <div
      className={'flex min-w-0 items-start gap-2 rounded-shape-lg p-3 ' + intentBannerBg[intent]}
      role="status"
      aria-live="polite"
    >
      {Icon}
      <div className="min-w-0">
        <div className={typography.role.body + ' ' + typography.weight.semibold}>{banner.title}</div>
        <div className={typography.role.caption}>{banner.description}</div>
      </div>
    </div>
  )
}

function FooterSection({ links }: { links: UsageCardFooterLink[] }) {
  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--border-subtle)]">
      {links.map((link) => {
        const baseClass = BUTTON_BASE + ' min-h-11 min-w-11 max-w-full px-3 py-2 ' +
          typography.size.sm + ' ' + (link.primary ? BUTTON_VARIANTS.primary : BUTTON_VARIANTS.ghost)
        if (link.external) {
          return (
            <a
              key={link.key}
              href={link.to}
              target="_blank"
              rel="noopener noreferrer"
              className={baseClass}
            >
              <span className="min-w-0 break-all text-start">{link.label}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </a>
          )
        }
        return (
          <Link key={link.key} to={link.to} className={baseClass}>
            <span className="min-w-0 break-all text-start">{link.label}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </Link>
        )
      })}
    </div>
  )
}
