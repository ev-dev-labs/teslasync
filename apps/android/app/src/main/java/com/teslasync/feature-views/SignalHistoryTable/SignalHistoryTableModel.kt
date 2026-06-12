// Pure, framework-free model + projection for the SignalHistoryTable feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/telemetry/components/SignalHistoryTable.tsx) plus the `formatValue` / `valueType` field
// reads it imports from `web/src/components/SignalQueryControls.tsx`. No Compose, no Android framework, no
// HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (SignalLogViewerPage / SignalExplorerPage /
// SignalsWorkspacePage) owns the page-global signal selector + the server-side query and passes the current
// page of `SignalLogEntry[]` down with `page` / `pageSize` / `totalRows` / `onPageChange` / `loading`. It
// performs no fetching. This file owns the per-row decisions that component makes: the value-type
// discriminator + its badge tone (web `valueType` + `TYPE_BADGE_VARIANT`), the displayed value string (web
// `formatValue`), the per-signal color index (web `selectedSignals.indexOf(...)` → `CHART_COLORS`), and the
// raw-payload pretty JSON the expandable row reveals (web `JSON.stringify(r, null, 2)`).
//
// Two sets of strings are reproduced as verbatim web literals: the value-type tokens "number" / "string" /
// "boolean" (web `valueType` returns them and renders them directly in the `<Badge>` — never through a
// `t()` call, so no catalog key exists for them) and the `formatValue` boolean literals "true" / "false"
// plus the "—" em-dash fallback. Reproducing the exact text keeps the observable output identical to the web
// source (ADR-004 parity), exactly as the sibling EventHistoryTable does for its own `helpers.ts` literals.
// Every string the component DOES resolve via `t(...)` is passed in already-localized through
// [SignalHistoryStrings] (P1/S10), so the projection itself stays locale-stable and pure.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SignalHistoryTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalhistorytable

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, signal name, or
 * value, so a diagnostics line can never leak the vehicle's telemetry.
 */
const val SIGNAL_HISTORY_TABLE_SLUG: String = "SignalHistoryTable"

/** Em dash shown when a value is absent — the web `formatValue` `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Web `formatValue` boolean literals (verbatim — the web renders them directly, never via `t()`). */
internal const val TRUE_LITERAL: String = "true"
internal const val FALSE_LITERAL: String = "false"

/** Web `keyExtractor={(r) => `${r.created_at}-${r.signal}`}` — the stable per-row key. */
internal const val KEY_SEPARATOR: String = "-"

/** The web `DataTable` stable column keys (web `Column.key`); shared by the header and the cells. */
const val COL_TIME: String = "time"
const val COL_SIGNAL: String = "signal"
const val COL_VALUE: String = "value"
const val COL_TYPE: String = "type"

/** Default page size the host hands down (web `SignalQueryControls` `PAGE_SIZES` default of 50). */
const val SIGNAL_HISTORY_PAGE_SIZE: Int = 50

// Largest magnitude treated as a JS-style integer literal; beyond it a Double loses integral precision so we
// keep the decimal form rather than risk a wrong Long cast.
private const val MAX_INTEGRAL_DOUBLE: Double = 1e15

/** Compact pretty-printer mirroring the web `JSON.stringify(r, null, 2)` two-space indent for expanded rows. */
private val PRETTY_JSON: Json =
    Json {
        prettyPrint = true
        prettyPrintIndent = "  "
    }

/**
 * The discriminated value type of a row — the native mirror of the web `valueType(row)` return. Carried on
 * the projected row so the composable maps it to both the verbatim badge label and the badge tone without
 * re-deriving it.
 */
enum class ValueType { Number, Boolean, String }

/**
 * One signal-log row — the native analogue of the web `SignalLogEntry`
 * (`web/src/components/SignalQueryControls.tsx`). [valueNum] / [valueStr] / [valueBool] are a tri-typed union
 * where at most one is non-null; all three null is a genuine "no value" row (the web em-dash case).
 */
data class SignalLogEntry(
    val createdAt: String,
    val signal: String,
    val valueNum: Double? = null,
    val valueStr: String? = null,
    val valueBool: Boolean? = null,
)

/**
 * The host-owned page of signal history the surface renders — the native bundle of the web component's
 * `{ rows, selectedSignals, page, pageSize, totalRows }` props. [rows] is the CURRENT page only (the web does
 * server-side pagination via `onPageChange`); [totalRows] is the unpaged total used by the header meta + the
 * pagination footer. [selectedSignals] drives the per-signal color index.
 */
