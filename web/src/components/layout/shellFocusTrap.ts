/**
 * shellFocusTrap
 * ──────────────
 * Shared focus containment + background hiding for app-shell overlays.
 *
 * Why this exists
 * ---------------
 * `<Modal>` owns the same behaviour for ordinary dialogs, but a handful of
 * shell overlays cannot be a `<Modal>`: the command palette is top-anchored,
 * carries combobox/listbox semantics with `aria-activedescendant`, and owns
 * its own multi-stage Escape handling (clear scope → close). Rather than
 * hand-rolling a second trap inside that component, the primitive lives here
 * and mirrors `<Modal>`'s contract exactly — same focusable-element selector,
 * same Tab / Shift+Tab wrap-around semantics.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * - It never moves focus on activation. The caller decides where initial
 *   focus lands (the palette focuses its search input).
 * - It never restores focus on teardown. The caller owns focus return so a
 *   single component cannot restore twice.
 *
 * Both omissions keep this composable with an overlay that already has
 * carefully tuned focus behaviour.
 */

/** Identical to `<Modal>`'s selector so both surfaces agree on "focusable". */
export const SHELL_FOCUSABLE_SELECTOR =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Visible, focusable descendants of `container`, in DOM order. */
export function getShellFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(
    container.querySelectorAll<HTMLElement>(SHELL_FOCUSABLE_SELECTOR),
  )
    .filter(
      (element) =>
        element.getAttribute('aria-hidden') !== 'true' &&
        // The shared selector matches `button`/`input`/`[href]` unconditionally,
        // so an element that opted OUT of the tab order with `tabindex="-1"`
        // would still be returned. Listbox options do exactly that (they are
        // driven by `aria-activedescendant`), so filter them out here rather
        // than letting Tab walk through dozens of rows.
        element.tabIndex >= 0,
    )
    // A selector LIST is not guaranteed to come back in document order on
    // every engine (jsdom/nwsapi groups by branch), and "first"/"last" are
    // only meaningful in tab order. Sort explicitly so the wrap-around is
    // deterministic everywhere.
    .sort((left, right) => {
      const relation = left.compareDocumentPosition(right)
      if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1
      if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1
      return 0
    })
}

/**
 * Keep Tab / Shift+Tab inside `container`.
 *
 * Lifecycle safety: the listener lives on the document, so it would outlive a
 * container that React unmounts before the effect cleanup runs (StrictMode
 * double-invoke, a parent that drops the subtree, an exit animation that is
 * cut short). Both the activation and the handler therefore check
 * `isConnected`: activating with a detached container is a no-op, and a
 * container that detaches while active makes the handler REMOVE ITSELF on the
 * next key event instead of stealing focus into a dead subtree.
 *
 * Returns an idempotent teardown. Safe to call with `null` (no-op teardown) so
 * callers can wire it straight into an effect without branching.
 */
