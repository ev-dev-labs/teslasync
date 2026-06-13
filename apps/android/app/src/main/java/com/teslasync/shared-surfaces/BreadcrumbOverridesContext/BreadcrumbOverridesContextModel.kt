// Pure, framework-free model + registry + coordinator + diagnostics for the BreadcrumbOverridesContext
// shared surface — the native analogue of every decision the web source makes before any UI is involved
// (web/src/components/layout/BreadcrumbOverridesContext.tsx). No Compose, no Android framework, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the
// composable layer (BreadcrumbOverridesContext.kt) a thin binding.
//
// What the web source actually is (and therefore the COMPLETE behaviour this surface reproduces): a
// per-render breadcrumb-label override BRIDGE, not a data-fetching view. Pages push dynamic labels keyed by
// route pattern (e.g. `{"/drives/:id": "196th Street -> Northeast 90th"}`) up to the single global Layout
// breadcrumb so the one breadcrumb slot can show rich labels without each page rendering its own duplicate
// row. The web provider keeps a `Map<id, overrideMap>` in `useState`, exposes `register` / `unregister`,
// and MERGES every registered map shallow-left-to-right (a later registration wins for the same route key,
// matching React's latest-effect-wins semantics) while dropping blank values. `useBreadcrumbOverrides()`
// reads the merged map (default `{}`); `useSetBreadcrumbOverrides(map)` registers a page's labels for the
// current route and unregisters on cleanup. This file reproduces that merge contract exactly: the keyed
// registry, the blank-dropping insertion-ordered merge, the register/unregister lifecycle, and the
// `override ?? fallback` resolution the downstream `useBreadcrumbs(overrides)` consumer performs.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface fetches nothing. Inventing a network lifecycle would add behaviour the web spec does not have
// (Honesty Covenant: no scope narrowing, no silent drift) — exactly the rationale the accepted
// ChartHiddenSeriesContext / ChartTimeRangeContext / NavigationGuardProvider siblings document. Its real,
// fully-reproduced states are the ones the web source expresses and are unit-tested below:
//   - absent        <- no provider / no registrations: the merged map is empty (web ctx default `{}`).
//   - empty-merge   <- registered maps carry only blank values: they contribute nothing (web `if (v)`).
//   - some-overrides<- one or more route patterns overridden; a later registration wins for the same key.
//   - register/unregister <- the transitions between those states as pages mount and unmount.
// The web source renders no static copy of its own (it renders `children`), so the surface is anonymous and
// carries no i18n keys — there is none to map, and none is invented. The override VALUES are caller-supplied
// dynamic data (a resolved entity name), not static UI copy, so they are not i18n keys either.
//
// Two divergences from the web source, disclosed here (Honesty Covenant #9, documented not silent):
//   1. The web allocates registration ids from a module-global `let nextId = 1`. Here [BreadcrumbOverridesCoordinator]
//      allocates them per-instance, which is strictly safer (no cross-provider id collision) and has no
//      observable difference — ids are opaque internal merge keys, never surfaced or logged.
//   2. Route-`{{param}}` substitution (e.g. "Drive #{{id}}") is part of the SEPARATE `useBreadcrumbs` /
//      `Breadcrumbs` surface, not of this override context; it is therefore out of scope here and lives with
//      that surface's own prompt. [resolveBreadcrumbLabel] reproduces only this context's bridge point —
//      the `override ?? fallback` choice the consumer makes against the merged map.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/BreadcrumbOverridesContext — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier),
// so the package intentionally diverges from the path, exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.breadcrumboverridescontext

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A breadcrumb-label override map keyed by route pattern — the native analogue of the web
 * `BreadcrumbOverrideMap = Partial<Record<string, string>>`. A key is a route pattern (e.g.
 * `"/drives/:id"`); a value is the friendly label that replaces that route's default breadcrumb label
 * (e.g. `"Trip to office"`). The web `Partial`/`undefined` "no override" case is represented natively by a
 * key being absent or — defensively — by a blank value, both of which [normalizeOverrides] and the merge
 * treat as "no override", matching the web `if (v)` blank-drop.
 */
typealias BreadcrumbOverrideMap = Map<String, String>