data class SignalHistoryData(
    val rows: List<SignalLogEntry>,
    val selectedSignals: List<String>,
    val page: Int,
    val pageSize: Int,
    val totalRows: Int,
) {
    companion object {
        /** The pre-resolution / no-query bundle: nothing loaded (web parent before its first query). */
        val EMPTY: SignalHistoryData =
            SignalHistoryData(
                rows = emptyList(),
                selectedSignals = emptyList(),
                page = 1,
                pageSize = SIGNAL_HISTORY_PAGE_SIZE,
                totalRows = 0,
            )
    }
}

/**
 * One fully projected, render-ready table row — the native analogue of a single web `data[]` entry after the
 * `render` callbacks run. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 * [colorIndex] is the row's position in `selectedSignals` (-1 when absent → the composable uses the neutral
 * text color, exactly as the web `idx < 0` branch does); [rawJson] is the pretty-printed payload the
 * expandable row reveals.
 */
data class SignalHistoryRow(
    val key: String,
    val time: String,
    val signal: String,
    val colorIndex: Int,
    val value: String,
    val valueType: ValueType,
    val rawJson: String,
)

/**
 * The already-localized strings the surface renders — the web `t(...)` calls the JSX resolves inline. The
 * composable builds this from `stringResource`; tests pass a deterministic instance. The value-type badge
 * labels are intentionally NOT here: the web never localizes them (see the file header).
 */
data class SignalHistoryStrings(
    val title: String,
    val timestampHeader: String,
    val signalHeader: String,
    val valueHeader: String,
    val typeHeader: String,
    val pageLabel: String,
    val totalLabel: String,
    val emptyTitle: String,
    val emptyMessage: String,
    val detailsLabel: String,
)

/**
 * Web `valueType(row)`: `value_num` present → [ValueType.Number]; else `value_bool` present →
 * [ValueType.Boolean]; otherwise [ValueType.String] (covers a string value AND a fully-empty row, matching
 * the web fall-through).
 */
fun valueType(entry: SignalLogEntry): ValueType =
    when {
        entry.valueNum != null -> ValueType.Number
        entry.valueBool != null -> ValueType.Boolean
        else -> ValueType.String
    }

/**
 * The verbatim web badge label for a [ValueType] — the lower-case token the web `valueType` returns and
 * renders straight into the `<Badge>` (never via `t()`, so reproduced as a literal for parity).
 */
fun typeLabel(type: ValueType): String =
    when (type) {
        ValueType.Number -> "number"
        ValueType.Boolean -> "boolean"
        ValueType.String -> "string"
    }

/**
 * Web `formatValue(entry)`: the numeric value (JS `String(value_num)`), else the raw string, else the boolean
 * `"true"` / `"false"` literal, else the em dash — in that exact precedence order.
 */
fun formatValue(entry: SignalLogEntry): String =
    when {
        entry.valueNum != null -> formatSignalNumber(entry.valueNum)
        entry.valueStr != null -> entry.valueStr
        entry.valueBool != null -> if (entry.valueBool) TRUE_LITERAL else FALSE_LITERAL
        else -> EM_DASH
    }

/**
 * JS `String(number)` parity: an integral value renders with no decimal point ("64", not "64.0"); any other
 * finite value keeps its minimal decimal form; non-finite values render their JS spelling. The web
 * `adaptSignalHistoryPoint` only stores finite numbers, so the non-finite arms are defensive.
 */
fun formatSignalNumber(value: Double): String =
    when {
        value.isNaN() -> "NaN"
        value.isInfinite() -> if (value > 0) "Infinity" else "-Infinity"
        isIntegral(value) -> value.toLong().toString()
        else -> value.toString()
    }

private fun isIntegral(value: Double): Boolean = kotlin.math.abs(value) < MAX_INTEGRAL_DOUBLE && value % 1.0 == 0.0

/**
 * Web `selectedSignals.indexOf(r.signal)`: the row's position in the caller's selected-signal list, or `-1`
 * when the signal is not selected (the composable then renders it in the neutral text color with no color
 * dot, exactly as the web `idx >= 0 ? color : undefined` branch does).
 */
fun signalColorIndex(
    signal: String,
    selectedSignals: List<String>,
): Int = selectedSignals.indexOf(signal)

/**
 * The pretty-printed raw payload the expandable row reveals — the native port of the web
 * `JSON.stringify(r, null, 2)` over the `SignalLogEntry`. Keys are emitted in the web field order
 * (`created_at`, `signal`, `value_num`, `value_str`, `value_bool`); an integral number is encoded without a
 * decimal point and an absent value as JSON `null`, matching the web serialization byte-for-byte for the
 * common cases.
 */
