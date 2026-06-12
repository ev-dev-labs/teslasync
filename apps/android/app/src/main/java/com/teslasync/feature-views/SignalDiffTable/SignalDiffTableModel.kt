// Pure, framework-free model + projection for the SignalDiffTable feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/telemetry/components/SignalDiffTable.tsx). No Compose, no Android framework, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The shared logic helpers it leans on (SortState / QueryErrorKind) are
// themselves pure Kotlin, so the projection stays JVM-pure.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SignalDiffTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveSignalsTable does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signaldifftable

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.SignalDiffRow
import io.teslasync.shared.core.presentation.telemetry.SignalDiffServerResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, signal name, or
 * value, so a diagnostics line can never leak the vehicle's compared state.
 */
const val SIGNAL_DIFF_TABLE_SLUG: String = "SignalDiffTable"

/** Em dash shown for a missing value / no-difference delta — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The web `formatRaw` literals for a JSON boolean value. */
internal const val BOOL_TRUE: String = "true"
internal const val BOOL_FALSE: String = "false"

/** The web stable column keys (web `Column.key`); shared by the header, the sort toggle, and the cells. */
const val COL_PIN: String = "pin"
const val COL_NAME: String = "name"
const val COL_VALUE_A: String = "value_a"
const val COL_VALUE_B: String = "value_b"
const val COL_DELTA: String = "delta"
const val COL_SOURCE_A: String = "source_a"
const val COL_SOURCE_B: String = "source_b"

/** Web `fmtNumber` default precision (`_globalPrecision` = 2) for raw numbers and the absolute delta. */
internal const val VALUE_DECIMALS: Int = 2

/** Web `fmtNumber(pct, 1)` precision for the percent-change suffix. */
internal const val PERCENT_DECIMALS: Int = 1

private const val PERCENT_MULTIPLIER: Double = 100.0

/** Compact (no-whitespace) encoder mirroring the web `JSON.stringify(value)` used for compound values. */
private val VALUE_JSON: Json = Json { encodeDefaults = false }

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR = 500

/**
 * The already-localized strings the table renders. The web component reads each via `t('signalDiff.…')`;
 * on Android they arrive through the P1/S10 i18n facade (`stringResource`) at the Compose boundary and are
 * passed in, keeping the projection locale-stable and free of any English literal. [filterHint] is the web
 * parent's filter prompt; [filterAria] names the filter field for TalkBack.
 */
data class SignalDiffTableStrings(
    val colSignal: String,
    val colValueA: String,
    val colValueB: String,
    val colDelta: String,
    val colSourceA: String,
    val colSourceB: String,
    val deltaChanged: String,
    val legendDelta: String,
    val legendDeltaHelp: String,
    val legendDeltaAria: String,
    val legendSource: String,
    val legendSourceHelp: String,
    val legendSourceAria: String,
    val emptyMessage: String,
    val noMatchesMessage: String,
    val loadingText: String,
    val filterHint: String,
    val filterAria: String,
    val pinLabel: String,
    val pinnedLabel: String,
    val selectAllLabel: String,
    val diffLabel: String,
)

/** The sign of a numeric delta — drives the cell's tone color (web positive/negative/zero coloring). */
enum class DeltaSign { Positive, Negative, Zero }

/**
 * The rendered Δ cell — the native port of the web `deltaLabel` result. [None] is an em dash (values equal),
 * [Changed] is the amber "changed" label (non-numeric values that differ), and [Numeric] carries the signed
 * [delta] (for sorting), its [sign] (for coloring), and the already-formatted [text] (e.g. `+12.34 (+5.6%)`).
 */
sealed interface SignalDiffDelta {
    data object None : SignalDiffDelta

    data object Changed : SignalDiffDelta

    data class Numeric(
        val delta: Double,
        val sign: DeltaSign,
        val text: String,
    ) : SignalDiffDelta
}

/**
 * One render-ready diff row — the native mirror of the web `SignalDiffRow` after its cell formatting. [valueA]
 * / [valueB] are the already-formatted display strings (web `formatRaw`); [delta] is the computed Δ cell;
 * [sourceA] / [sourceB] are the raw layer strings the `SourceLayerBadge` parses; [ageMsA] / [ageMsB] are the
 * value ages appended to the badge.
 */
data class SignalDiffRowVm(
    val name: String,
    val valueA: String,
    val valueB: String,
    val delta: SignalDiffDelta,
    val sourceA: String?,
    val sourceB: String?,
    val ageMsA: Long?,
    val ageMsB: Long?,
)

/**
 * The feed parameters the host page supplies (web parent's vehicle + window pickers): the selected
 * [vehicleId] and the two snapshot instants [atA] / [atB], plus the optional [signalsCsv] narrowing set.
 * [isEnabled] mirrors the web `enabled: vehicleId > 0 && atAIso && atBIso` guard.
 */
