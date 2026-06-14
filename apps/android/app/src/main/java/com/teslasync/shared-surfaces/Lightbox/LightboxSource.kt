// The data seam the Lightbox surface binds to for its single (host-supplied) data source — the native
// analogue of the web component's `images` prop (web/src/components/ui/Lightbox.tsx). The web viewer is a
// controlled component handed its gallery directly; the native surface keeps the view free of I/O (ADR-002)
// by binding the gallery through this seam, which the [LightboxViewModel] drives. A concrete adapter over a
// host-provided [LightboxGalleryProvider] backs it in production (e.g. a vehicle-photos screen); a test
// fake backs it in unit tests.
//
// The gallery is carried as a cache-then-network [Resource] feed (ADR-013) so the surface's
// loading / content / empty / error / stale / offline matrix folds out of the same contract every other
// surface uses — the StatusBar precedent for a local data source. No HTTP and no persistence touch the view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Lightbox) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `Lightbox*` filename cannot match the
// `LightboxSource` seam plus its co-located provider + store types.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.lightbox

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The seam the [LightboxViewModel] depends on so it binds to an abstraction (a host-supplied gallery ↔ a
 * test fake), never a concrete client. The gallery is delivered as a cache-then-network [Resource] feed so
 * the surface's loading / content / empty / error / stale / offline states fold out of one contract. No HTTP
 * touches the view.
 */
interface LightboxSource {
    /** The gallery feed: loading → resolved, with freshness flagged honestly. */
    fun gallery(): Flow<Resource<LightboxGallery>>

    /** (Re)loads the gallery from the provider — drives the loading→content (and offline) transitions. */
    fun refresh()
}

/**
 * The host boundary that loads the gallery — the native analogue of the web caller passing `images`. A pure
 * read seam so the store is testable with an in-memory provider and a load failure can be exercised
 * deterministically. [load] may throw; the store treats a failure as offline/last-known when a prior gallery
 * exists, or a hard error otherwise.
 */
fun interface LightboxGalleryProvider {
    /** Returns the gallery to display. May throw to exercise the error/offline branches. */
    fun load(): LightboxGallery
}

/**
 * Trivial [LightboxGalleryProvider] over an already-resolved [gallery] — the default seam for previews,
 * tests, and hosts whose photos are already in memory (the common web case where `images` is a static prop).
 */
class InMemoryLightboxGalleryProvider(
    private val gallery: LightboxGallery,
) : LightboxGalleryProvider {
    override fun load(): LightboxGallery = gallery
}

/**
 * The shared gallery store — the cache-then-network feed every observer of this surface shares. The feed
 * starts [Resource.Loading] (pre-fetch). [refresh] reads the provider and resolves it to [Resource.Success];
 * a load failure resolves to [Resource.Error] (offline/last-known when a prior gallery exists, a hard error
 * otherwise). A refresh over an existing gallery flags it stale until the new read lands.
 *
 * @param provider the host gallery loader (an [InMemoryLightboxGalleryProvider] in the static case).
 * @param clock injectable time source for the freshness stamp; tests pass a deterministic clock.
 */
class LightboxGalleryStore(
    private val provider: LightboxGalleryProvider,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private val feed =
        MutableStateFlow<Resource<LightboxGallery>>(
            Resource.Loading(cached = null, fetchedAt = null, stale = false),
        )

    /** The reactive gallery feed shared by every observer. */
    fun gallery(): StateFlow<Resource<LightboxGallery>> = feed.asStateFlow()

    /** Reads the provider into the feed; a refresh over a cached gallery flags it stale until it lands. */
    fun refresh() {
        val current = feed.value.cached
        if (current != null) {
            feed.value = Resource.Loading(cached = current, fetchedAt = null, stale = true)
        }
        feed.value =
            runCatching { provider.load() }
                .fold(
                    onSuccess = { Resource.Success(it, fetchedAt = clock(), stale = false) },
                    onFailure = {
                        Resource.Error(cached = current, fetchedAt = clock(), stale = current != null, error = it)
                    },
                )
    }

    companion object {
        /** Builds a store over an in-memory [gallery] — the static-`images` case. */
        fun of(gallery: LightboxGallery): LightboxGalleryStore = LightboxGalleryStore(InMemoryLightboxGalleryProvider(gallery))
    }
}

/**
 * Binds the surface to a shared [LightboxGalleryStore]. No HTTP touches the view.
 *
 * @param store the shared gallery store the host wires up.
 */
class StoreLightboxSource(
    private val store: LightboxGalleryStore,
) : LightboxSource {
    override fun gallery(): Flow<Resource<LightboxGallery>> = store.gallery()

    override fun refresh() = store.refresh()
}
