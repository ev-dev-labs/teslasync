// Pure, framework-free model + projection for the SignalSparklinePreview feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/telemetry/components/SignalSparklinePreview.tsx): the `SPARKLINE_LIMIT`/`SPARKLINE_HOURS`
// query window, the `NON_NUMERIC` kind set + `isNumeric` guard, the `envelopesToNumbers` numeric/boolean
// extraction, and the branch precedence (`!enabled` ⇒ nothing, non-numeric ⇒ kind chip, loading ⇒ skeleton,
// `numericSeries.length < 2` ⇒ em-dash, else ⇒ Sparkline). The web component owns a single `useSignalHistory`
// query; this layer projects that one cache-then-network feed onto a [SignalSparklinePreviewState] the thin
// composable renders. No Compose, no Android framework, no HTTP: every declaration here is unit-tested
// off-device in the :app:testReleaseUnitTest gate. Values are the raw SI the backend serves (Phase-42); this
// layer renders them verbatim and performs no unit conversion.
//
// Parity extension — the web component leans on TanStack Query's cache and only renders four visible branches
// (chip / skeleton / em-dash / sparkline). The P3 surface contract additionally mandates an explicit error
// affordance and stale / offline surfaces, so a hard failure with no usable cached series resolves to
// [SignalSparklineMode.Error] (a retry affordance) and a cached series served after a failed refresh / past
// its TTL carries [SparklineFreshness.Offline] / [SparklineFreshness.Stale] — the honest ADR-013 freshness
// contract — while still drawing the last-known line (web parity: TanStack keeps `data` across a refetch).
//
// `MatchingDeclarationName` is suppressed for the co-located supporting types; `InvalidPackageDeclaration` is
// suppressed because this surface's mandated directory (com/teslasync/feature-views/SignalSparklinePreview —
// the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a hyphen and a PascalCase segment
// are illegal in a package identifier), so the package intentionally diverges from the path — exactly as the
// sibling SignalCatalogPanel does.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalsparklinepreview

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalHistoryRange
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, signal name, or
 * value, so a diagnostics line can never leak the vehicle's live state.
 */
const val SIGNAL_SPARKLINE_PREVIEW_SLUG: String = "SignalSparklinePreview"

/** Em dash shown for the "no samples" empty state — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The web `SPARKLINE_LIMIT` — the trailing-hour history is capped at 30 samples. */
const val SPARKLINE_LIMIT: Int = 30

/** The web `SPARKLINE_HOURS` — the sparkline covers the last hour. */
const val SPARKLINE_HOURS: Int = 1

/** The history window every preview pulls (web `useSignalHistory(id, signal, { hours: 1, limit: 30 })`). */
val SPARKLINE_RANGE: SignalHistoryRange = SignalHistoryRange(hours = SPARKLINE_HOURS, limit = SPARKLINE_LIMIT)

/** The web `numericSeries.length < 2` guard — a trend line needs at least two finite points. */
internal const val MIN_SPARKLINE_POINTS: Int = 2

/**
 * The non-numeric value kinds (web `NON_NUMERIC` set: `'string' | 'unknown' | 'time'`). A signal of one of
 * these kinds has no meaningful trend line and renders the compact kind chip instead of a sparkline.
 */
val NON_NUMERIC_KINDS: Set<SignalKind> = setOf(SignalKind.String, SignalKind.Unknown, SignalKind.Time)

/** Web `!NON_NUMERIC.has(valueKind)`: bool / int / float render a sparkline; string / time / unknown do not. */
fun isNumericKind(kind: SignalKind): Boolean = kind !in NON_NUMERIC_KINDS

/**
 * Project a typed history series onto the plottable numbers — the verbatim port of the web
 * `envelopesToNumbers`: a finite numeric value passes through, a boolean becomes `1`/`0`, and any other kind
 * (string / time / null) is skipped. Mirrors the web `typeof v === 'number'` / `typeof v === 'boolean'` arms.
 */
fun envelopesToNumbers(data: List<SignalEnvelope>): List<Double> {
    val out = ArrayList<Double>(data.size)
    for (envelope in data) {
        when (val value = envelope.value) {
            is SignalValue.Num -> if (value.value.isFinite()) out.add(value.value)
            is SignalValue.Bool -> out.add(if (value.value) 1.0 else 0.0)
            is SignalValue.Text, SignalValue.Null -> Unit
        }
    }
    return out
}

/**
 * The branch the composable renders — the native superset of the web component's render ternary. [Disabled]
 * mirrors the web `if (!enabled) return null`; [NonNumeric] the kind chip; [Loading] the pulsing skeleton;
 * [Empty] the "no samples" em-dash; [Content] the Sparkline; and [Error] is the P3-mandated retry affordance
 * for a hard failure with no cached series.
 */
enum class SignalSparklineMode { Disabled, NonNumeric, Loading, Error, Content, Empty }

/**
 * The freshness of the cached series behind a [SignalSparklineMode.Content] render. [Fresh] draws the line
 * alone (web parity); [Stale] adds a stale affordance and triggers auto-refresh; [Offline] adds an offline
 * affordance over the last-known line (a cached series served after a failed refresh — ADR-013).
 */
enum class SparklineFreshness { Fresh, Stale, Offline }

