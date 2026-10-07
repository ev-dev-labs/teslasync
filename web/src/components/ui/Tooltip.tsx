import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  /**
   * Tooltip content. Strings render in a single line by default; pass JSX (or
   * set `multiline`) when the content needs to wrap.
   *
   * IMPORTANT — text colour contract:
   * The tooltip uses an INVERTED surface for high contrast (light card in
   * dark mode / dark card in light mode) and cascades its own intrinsic
   * `--text-inverse` colour through this content. Do NOT pass hardcoded
   * white, translucent-white, or light-gray (100-400) body-text colour
   * classes inside `content` — they collide with the inverted surface and
   * render invisibly in one of the two themes (light-mode global overrides
   * flip translucent white to dark slate, which then collides with the dark
   * card). The exact set is the `FORBIDDEN_TEXT_CLASS` regex below.
   *
   * Decorative shades that convey meaning (`text-amber-300` for severity,
   * `text-emerald-300` for success, etc.) are fine — they have light-mode
   * overrides for readability and are not body text.
   *
   * The audit script `web/scripts/audit-tooltip-text-color.mjs` enforces
   * this in CI; a dev-only `console.warn` fires in development when an
   * offending className is detected.
   */
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * When true (or when `content` is non-string JSX with its own width
   * constraints), the tooltip body wraps onto multiple lines instead of
   * forcing `whitespace-nowrap`. Used by `HelpTooltip` for long help bodies.
   */
  multiline?: boolean;
  children: ReactNode;
}

/**
 * Dev-only sentry — warns once per offending callsite when a child of
 * `content` hardcodes a body-text colour class that collides with the
 * tooltip's INVERTED surface. Production builds short-circuit on the first
 * line so this has zero runtime cost when shipped.
 *
 * The audit script catches the same pattern statically in CI; this hook is
 * a belt-and-braces backstop that fires the moment a developer lands the
 * offending JSX in dev (before they push and the CI gate red-flags it).
 */
const FORBIDDEN_TEXT_CLASS = /\btext-(?:white|gray-[1-4]00)(?:\/(?:[0-9]+))?\b/;
const warnedFingerprints = new Set<string>();

function collectForbiddenClasses(node: ReactNode, hits: string[], depth = 0): void {
  if (depth > 6) return;
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const child of node) collectForbiddenClasses(child, hits, depth + 1);
    return;
  }
  if (!isValidElement(node)) return;
  const className = (node.props as { className?: unknown }).className;
  if (typeof className === 'string') {
    const match = FORBIDDEN_TEXT_CLASS.exec(className);
    if (match) hits.push(match[0]);
  }
  const children = (node.props as { children?: ReactNode }).children;
  if (children !== undefined) collectForbiddenClasses(children, hits, depth + 1);
}

function warnIfHardcodedTextColor(content: ReactNode, callerHint: string): void {
  if (import.meta.env.PROD) return;
  if (typeof content === 'string' || typeof content === 'number') return;
  const hits: string[] = [];
  collectForbiddenClasses(content, hits);
  if (hits.length === 0) return;
  const fingerprint = `${callerHint}::${hits.join(',')}`;
  if (warnedFingerprints.has(fingerprint)) return;
  warnedFingerprints.add(fingerprint);
  console.warn(
    `[Tooltip] content hardcodes ${hits.join(', ')} which collides with the ` +
      `tooltip's inverted surface (light card in dark mode / dark card in ` +
      `light mode). Remove the colour class from the JSX inside content — ` +
      `the tooltip cascades its own text colour. Caller: ${callerHint}`,
  );
}

const sideClasses = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
} as const;

