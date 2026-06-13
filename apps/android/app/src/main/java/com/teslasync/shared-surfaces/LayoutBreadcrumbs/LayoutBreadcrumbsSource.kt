// The data seam the LayoutBreadcrumbs shared surface binds to — the native analogue of the web
// `BreadcrumbOverridesContext` (web/src/components/layout/BreadcrumbOverridesContext.tsx). The web context lets a
// page push dynamic, friendly crumb labels (e.g. a drive's "196th Street -> Northeast 90th" instead of the static
// "Drive Detail") up to the single global breadcrumb slot, keyed by route, so the one breadcrumb row can show rich
// labels without every page rendering its own duplicate trail. This store is the native equivalent: an in-memory,
// observable registration map that pages write into and the surface reads through its view-model (P1/S8 boundary,
// ADR-002 — the view performs no business logic and no direct mutation).
//
// The web `register(id, map)` / `unregister(id)` round-trip and the shallow left-to-right merge (a later
// registration wins for the same route key, matching React's latest-effect-wins semantics) are reproduced verbatim
// in [InMemoryBreadcrumbOverridesStore]; the `if (v) merged[k] = v` blank-skip is reproduced by [register]'s
// `isNotBlank` filter. Like the web module (one provider mounted near the app root), one process-default instance
// is exposed via [BreadcrumbOverrides] so any page can register without prop-drilling a container — the faithful
// analogue of the single root-level React provider. The store is abstracted behind [BreadcrumbOverridesStore] so
// the merge logic runs without a UI and a test can inject its own instance.
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the port interface plus its production
// state holder co-located in one file; `InvalidPackageDeclaration` because the mandated surface directory
// (com/teslasync/shared-surfaces) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.concurrent.atomic.AtomicInteger

/**
 * A handle a page holds for the labels it registered — the native analogue of the unregister function the web
 * `useSetBreadcrumbOverrides` effect returns. [cancel] removes the page's contribution; it is idempotent, so a
 * `DisposableEffect`'s `onDispose` can call it safely.
 */
fun interface BreadcrumbRegistration {
    /** Removes the registered label map for this handle. Safe to call more than once. */
    fun cancel()
}

/**
 * The observable breadcrumb-label override store — the native `BreadcrumbOverridesContext` value. [overrides] is
 * the merged, render-ready map (route id -> friendly label) the surface reads; pages contribute via [register] and
 * withdraw via [unregister] (or the returned [BreadcrumbRegistration]). The production store is in-memory; a test
 * implements this interface directly so the surface's binding runs without a UI.
 */
interface BreadcrumbOverridesStore {
    /** The merged label overrides (route id -> label), recomputed on every registration change. */
    val overrides: StateFlow<Map<String, String>>

    /** Registers (or replaces) the [labels] for the explicit registration [id] — web `register(id, map)`. */
    fun register(
        id: Int,
        labels: Map<String, String>,
    )

    /** Removes the registration for [id] if present — web `unregister(id)`; a no-op when [id] is unknown. */
    fun unregister(id: Int)

    /**
     * Registers [labels] under a freshly allocated id and returns a [BreadcrumbRegistration] that withdraws them —
     * the native analogue of the web `useSetBreadcrumbOverrides` hook a page calls inside an effect.
     */
    fun register(labels: Map<String, String>): BreadcrumbRegistration
}

/**
 * The production [BreadcrumbOverridesStore]: a small, self-contained state holder backing the web context. It keeps
 * the per-registration maps keyed by id (insertion-ordered, so ascending ids merge last and a later registration
 * wins a key conflict — web "later registration wins"), and republishes the flattened, blank-filtered merge to
 * [overrides] on every change. Mutations use [MutableStateFlow.update] so concurrent registrations are consistent.
 */
class InMemoryBreadcrumbOverridesStore : BreadcrumbOverridesStore {
    private val registrations = MutableStateFlow<Map<Int, Map<String, String>>>(emptyMap())
    private val overridesState = MutableStateFlow<Map<String, String>>(emptyMap())
    private val nextId = AtomicInteger(1)

    override val overrides: StateFlow<Map<String, String>> = overridesState.asStateFlow()

    override fun register(
        id: Int,
        labels: Map<String, String>,
    ) {
        registrations.update { it + (id to labels) }
        recompute()
    }

    override fun unregister(id: Int) {
        registrations.update { if (it.containsKey(id)) it - id else it }
        recompute()
    }

    override fun register(labels: Map<String, String>): BreadcrumbRegistration {
        val id = nextId.getAndIncrement()
        register(id, labels)
        return BreadcrumbRegistration { unregister(id) }
    }

    private fun recompute() {
        val merged = LinkedHashMap<String, String>()
        for (map in registrations.value.values) {
            for ((key, value) in map) {
                if (value.isNotBlank()) merged[key] = value
            }
        }
        overridesState.value = merged
    }
}

/**
 * The process-default breadcrumb override store — the native analogue of the single web context provider mounted
 * near the app root. A page registers its dynamic crumb labels here (e.g. inside a `DisposableEffect`) so the
 * global [LayoutBreadcrumbs] slot can surface them; the surface reads the same instance by default.
 */
object BreadcrumbOverrides {
    /** The shared, app-wide store the surface and pages bind to by default. */
    val store: BreadcrumbOverridesStore = InMemoryBreadcrumbOverridesStore()

    /** Registers [labels] in the shared [store] and returns a handle that withdraws them — web hook analogue. */
    fun register(labels: Map<String, String>): BreadcrumbRegistration = store.register(labels)
}
