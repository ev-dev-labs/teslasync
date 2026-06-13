// The main-content landmark seam the SkipToContent surface binds to, plus its process-wide production
// instance — the native port of the web `document.getElementById('main-content')` lookup the web SkipToContent
// performs in its `onClick` (web/src/components/feedback/SkipToContent.tsx). The view (composable) performs NO
// work of its own; it routes activation through the [SkipToContentViewModel], which drives this seam (ADR-002),
// so the "data flows through the shared state holder" contract holds even though this surface fetches nothing.
//
// The web source reaches a single global landmark: `const main = document.getElementById('main-content')`,
// then focuses + scrolls it when present and silently does nothing when absent. This seam mirrors that 1:1:
// [RegistrySkipTarget] is the native analogue of that global landmark — the host scaffold registers its
// main-content focus action once (see [rememberMainContentAnchor] in the view), and [focusMainContent] invokes
// the registered action, returning true when a landmark was present (web `if (main)`) and false when none is
// registered (web `getElementById` returning `null`). [ProcessSkipTarget] is the shared singleton every
// mounted SkipToContent targets, exactly as every web SkipToContent shares the one `#main-content` id.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SkipToContent) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `SkipToContent*` filename cannot match the
// `SkipTarget` seam plus its co-located registry types.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.skiptocontent

import java.util.concurrent.atomic.AtomicReference

/**
 * The single seam the [SkipToContentViewModel] depends on so it binds to an abstraction (the real process
 * registry ↔ a throwaway test instance), never to a concrete focus client — the Android analogue of the web
 * `document.getElementById('main-content')` landmark lookup (the P1/S8 state-holder boundary for this surface).
 *
 * [focusMainContent] moves focus to the registered main-content landmark — and, because a focused node is
 * brought into view inside a scrollable parent, reproduces the web `scrollIntoView({ block: 'start' })` — then
 * returns true when a landmark was present (web `if (main)`) or false when none is registered, so activation is
 * a safe no-op rather than a crash. No HTTP touches the view.
 */
fun interface SkipTarget {
    /** Moves focus to the main-content landmark; returns true when one was present (web `if (main)`). */
    fun focusMainContent(): Boolean
}

/**
 * A handle to one [RegistrySkipTarget] registration. The host releases it when its main content leaves the
 * composition (web: the `<main>` element unmounting), so a torn-down screen never stays the skip destination.
 */
fun interface SkipTargetHandle {
    /** Clears this registration if it is still the active landmark. */
    fun release()
}

/**
 * The default [SkipTarget] — a process-wide registry of the host's main-content landmark, the native analogue
 * of the single global `<main id="main-content">` element every web SkipToContent shares. The host marks its
 * main content once (see `rememberMainContentAnchor`), which [register]s a focus action here for as long as it
 * is composed; [focusMainContent] invokes the most-recently-registered action. The slot is held in an
 * [AtomicReference] so registration, activation, and release stay coherent even though all three occur on the
 * main thread in practice.
 */
class RegistrySkipTarget : SkipTarget {
    private val action = AtomicReference<(() -> Unit)?>(null)

    /** True when a host landmark is currently registered — the native mirror of `#main-content` existing. */
    val hasTarget: Boolean get() = action.get() != null

    /**
     * Registers [focusAction] as the current main-content landmark, replacing any prior registration (a single
     * landmark wins, like the one `#main-content` id). Returns a [SkipTargetHandle] whose [SkipTargetHandle.release]
     * clears it again only if it is still the active one — so a freshly mounted screen that registered after this
     * one is never clobbered when this one disposes.
     */
    fun register(focusAction: () -> Unit): SkipTargetHandle {
        action.set(focusAction)
        return SkipTargetHandle { action.compareAndSet(focusAction, null) }
    }

    /**
     * Invokes the registered focus action and reports whether one was present — the native mirror of the web
     * `if (main) { main.focus(); main.scrollIntoView() }` guard. Returns false (a no-op) when no landmark is
     * registered, exactly as the web handler does nothing when `getElementById` returns `null`.
     */
    override fun focusMainContent(): Boolean {
        val focusAction = action.get() ?: return false
        focusAction()
        return true
    }
}

/**
 * The process-wide skip target singleton — the native analogue of the global `#main-content` landmark every
 * call-site shares. The host scaffold registers its main content once; every mounted SkipToContent then targets
 * it. A test constructs a throwaway [RegistrySkipTarget] (or a fake [SkipTarget]) so the singleton is never
 * polluted across cases.
 */
val ProcessSkipTarget: RegistrySkipTarget = RegistrySkipTarget()