/**
 * Hover/focus tooltip.
 *
 * Visual contract — inverted surface:
 *   - dark mode  → light card (`bg-gray-100`) with dark `--text-inverse` text
 *   - light mode → dark  card (`bg-gray-900`) with light `--text-inverse` text
 *
 * The inversion gives high contrast against the page background in both
 * themes (matches Linear / GitHub / modern tooltip UX).
 *
 * Text-colour contract: do NOT pass hardcoded white, translucent-white, or
 * light-gray (100-400) body-text colour classes inside `content` (the exact
 * set is the `FORBIDDEN_TEXT_CLASS` regex above). Decorative shades that
 * convey meaning (`text-amber-300` severity, `text-emerald-300` success)
 * are fine — they have light-mode overrides for readability and convey
 * meaning rather than body text. See `TooltipProps.content` for the full
 * rationale, `web/scripts/audit-tooltip-text-color.mjs` for CI enforcement,
 * and `warnIfHardcodedTextColor` above for the dev-time backstop.
 *
 * Accessibility:
 * - Tooltip body has `role="tooltip"` + a stable id.
 * - When `children` is a single element, the tooltip id is added to that
 *   element's `aria-describedby` (preserving any existing value) so screen
 *   readers announce the tooltip text after the trigger's own name.
 * - The visibility CSS handles both `:hover` AND `:focus-within` so keyboard
 *   users (Tab into a button wrapped in a tooltip) get the same affordance as
 *   mouse users.
 *
 * Touch devices:
 * - Wrap a focusable trigger (e.g. <button>) and tapping it grants focus,
 *   triggering `:focus-within` on the wrapper — so the tooltip appears on
 *   tap. Tapping outside blurs the trigger and dismisses the tooltip.
 *
 * Reduced motion:
 * - The reveal transition is disabled globally via the `motion-reduce`
 *   variant when the user has `prefers-reduced-motion: reduce`.
 */
export function Tooltip({ content, side = 'top', multiline, children }: TooltipProps) {
  const tooltipId = useId();

  // Stable per-mount fingerprint for the dev-time warn so we don't
  // de-duplicate across distinct callsites that happen to share the same
  // forbidden class.
  const callerRef = useRef<string>('');
  if (!callerRef.current) callerRef.current = `tooltip:${tooltipId}`;

  useEffect(() => {
    warnIfHardcodedTextColor(content, callerRef.current);
  }, [content]);

  // We try to attach `aria-describedby` directly to the trigger element so
  // assistive tech reads the tooltip after the trigger name. This works when
  // children is a single React element (the common case — wrapping one
  // <button>/<IconBox>/etc.). For text-only or multiple children we fall back
  // to rendering `children` verbatim; the bubble still carries role="tooltip".
  //
  // `Children.only` is deliberately avoided here: it THROWS on a lone
  // non-element child ("React.Children.only expected to receive a single React
  // element child"), so `<Tooltip>Save</Tooltip>` (a bare string trigger) or a
  // single-item array crashed the whole subtree — a plain `Children.count() ===
  // 1` guard is not enough to prove the child is a clonable element.
  // `Children.toArray` normalises away null/boolean children and lets us prove
  // both "exactly one renderable node" AND "that node is a valid element"
  // before cloning.
  const childArray = Children.toArray(children);
  const soleChild = childArray.length === 1 ? childArray[0] : null;
  const enrichedChild =
    soleChild && isValidElement(soleChild)
      ? (cloneElement(soleChild as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': [
            (soleChild.props as { 'aria-describedby'?: string })['aria-describedby'],
            tooltipId,
          ]
            .filter(Boolean)
            .join(' '),
        }) as ReactNode)
      : children;

  return (
    <span className="relative inline-flex group/tip">
      {enrichedChild}
      <span
        id={tooltipId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 rounded-lg px-2.5 py-1.5 text-xs font-medium',
          multiline ? 'whitespace-normal max-w-[260px]' : 'whitespace-nowrap',
          'bg-gray-900 text-[var(--text-inverse)] shadow-lg dark:bg-gray-100',
          // Forced-colors mode suppresses
          // box-shadow and remaps the bg-gray to Canvas, so the tooltip
          // body would otherwise blend into surrounding panels. Pin a
          // system-colour border + opaque Canvas bg so the inverted
          // surface still reads as a separate floating layer in
          // Windows High Contrast.
          'forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]',
          'opacity-0 scale-95 transition-all duration-fast motion-reduce:transition-none',
          'group-hover/tip:opacity-100 group-hover/tip:scale-100',
          'group-focus-within/tip:opacity-100 group-focus-within/tip:scale-100',
          sideClasses[side],
        )}
      >
        {content}
      </span>
    </span>
  );
}
