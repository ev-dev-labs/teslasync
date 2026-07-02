import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  /**
   * Tooltip content. Strings render in a single line by default; pass JSX (or
   * set `multiline`) when the content needs to wrap.
   *
   * IMPORTANT — text colour contract:
   * The tooltip uses an INVERTED surface for high contrast (light card in
   * dark mode / dark card in light mode) and cascades its own intrinsic
   * `text-gray-100 dark:text-gray-900` pair through this content. Do NOT
   * pass `text-white`, `text-white/N`, or `text-gray-{100..400}` classes
   * inside `content` — they collide with the inverted surface and render
   * invisibly in one of the two themes (light-mode global overrides flip
   * `text-white/N` to dark slate, which then collides with the dark card).
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
 * Hover/focus tooltip, built on Radix UI's `Tooltip` primitive.
 *
 * Radix owns the accessible trigger contract — the WAI-ARIA tooltip state
 * machine (pointer intent, focus/blur, single-open coordination through
 * `Tooltip.Provider`, and the `data-state` attribute) is delegated to
 * `Tooltip.Root`/`Tooltip.Trigger` instead of the previous hand-rolled event
 * wiring. Radix primitives are unstyled, so this file owns the visual layer:
 * the inverted glass surface, placement, motion, and the always-rendered
 * `role="tooltip"` body.
 *
 * The body is rendered by THIS component (not `Tooltip.Content`) on purpose:
 * the shared visual contract requires a single `role="tooltip"` element that
 * carries the intrinsic `text-gray-100 dark:text-gray-900` pair and is wired
 * to the trigger via a stable `aria-describedby`, which the audit script and
 * contract tests pin. Radix's `Tooltip.Content` renders a *separate*
 * visually-hidden `role="tooltip"` node and only wires `aria-describedby`
 * while open, so the trigger machinery is reused while the description node
 * stays owned here.
 *
 * Visual contract — inverted surface:
 *   - dark mode  → light card (`bg-gray-100`) with dark text (`text-gray-900`)
 *   - light mode → dark  card (`bg-gray-900`) with light text (`text-gray-100`)
 *
 * The inversion gives high contrast against the page background in both
 * themes (matches Linear / GitHub / modern tooltip UX).
 *
 * Text-colour contract: do NOT pass `text-white`, `text-white/N`, or
 * `text-gray-{100..400}` classes inside `content`. Decorative shades that
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
 * - Radix reveals the body on hover AND keyboard focus; `Escape` dismisses it
 *   while the trigger keeps focus (WAI-ARIA tooltip pattern), and the CSS
 *   `:focus-within` reveal keeps it visible for the remaining cases (touch
 *   tap, non-Radix focus).
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

  // Radix owns the open-state machine (hover intent, focus/blur, single-open
  // coordination); we mirror it into local state to drive the visual reveal
  // and the `Escape`-to-dismiss guard.
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    // A fresh hover/focus clears a prior Escape dismissal so the tooltip can
    // reappear on the next interaction.
    if (next) setDismissed(false);
  }, []);

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
  // <button>/<IconBox>/etc.). For text-only, array, or empty children we fall
  // back to a wrapper span, which still satisfies role="tooltip" semantics
  // (and never throws the way `Children.only` would on a bare string).
  const child = isValidElement(children) ? children : null;
  const enrichedChild =
    child
      ? (cloneElement(
          child as ReactElement<{
            'aria-describedby'?: string;
            onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
          }>,
          {
            'aria-describedby': [
              (child.props as { 'aria-describedby'?: string })['aria-describedby'],
              tooltipId,
            ]
              .filter(Boolean)
              .join(' '),
            onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
              (
                child.props as {
                  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
                }
              ).onKeyDown?.(event);
              if (event.key === 'Escape') {
                setOpen(false);
                setDismissed(true);
              }
            },
          },
        ) as ReactNode)
      : children;

  return (
    <TooltipPrimitive.Provider delayDuration={0} disableHoverableContent>
      <TooltipPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <span className="relative inline-flex group/tip">
          {child ? (
            <TooltipPrimitive.Trigger asChild>{enrichedChild}</TooltipPrimitive.Trigger>
          ) : (
            <TooltipPrimitive.Trigger asChild>
              <span aria-describedby={tooltipId} className="inline-flex">
                {children}
              </span>
            </TooltipPrimitive.Trigger>
          )}
          <span
            id={tooltipId}
            role="tooltip"
            data-state={open ? 'open' : 'closed'}
            data-dismissed={dismissed ? 'true' : undefined}
            className={cn(
              'pointer-events-none absolute z-50 rounded-lg px-2.5 py-1.5 text-xs font-medium',
              multiline ? 'whitespace-normal max-w-[260px]' : 'whitespace-nowrap',
              'bg-gray-900 text-gray-100 shadow-lg dark:bg-gray-100 dark:text-gray-900',
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
              // Radix drives the open state on hover/focus; mirror it so the
              // reveal stays in lock-step with the primitive's `data-state`.
              'data-[state=open]:opacity-100 data-[state=open]:scale-100',
              // `Escape` force-hides the body even while the trigger keeps
              // focus (overrides the reveal above until the next interaction).
              'data-[dismissed=true]:!opacity-0 data-[dismissed=true]:!scale-95',
              sideClasses[side],
            )}
          >
            {content}
          </span>
        </span>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
