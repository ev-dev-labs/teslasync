// The id seam the Tooltip surface binds to (the P1/S8 boundary), plus the production source and the
// deterministic test source — the native port of the only hook web/src/components/ui/Tooltip.tsx reads:
// React `useId`. The web component calls `useId()` once to mint a stable, render-invariant id, gives the
// tooltip body that id (`role="tooltip"`), and adds it to the trigger's `aria-describedby` so assistive
// technologies announce the tooltip after the trigger's own name. The view (composable) performs NO work of
// its own; it renders against the id the ViewModel minted from this seam, satisfying the "data flows through
// the shared state holder, no direct work in the view" contract (ADR-002).
//
// `useId` returns an id that is (a) stable across re-renders of the same component instance and (b) unique
// across every instance in the tree. This seam mirrors that 1:1: [TooltipIdSource.nextId] mints one id, the
// production [ProcessTooltipIdSource] draws from a single process-wide monotonic counter so two tooltips never
// collide (the web tree-wide uniqueness), and [StaticTooltipIdSource] returns a fixed value so a unit test /
// preview is deterministic and never depends on allocation order. The ViewModel calls `nextId()` exactly once
// in its constructor, so the id is stable for the surface's lifetime — the `useId` stability guarantee — and
// survives recomposition.
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed because the file is named after the
// surface (Tooltip*) rather than its first top-level type; `InvalidPackageDeclaration` because the mandated
// surface directory (com/teslasync/shared-surfaces/Tooltip) cannot form a valid Kotlin package — exactly as
// the sibling surfaces do.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tooltip

import java.util.concurrent.atomic.AtomicLong

/**
 * The single seam the [TooltipViewModel] depends on so it binds to an abstraction (the real process-counter
 * source ↔ a deterministic test source), never to a concrete allocator — the Android analogue of the web
 * `useId` dependency (the P1/S8 state-holder boundary for this surface).
 *
 * [nextId] mints one stable, tree-unique id (web `useId()`); the ViewModel calls it once so the surface's id
 * is render-invariant. No work touches the view.
 */
interface TooltipIdSource {
    /** Mints one stable, tree-unique tooltip id — the native mirror of a single `useId()` call. */
    fun nextId(): String
}

/**
 * The production [TooltipIdSource] — draws from a single process-wide monotonic counter so every tooltip gets
 * a distinct id (the web `useId` tree-wide uniqueness) without any allocation-order coupling. The minted id is
 * opaque; only its stability + uniqueness matter, exactly as for the web id.
 */
class ProcessTooltipIdSource : TooltipIdSource {
    override fun nextId(): String = "$ID_PREFIX${COUNTER.getAndIncrement()}"

    private companion object {
        /** Opaque, human-greppable prefix for a minted id (the value itself is never shown to users). */
        const val ID_PREFIX: String = "tooltip-"

        /** Process-wide monotonic source of distinct ids — the web tree-wide `useId` uniqueness. */
        val COUNTER: AtomicLong = AtomicLong(0)
    }
}

/**
 * A deterministic [TooltipIdSource] over a caller-supplied [id] — used by previews (a fixed id) and unit tests
 * (an asserted id), so a test never depends on global allocation order and the production counter is never
 * advanced across cases.
 */
class StaticTooltipIdSource(
    private val id: String = DEFAULT_TEST_ID,
) : TooltipIdSource {
    override fun nextId(): String = id

    private companion object {
        /** A stable, recognisable id for previews / tests when the caller supplies none. */
        const val DEFAULT_TEST_ID: String = "tooltip-preview"
    }
}
