/**
 * Route-focus decision layer (A11Y-03).
 *
 * Moving focus to the new page's `<h1>` after a client-side navigation
 * is the WAI-ARIA APG remedy for the SPA "focus is stranded on a
 * removed nav link" problem: without it, the next Tab lands back at
 * the top of the document and a screen-reader user has to traverse the
 * entire chrome again to reach the content they just asked for.
 *
 * Naively focusing the heading on every location change is worse than
 * doing nothing, though. It:
 *
 * - **Steals focus mid-typing.** Filter inputs, search boxes, and date
 *   pickers write their state into the query string. Every keystroke
 *   is a `REPLACE` navigation, so an unconditional focus move rips the
 *   caret out of the field the user is actively typing in.
 * - **Fights the browser on Back/Forward.** On `POP` the browser (and
 *   our `ScrollRestoration`) restores the previous position; yanking
 *   focus to the top of the page discards that restoration and makes
 *   Back feel like a fresh load.
 * - **Interrupts dialogs.** A modal that navigates on submit would lose
 *   its own focus trap to the page heading while it is still mounted.
 * - **Talks to a backgrounded tab.** If the document is not focused,
 *   calling `.focus()` can pull the tab forward on some platforms.
 *
 * This module is the pure, DOM-free-ish decision function that answers
 * exactly one question — *may we move focus to the route heading right
 * now?* — so the policy is unit-testable without a router, a layout, or
 * a real navigation.
 *
 * @see web/src/components/a11y/RouteFocusManager.tsx for the component
 *   that applies these decisions.
 */

/** Attribute marking the element that should receive route focus. */
export const ROUTE_FOCUS_TARGET_ATTR = 'data-route-focus-target';

/** Selector for the primary route-focus target (the page `<h1>`). */
export const ROUTE_FOCUS_TARGET_SELECTOR = `[${ROUTE_FOCUS_TARGET_ATTR}]`;

/** Fallback target when a route renders no page heading. */
export const ROUTE_FOCUS_FALLBACK_SELECTOR = '#main-content';

/** Router navigation kinds we care about. Mirrors React Router's type. */
export type RouteNavigationKind = 'PUSH' | 'REPLACE' | 'POP';

/** Why the policy allowed or refused a focus move. Surfaced in tests. */
export type RouteFocusReason =
  | 'first-render'
  | 'history-navigation'
  | 'same-path'
  | 'document-not-focused'
  | 'dialog-open'
  | 'text-entry-in-progress'
  | 'focus-moved-since-scheduled'
  | 'allowed';

export interface RouteFocusDecision {
  shouldFocus: boolean;
  reason: RouteFocusReason;
}

export interface RouteFocusContext {
  /** Navigation kind reported by the router for this location change. */
  navigationKind: RouteNavigationKind;
  /** True only for the very first render of the manager. */
  isFirstRender: boolean;
  /** True when the pathname is unchanged (query-only navigation). */
  isSamePath: boolean;
  /** `document.hasFocus()` at the moment the move would happen. */
  documentHasFocus: boolean;
  /** The currently-focused element, or null. */
  activeElement: Element | null;
  /**
   * The element that was focused when the move was *scheduled*. When it
   * differs from `activeElement`, the user (or a component) moved focus
   * during the delay and we must not override that intent.
   */
  scheduledFromElement: Element | null;
}

/**
 * True when `element` sits inside an open modal surface (dialog,
 * alertdialog, or an explicitly `aria-modal` container). Those own
 * their focus for as long as they are mounted.
 */
export function isInsideModalSurface(element: Element | null): boolean {
  if (!element) return false;
  return Boolean(
    element.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'),
  );
}

/**
 * True when `element` is a control the user could be mid-entry in.
 *
 * Deliberately broad: it covers native text inputs, `<textarea>`,
 * `contenteditable` regions, combobox/searchbox/spinbutton widgets, and
 * `<select>`. Checkboxes, radios, and buttons are excluded — activating
 * one of those is a discrete event that typically CAUSES the
 * navigation, so keeping focus on it would defeat the whole feature.
 */
export function isTextEntryElement(element: Element | null): boolean {
  if (!element) return false;
  const el = element as HTMLElement;
  if (el.isContentEditable) return true;

  const tag = el.tagName?.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
    const nonTextTypes = new Set([
      'button',
      'checkbox',
      'color',
      'file',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ]);
    return !nonTextTypes.has(type);
  }

  const role = el.getAttribute?.('role');
  return role === 'combobox' || role === 'searchbox' || role === 'spinbutton';
}

/**
 * Decide whether the route-focus manager may move focus to the page
 * heading for this navigation.
 *
 * Order matters: cheap, navigation-shaped refusals come first so the
 * DOM-inspecting checks only run for navigations that could plausibly
 * warrant a focus move.
 */
export function decideRouteFocus(ctx: RouteFocusContext): RouteFocusDecision {
  // The browser already places focus at the document start on a full
  // load, and announces the title. Doing it again double-speaks.
  if (ctx.isFirstRender) {
    return { shouldFocus: false, reason: 'first-render' };
  }

  // Back / Forward: the browser plus ScrollRestoration re-establish the
  // previous reading position. Overriding it with a jump to the heading
  // makes history navigation feel like a fresh page load.
  if (ctx.navigationKind === 'POP') {
    return { shouldFocus: false, reason: 'history-navigation' };
  }

  // Filter chips, sort controls, and saved views all rewrite the query
  // string on the SAME pathname. Those are in-page state changes, not
  // page changes — they get a live-region announcement instead.
  if (ctx.isSamePath) {
    return { shouldFocus: false, reason: 'same-path' };
  }

  if (!ctx.documentHasFocus) {
    return { shouldFocus: false, reason: 'document-not-focused' };
  }

  if (isInsideModalSurface(ctx.activeElement)) {
    return { shouldFocus: false, reason: 'dialog-open' };
  }

  if (isTextEntryElement(ctx.activeElement)) {
    return { shouldFocus: false, reason: 'text-entry-in-progress' };
  }

  // Focus moved between scheduling and firing — something deliberately
  // claimed it (an auto-focused field, a toast action, a dialog that
  // opened during the transition). Respect that claim.
  //
  // `<body>` is the "nobody owns focus" state, so a move *away from*
  // body is a genuine claim, while a move *to* body is just the old
  // element unmounting and must not block us.
  if (
    ctx.scheduledFromElement !== ctx.activeElement &&
    ctx.activeElement != null &&
    ctx.activeElement !== ctx.activeElement.ownerDocument?.body
  ) {
    return { shouldFocus: false, reason: 'focus-moved-since-scheduled' };
  }

  return { shouldFocus: true, reason: 'allowed' };
}
