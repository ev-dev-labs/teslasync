// Pure, framework-free model + projection + diagnostics for the DataFreshness shared surface — the native
// analogue of web/src/components/data-display/DataFreshness.tsx (and its `DataFreshnessAuto` wrapper). No
// Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a tiny
// query-result-driven freshness chip — a status dot + icon + relative-time label ("3m ago", "updating…",
// "error") that surfaces the health of a data fetch. It derives four states from a TanStack Query result
// with the precedence error > fetching > stale > fresh:
//   • fresh    — a successful fetch with no refetch in flight and not past staleTime;
//   • fetching — a refetch is in flight (animated dot ring + spinning icon);
//   • stale    — the value is past its staleTime (amber);
//   • error    — the fetch failed (red, wifi-off icon).
// The `DataFreshnessAuto` wrapper derives every prop from a `useQuery()` result and adds `forceStaleAfterMs`
// (force amber once a value ages past a window — used for long-`staleTime` continuous aggregates) plus a
// `refetchable` toggle (clicking refetches).
//
// How that maps onto the native shared state-holder layer (P1/S8, ADR-002): the surface binds the Charging
// domain feed (the web doc-comment's own example: `useChargingHistory`) through [DataFreshnessSource]. Its
// cache-then-network [io.teslasync.shared.core.data.repo.Resource] is projected onto the shared
// [io.teslasync.android.data.UiState] (loading / content / empty / stale / offline / error) and then folded
// here into a [FreshnessSnapshot]. The web `isError` splits honestly into two native states: a hard error
// with no cache → [FreshnessStatus.Error]; an error that still has last-known cache → [FreshnessStatus.Offline]
// (the P3 "offline / last known" surface the platform UiState contract makes explicit). Everything below is
// framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DataFreshness — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datafreshness

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the DataFreshness surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`DataFreshness`).
 */
object DataFreshnessRegistration {
    /** Stable surface id (also the `viewModel` key prefix the host binds the chip with). */
    const val ID: String = "data-freshness"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DataFreshness"
}

/**
 * The four web freshness states plus the explicit [Offline] refinement the native cache-then-network
 * contract surfaces. [slug] is the PII-free state word interpolated into the `Data freshness: {state}`
 * accessibility label (the native mirror of the web `aria-label` carrying the literal `status`).
 */
enum class FreshnessStatus(
    val slug: String,
) {
    /** A successful fetch, not refetching, not past its staleness window (web `fresh`). */
    Fresh("fresh"),

    /** A refetch (or first load) is in flight (web `fetching`). */
    Fetching("fetching"),

    /** The value is past its staleness window (web `stale`). */
    Stale("stale"),

    /** A hard failure with no cached value to fall back on (web `error`). */
    Error("error"),

    /** A failed refresh that still has last-known cache — the honest "offline / last known" surface. */
    Offline("offline"),
}

/** The relative-time bucket a label resolves to — the native mirror of the web `formatRelativeTime`. */
enum class RelativeUnit {
    /** Held stable for the whole first minute (web `< 60s` → "just now"). */
    JustNow,

    /** Whole minutes (web `< 3600s`). */
    Minutes,

    /** Whole hours (web `< 86_400s`). */
    Hours,

    /** Whole days (web `< 604_800s`). */
    Days,

    /** Whole weeks (web fall-through, keeps day-cadence aggregates sensible). */
    Weeks,

    /** A refetch is in flight (web "updating…"). */
    Updating,

    /** A hard failure (web "error"). */
    Error,

    /** Nothing to show — never updated (web empty relative-time string). */
    None,
}

/**
 * A resolved relative-time label, framework-free so it is unit-tested off-device. [unit] selects the i18n
 * string the composable resolves; [value] is the whole-unit count for [RelativeUnit.Minutes] / [Hours] /
 * [Days] / [Weeks] and is `0` for the unit-less cases.
 */
data class RelativeLabel(
    val unit: RelativeUnit,
    val value: Int = 0,
)

/** Which tooltip / accessibility state-description the chip exposes (web `title`). */
enum class TooltipKind {
    /** A reduced-motion refetch in flight (web "Updating…"). */
    Updating,

    /** A known last-fetch time (web "Last updated: {time}"). */
    LastUpdated,

    /** No successful fetch yet (web "Never updated"). */
    NeverUpdated,
}

/**
 * The resolved tooltip the chip announces. [atMs] carries the epoch-millisecond stamp the composable formats
 * to a locale-aware time-of-day for [TooltipKind.LastUpdated], and is `null` for the other kinds.
 */
data class FreshnessTooltip(
    val kind: TooltipKind,
    val atMs: Long? = null,
)

