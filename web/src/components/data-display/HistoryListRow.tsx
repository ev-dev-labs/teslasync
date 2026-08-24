import { type ReactNode, type MouseEventHandler } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { cn } from '@/lib/cn';

export type HistoryListRowGlow = 'cyan' | 'green' | 'purple' | 'none';

export interface HistoryListRowProps {
  /**
   * Optional checkbox slot. Clicks inside this region don't trigger
   * the row's link / onClick (event propagation is stopped).
   */
  checkbox?: ReactNode;
  /**
   * Leading badge slot — score letter, charger icon, ProgressRing.
   * Rendered in a fixed-width (`w-9`) centred column so rows align
   * regardless of badge content.
   */
  leading?: ReactNode;
  /**
   * Required primary line — typically `time + duration + main metric
   * badge + status badges`. Caller composes inline.
   */
  primary: ReactNode;
  /**
   * Optional second line — `RouteDisplay`, charger location, etc.
   */
  route?: ReactNode;
  /**
   * Optional third line — `InlineMetric` chips (avg speed, battery
   * delta, efficiency, cost, …).
   */
  metrics?: ReactNode;
  /**
   * Optional fourth slot — inline insight (e.g. "⚠ Low efficiency —
   * investigate →"). Renders below the metrics row.
   */
  insight?: ReactNode;
  /**
   * Hover-revealed action buttons (eye / map / curve / more menu).
   * Sit absolutely-positioned in the top-right; only visible when the
   * row is hovered or focus-within. Pass an array of nodes (each
   * already a `<Button>` from `components/ui`).
   */
  actions?: ReactNode[];
  /** Navigate to this URL when the row is clicked. */
  href?: string;
  /** Or, run this handler on click (mutually exclusive with `href`). */
  onClick?: MouseEventHandler<HTMLDivElement>;
  /** Adds the "selected" tint on the panel border. */
  selected?: boolean;
  /** Hover glow colour (passed to GlassPanel). Default `'cyan'`. */
  glow?: HistoryListRowGlow;
  /**
   * Hide the trailing chevron (set when the row isn't navigable).
   */
  hideChevron?: boolean;
  className?: string;
  /** Test hook. */
  testId?: string;
}

/**
 * `HistoryListRow` — generic, slot-based row for history-style pages.
 *
 * Used by `DriveCard` (under /drives) and `ChargingSessionCard` (under
 * /charging) — both pages compose the same row with different leading
 * badges, metric chips, and hover actions.
 *
 * Slots (top-down):
 *   ┌──────────────────────────────────────────┬──[actions]─┐
 *   │ ☐ checkbox │ leading │  primary           │            │
 *   │            │         │  route             │            │
 *   │            │         │  metrics           │  chevron > │
 *   │            │         │  insight           │            │
 *   └──────────────────────────────────────────┴────────────┘
 *
 * Click handling:
 *   - If `href` is set, the entire row is wrapped in a Router `<Link>`.
 *   - If `onClick` is set instead, the GlassPanel itself fires onClick.
 *   - Clicks inside the `checkbox` region are stopped so the user can
 *     toggle selection without navigating.
 *   - Clicks inside the `actions` region are also stopped so quick
 *     actions don't navigate.
 */
export function HistoryListRow({
  checkbox,
  leading,
  primary,
  route,
  metrics,
  insight,
  actions,
  href,
  onClick,
  selected,
  glow = 'cyan',
  hideChevron,
  className,
  testId,
}: HistoryListRowProps) {
  const stop: MouseEventHandler = (e) => e.stopPropagation();

  const body = (
    <GlassPanel
      hover
      glow={glow}
      onClick={onClick}
      data-testid={testId ? `${testId}-panel` : undefined}
      className={cn(
        'p-3 sm:p-4 transition-all duration-normal group cursor-pointer relative',
        actions && actions.length > 0 && 'pe-14',
        selected && 'border-cyan-400/40 ring-1 ring-cyan-400/20',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {leading != null && (
          <div className="shrink-0 w-9 text-center">{leading}</div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">{primary}</div>
          {route && <div className="mb-1">{route}</div>}
          {metrics && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)] tabular-nums">
              {metrics}
            </div>
          )}
          {insight && <div className="mt-1">{insight}</div>}
        </div>

        {!hideChevron && (
          <ChevronRight className="h-4 w-4 text-[var(--text-muted)] group-hover:text-cyan-400 transition-colors shrink-0" />
        )}
      </div>
    </GlassPanel>
  );

  return (
    <div
      className="group/row relative flex items-stretch gap-2"
      data-testid={testId}
    >
      {checkbox != null && (
        <div className="flex items-center pl-2" onClick={stop}>
          {checkbox}
        </div>
      )}
      {href ? (
        <Link to={href} className="flex-1 min-w-0">
          {body}
        </Link>
      ) : (
        <div className="flex-1 min-w-0">{body}</div>
      )}
      {actions && actions.length > 0 && (
        <div
          className={cn(
            'absolute end-2 top-2 z-10 flex items-center gap-1',
            'opacity-100 transition-opacity duration-fast sm:opacity-0',
            'sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100',
          )}
        >
          {actions.map((node, i) => (
            <span key={i}>{node}</span>
          ))}
        </div>
      )}
    </div>
  );
}
