// Pure, framework-free model + projection for the StatusHeader feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/dlq-inspector/StatusHeader.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// StatusHeader is a presentational surface — the web component takes its `data` / `loading` as props from
// the DLQ-inspector page (which owns the TanStack query), so this surface binds no data hooks. As in the
// sibling ResultPanel port, the cache-then-network states (stale / offline / fetch-error) live on the
// owning page, not here; the two branches the web source defines — `loading` (skeleton chrome) and the
// resolved summary (which renders zeros when `data` is absent, never a blank box) plus the conditional
// "replay disabled" warning — are the complete state set this surface renders.
//
// The web reads three values off the optional `DLQListResponse`: the total `count`, the number of
// replayable rows in the returned `entries`, and the `replay_enabled` flag. [DlqListResponse] mirrors that
// wire shape (snake_case via @SerialName) so the projection can run straight off the cached API JSON; only
// `replayable` is modelled on the entry rows because that is the only entry field this surface consumes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/StatusHeader — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statusheader

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.text.NumberFormat
import java.util.Locale

/**
 * One DLQ entry row, narrowed to the single field this surface reads — the native mirror of the web
 * `DLQEntrySummary.replayable`. The web list endpoint returns many more columns; they are intentionally
 * not modelled here, so a decoder must ignore unknown keys when reading the cached API JSON.
 */
@Serializable
data class DlqEntrySummary(
    val replayable: Boolean = false,
)

/**
 * The DLQ list response the owning page threads into this surface — the native mirror of the web
 * `DLQListResponse` (`internal/api/dlq_handler.go`). `replay_enabled` keeps its snake_case wire name via
 * @SerialName so the projection runs directly off the cached response. All fields default so a partial or
 * still-loading payload decodes without error.
 */
@Serializable
data class DlqListResponse(
    val count: Int = 0,
    @SerialName("replay_enabled") val replayEnabled: Boolean = false,
    val entries: List<DlqEntrySummary> = emptyList(),
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property loading whether the owning query is still in flight (web `loading` prop); the cards render
 *   skeleton chrome and the warning is withheld while true.
 * @property totalEntries the DLQ depth (web `data?.count ?? 0`).
 * @property replayableEntries the number of replayable rows among the returned entries
 *   (web `(data?.entries ?? []).filter(e => e.replayable).length`).
 * @property replayEnabled whether server-side replay is enabled (web `data?.replay_enabled ?? false`).
 * @property showDisabledBanner whether the "replay disabled" warning renders — web `!loading && !enabled`,
 *   so it is withheld during loading and whenever replay is enabled.
 */
data class StatusHeaderDisplay(
    val loading: Boolean,
    val totalEntries: Int,
    val replayableEntries: Int,
    val replayEnabled: Boolean,
    val showDisabledBanner: Boolean,
)

/**
 * Pure projection from the surface's inputs to its render-ready [StatusHeaderDisplay] — a 1:1 port of the
 * three derivations the web component performs (`count`, the replayable filter-count, and `enabled`) plus
 * the `!loading && !enabled` warning gate — and the locale-aware integer formatter the web renders the two
 * counts through (`fmtInt`, i.e. `Intl.NumberFormat` with zero fraction digits).
 */
object StatusHeaderProjection {
    /**
     * Select the render-ready view for the given inputs. [data] is the optional DLQ response (web
     * `data: DLQListResponse | undefined`); a null payload yields zeros and an enabled=false flag exactly
     * like the web nullish coalescing, so the surface still renders its three cards (never a blank box).
     */
    fun project(
        data: DlqListResponse?,
        loading: Boolean,
    ): StatusHeaderDisplay {
        val total = data?.count ?: 0
        val replayable = data?.entries?.count { it.replayable } ?: 0
        val enabled = data?.replayEnabled ?: false
        return StatusHeaderDisplay(
            loading = loading,
            totalEntries = total,
            replayableEntries = replayable,
            replayEnabled = enabled,
            showDisabledBanner = !loading && !enabled,
        )
    }

    /**
     * Format an entry count the way the web `fmtInt` does — locale-aware grouping separators and no
     * fraction digits (`Intl.NumberFormat(locale, { maximumFractionDigits: 0 })`). [locale] defaults to the
     * JVM default so off-device tests are deterministic when they pass an explicit locale.
     */
    fun formatCount(
        value: Int,
        locale: Locale = Locale.getDefault(),
    ): String = NumberFormat.getIntegerInstance(locale).format(value.toLong())
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the DLQ
 * depth, the replayable count, or the enabled flag — so a diagnostics line can never leak the fleet's DLQ
 * posture.
 */
object StatusHeaderDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "StatusHeader"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