/**
 * Drops blank-valued entries from [map] so a `""` label never shadows a route's default — the native mirror
 * of the web merge's `if (v) merged[k] = v` guard, applied at registration time. Idempotent: normalizing an
 * already-normalized map returns an equal map, so it is safe to call at every boundary.
 */
fun normalizeOverrides(map: BreadcrumbOverrideMap): BreadcrumbOverrideMap = map.filterValues { it.isNotEmpty() }

/**
 * Merges [registrations] into one override map shallow-left-to-right — the native mirror of the web
 * provider's `overrides` `useMemo`:
 * ```
 * for (const map of registrations.values())
 *   for (const [k, v] of Object.entries(map)) if (v) merged[k] = v
 * ```
 * [registrations] MUST be iterated in registration (insertion) order so a later registration wins for the
 * same route key (React's latest-effect-wins semantics); the caller passes a `LinkedHashMap.values()` to
 * guarantee that. Blank values are dropped, so a registration of `{"/x": ""}` contributes nothing.
 */
fun mergeOverrideRegistrations(registrations: Collection<BreadcrumbOverrideMap>): BreadcrumbOverrideMap {
    val merged = LinkedHashMap<String, String>()
    for (map in registrations) {
        for ((key, value) in map) {
            if (value.isNotEmpty()) merged[key] = value
        }
    }
    return merged
}

/**
 * Resolves the breadcrumb label for [routePattern] — the native mirror of the single bridge point the
 * downstream web `useBreadcrumbs(overrides)` consumer performs: `const label = override ?? t(fallback)`. A
 * present (non-blank) override for the route wins; otherwise the caller's [fallbackLabel] (the route's i18n
 * default, resolved by the consumer at its own render boundary) is returned. Pure, so the override-vs-fallback
 * choice is unit-tested off-device without route matching, which belongs to the separate Breadcrumbs surface.
 */
fun resolveBreadcrumbLabel(
    overrides: BreadcrumbOverrideMap,
    routePattern: String,
    fallbackLabel: String,
): String = overrides[routePattern]?.takeIf { it.isNotEmpty() } ?: fallbackLabel

/**
 * The keyed set of active per-page override registrations — the native port of the web provider's
 * `useState<ReadonlyMap<number, BreadcrumbOverrideMap>>`. Insertion order is preserved (a `LinkedHashMap`)
 * so [merged] iterates registrations in registration order and a later registration wins for the same route
 * key, matching the web `registrations.values()` merge order. Re-[put]ting an existing id replaces its map
 * in place WITHOUT changing its iteration position (LinkedHashMap insertion-order semantics), mirroring the
 * web `Map.set` on an existing key. A plain class (no Compose, no coroutines) so the membership + merge
 * logic is unit-tested off-device.
 */
class BreadcrumbOverridesRegistry {
    private val registrations = LinkedHashMap<Int, BreadcrumbOverrideMap>()

    /** Registers (or replaces) the normalized override map for [id] — the web `register(id, map)`. */
    fun put(
        id: Int,
        map: BreadcrumbOverrideMap,
    ) {
        registrations[id] = normalizeOverrides(map)
    }

    /** Removes the registration for [id], returning true when one was present — the web `unregister(id)`. */
    fun remove(id: Int): Boolean = registrations.remove(id) != null

    /** The merged, blank-dropped override map across every registration in registration order (web `overrides`). */
    fun merged(): BreadcrumbOverrideMap = mergeOverrideRegistrations(registrations.values)

    /** The number of currently-registered maps (test/observability helper). */
    val size: Int get() = registrations.size
}

/**
 * The narrow registration surface a page binds to — the native port of the `register` half of the web
 * `BreadcrumbOverridesContextValue` (`{ overrides, register, unregister }`). A consumer ([SetBreadcrumbOverrides])
 * calls [register] with its label map and receives an unregister function to run on dispose, exactly as the
 * web `useSetBreadcrumbOverrides` registers in an effect and unregisters in its cleanup. The merged-map READ
 * half of the context value is exposed separately through the Compose value local so a reader recomposes on
 * change without holding the controller.
 */