/**
 * The freshness-relevant, PII-free projection of a feed's [UiState] — it carries no rows, only the freshness
 * signals the chip needs. Folded from [UiState] by [toFreshnessSnapshot] and rendered by
 * [DataFreshnessProjection.render], so neither the ViewModel nor the view ever re-derives the contract.
 *
 * @property updatedAtMs epoch-millisecond stamp of the last successful fetch, or `null` when nothing has
 *   loaded (web `dataUpdatedAt > 0 ? dataUpdatedAt : null`).
 * @property fetching whether a first load or a background refetch is in flight (web `isFetching`).
 * @property stale whether the value is past its staleness window (web `isStale`).
 * @property hardError whether the fetch failed with no cached value to show (web `isError`, no cache).
 * @property offline whether a failed refresh still has last-known cache (the explicit offline surface).
 * @property hasData whether any value is available to render.
 * @property empty whether a successful fetch resolved to no rows.
 */
data class FreshnessSnapshot(
    val updatedAtMs: Long?,
    val fetching: Boolean,
    val stale: Boolean,
    val hardError: Boolean,
    val offline: Boolean,
    val hasData: Boolean,
    val empty: Boolean,
) {
    companion object {
        /** The initial, pre-collection snapshot: a first load with nothing cached (web initial `isFetching`). */
        fun loading(): FreshnessSnapshot =
            FreshnessSnapshot(
                updatedAtMs = null,
                fetching = true,
                stale = false,
                hardError = false,
                offline = false,
                hasData = false,
                empty = false,
            )
    }
}

/**
 * The fully-resolved render state the composable paints — the native mirror of every value the web
 * `DataFreshness` derives between its props and the rendered `<span>`. Pure so the composable only resolves
 * strings + colors from it.
 *
 * @property status the freshness tier (drives color + icon).
 * @property label the relative-time label (drives the chip text; [RelativeUnit.None] paints no text).
 * @property tooltip the announced state-description (web `title`).
 * @property showPing whether the expanding dot ring animates (web `status === 'fetching' && !reduce`).
 * @property showPulse whether the dot pulses for a background refetch (web `isBackgroundRefetch && !reduce`).
 * @property spin whether the icon spins (web fetching `animate-spin && !reduce`).
 * @property refreshable whether tapping refetches (web `onRefresh && !isFetching`).
 */
data class FreshnessRender(
    val status: FreshnessStatus,
    val label: RelativeLabel,
    val tooltip: FreshnessTooltip,
    val showPing: Boolean,
    val showPulse: Boolean,
    val spin: Boolean,
    val refreshable: Boolean,
)

/**
 * Folds the platform [UiState] onto the freshness signals (PII-free — no rows escape). The web
 * `updatedAt`/`isFetching`/`isStale`/`isError` map onto the cache-then-network UiState as documented on
 * [FreshnessSnapshot]; a hard error (no cache) and an error-with-cache (offline / last known) are kept
 * distinct so the chip can paint the honest offline surface the P3 contract mandates.
 */
fun <T> UiState<T>.toFreshnessSnapshot(): FreshnessSnapshot =
    FreshnessSnapshot(
        updatedAtMs = fetchedAt,
        fetching = isLoading || refreshing,
        stale = stale,
        hardError = isError,
        offline = hasError && hasData,
        hasData = hasData,
        empty = isEmpty,
    )

/**
 * Pure projection of a [FreshnessSnapshot] into the render state — the native mirror of everything the web
 * `DataFreshness` decides between its props and the rendered chip. Framework-free so the whole contract is
 * covered by the JVM unit gate without a Compose host.
 */
object DataFreshnessProjection {
    private const val SECONDS_PER_MINUTE = 60L
    private const val SECONDS_PER_HOUR = 3_600L
    private const val SECONDS_PER_DAY = 86_400L
    private const val SECONDS_PER_WEEK = 604_800L
    private const val MILLIS_PER_SECOND = 1_000L

    /**
     * Projects [snapshot] at wall-clock [nowMs] into the render state. [reduceMotion] suppresses the dot
     * ring / pulse / icon spin (web reduced-motion branch); [refetchable] is the host's manual-refresh
     * toggle (web `DataFreshnessAuto.refetchable`); [forceStaleAfterMs] forces the stale tier once the
     * value ages past the window even when the feed has not flagged it (web `forceStaleAfterMs`).
     */
    fun render(
        snapshot: FreshnessSnapshot,
        nowMs: Long,
        reduceMotion: Boolean,
        refetchable: Boolean,
        forceStaleAfterMs: Long? = null,
    ): FreshnessRender {
        val effectiveStale = snapshot.stale || isForcedStale(snapshot.updatedAtMs, nowMs, forceStaleAfterMs)
        val status = statusFor(snapshot, effectiveStale)
        val backgroundRefetch = snapshot.fetching && snapshot.hasData
        return FreshnessRender(
            status = status,
            label = relativeLabel(snapshot, nowMs),
            tooltip = tooltipFor(snapshot, reduceMotion),
            showPing = status == FreshnessStatus.Fetching && !reduceMotion,
            showPulse = backgroundRefetch && !reduceMotion,
            spin = snapshot.fetching && !reduceMotion,
            refreshable = refetchable && !snapshot.fetching,
        )
    }

