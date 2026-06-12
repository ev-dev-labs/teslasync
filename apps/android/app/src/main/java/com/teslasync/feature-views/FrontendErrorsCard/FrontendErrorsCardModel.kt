// Pure, framework-free model + projection for the FrontendErrorsCard feature view — the native analogue of
// every value the web component derives before returning JSX
// (web/src/features/system/components/status/FrontendErrorsCard.tsx). No Compose, no Android UI, no HTTP:
// every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// FrontendErrorsCard is the last-hour rolling summary of browser-reported frontend errors that backed the
// now-deleted /admin page's "Frontend Errors" panel, surfaced inside the /system-status "Recent errors"
// accordion. The web component reads `/admin/web-errors/summary` via `useWebErrorsSummary()` (the `useAdmin`
// hook domain) and renders the total error count plus the top offenders (component name + route + count).
// This file owns the parts the web render derives from that payload:
//   • the total — web `data.total ?? 0`, surfaced through `fmtInt` (grouped integer, `0` when absent);
//   • the top-offenders rows — each `entry.name || '—'` / `entry.route || '—'` with `fmtInt(entry.count ?? 0)`,
//     reproducing the web `value || '—'` blank fallback and the `?? 0` count default exactly;
//   • the has-offenders switch — web `top.length > 0 ? <ul>…</ul> : <p>No frontend errors…</p>`.
//
// Binding (P1/S8): this surface performs NO HTTP. The owning /system-status host owns the shared
// `AdminStore.webErrorsSummary()` feed (the cross-platform port of `useWebErrorsSummary`, in :core) and
// threads its cache-then-network `Resource<JsonElement>` down through [toWebErrorsSummaryUiState], so the
// composable renders every lifecycle state that layer can carry (loading / empty / error / stale / offline)
// without ever fetching — the same host-owns-the-feed contract the sibling AIUsageCard / AuditPanel ports
// follow. [WebErrorsSummary.fromJson] is the cached-payload → typed-projection data adapter that bridge is
// unit-tested on.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FrontendErrorsCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.frontenderrorscard

import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no error payload. */
const val FRONTEND_ERRORS_SLUG: String = "FrontendErrorsCard"

/** Em dash shown for a blank offender name/route — the native mirror of the web `value || '—'` fallback. */
internal const val FRONTEND_ERRORS_EM_DASH: String = "\u2014"

/** Integer counts carry no fraction digits — web `fmtInt` == `fmtNumber(v, 0)`. */
private const val COUNT_DECIMALS: Int = 0

/**
 * One top-offender row — the native mirror of the web `WebErrorsSummaryEntry` the component renders
 * (web/src/types/admin.ts). Only the three fields the list draws are modelled.
 *
 * [count] is a nullable [Double] mirroring the web `number | null | undefined` shape the `?? 0` default
 * guards against, so a sparse payload never produces `NaN`; [name]/[route] keep the raw (possibly blank)
 * wire string because the web applies the `|| '—'` fallback at render, classified separately in the
 * projection.
 *
 * @property name the offending component name (web `entry.name`); blank renders the em dash.
 * @property route the route the error fired on (web `entry.route`); blank renders the em dash.
 * @property count the error count for this offender (web `entry.count`); absent renders `0`.
 */
data class WebErrorEntry(
    val name: String,
    val route: String,
    val count: Double?,
) {
    companion object {
        private const val KEY_NAME = "name"
        private const val KEY_ROUTE = "route"
        private const val KEY_COUNT = "count"

        /** Parses one `top[]` element; a non-object element yields `null` so it is dropped from the list. */
        fun fromJson(json: JsonElement?): WebErrorEntry? {
            val obj = json as? JsonObject ?: return null
            return WebErrorEntry(
                name = obj.string(KEY_NAME),
                route = obj.string(KEY_ROUTE),
                count = obj.number(KEY_COUNT),
            )
        }

        private fun JsonObject.string(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

        private fun JsonObject.number(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
    }
}

/**
 * The slice of the `/admin/web-errors/summary` aggregate this card actually reads — the native mirror of the
 * two web `WebErrorsSummary` fields the component renders. The full DTO also carries `window_seconds` and
 * `as_of`, which this card never shows, so they are deliberately omitted (DRY — the model carries only what
 * the surface renders, like the sibling AIUsageCard port).
 *
 * @property total the rolling last-hour error count (web `data.total`); absent renders `0`.
 * @property top the top offenders (web `data.top`); empty selects the "no errors" message.
 */
data class WebErrorsSummary(
    val total: Double?,
    val top: List<WebErrorEntry>,
) {
    /** Web `top.length > 0`: there is at least one offender to list. */
    val hasOffenders: Boolean get() = top.isNotEmpty()

    /** No offenders to list — selects the host's [UiState] empty phase + the "no errors" message. */
    val isEmpty: Boolean get() = top.isEmpty()

    companion object {
        private const val KEY_TOTAL = "total"
        private const val KEY_TOP = "top"

        /** The all-clear payload the server returns when no errors have been reported this hour. */
        val EMPTY: WebErrorsSummary = WebErrorsSummary(total = 0.0, top = emptyList())

        /**
         * Parses the shared store's raw `/admin/web-errors/summary` [JsonElement] into the typed slice this
         * card reads — the data adapter the host plugs into [toWebErrorsSummaryUiState]. Snake_case keys are
         * read verbatim (the shared `AdminRepository` carries the server JSON unchanged); a non-object
         * payload yields `null`, and a missing/!array `top` collapses to an empty list (web `data.top ?? []`).
         */
        fun fromJson(json: JsonElement?): WebErrorsSummary? {
            val obj = json as? JsonObject ?: return null
            val entries = (obj[KEY_TOP] as? JsonArray)?.mapNotNull { WebErrorEntry.fromJson(it) } ?: emptyList()
            return WebErrorsSummary(
                total = (obj[KEY_TOTAL] as? JsonPrimitive)?.doubleOrNull,
                top = entries,
            )
        }
    }
}

/**
 * Maps the shared `AdminStore.webErrorsSummary()` feed's cache-then-network [Resource] (raw `JsonElement`,
 * P1/S8) onto the Android [UiState] this card binds — the single seam the /system-status host wires the
 * surface up with (`store.webErrorsSummary().map { it.toWebErrorsSummaryUiState() }`). The cached payload is
 * parsed through [WebErrorsSummary.fromJson] at every emission so an instant cold-start cache replay and an
 * offline "last known" value both render real figures, and an empty-offenders payload resolves to the empty
 * phase (the web "no errors" message).
 */
fun Resource<JsonElement>.toWebErrorsSummaryUiState(): UiState<WebErrorsSummary> = mapToWebErrorsSummary().toUiState { it.isEmpty }

private fun Resource<JsonElement>.mapToWebErrorsSummary(): Resource<WebErrorsSummary> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached = WebErrorsSummary.fromJson(cached), fetchedAt = fetchedAt, stale = stale)

        is Resource.Success ->
            Resource.Success(data = WebErrorsSummary.fromJson(data) ?: WebErrorsSummary.EMPTY, fetchedAt = fetchedAt, stale = stale)

        is Resource.Error ->
            Resource.Error(cached = WebErrorsSummary.fromJson(cached), fetchedAt = fetchedAt, stale = stale, error = error)
    }

