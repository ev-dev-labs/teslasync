// The data port the StickyCompactHero shared surface binds to — the native analogue of the `status` prop the web
// bar receives (web/src/components/status/StickyCompactHero.tsx). The web component is purely presentational: its
// parent (the SystemStatusPage / `StatusHero`) derives the instance health from a cache-then-network health query
// and hands the resolved [HeroStatus] down as a prop. The native port honours that lifecycle rather than
// flattening it: the host supplies the status as a `Flow<Resource<HeroStatus>>` so the bar can render the full
// loading / content / stale / offline / error matrix the platform contract mandates, never inventing a feed the
// surface does not own. The view never performs HTTP; a concrete adapter over the host's health feed (or a test
// fake) drives this seam (the P1/S8 boundary, ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StickyCompactHero) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the co-located builders alongside the
// namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickycompacthero

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The seam the [StickyCompactHeroViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store, repository, or the network. [status] is the cache-then-network instance-health feed
 * (the resolved value the web parent passes as the `status` prop). No HTTP touches the view.
 */
interface StickyCompactHeroSource {
    /** The instance health as a cache-then-network feed — the resolved web `status` prop, with its lifecycle. */
    fun status(): Flow<Resource<HeroStatus>>
}

/**
 * Builds a [StickyCompactHeroSource] from an explicit producer — the test/host seam used to drive the status feed
 * deterministically while exercising the real projection.
 */
fun stickyCompactHeroSource(status: () -> Flow<Resource<HeroStatus>>): StickyCompactHeroSource =
    object : StickyCompactHeroSource {
        override fun status(): Flow<Resource<HeroStatus>> = status()
    }

/**
 * The default status feed: a single resolved [HeroStatus.Unknown] emission — the honest "status not yet known"
 * face the web bar shows for the `unknown` status. Used when a host has not (yet) wired its health feed into the
 * seam, so the surface renders the unknown bar rather than fabricating a health (documented divergence, not
 * silent drift).
 */
fun unknownStatus(): Flow<Resource<HeroStatus>> = flowOf(Resource.Success(HeroStatus.Unknown, fetchedAt = 0L, stale = false))