    /**
     * The freshness tier, in the web precedence error > fetching > stale > fresh, with the error tier split
     * into a hard [FreshnessStatus.Error] (no cache) and [FreshnessStatus.Offline] (last-known cache).
     */
    fun statusFor(
        snapshot: FreshnessSnapshot,
        effectiveStale: Boolean,
    ): FreshnessStatus =
        when {
            snapshot.hardError -> FreshnessStatus.Error
            snapshot.offline -> FreshnessStatus.Offline
            snapshot.fetching -> FreshnessStatus.Fetching
            effectiveStale -> FreshnessStatus.Stale
            else -> FreshnessStatus.Fresh
        }

    /**
     * The relative-time label, mirroring the web `relativeTime`: a bucketed "x ago" when a known time exists
     * and no refetch is in flight, else "updating…" while fetching, else "error" on a hard failure, else
     * nothing (never updated).
     */
    fun relativeLabel(
        snapshot: FreshnessSnapshot,
        nowMs: Long,
    ): RelativeLabel {
        val updatedAt = snapshot.updatedAtMs
        return when {
            updatedAt != null && !snapshot.fetching -> bucket(updatedAt, nowMs)
            snapshot.fetching -> RelativeLabel(RelativeUnit.Updating)
            snapshot.hardError -> RelativeLabel(RelativeUnit.Error)
            else -> RelativeLabel(RelativeUnit.None)
        }
    }

    /**
     * The announced tooltip / state-description, mirroring the web `title`: a reduced-motion refetch shows
     * "Updating…", a known last-fetch time shows "Last updated: {time}", otherwise "Never updated".
     */
    fun tooltipFor(
        snapshot: FreshnessSnapshot,
        reduceMotion: Boolean,
    ): FreshnessTooltip =
        when {
            snapshot.fetching && reduceMotion -> FreshnessTooltip(TooltipKind.Updating)
            snapshot.updatedAtMs != null -> FreshnessTooltip(TooltipKind.LastUpdated, snapshot.updatedAtMs)
            else -> FreshnessTooltip(TooltipKind.NeverUpdated)
        }

    /**
     * Whether [updatedAtMs] has aged past [forceStaleAfterMs] at [nowMs] — the native mirror of the web
     * `DataFreshnessAuto` forced-stale window. A `null` window, a `null` stamp, or a non-positive window
     * never forces stale.
     */
    fun isForcedStale(
        updatedAtMs: Long?,
        nowMs: Long,
        forceStaleAfterMs: Long?,
    ): Boolean =
        forceStaleAfterMs != null &&
            forceStaleAfterMs > 0 &&
            updatedAtMs != null &&
            nowMs - updatedAtMs > forceStaleAfterMs

    private fun bucket(
        updatedAtMs: Long,
        nowMs: Long,
    ): RelativeLabel {
        val seconds = ((nowMs - updatedAtMs) / MILLIS_PER_SECOND).coerceAtLeast(0)
        return when {
            seconds < SECONDS_PER_MINUTE -> RelativeLabel(RelativeUnit.JustNow)
            seconds < SECONDS_PER_HOUR -> RelativeLabel(RelativeUnit.Minutes, (seconds / SECONDS_PER_MINUTE).toInt())
            seconds < SECONDS_PER_DAY -> RelativeLabel(RelativeUnit.Hours, (seconds / SECONDS_PER_HOUR).toInt())
            seconds < SECONDS_PER_WEEK -> RelativeLabel(RelativeUnit.Days, (seconds / SECONDS_PER_DAY).toInt())
            else -> RelativeLabel(RelativeUnit.Weeks, (seconds / SECONDS_PER_WEEK).toInt())
        }
    }
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever the chip's manual refresh is invoked. */
const val EVENT_REFRESH: String = "dataFreshness.refresh"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [DataFreshnessRegistration.SLUG]
 * (P1/S11) — never a vehicle id nor a freshness payload, so a diagnostics line can never leak which feed a
 * user was viewing. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls
 * it once per surface open.
 */
fun recordDataFreshnessOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to DataFreshnessRegistration.SLUG))
}

/**
 * Emits the PII-safe refresh diagnostic carrying only the surface slug — never a vehicle id — so manual
 * refreshes are observable without leaking which feed the user refreshed.
 */
fun recordDataFreshnessRefresh(logger: Logger) {
    logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to DataFreshnessRegistration.SLUG))
}