/**
 * One fully projected, render-ready offender row — the native analogue of what the web `<li>` renders. Pure
 * strings (no Compose types) so the projection is fully unit-tested off-device.
 *
 * @property name the offender name with the web `|| '—'` blank fallback applied.
 * @property route the route with the web `|| '—'` blank fallback applied.
 * @property count the grouped integer count (web `fmtInt(entry.count ?? 0)`), `0` when absent.
 */
data class WebErrorRow(
    val name: String,
    val route: String,
    val count: String,
)

/**
 * The fully projected, render-ready figures — the native analogue of everything the web component computes
 * before returning JSX. Pure strings + a flag so the projection is fully unit-tested off-device.
 *
 * @property totalText the grouped integer total (web `fmtInt(data.total ?? 0)`).
 * @property rows the projected top-offender rows in server order (web `data.top.map(...)`).
 * @property hasOffenders whether to render the list (web `top.length > 0`) or the "no errors" message.
 */
data class FrontendErrorsDisplay(
    val totalText: String,
    val rows: List<WebErrorRow>,
    val hasOffenders: Boolean,
)

/**
 * Pure projection from a [WebErrorsSummary] payload to its render-ready [FrontendErrorsDisplay] plus the
 * formatters the web component applies inline — a 1:1 port of the `fmtInt` total, the per-row `fmtInt` count,
 * and the `value || '—'` name/route fallback. Stateless and side-effect-free so it is fully covered by the
 * off-device unit gate; the composable only resolves localized labels and draws this.
 */
object FrontendErrorsProjection {
    /** Project a payload onto its render-ready total + offender rows. */
    fun project(
        data: WebErrorsSummary,
        locale: Locale,
    ): FrontendErrorsDisplay =
        FrontendErrorsDisplay(
            totalText = formatInt(data.total, locale),
            rows =
                data.top.map { entry ->
                    WebErrorRow(
                        name = valueOrDash(entry.name),
                        route = valueOrDash(entry.route),
                        count = formatInt(entry.count, locale),
                    )
                },
            hasOffenders = data.hasOffenders,
        )

    /** Web `value || '—'`: an empty string becomes the em dash, else the value verbatim. */
    fun valueOrDash(value: String): String = value.ifEmpty { FRONTEND_ERRORS_EM_DASH }

    /**
     * Web `fmtInt(v)` == `fmtNumber(v, 0)` over `safeNumber(v)`: a grouped integer, with a null / non-finite
     * value coerced to `0` (never the em dash — the web count path always renders a number).
     */
    fun formatInt(
        value: Double?,
        locale: Locale,
    ): String {
        val safe = if (value == null || !value.isFinite()) 0.0 else value
        return numberFormat(locale).format(safe)
    }

    // Web `fmtNumber` uses ECMAScript `Intl.NumberFormat` (halfExpand) grouping; HALF_UP matches it rather
    // than Java's default banker's rounding (HALF_EVEN).
    private fun numberFormat(locale: Locale): NumberFormat =
        NumberFormat.getNumberInstance(locale).apply {
            minimumFractionDigits = COUNT_DECIMALS
            maximumFractionDigits = COUNT_DECIMALS
            isGroupingUsed = true
            roundingMode = RoundingMode.HALF_UP
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never an error
 * count, a component name, or a route — so a diagnostics line can never leak the fleet's posture.
 */
object FrontendErrorsCardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = FRONTEND_ERRORS_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