/**
 * The immutable state the view-model exposes — the cache-then-network projection of the single
 * `useSignalHistory` feed the web component owns. [series] is the plottable numeric history (kept across a
 * refetch / error so stale / offline still draw the last-known line); [freshness] drives the Content
 * affordance + auto-refresh; [isFetching] guards the auto-refresh against a storm; and [errorKind] classifies
 * a hard failure. [valueKind]/[signal] are carried for the kind chip + the sparkline's accessibility label.
 */
data class SignalSparklinePreviewState(
    val mode: SignalSparklineMode,
    val valueKind: SignalKind,
    val signal: String,
    val series: List<Double>,
    val freshness: SparklineFreshness,
    val isFetching: Boolean,
    val updatedAtMillis: Long?,
    val errorKind: QueryErrorKind?,
)

/**
 * Pure projection from the static props + the single `useSignalHistory` [Resource] to the render-ready
 * [SignalSparklinePreviewState] — the native port of the web component's render branches. Side-effect-free so
 * the gate unit-tests every branch without a device.
 */
object SignalSparklineProjection {
    /**
     * Resolve the render state from [enabled] + [valueKind] + the feed [resource] (web's render ternary).
     * A `null` [resource] means the view-model has not opened the feed (disabled, non-numeric, or no
     * vehicle/signal yet) — the web disabled-query branch, which renders the em-dash empty state.
     */
    fun fromResource(
        enabled: Boolean,
        valueKind: SignalKind,
        signal: String,
        resource: Resource<SignalHistoryResponse>?,
    ): SignalSparklinePreviewState =
        when {
            !enabled -> gated(SignalSparklineMode.Disabled, valueKind, signal)
            !isNumericKind(valueKind) -> gated(SignalSparklineMode.NonNumeric, valueKind, signal)
            resource == null -> gated(SignalSparklineMode.Empty, valueKind, signal)
            else -> fromOpenFeed(valueKind, signal, resource)
        }

    /** Project an opened feed emission onto the render state, keeping the cached series across error/refetch. */
    private fun fromOpenFeed(
        valueKind: SignalKind,
        signal: String,
        resource: Resource<SignalHistoryResponse>,
    ): SignalSparklinePreviewState {
        val series = resource.cached?.let { envelopesToNumbers(it.data) } ?: emptyList()
        val hasSeries = series.size >= MIN_SPARKLINE_POINTS
        val isFetching = resource is Resource.Loading
        val isError = resource is Resource.Error
        val mode =
            when {
                hasSeries -> SignalSparklineMode.Content
                isError -> SignalSparklineMode.Error
                isFetching -> SignalSparklineMode.Loading
                else -> SignalSparklineMode.Empty
            }
        val freshness =
            when {
                mode != SignalSparklineMode.Content -> SparklineFreshness.Fresh
                isError -> SparklineFreshness.Offline
                resource.stale -> SparklineFreshness.Stale
                else -> SparklineFreshness.Fresh
            }
        return SignalSparklinePreviewState(
            mode = mode,
            valueKind = valueKind,
            signal = signal,
            series = series,
            freshness = freshness,
            isFetching = isFetching,
            updatedAtMillis = resource.fetchedAtMillis(),
            errorKind = (resource as? Resource.Error)?.let { queryErrorKindOf(it.error) },
        )
    }

    /** The no-feed states (disabled / non-numeric / no-vehicle) — neutral freshness, empty series. */
    private fun gated(
        mode: SignalSparklineMode,
        valueKind: SignalKind,
        signal: String,
    ): SignalSparklinePreviewState =
        SignalSparklinePreviewState(
            mode = mode,
            valueKind = valueKind,
            signal = signal,
            series = emptyList(),
            freshness = SparklineFreshness.Fresh,
            isFetching = false,
            updatedAtMillis = null,
            errorKind = null,
        )

    /** The freshness stamp of a feed emission (web `dataUpdatedAt`), across loading / success / error. */
    private fun Resource<*>.fetchedAtMillis(): Long? =
        when (this) {
            is Resource.Loading -> fetchedAt
            is Resource.Success -> fetchedAt
            is Resource.Error -> fetchedAt
        }

    /**
     * Classify a feed failure into the recovery bucket the retry affordance keys off — the native analogue of
     * the web `classifyQueryError`. HTTP status drives not-found / unauthorized / server; an open breaker maps
     * to the transient waiting bucket; transport failures map to the generic network bucket.
     */
    fun queryErrorKindOf(error: Throwable?): QueryErrorKind =
        when (error) {
            is ApiError.Http ->
                when {
                    error.status == HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    error.status == HTTP_UNAUTHORIZED || error.status == HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    error.status >= HTTP_SERVER_ERROR -> QueryErrorKind.ServerError
                    else -> QueryErrorKind.Network
                }
            is ApiError.CircuitOpen -> QueryErrorKind.Waiting
            else -> QueryErrorKind.Network
        }

    private const val HTTP_NOT_FOUND = 404
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_SERVER_ERROR = 500
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SIGNAL_SPARKLINE_PREVIEW_SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * composable's first-composition effect.
 */
fun recordSignalSparklinePreviewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SIGNAL_SPARKLINE_PREVIEW_SLUG))
}
