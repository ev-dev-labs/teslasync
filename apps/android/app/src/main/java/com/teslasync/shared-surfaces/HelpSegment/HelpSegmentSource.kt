// The decoupled action seam the HelpSegment surface binds to, plus its process-wide production registry — the
// native port of the web HelpSegment's three decoupled dispatches (web/src/components/layout/status-bar/
// HelpSegment.tsx): `window.dispatchEvent('toggle-keyboard-shortcuts')`, `dispatchTourLauncherOpen()`, and
// `window.dispatchEvent('open-feedback-modal')`. The view (composable) performs NO work of its own; it routes
// every tap through the [HelpSegmentViewModel], which drives this seam (ADR-002), so the "data flows through
// the shared state holder" contract holds even though this surface fetches nothing.
//
// The web source stays decoupled from the React tree on purpose: it fires window events / a registry call so
// the shortcuts sheet, the tour launcher, and the feedback modal each listen wherever they happen to be
// mounted, and a tap with nothing mounted is a harmless no-op. This seam mirrors that 1:1: [HelpActions] is the
// abstraction the ViewModel depends on (the real process registry ↔ a throwaway test instance), and
// [HelpActions.open] returns true when a listener was mounted (web's event firing a listener) or false when
// none is registered (web's event landing with no listener). [RegistryHelpActions] is the native analogue of
// the global window-event / tour-registry bus — a host (the shortcuts sheet / tour launcher / feedback modal)
// registers a handler per [HelpAction] for as long as it is mounted; [ProcessHelpActions] is the shared
// singleton every mounted HelpSegment dispatches through, exactly as every web HelpSegment shares the one
// `window` event bus.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/HelpSegment) cannot form a valid Kotlin package. `MatchingDeclarationName` and
// the ktlint filename rule are suppressed: the mandated `HelpSegment*` filename cannot match the [HelpActions]
// seam plus its co-located registry types.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpsegment

import java.util.concurrent.atomic.AtomicReference

/**
 * The single seam the [HelpSegmentViewModel] depends on so it binds to an abstraction (the real process
 * registry ↔ a throwaway test instance), never to a concrete event bus — the Android analogue of the web
 * HelpSegment's decoupled `window.dispatchEvent` / `dispatchTourLauncherOpen` dispatch (the P1/S8 state-holder
 * boundary for this surface).
 *
 * [open] dispatches the intent for [action] to whatever listener is mounted and returns true when one was
 * present (web: a registered listener fired) or false when none is registered, so the tap is a safe no-op
 * rather than a crash. No HTTP touches the view.
 */
fun interface HelpActions {
    /** Dispatches [action]'s intent; returns true when a listener was mounted to handle it. */
    fun open(action: HelpAction): Boolean
}

/**
 * A handle to one [RegistryHelpActions] handler registration. The mounted host (the shortcuts sheet / tour
 * launcher / feedback modal) releases it when it leaves the composition, so a torn-down listener never stays
 * the dispatch destination.
 */
fun interface HelpActionHandle {
    /** Clears this registration if it is still the active handler for its action. */
    fun release()
}

/**
 * The default [HelpActions] — a process-wide registry of one handler per [HelpAction], the native analogue of
 * the global `window` event bus / tour registry every web HelpSegment shares. A host registers its handler for
 * an action (see [register]) for as long as it is mounted; [open] invokes the most-recently-registered handler
 * for that action. Each action's slot is held in its own [AtomicReference] so registration, dispatch, and
 * release stay coherent even though all three occur on the main thread in practice.
 */
class RegistryHelpActions : HelpActions {
    private val slots: Map<HelpAction, AtomicReference<(() -> Unit)?>> =
        HelpAction.entries.associateWith { AtomicReference<(() -> Unit)?>(null) }

    /** True when a host handler is currently registered for [action] — the native mirror of a mounted listener. */
    fun isRegistered(action: HelpAction): Boolean = slots.getValue(action).get() != null

    /**
     * Registers [handler] as the current handler for [action], replacing any prior registration (a single
     * listener wins, like the most-recently-mounted web listener). Returns a [HelpActionHandle] whose
     * [HelpActionHandle.release] clears it again only if it is still the active one — so a freshly mounted host
     * that registered after this one is never clobbered when this one disposes.
     */
    fun register(
        action: HelpAction,
        handler: () -> Unit,
    ): HelpActionHandle {
        val slot = slots.getValue(action)
        slot.set(handler)
        return HelpActionHandle { slot.compareAndSet(handler, null) }
    }

    /**
     * Invokes the handler registered for [action] and reports whether one was present — the native mirror of a
     * web `dispatchEvent` either firing a listener or landing unhandled. Returns false (a no-op) when no handler
     * is registered, exactly as the web event does nothing when no listener is mounted.
     */
    override fun open(action: HelpAction): Boolean {
        val handler = slots.getValue(action).get() ?: return false
        handler()
        return true
    }
}

/**
 * The process-wide help-actions singleton — the native analogue of the global `window` event bus every
 * HelpSegment dispatches through. Mounted hosts register their handlers once; every mounted HelpSegment then
 * dispatches to them. A test constructs a throwaway [RegistryHelpActions] (or a fake [HelpActions]) so the
 * singleton is never polluted across cases.
 */
val ProcessHelpActions: RegistryHelpActions = RegistryHelpActions()