export function trapFocusWithin(container: HTMLElement | null): () => void {
  // A detached container has no meaningful tab order and cannot receive
  // focus — refuse to arm rather than installing a listener that can only
  // ever misfire.
  if (!container || !container.isConnected) return () => {}

  const doc = container.ownerDocument
  let armed = true

  const disarm = () => {
    if (!armed) return
    armed = false
    doc.removeEventListener('keydown', handleKeyDown, true)
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Self-disable: the container went away without a cleanup call.
    if (!container || !container.isConnected) {
      disarm()
      return
    }
    if (event.key !== 'Tab') return
    const focusables = getShellFocusableElements(container)
    if (focusables.length === 0) {
      // Nothing to tab to — keep focus pinned on the container itself.
      event.preventDefault()
      container.focus?.()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = doc.activeElement

    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last || !container.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }

  doc.addEventListener('keydown', handleKeyDown, true)
  return disarm
}

/**
 * Per-element ownership for background hiding.
 *
 * Overlays nest (a confirm dialog opened from the palette, a tour step over
 * either). If each overlay restored attributes on its own teardown, the FIRST
 * one to close would un-hide the background while an inner overlay is still
 * modal. Ownership is therefore reference-counted per element: the first
 * claimer records the element's ORIGINAL attributes, every claimer bumps the
 * count, and only the release that drops the count to zero restores them.
 *
 * A `WeakMap` keyed by the element means detached nodes are collected with the
 * DOM and no bookkeeping leaks between overlays or tests.
 */
interface OverlayOwnership {
  count: number
  hadInert: boolean
  previousAriaHidden: string | null
}

const overlayOwnership = new WeakMap<Element, OverlayOwnership>()

function claimHidden(element: Element): void {
  let record = overlayOwnership.get(element)
  if (!record) {
    record = {
      count: 0,
      // Captured from the element's pre-overlay state. Nested claimers never
      // re-capture, so they cannot mistake OUR `inert` for a pre-existing one.
      hadInert: element.hasAttribute('inert'),
      previousAriaHidden: element.getAttribute('aria-hidden'),
    }
    overlayOwnership.set(element, record)
  }
  record.count += 1
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}

function releaseHidden(element: Element): void {
  const record = overlayOwnership.get(element)
  if (!record) return
  record.count -= 1
  if (record.count > 0) return
  overlayOwnership.delete(element)
  if (!record.hadInert) element.removeAttribute('inert')
  if (record.previousAriaHidden == null) {
    element.removeAttribute('aria-hidden')
  } else {
    element.setAttribute('aria-hidden', record.previousAriaHidden)
  }
}

/** Test seam: current claim count for an element (0 when unowned). */
export function __getOverlayClaimCountForTests(element: Element): number {
  return overlayOwnership.get(element)?.count ?? 0
}

/**
 * Hide everything outside `anchor` from assistive technology.
 *
 * `aria-modal="true"` alone is unreliable for an overlay that is NOT portaled
 * to `<body>` — screen readers still reach sibling content. This walks the
 * ancestor chain from `anchor` up to `<body>` and marks every sibling along
 * the way `inert` + `aria-hidden`, which is the behaviour `aria-modal`
 * promises.
 *
 * `isOwnRoot` lets an overlay that renders more than one top-level node (e.g.
 * a backdrop plus a positioner) exempt its own siblings, so the backdrop keeps
 * receiving click-outside events instead of being inerted.
 *
 * Nesting is reference-counted (see {@link claimHidden}): concurrent overlays
 * can claim the same background element in any order, and the attributes are
 * only restored when the LAST one releases. Restores are idempotent, so a
 * double teardown cannot decrement someone else's claim.
 *
 * A detached anchor is refused outright — walking a detached subtree would
 * claim nodes that are no longer in the document and leak the claim.
 */
export function hideBackgroundFrom(
  anchor: HTMLElement | null,
  options: { isOwnRoot?: (element: Element) => boolean } = {},
): () => void {
  if (!anchor || !anchor.ownerDocument || !anchor.isConnected) return () => {}
  const doc = anchor.ownerDocument
  const isOwnRoot = options.isOwnRoot ?? (() => false)
  const claimed: Element[] = []

  let node: HTMLElement | null = anchor
  while (node && node !== doc.body && node.parentElement) {
    const parent: HTMLElement = node.parentElement
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || isOwnRoot(sibling)) continue
      claimHidden(sibling)
      claimed.push(sibling)
    }
    node = parent
  }

  let released = false
  return () => {
    if (released) return
    released = true
    for (const element of claimed) releaseHidden(element)
    claimed.length = 0
  }
}

/**
 * Compose {@link trapFocusWithin} and {@link hideBackgroundFrom} for a modal
 * shell overlay. Returns a single idempotent teardown.
 *
 * Activating with a detached (or missing) container is a predictable no-op:
 * neither sub-primitive arms, and the returned teardown is still callable, so
 * an effect that races an unmount cannot throw or leak a document listener.
 */
export function activateShellOverlayGuard(
  options: {
    /** Element that owns keyboard focus (the overlay panel). */
    focusContainer: HTMLElement | null
    /** Element used to walk the ancestor chain when hiding the background. */
    backgroundAnchor?: HTMLElement | null
    isOwnRoot?: (element: Element) => boolean
  },
): () => void {
  const releaseFocus = trapFocusWithin(options.focusContainer)
  const restoreBackground = hideBackgroundFrom(
    options.backgroundAnchor ?? options.focusContainer,
    { isOwnRoot: options.isOwnRoot },
  )
  let released = false
  return () => {
    if (released) return
    released = true
    releaseFocus()
    restoreBackground()
  }
}
