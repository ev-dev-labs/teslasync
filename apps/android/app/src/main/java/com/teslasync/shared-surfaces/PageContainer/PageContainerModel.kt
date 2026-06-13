// Pure, framework-free model + projection + diagnostics for the PageContainer shared surface — the native
// analogue of every decision the web component makes (web/src/components/layout/PageContainer.tsx) before it
// paints its header + body. No Compose, no Android, no HTTP: every declaration here is exercised off-device in
// the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): the page-chrome shell
// every parity page renders inside. It is NOT a data-fetcher — it receives its `loading` / `error` / `empty`
// flags and its `query` freshness as props from the page that owns the feed, and its only own side effect is
// pushing per-route breadcrumb label overrides up to the Layout. Concretely it draws:
//   • a header: an h1 [title], an optional [subtitle], and a trailing cluster (the freshness chip + a copy-link
//     button + the host `actions`) shown only when at least one trailing item exists; and
//   • a body, in the precedence loading > error > empty > content: a centred spinner, an error surface, an
//     empty surface, or the children wrapped in a page-level error boundary.
// The `query` (`useQuery` result, single or array) is folded to the single most-degraded freshness state via
// [pickWorstFreshness] (web `pickWorstQuery`) and surfaced by the chip — that is where the `stale` and
// `offline` states live. The `useSetBreadcrumbOverrides(breadcrumbLabels)` side effect is the producer half of
// [BreadcrumbOverridesStore] (web `BreadcrumbOverridesContext`); `useBreadcrumbs` is the Layout's consumer, NOT
// PageContainer's, so it is intentionally not reproduced here (honesty covenant: no silent drift).
//
// Why there is no Source/ViewModel (honesty covenant: no scope narrowing): the web component fetches nothing —
// it has no `useQuery()` call of its own; the `query` it renders is a result handed in by the page. So there is
// no cache-then-network feed to bind. The native-faithful shape is therefore a composable + this pure model,
// exactly like the equally presentational sibling Spinner / SectionErrorBoundary surfaces. The six states the
// prompt enumerates are all real and all reproduced: loading / error / empty live in the body
// ([classifyPageBody]); stale / offline live in the freshness chip ([pickWorstFreshness] +
// [io.teslasync.android.sharedsurfaces.datafreshness.DataFreshnessProjection]); content is the boundary-wrapped
// children. Each is reduced here and asserted off-device, doubling as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/PageContainer — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling DataFreshness / Spinner surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pagecontainer

import io.teslasync.android.sharedsurfaces.datafreshness.FreshnessSnapshot
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Canonical registry metadata for the PageContainer surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`PageContainer`).
 */
object PageContainerRegistration {
    /** Stable surface id (also the `viewModel`-style key prefix a host could bind the chrome with). */
    const val ID: String = "page-container"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PageContainer"
}

/**
 * The mutually-exclusive body surface the page chrome paints — the native mirror of the web component's
 * `loading ? … : error ? … : empty ? … : children` ladder. The freshness tiers (stale / offline) are NOT body
 * states: they live in the header chip, so the body can render content while the chip flags staleness, exactly
 * as on the web.
 */
enum class PageBodyState {
    /** A first load is in flight — render the centred brand spinner (web `loading` → `<Spinner size="lg" />`). */
    Loading,

    /** The page-owned fetch failed — render the error surface (web `error` → the red message card). */
    Error,

    /** The fetch resolved to nothing — render the empty surface (web `empty` → the muted message). */
    Empty,

    /** There is renderable content — render the children inside the page error boundary (web default branch). */
    Content,
}

/**
 * Reduce the host's body flags into the one body surface to paint, in the web precedence
 * loading > error > empty > content. Pure (no Compose), so every branch is exhaustively covered off-device.
 */
fun classifyPageBody(
    loading: Boolean,
    hasError: Boolean,
    empty: Boolean,
): PageBodyState =
    when {
        loading -> PageBodyState.Loading
        hasError -> PageBodyState.Error
        empty -> PageBodyState.Empty
        else -> PageBodyState.Content
    }

/**
 * How degraded a freshness state is, lowest to highest — the native mirror of the web `pickWorstQuery` rank
 * (`error > stale > fetching > fresh`), with the platform's honest error split (a last-known-cache failure is
 * [Offline], a no-cache failure is [HardError]). Declared in ascending severity so `ordinal` is the rank.
 */
enum class FreshnessSeverity {
    /** A successful, up-to-date fetch (web `fresh`). */
    Fresh,

    /** A refetch (or first load) is in flight (web `isFetching`). */
    Fetching,

    /** The value is past its staleness window (web `isStale`). */
    Stale,

    /** A failed refresh that still has last-known cache — the honest offline surface. */
    Offline,

    /** A hard failure with no cached value to fall back on (web `isError`). */
    HardError,
}