fun toPrettyJson(entry: SignalLogEntry): String =
    PRETTY_JSON.encodeToString(
        JsonObject.serializer(),
        buildJsonObject {
            put("created_at", entry.createdAt)
            put("signal", entry.signal)
            put("value_num", numberElement(entry.valueNum))
            put("value_str", entry.valueStr)
            put("value_bool", entry.valueBool)
        },
    )

private fun numberElement(value: Double?): JsonElement =
    when {
        value == null -> JsonNull
        isIntegral(value) -> JsonPrimitive(value.toLong())
        else -> JsonPrimitive(value)
    }

/**
 * The pure projection the composable renders — the native mirror of the web component's per-row `render`
 * callbacks (timestamp, color-coded signal, formatted value, type badge) plus the expandable payload.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SignalHistoryProjection {
    /**
     * Projects each [entry] into a render-ready [SignalHistoryRow]. [formatTime] formats `created_at`;
     * injecting it keeps this function locale/zone-deterministic for tests (the composable supplies the real
     * formatter). [selectedSignals] drives the per-row color index.
     */
    fun project(
        entries: List<SignalLogEntry>,
        selectedSignals: List<String>,
        formatTime: (createdAt: String) -> String,
    ): List<SignalHistoryRow> =
        entries.map { entry ->
            SignalHistoryRow(
                key = rowKey(entry),
                time = formatTime(entry.createdAt),
                signal = entry.signal,
                colorIndex = signalColorIndex(entry.signal, selectedSignals),
                value = formatValue(entry),
                valueType = valueType(entry),
                rawJson = toPrettyJson(entry),
            )
        }

    /** Web `keyExtractor={(r) => `${r.created_at}-${r.signal}`}`. */
    fun rowKey(entry: SignalLogEntry): String = "${entry.createdAt}$KEY_SEPARATOR${entry.signal}"
}

/**
 * The header meta line — the web `{t('Page')} {page} · {fmtInt(totalRows)} {t('total')}`. [totalFormatted] is
 * the already-grouped count (see [formatRowCount]); pure string assembly so it is unit-tested directly.
 */
fun headerMeta(
    pageLabel: String,
    page: Int,
    totalFormatted: String,
    totalLabel: String,
): String = "$pageLabel $page \u00B7 $totalFormatted $totalLabel"

/** Grouped integer formatting — the web `fmtInt(totalRows)` (Intl.NumberFormat grouping) for the header meta. */
fun formatRowCount(
    total: Int,
    locale: Locale = Locale.getDefault(),
): String = NumberFormat.getIntegerInstance(locale).format(total.toLong())

/**
 * Projects the web-parity `{ rows…, loading }` props onto a lifecycle [UiState] — the native equivalent of
 * the web `loading ? <Skeleton/> : rows.length > 0 ? <DataTable/> : <EmptyState/>` ternary: loading →
 * [UiPhase.Loading], a resolved-but-empty page → [UiPhase.Empty], otherwise [UiPhase.Content]. There is no
 * fetch behind this overload, so it never carries an error/stale flag.
 */
fun projectUiState(
    data: SignalHistoryData,
    loading: Boolean,
): UiState<SignalHistoryData> {
    val phase =
        when {
            loading -> UiPhase.Loading
            data.rows.isEmpty() -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(phase = phase, data = data)
}

/**
 * Tolerant ISO-8601 → localized "medium date, short time" timestamp formatter — the native analogue of the
 * web `useDateFormat().formatDateTime(created_at)` the Timestamp column renders. Pure (java.time only) so it
 * is unit-tested deterministically with a fixed zone/locale; a blank or unparseable input yields [EM_DASH],
 * matching the web invalid-date guard. The composable injects the platform [Locale] / [ZoneId] at the render
 * boundary, which is how the web `useDateFormat` hook (P1/S8) is bound on native.
 */
object SignalHistoryTimeFormatting {
    fun format(
        createdAt: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(createdAt) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }
}

// Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
// date-time treated as UTC. The first that parses wins; none parsing yields null.
private val INSTANT_PARSERS: List<(String) -> Instant?> =
    listOf(
        { raw -> tryParseInstant { Instant.parse(raw) } },
        { raw -> tryParseInstant { OffsetDateTime.parse(raw).toInstant() } },
        { raw -> tryParseInstant { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
    )

private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else INSTANT_PARSERS.firstNotNullOfOrNull { it(raw) }

private fun tryParseInstant(block: () -> Instant): Instant? =
    try {
        block()
    } catch (_: DateTimeParseException) {
        null
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SIGNAL_HISTORY_TABLE_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from first
 * composition.
 */
fun recordSignalHistoryTableOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SIGNAL_HISTORY_TABLE_SLUG))
}