data class SignalDiffQuery(
    val vehicleId: Long? = null,
    val atA: String = "",
    val atB: String = "",
    val signalsCsv: String = "",
) {
    /** Whether the diff feed should open (web disabled-query guard); a blank window or no vehicle holds off. */
    val isEnabled: Boolean
        get() {
            val hasVehicle = vehicleId != null && vehicleId > 0L
            val hasWindow = atA.isNotBlank() && atB.isNotBlank()
            return hasVehicle && hasWindow
        }
}

/**
 * The immutable state the [SignalDiffTableViewModel] exposes — the cache-then-network projection of the
 * single `useSignalDiffServer` feed the web parent owns. [response] is the last-known diff (kept across
 * refetch/error so stale/offline still render the cached rows); the freshness flags drive the header chip +
 * auto-refresh, and [errorKind] classifies a hard failure for the `QueryError` branch.
 */
data class SignalDiffTableState(
    val response: SignalDiffServerResponse?,
    val updatedAtMillis: Long?,
    val isFetching: Boolean,
    val isStale: Boolean,
    val isError: Boolean,
    val errorKind: QueryErrorKind?,
) {
    companion object {
        /** The pre-resolution / disabled state: nothing loaded, neutral freshness (web `enabled:false`). */
        val EMPTY: SignalDiffTableState =
            SignalDiffTableState(
                response = null,
                updatedAtMillis = null,
                isFetching = false,
                isStale = false,
                isError = false,
                errorKind = null,
            )
    }
}

/**
 * Pure projection from a server-side diff [SignalDiffServerResponse] to render-ready [SignalDiffRowVm]s — the
 * native port of the web cell formatting (`formatRaw`, `asNumber`, `deltaLabel`) plus the pinned-first sort
 * and the case-insensitive name filter the web parent applies. Number formatting uses the web `fmtNumber`
 * default (en-US grouping, 2 fraction digits) so the off-device tests are deterministic; display
 * localization is the render boundary's job, never this layer's.
 */
object SignalDiffTableProjection {
    /** Web `diffResp?.data ?? []` mapped through the per-row cell formatting; one [SignalDiffRowVm] per row. */
    fun projectRows(response: SignalDiffServerResponse?): List<SignalDiffRowVm> {
        val rows = response?.data ?: return emptyList()
        return rows.map { rowFrom(it) }
    }

    /** Maps one wire [SignalDiffRow] onto its rendered cells — the web column `render` callbacks, hoisted. */
    fun rowFrom(row: SignalDiffRow): SignalDiffRowVm =
        SignalDiffRowVm(
            name = row.name,
            valueA = formatRaw(row.valueA),
            valueB = formatRaw(row.valueB),
            delta = deltaOf(row.valueA, row.valueB),
            sourceA = row.sourceA,
            sourceB = row.sourceB,
            ageMsA = row.ageMsA,
            ageMsB = row.ageMsB,
        )

    /**
     * Web `formatRaw`: `null`/absent → em dash, finite number → `fmtNumber`, boolean → `true`/`false`,
     * string → the string verbatim, and any compound (object/array) is compact-JSON-encoded so a typed value
     * never crashes the cell.
     */
    fun formatRaw(value: JsonElement?): String =
        when (value) {
            null, is JsonNull -> EM_DASH
            is JsonPrimitive -> formatPrimitive(value)
            is JsonObject, is JsonArray ->
                runCatching { VALUE_JSON.encodeToString(JsonElement.serializer(), value) }.getOrDefault(EM_DASH)
        }

    /**
     * Web `deltaLabel`: when both sides coerce to finite numbers it is the signed difference plus its percent
     * change (relative to `|a|`, omitted when `a == 0`); otherwise equal rendered values give [None] and any
     * other mismatch gives [Changed].
     */
    fun deltaOf(
        valueA: JsonElement?,
        valueB: JsonElement?,
    ): SignalDiffDelta {
        val numA = asNumber(valueA)
        val numB = asNumber(valueB)
        return when {
            numA != null && numB != null -> numericDelta(numA, numB)
            formatRaw(valueA) == formatRaw(valueB) -> SignalDiffDelta.None
            else -> SignalDiffDelta.Changed
        }
    }

    /**
     * Web `asNumber`: a finite number is taken verbatim, a non-empty numeric string is parsed, a boolean maps
     * to `1`/`0`, and everything else (null, blank, non-numeric string, compound) is `null`.
     */
    fun asNumber(value: JsonElement?): Double? {
        val primitive = (value as? JsonPrimitive)?.takeUnless { it is JsonNull } ?: return null
        return if (primitive.isString) parseNumericString(primitive.content) else numberOrBoolean(primitive)
    }