/** The [FreshnessSeverity] of a single snapshot, in the web precedence (error > stale > fetching > fresh). */
fun freshnessSeverity(snapshot: FreshnessSnapshot): FreshnessSeverity =
    when {
        snapshot.hardError -> FreshnessSeverity.HardError
        snapshot.offline -> FreshnessSeverity.Offline
        snapshot.stale -> FreshnessSeverity.Stale
        snapshot.fetching -> FreshnessSeverity.Fetching
        else -> FreshnessSeverity.Fresh
    }

/**
 * Fold a page's freshness inputs into the single most-degraded one so one header chip can stand in for the
 * whole page — the native mirror of the web `pickWorstQuery`. Returns `null` for an empty list (web treats an
 * empty `query` array the same as `undefined` → no chip). The first snapshot at the worst tier wins, matching
 * the web reducer's strict `rank > worstRank` (first-max) behaviour.
 */
fun pickWorstFreshness(snapshots: List<FreshnessSnapshot>): FreshnessSnapshot? = snapshots.maxByOrNull { freshnessSeverity(it).ordinal }

/**
 * Whether the header's trailing cluster renders at all — the native mirror of the web
 * `(actions || copyLink || resolvedQuery)` guard. When every trailing input is absent the header is just the
 * title column, with no empty trailing row.
 */
fun pageHasTrailingCluster(
    hasActions: Boolean,
    hasCopyLink: Boolean,
    hasFreshness: Boolean,
): Boolean = hasActions || hasCopyLink || hasFreshness

/**
 * The empty-surface message — the native mirror of the web `emptyMessage ?? \`No ${title} found.\``. A blank or
 * absent host message degrades to the localized [fallback] (the composable passes the "No data available"
 * catalog string), so the empty surface is never a blank box. Pure so the choice is unit-tested.
 */
fun pageEmptyMessage(
    custom: String?,
    fallback: String,
): String = custom?.trim()?.takeIf { it.isNotEmpty() } ?: fallback

/**
 * The error-surface message — the native mirror of the web `{error.message}` paragraph. A blank or absent
 * throwable message degrades to the localized [fallback] so the error surface always says something useful.
 * Pure so the choice is unit-tested without a Compose host.
 */
fun pageErrorMessage(
    message: String?,
    fallback: String,
): String = message?.trim()?.takeIf { it.isNotEmpty() } ?: fallback

/**
 * Merge a collection of per-owner override maps into the single active breadcrumb-overrides map, later owners
 * winning per route key. Pure so the merge is unit-tested off-device. Kept stable-ordered (insertion order of
 * owners, then keys) so a consumer reads a deterministic map.
 */
fun mergeBreadcrumbOverrides(perOwner: Collection<Map<String, String>>): Map<String, String> {
    val merged = LinkedHashMap<String, String>()
    perOwner.forEach(merged::putAll)
    return merged
}

/**
 * The producer-side state holder for per-route breadcrumb label overrides (P1/S8) — the native analogue of the
 * web `BreadcrumbOverridesContext` that `useSetBreadcrumbOverrides` pushes into and the Layout reads. Each
 * mounted [PageContainer] registers its labels under a stable owner token and unregisters on dispose; the
 * merged [overrides] flow is what a breadcrumb consumer observes. The store carries only developer-authored
 * route → label strings, never user data, so it is PII-safe.
 *
 * Mutation is expected on Compose's main thread (the [PageContainer] effect); [overrides] is a hot
 * [StateFlow] so a future breadcrumb consumer can collect it lifecycle-aware. Framework-free so the
 * register / merge / unregister contract is unit-tested off-device.
 */
class BreadcrumbOverridesStore {
    private val byOwner = LinkedHashMap<Any, Map<String, String>>()
    private val mutableOverrides = MutableStateFlow<Map<String, String>>(emptyMap())

    /** The merged, currently-active route → label overrides (later owners win per key). */
    val overrides: StateFlow<Map<String, String>> = mutableOverrides.asStateFlow()

    /** A snapshot of the merged overrides, for tests / one-shot reads. */
    val current: Map<String, String> get() = mutableOverrides.value

    /** Registers (or replaces) [owner]'s [labels] and republishes the merged map (web set-on-mount). */
    fun register(
        owner: Any,
        labels: Map<String, String>,
    ) {
        byOwner[owner] = labels
        publish()
    }

    /** Removes [owner]'s labels and republishes the merged map (web clear-on-unmount). */
    fun unregister(owner: Any) {
        if (byOwner.remove(owner) != null) publish()
    }

    private fun publish() {
        mutableOverrides.value = mergeBreadcrumbOverrides(byOwner.values)
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the page
 * title, the error message, or any breadcrumb label — so a diagnostics line can never leak what page a user
 * was on. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it once
 * per surface open.
 */
object PageContainerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = PageContainerRegistration.SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
