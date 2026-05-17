/**
 * UsageCard — shared visual primitive for "spend / volume" cards.
 *
 * Phase-50 / 0004 — F3 AI Call Log + Usage Card.
 *
 * Two consumers ship in this slice:
 *   - TeslaApiUsageCard (existing, refactored to feed this primitive).
 *   - AiUsageCard       (new, for the AI provider audit log).
 *
 * The DRY win: both cards have the same skeleton — optional budget
 * bar, three at-a-glance bands, a key/value detail grid, optional
 * top-list breakdowns, optional banner, optional footer links. By
 * separating that skeleton from each consumer's data derivation, we
 * keep the visual contract in one file and let the consumers focus
 * on "what numbers do I have" rather than "how do I render them".
 *
 * Pure presentational: no hooks, no API calls, no derived state.
 * Every dynamic value comes in via props so the card stays trivially
 * testable + Storybook-friendly without mounting a query client.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ExternalLink } from 'lucide-react'

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
 * (rendered in a monospace font), value is the right-aligned count.
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
  /** 0..100 used for bar width AND aria-valuenow. */
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
  normal: 'bg-cyan-500/70',
  warn: 'bg-amber-500/70',
  danger: 'bg-red-500/70',
}

const intentBandRing: Record<UsageCardIntent, string> = {
  normal: 'bg-white/[0.03]',
  warn: 'bg-amber-500/10 ring-1 ring-amber-500/30',
  danger: 'bg-red-500/10 ring-1 ring-red-500/30',
}

const intentValueText: Record<UsageCardIntent, string> = {
  normal: 'text-[var(--text-primary)]',
  warn: 'text-amber-300',
  danger: 'text-red-400',
}

const intentBannerBg: Record<UsageCardIntent, string> = {
  normal: 'bg-cyan-500/10 text-cyan-200 ring-1 ring-cyan-500/30',
  warn: 'bg-amber-500/10 text-amber-100 ring-1 ring-amber-500/30',
  danger: 'bg-red-500/10 text-red-200 ring-1 ring-red-500/30',
}

const intentBannerDescription: Record<UsageCardIntent, string> = {
  normal: 'text-cyan-300/80',
  warn: 'text-amber-200/80',
  danger: 'text-red-300/80',
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
      <p className="text-sm text-[var(--text-muted)]">
        {emptyMessage ?? 'No data to display yet.'}
      </p>
    )
  }

  return (
    <div className={'space-y-4 ' + (className ?? '')}>
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
  const intent = budget.intent ?? 'normal'
  const barColor = intentBarBg[intent]
  // Preserve the unclamped pct in aria-valuenow so screen readers
  // announce "over budget" overflow accurately. The visual width
  // clamps to 100% so the bar doesn't overflow its container.
  const widthPct = Math.max(0, Math.min(100, budget.pct))
  const ariaPct = Math.max(0, Math.round(budget.pct))
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-[var(--text-primary)]">{budget.headline}</span>
        {budget.rightLabel ? (
          <span
            className={
              intent === 'danger'
                ? 'text-red-400 font-semibold tabular-nums'
                : 'text-[var(--text-muted)] tabular-nums'
            }
          >
            {budget.rightLabel}
          </span>
        ) : null}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]"
        role="progressbar"
        aria-valuenow={ariaPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={budget.ariaLabel}
      >
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      {budget.caption ? (
        <p className="text-xs text-[var(--text-muted)]">{budget.caption}</p>
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
          <div key={i} className={'rounded-lg p-3 ' + intentBandRing[intent]}>
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--text-muted)]">
              {b.icon ? <span className="inline-flex h-3.5 w-3.5">{b.icon}</span> : null}
              {b.label}
            </div>
            <div className="mt-1 font-semibold tabular-nums text-[var(--text-primary)]">
              {b.value}
            </div>
            {b.sub ? (
              <div className="text-xs text-[var(--text-muted)] tabular-nums">{b.sub}</div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function DetailsSection({ details }: { details: UsageCardDetail[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-4">
      {details.map((d, i) => {
        const intent = d.intent ?? 'normal'
        return (
          <div key={i}>
            <div className="text-xs text-[var(--text-muted)]">{d.label}</div>
            <div className={'tabular-nums ' + intentValueText[intent]}>{d.value}</div>
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
        <div key={tl.key} className="rounded-lg bg-white/[0.03] p-3">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--text-muted)]">
            {tl.icon ? <span className="inline-flex h-3.5 w-3.5">{tl.icon}</span> : null}
            {tl.title}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {tl.items.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-[var(--text-secondary)]">
                  {item.label}
                </span>
                <span className="tabular-nums text-[var(--text-primary)]">{item.value}</span>
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
      className={'flex items-start gap-2 rounded-lg p-3 text-sm ' + intentBannerBg[intent]}
      role="status"
      aria-live="polite"
    >
      {Icon}
      <div>
        <div className="font-semibold">{banner.title}</div>
        <div className={'text-xs ' + intentBannerDescription[intent]}>{banner.description}</div>
      </div>
    </div>
  )
}

function FooterSection({ links }: { links: UsageCardFooterLink[] }) {
  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
      {links.map((link) => {
        const baseClass = link.primary
          ? 'inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-500/20 min-h-[36px]'
          : 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 hover:bg-white/[0.04] min-h-[36px]'
        if (link.external) {
          return (
            <a
              key={link.key}
              href={link.to}
              target="_blank"
              rel="noopener noreferrer"
              className={baseClass}
            >
              {link.label}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )
        }
        return (
          <Link key={link.key} to={link.to} className={baseClass}>
            {link.label}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )
      })}
    </div>
  )
}