interface BreadcrumbOverridesController {
    /**
     * Registers [map] for the current page and returns an unregister function — the web `register` paired
     * with `unregister`. Call the returned function from a Compose `DisposableEffect` cleanup. A blank-only
     * map registers but contributes nothing after the merge's blank-drop, matching the web.
     */
    fun register(map: BreadcrumbOverrideMap): () -> Unit
}

/**
 * The no-op controller used when no provider is mounted — the native analogue of the web
 * `useSetBreadcrumbOverrides` early-returning when `useContext` is `null` (`if (!ctx) return`). Lets a page
 * call [SetBreadcrumbOverrides] inside an isolated component test or preview without the full provider tree:
 * registration is a no-op returning a no-op unregister.
 */
object NoopBreadcrumbOverridesController : BreadcrumbOverridesController {
    /** No-op registration: returns a no-op unregister (web `if (!ctx) return`). */
    override fun register(map: BreadcrumbOverrideMap): () -> Unit = {}
}

/**
 * The provider-owned override state holder — the framework-free heart of the surface, the native port of the
 * web provider body (the `registrations` state, the merged `overrides` `useMemo`, and the `register` /
 * `unregister` callbacks). It owns no Compose and no Android, so the whole merge lifecycle is unit-tested
 * off-device. The composable in BreadcrumbOverridesContext.kt only `remember`s one of these, collects
 * [overrides] to provide the merged map to readers, and provides the coordinator itself to setters.
 *
 * Each [register] allocates a fresh per-instance id and appends it to the registry, so a later registration
 * wins for a shared route key (web latest-effect-wins); the returned unregister removes exactly that id. The
 * id counter is per-coordinator rather than the web's module-global `nextId` (a disclosed, observable-free
 * divergence — ids are opaque internal keys).
 */
class BreadcrumbOverridesCoordinator : BreadcrumbOverridesController {
    private val registry = BreadcrumbOverridesRegistry()
    private val mutableOverrides = MutableStateFlow<BreadcrumbOverrideMap>(emptyMap())
    private var nextId = FIRST_REGISTRATION_ID

    /** The live merged override map (web `overrides`); readers collect this and recompose on change. */
    val overrides: StateFlow<BreadcrumbOverrideMap> = mutableOverrides.asStateFlow()

    override fun register(map: BreadcrumbOverrideMap): () -> Unit {
        val id = nextId++
        registry.put(id, map)
        recompute()
        return {
            if (registry.remove(id)) recompute()
        }
    }

    /** The current number of active registrations (test/observability helper). */
    val registrationCount: Int get() = registry.size

    // Re-derives the merged map after any registration change so the collected StateFlow re-emits, mirroring
    // the web `overrides` useMemo recomputing whenever `registrations` changes.
    private fun recompute() {
        mutableOverrides.value = registry.merged()
    }
}

/** The first registration id a [BreadcrumbOverridesCoordinator] hands out — the web initial `nextId = 1`. */
const val FIRST_REGISTRATION_ID: Int = 1

/**
 * PII-safe registration for this surface (P1/S11). [SLUG] is the prompt-mandated surface slug emitted with
 * the one-shot `view.opened` diagnostic; [ID] is its stable kebab-case identifier. Only the slug is ever
 * logged — never a route pattern nor an override label — so a diagnostics line can never leak which page a
 * user is viewing or the (possibly location-derived) friendly label it resolved.
 */
object BreadcrumbOverridesContextRegistration {
    /** Stable kebab-case surface id. */
    const val ID: String = "breadcrumb-overrides-context"

    /** Diagnostics surface slug emitted with `view.opened` (the prompt-mandated slug). */
    const val SLUG: String = "BreadcrumbOverridesContext"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface first composes (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on the `view.opened` diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only [BreadcrumbOverridesContextRegistration.SLUG]
 * (P1/S11) — never a route pattern or an override label, so a diagnostics line can never leak which page a
 * user is on or the friendly label resolved for it. Kept free of Compose so it is unit-tested with a
 * recording [Logger]; the provider's first-composition effect calls it once per surface open.
 */
fun recordBreadcrumbOverridesContextOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to BreadcrumbOverridesContextRegistration.SLUG))
}
