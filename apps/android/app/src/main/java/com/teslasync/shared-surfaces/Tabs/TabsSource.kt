// The id seam the Tabs surface binds to (the P1/S8 boundary), plus the production source and the deterministic
// test source — the native port of the only hook web/src/components/ui/Tabs.tsx reads: React `useId`. The web
// component calls `useId()` once to mint a stable, render-invariant id and derives every per-tab element id
// from it (`${tablistId}-tab-${key}`). The view (composable) performs NO work of its own; it renders against
// the id the ViewModel minted from this seam, satisfying the "data flows through the shared state holder, no
// direct work in the view" contract (ADR-002).
//
// `useId` returns an id that is (a) stable across re-renders of the same component instance and (b) unique
// across every instance in the tree. This seam mirrors that 1:1: [TabsIdSource.nextId] mints one id, the
// production [ProcessTabsIdSource] draws from a single process-wide monotonic counter so two strips never
// collide (the web tree-wide uniqueness), and [StaticTabsIdSource] returns a fixed value so a unit test /
// preview is deterministic and never depends on allocation order. The ViewModel calls `nextId()` exactly once
// in its constructor, so the id is stable for the surface's lifetime — the `useId` stability guarantee — and
// survives recomposition.
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed because the file is named after the
// surface (Tabs*) rather than its first top-level type; `InvalidPackageDeclaration` because the mandated
// surface directory (com/teslasync/shared-surfaces/Tabs) cannot form a valid Kotlin package — exactly as the
// sibling surfaces do.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tabs

import java.util.concurrent.atomic.AtomicLong

/**
 * The single seam the [TabsViewModel] depends on so it binds to an abstraction (the real process-counter
 * source ↔ a deterministic test source), never to a concrete allocator — the Android analogue of the web
 * `useId` dependency (the P1/S8 state-holder boundary for this surface).
 *
 * [nextId] mints one stable, tree-unique id (web `useId()`); the ViewModel calls it once so the surface's id
 * is render-invariant. No work touches the view.
 */
interface TabsIdSource {
    /** Mints one stable, tree-unique tablist id — the native mirror of a single `useId()` call. */
    fun nextId(): String
}

/**
 * The production [TabsIdSource] — draws from a single process-wide monotonic counter so every strip gets a
 * distinct id (the web `useId` tree-wide uniqueness) without any allocation-order coupling. The minted id is
 * opaque; only its stability + uniqueness matter, exactly as for the web id.
 */
class ProcessTabsIdSource : TabsIdSource {
    override fun nextId(): String = "$ID_PREFIX${COUNTER.getAndIncrement()}"

    private companion object {
        /** Opaque, human-greppable prefix for a minted id (the value itself is never shown to users). */
        const val ID_PREFIX: String = "tabs-"

        /** Process-wide monotonic source of distinct ids — the web tree-wide `useId` uniqueness. */
        val COUNTER: AtomicLong = AtomicLong(0)
    }
}

/**
 * A deterministic [TabsIdSource] over a caller-supplied [id] — used by previews (a fixed id) and unit tests
 * (an asserted id), so a test never depends on global allocation order and the production counter is never
 * advanced across cases.
 */
class StaticTabsIdSource(
    private val id: String = DEFAULT_TEST_ID,
) : TabsIdSource {
    override fun nextId(): String = id

    private companion object {
        /** A stable, recognisable id for previews / tests when the caller supplies none. */
        const val DEFAULT_TEST_ID: String = "tabs-preview"
    }
}