    /** Web `r.name.toLowerCase().includes(needle)`; a blank query returns every row (web parent's filter). */
    fun filterRows(
        rows: List<SignalDiffRowVm>,
        query: String,
    ): List<SignalDiffRowVm> {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) return rows
        return rows.filter { it.name.lowercase().contains(needle) }
    }

    /**
     * The web `sortedRows` comparator extended with the table's sortable columns: pinned signals always sort
     * first (the headline power-user behavior the web `pinnedSignals` ordering provides), then within each
     * group by the active column — `name` lexicographically or `delta` by signed magnitude — flipped by the
     * [sort] direction. A non-sortable / unknown key falls back to ascending name (web default order).
     */
    fun sortRows(
        rows: List<SignalDiffRowVm>,
        pinned: Set<String>,
        sort: SortState,
    ): List<SignalDiffRowVm> {
        val direction = if (sort.direction == SortDirection.Asc) 1 else -1
        val withinGroup =
            Comparator<SignalDiffRowVm> { a, b ->
                when (sort.key) {
                    COL_DELTA -> deltaSortKey(a.delta).compareTo(deltaSortKey(b.delta)) * direction
                    else -> a.name.compareTo(b.name) * direction
                }
            }
        return rows.sortedWith(
            compareByDescending<SignalDiffRowVm> { if (pinned.contains(it.name)) 1 else 0 }.then(withinGroup),
        )
    }

    /**
     * Classify a feed failure into the recovery copy the `QueryError` branch shows — the native analogue of
     * the web `classifyQueryError`. HTTP status drives not-found / unauthorized / server; transport failures
     * map to the generic network branch and an open breaker to the transient waiting branch.
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

    /** Web `formatRaw` for a JSON primitive: string verbatim, boolean literal, finite number formatted. */
    private fun formatPrimitive(value: JsonPrimitive): String =
        when {
            value.isString -> value.content
            value.booleanOrNull != null -> if (value.booleanOrNull == true) BOOL_TRUE else BOOL_FALSE
            else -> value.doubleOrNull?.takeIf { it.isFinite() }?.let { formatNumber(it) } ?: EM_DASH
        }

    /** Web `asNumber` for a non-string primitive: a finite number, or `1`/`0` for a boolean, else `null`. */
    private fun numberOrBoolean(primitive: JsonPrimitive): Double? =
        primitive.doubleOrNull?.takeIf { it.isFinite() } ?: primitive.booleanOrNull?.let { if (it) 1.0 else 0.0 }

    /** Web `asNumber` for a string: a non-blank, finite parse, else `null`. */
    private fun parseNumericString(content: String): Double? {
        val trimmed = content.trim()
        val parsed = if (trimmed.isEmpty()) null else trimmed.toDoubleOrNull() // parity:allow stdlib numeric coercion
        return parsed?.takeIf { it.isFinite() }
    }

    /** The numeric Δ branch of the web `deltaLabel`: the signed difference + its percent change. */
    private fun numericDelta(
        numA: Double,
        numB: Double,
    ): SignalDiffDelta.Numeric {
        val delta = numB - numA
        val pct = if (numA != 0.0) (delta / abs(numA)) * PERCENT_MULTIPLIER else null
        return SignalDiffDelta.Numeric(delta = delta, sign = signOf(delta), text = deltaText(delta, pct))
    }

    /** Web `{positive ? '+' : ''}{fmtNumber(delta)}{pct != null ? ' (±pct%)' : ''}`. */
    private fun deltaText(
        delta: Double,
        pct: Double?,
    ): String {
        val sign = if (delta > 0.0) "+" else ""
        val pctText =
            pct?.let { value ->
                val pctSign = if (value >= 0.0) "+" else ""
                " ($pctSign${formatNumber(value, PERCENT_DECIMALS)}%)"
            } ?: ""
        return "$sign${formatNumber(delta)}$pctText"
    }

    /** Sort key for a Δ cell: the signed numeric delta, or `0` for non-numeric (changed / equal) rows. */
    private fun deltaSortKey(delta: SignalDiffDelta): Double = (delta as? SignalDiffDelta.Numeric)?.delta ?: 0.0

    private fun signOf(delta: Double): DeltaSign =
        when {
            delta > 0.0 -> DeltaSign.Positive
            delta < 0.0 -> DeltaSign.Negative
            else -> DeltaSign.Zero
        }
}

/**
 * Formats [value] like the web `fmtNumber`: en-US grouping with a fixed [decimals] fraction count (default
 * the web global precision of 2). Locale is pinned to en-US so the pure projection and its golden tests are
 * deterministic and match the web default; the values are raw debugger signal values, not unit-converted
 * metrics. A non-finite input yields the em dash.
 */
internal fun formatNumber(
    value: Double,
    decimals: Int = VALUE_DECIMALS,
): String {
    if (!value.isFinite()) return EM_DASH
    val format = NumberFormat.getNumberInstance(Locale.US)
    format.minimumFractionDigits = decimals
    format.maximumFractionDigits = decimals
    format.isGroupingUsed = true
    return format.format(value)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SIGNAL_DIFF_TABLE_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * composable's first-composition effect.
 */
fun recordSignalDiffTableOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SIGNAL_DIFF_TABLE_SLUG))
}
