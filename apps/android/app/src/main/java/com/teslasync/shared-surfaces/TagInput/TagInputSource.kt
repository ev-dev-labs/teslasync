// The data seam the TagInput surface binds to for the persisted tag list, plus the bindings a host wires it
// from. The view (composable) performs NO HTTP — it only collects state from the [TagInputViewModel], which
// drives this seam (ADR-002), satisfying the "no direct HTTP from the view" contract while reproducing the
// web data path that produces the field's `value`.
//
// In the web app the field is *controlled*: its `value` list and `onChange` come from the parent — there is
// no fetch inside the component (its hooks are `useTranslation` / `useAnnouncer` / `useId` /
// `useImperativeHandle`, none of which load data). The native self-contained surface reproduces both shapes:
//   • the controlled case (the parent already holds the tags) → [staticTagListSource], a single fresh
//     [Resource.Success] — used by previews, tests, and any caller that passes an initial list verbatim;
//   • the host-feed case (a caller that loads persisted tags, e.g. saved alert labels) → [asTagListSource]
//     over the host's own cache-then-network `Flow<Resource<List<String>>>`, so every prompt state —
//     loading / content / empty / stale / offline / error — renders from a genuine `Resource` lifecycle
//     rather than being fabricated (covenant: no silent drift).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TagInput) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located binding adapters.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.taginput

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * The single seam the [TagInputViewModel] depends on, so it binds to an abstraction (static source ↔ host
 * feed ↔ test fake) rather than to a concrete client — the Android counterpart of the web controlled-`value`
 * boundary. [tags] streams the seed list as a cache-then-network [Resource]; transport faults surface as
 * [Resource.Error] (keeping any cached list visible), never as a thrown exception. No HTTP touches the view.
 */
fun interface TagListSource {
    /** Streams the seed tag list (the web initial `value`), as a cache-then-network [Resource]. */
    fun tags(): Flow<Resource<List<String>>>
}

/**
 * Binds the surface to a list already in hand — the controlled web case where the parent passes `value`
 * straight to the field. Emits a single fresh [Resource.Success], so the surface seeds immediately with no
 * loading flash. Used by previews, tests, and any host holding the tags.
 */
fun staticTagListSource(
    tags: List<String>,
    fetchedAtMillis: Long = 0L,
): TagListSource = TagListSource { flowOf(Resource.Success(tags, fetchedAtMillis, stale = false)) }

/**
 * Binds the surface to a host's own cache-then-network feed of persisted tags (e.g. saved labels loaded from
 * the API). Re-collecting the flow performs the host's genuine cache-then-network refresh, which backs the
 * surface's stale auto-refresh + error-retry affordances. No HTTP touches the view.
 */
fun Flow<Resource<List<String>>>.asTagListSource(): TagListSource {
    val flow = this
    return TagListSource { flow }
}
