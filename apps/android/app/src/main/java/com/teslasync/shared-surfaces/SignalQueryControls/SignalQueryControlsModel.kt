// Pure, framework-free model + projection for the SignalQueryControls shared surface — the native analogue of
// everything the web module derives before returning JSX (web/src/components/SignalQueryControls.tsx). No
// Compose, no Android UI, no HTTP: every declaration here is exercised by the :app:testReleaseUnitTest gate so
// the composable stays a thin render layer.
//
// The web file is the reusable query toolkit shared by the Signal Log Viewer + Signal Explorer pages: a
// signal multi-select bound to `GET /signals/available` (its one `useQuery`), a `datetime-local` From/To range
// with five quick presets, a rows-per-page + Query control, and a typed results table (#, timestamp, color-
// coded value, type badge) with server-side pagination. This model reproduces, EXACTLY and purely: the typed
// `{ts, kind, value}` → legacy `{created_at, value_num/str/bool}` adapter that motivated the web helper, the
// value-type discriminator + formatter + badge mapping, the `datetime-local` parse/format + preset matching,
// and the cache-then-network fold of the genuine async dependency (the available-signals feed) into the
// loading / content / empty / error / stale / offline matrix the prompt mandates.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SignalQueryControls — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path, exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.signalquerycontrols

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.forms.ComboOption
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryPoint
import io.teslasync.shared.core.presentation.telemetry.SignalHistoryResponse
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.abs

/**
 * Canonical registry metadata for this surface — the native mirror of the web module's contract. The
 * diagnostics slug, the structured-log field key, and the event names are pinned here so the native and web
 * surfaces stay in lockstep.
 */
object SignalQueryControlsRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SignalQueryControls"

    /** Structured-log field key carrying the surface slug. */
    const val SURFACE_KEY: String = "surface"

    /** The one PII-safe diagnostic emitted on first composition (P1/S11). */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** Emitted when the available-signals feed is re-fetched (retry / stale auto-refresh). */
    const val EVENT_REFRESH: String = "signalQueryControls.refresh"
}

/** The tri-typed value discriminator a signal row carries — the native port of the web `getValueType`. */
enum class SignalValueType {
    /** A numeric value (web `value_num`). */
    Num,

    /** A string / time value (web `value_str`). */
    Str,

    /** A boolean value (web `value_bool`). */
    Bool,

    /** A fully-empty row (web `null`). */
    Null,
}

/**
 * One results-table row — the native port of the web `SignalLogEntry`. The three value fields are a tri-typed
 * union exactly one of which is non-null (or all null for an empty row); [valueType] + [formatValue] read them
 * in the web's precedence order.
 */
data class SignalLogEntry(
    val createdAt: String,
    val signal: String,
    val valueNum: Double? = null,
    val valueStr: String? = null,
    val valueBool: Boolean? = null,
)

/**
 * The web `getValueType(entry)`: `value_num` present → [SignalValueType.Num]; else `value_str` → [Str]; else
 * `value_bool` → [Bool]; otherwise [Null]. The order is significant and matches the web switch.
 */
fun SignalLogEntry.valueType(): SignalValueType =
    when {
        valueNum != null -> SignalValueType.Num
        valueStr != null -> SignalValueType.Str
        valueBool != null -> SignalValueType.Bool
        else -> SignalValueType.Null
    }

/**
 * The web `formatValue(entry)`: the numeric value (JS `String(value_num)`), else the raw string, else the
 * boolean as `true`/`false`, else the em-dash sentinel for an empty row.
 */
fun SignalLogEntry.formatValue(): String =
    when {
        valueNum != null -> formatSignalNumber(valueNum)
        valueStr != null -> valueStr
        valueBool != null -> if (valueBool) TRUE_LITERAL else FALSE_LITERAL
        else -> EM_DASH
    }

/**
 * The verbatim lower-case value-type token the web `getValueType` returns and renders in the type badge
 * (`num`/`str`/`bool`/`null`). It is a protocol value-kind identifier, not user-facing prose — so, exactly as
 * the sibling SignalHistoryTable surface does for its own type badge, it is carried as the literal token
 * rather than a localized string.
 */
fun typeToken(type: SignalValueType): String =
    when (type) {
        SignalValueType.Num -> "num"
        SignalValueType.Str -> "str"
        SignalValueType.Bool -> "bool"
        SignalValueType.Null -> "null"
    }

/** The semantic badge variant for a value type — the native port of the web `TYPE_BADGE_COLOR` map. */
fun badgeVariantOf(type: SignalValueType): BadgeVariant =
    when (type) {
        SignalValueType.Num -> BadgeVariant.Info
        SignalValueType.Str -> BadgeVariant.Success
        SignalValueType.Bool -> BadgeVariant.Warning
        SignalValueType.Null -> BadgeVariant.Neutral
    }

/**
 * JS `String(number)` parity: an integral value renders with no decimal point (`64`, not `64.0`); any other
 * value uses the default decimal rendering.
 */
fun formatSignalNumber(value: Double): String =
    when {
        !value.isFinite() -> value.toString()
        abs(value) < MAX_INTEGRAL_DOUBLE && value % 1.0 == 0.0 -> value.toLong().toString()
        else -> value.toString()
    }

/** The selectable page sizes — the web `PAGE_SIZES`. */
val PAGE_SIZES: List<Int> = listOf(25, 50, 100)

internal const val EM_DASH: String = "\u2014"
internal const val TRUE_LITERAL: String = "true"
internal const val FALSE_LITERAL: String = "false"
private const val MAX_INTEGRAL_DOUBLE: Double = 1e15

// ── BE → FE adapter (the typed `{ts, kind, value}` → legacy `SignalLogEntry` projection) ──

/**
 * The native port of the web `adaptSignalHistoryPoint`. The typed `GET /signals/{id}/{name}/history` endpoint
 * returns a single `value` whose runtime type is dictated by the row's kind; the rest of the telemetry UI was
 * built for the legacy `value_num/str/bool` rows. Without this adapter the timestamp renders "Invalid Date"
 * and every cell shows the em-dash — the exact symptom that motivated the web helper. The [JsonPrimitive] is
 * discriminated string → boolean → number (the web `typeof` switch order); a JSON null / absent value leaves
 * all three fields null.
 */
fun adaptSignalHistoryPoint(
    point: SignalHistoryPoint,
    signal: String,
): SignalLogEntry {
    val primitive = point.value as? JsonPrimitive
    return when {
        point.value == null || point.value is JsonNull || primitive == null ->
            SignalLogEntry(createdAt = point.ts, signal = signal)
        primitive.isString ->
            SignalLogEntry(createdAt = point.ts, signal = signal, valueStr = primitive.content)
        primitive.booleanOrNull != null ->
            SignalLogEntry(createdAt = point.ts, signal = signal, valueBool = primitive.booleanOrNull)
        primitive.doubleOrNull != null ->
            SignalLogEntry(createdAt = point.ts, signal = signal, valueNum = primitive.doubleOrNull?.takeIf(Double::isFinite))
        else ->
            SignalLogEntry(createdAt = point.ts, signal = signal, valueStr = primitive.content)
    }
}

/** The native port of the web `adaptSignalHistoryResp` — maps every point of a typed history response. */
fun adaptSignalHistoryResp(response: SignalHistoryResponse?): List<SignalLogEntry> {
    if (response == null) return emptyList()
    val signal = response.signal
    return response.data.map { adaptSignalHistoryPoint(it, signal) }
}

// ── datetime-local parse/format + quick-range presets ──

/** A quick-range preset — the native port of one `TIME_RANGE_PRESETS` entry. */
data class TimeRangePreset(
    val label: String,
    val hours: Int,
)

/**
 * The five quick-range presets — the native port of the web `TIME_RANGE_PRESETS` (1h / 6h / 24h / 7d / 30d).
 * Labels are protocol-style duration tokens (web renders them verbatim), not localized prose.
 */
val TIME_RANGE_PRESETS: List<TimeRangePreset> =
    listOf(
        TimeRangePreset("1h", 1),
        TimeRangePreset("6h", 6),
        TimeRangePreset("24h", 24),
        TimeRangePreset("7d", 168),
        TimeRangePreset("30d", 720),
    )

/**
 * Pure `datetime-local` ⇄ `LocalDateTime` helpers + the timestamp formatter + the preset matcher — the native
 * port of the web `toLocalDatetimeStr` / `formatTimestampMs` / `matchTimeRangePreset`. Side-effect-free and
 * fully off-device-testable; the composable supplies the display [ZoneId] at the render boundary.
 */
object SignalQueryTime {
    private const val LOCAL_PATTERN_SECONDS = "yyyy-MM-dd'T'HH:mm:ss"
    private const val LOCAL_PATTERN_MINUTES = "yyyy-MM-dd'T'HH:mm"
    private const val DISPLAY_PATTERN = "yyyy-MM-dd HH:mm"
    private const val TIMESTAMP_PATTERN = "yyyy-MM-dd HH:mm:ss.SSS"
    private const val HOUR_MILLIS = 3_600_000L
    private const val DEFAULT_TOLERANCE_MILLIS = 60_000L

    private val LOCAL_SECONDS: DateTimeFormatter = DateTimeFormatter.ofPattern(LOCAL_PATTERN_SECONDS, Locale.ROOT)
    private val LOCAL_MINUTES: DateTimeFormatter = DateTimeFormatter.ofPattern(LOCAL_PATTERN_MINUTES, Locale.ROOT)
    private val DISPLAY_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern(DISPLAY_PATTERN, Locale.ROOT)
    private val TIMESTAMP_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern(TIMESTAMP_PATTERN, Locale.ROOT)

    /** Formats a [moment] as a seconds-precision `datetime-local` string — the web `toLocalDatetimeStr`. */
    fun toLocalDatetimeStr(moment: LocalDateTime): String = moment.format(LOCAL_SECONDS)

    /** Parses a `datetime-local` string (seconds- or minutes-precision) back to a [LocalDateTime], else null. */
    fun parseLocalDatetime(value: String): LocalDateTime? {
        if (value.isBlank()) return null
        return runCatching { LocalDateTime.parse(value, LOCAL_SECONDS) }
            .recoverCatching { LocalDateTime.parse(value, LOCAL_MINUTES) }
            .getOrNull()
    }

    /** The picker-field display text for a window value, or [emptyLabel] when unset so a field is never blank. */
    fun displayLabel(
        value: String,
        emptyLabel: String,
    ): String = parseLocalDatetime(value)?.format(DISPLAY_FORMAT) ?: emptyLabel

    /**
     * The web `formatTimestampMs(iso)`: a millisecond-precision wall-clock stamp in [zone], or the em-dash for
     * an unparseable input. Tries an absolute instant, then an offset, then a zoneless local datetime so every
     * shape the typed history endpoint can emit round-trips.
     */
    fun formatTimestampMs(
        iso: String,
        zone: ZoneId,
    ): String {
        if (iso.isBlank()) return EM_DASH
        val local =
            runCatching { Instant.parse(iso).atZone(zone).toLocalDateTime() }
                .recoverCatching { OffsetDateTime.parse(iso).atZoneSameInstant(zone).toLocalDateTime() }
                .recoverCatching { LocalDateTime.parse(iso) }
                .getOrNull()
        return local?.format(TIMESTAMP_FORMAT) ?: EM_DASH
    }

    /**
     * The web `matchTimeRangePreset(from, to)`: the matched preset's `hours`, or null. Both strings are read in
     * the same (local) zone so the span is zone-independent; a span within [toleranceMillis] of a preset's hour
     * span matches. The ±60 s default absorbs the click-vs-now drift the web tolerates.
     */
    fun matchTimeRangePreset(
        fromValue: String,
        toValue: String,
        toleranceMillis: Long = DEFAULT_TOLERANCE_MILLIS,
    ): Int? {
        val from = parseLocalDatetime(fromValue)
        val to = parseLocalDatetime(toValue)
        if (from == null || to == null) return null
        val spanMillis = ChronoUnit.MILLIS.between(from, to)
        return TIME_RANGE_PRESETS.firstOrNull { abs(spanMillis - it.hours * HOUR_MILLIS) <= toleranceMillis }?.hours
    }

    /**
     * The web `onPreset(hours)` range: from = now − hours, to = now, both as seconds-precision `datetime-local`
     * strings. [now] is injected so the computation is deterministic in tests.
     */
    fun presetRange(
        hours: Int,
        now: LocalDateTime,
    ): Pair<String, String> = toLocalDatetimeStr(now.minusHours(hours.toLong())) to toLocalDatetimeStr(now)
}

// ── Signal multi-select selection algebra (the web SignalMultiSelect add/remove + cap) ──

/**
 * Toggle [signal] in the [selected] list — the native port of the web `addSignal`/`removeSignal`. An already-
 * selected signal is removed; otherwise it is appended unless the [max] cap is reached, in which case the
 * selection is returned unchanged (the web early-return guard). A null [max] means no cap.
 */
fun toggleSignal(
    selected: List<String>,
    signal: String,
    max: Int?,
): List<String> =
    when {
        signal in selected -> selected.filterNot { it == signal }
        max != null && selected.size >= max -> selected
        else -> selected + signal
    }

/** True once the selection has reached the [max] cap — the web `selected.length >= maxSignals` guard. */
fun atSignalCap(
    selected: List<String>,
    max: Int?,
): Boolean = max != null && selected.size >= max

// ── i18n strings + render-ready projection ──

/**
 * The already-localized strings the surface folds into its output, resolved from `stringResource` at the
 * render boundary (tests pass a deterministic instance) so [SignalQueryControlsProjection] stays a pure,
 * locale-stable function. Every value resolves through the P1/S10 catalog. [presetAriaTemplate] carries the
 * positional `%1$s` the per-preset accessible name fills in (catalog `translation_signalQuery_preset_aria`).
 */
data class SignalQueryControlsStrings(
    val fromLabel: String,
    val toLabel: String,
    val quickRangeLabel: String,
    val presetAriaTemplate: String,
    val queryLabel: String,
    val rowsLabel: String,
    val signalsLabel: String,
    val noOptionsLabel: String,
    val maxReachedLabel: String,
    val removeLabel: String,
    val timestampHeader: String,
    val signalHeader: String,
    val valueHeader: String,
    val typeHeader: String,
    val noResultsLabel: String,
    val emptyResultsTitle: String,
    val emptyResultsMessage: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
    val updatingLabel: String,
    val retryLabel: String,
    val confirmLabel: String,
    val cancelLabel: String,
    val paginationFirst: String,
    val paginationPrevious: String,
    val paginationNext: String,
    val paginationLast: String,
) {
    /** The accessible name for the preset chip [label] — web `t('signalQuery.preset.aria', { label })`. */
    fun presetAria(label: String): String = presetAriaTemplate.format(label)

    /** The accessible name for a selected-signal chip's remove affordance — web `aria-label="Remove {sig}"`. */
    fun removeAria(signal: String): String = "$removeLabel $signal"
}

/**
 * The mutually-exclusive render surface the signal picker draws. [Content] is the selectable picker; [Empty]
 * is the resolved-but-no-signals friendly note (web's empty `useSignals` result); [Loading] + [Error] surface
 * the cold-start + hard-failure states of the available-signals feed the surface binds.
 */
enum class SignalPickerPhase {
    /** First fetch with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** Signals resolved — render the chips + the multi-select. */
    Content,

    /** Resolved with no available signals — render a friendly empty note. */
    Empty,

    /** The fetch failed with nothing cached to fall back on — render a classified error with retry. */
    Error,
}

/**
 * The immutable, render-ready projection of the available-signals feed the composable draws — the resolved
 * [phase], the available signal [names], and the cache-then-network freshness envelope ([stale]/[offline]/
 * [refreshing] + [errorKind]/[httpStatus]) so the surface honestly flags last-known data. Pure data, so
 * [SignalQueryControlsProjection] is unit-tested without a UI host.
 */
data class SignalPickerDisplay(
    val phase: SignalPickerPhase,
    val names: List<String> = emptyList(),
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** True when a freshness chip (stale / offline / refreshing) should be shown over cached options. */
    val showFreshnessChip: Boolean get() = stale || offline || refreshing

    /** True when the resolved feed exposed no signals (the friendly empty note). */
    val isEmpty: Boolean get() = phase == SignalPickerPhase.Empty
}

/**
 * Pure projection + selection helpers for the SignalQueryControls picker — the native port of the web
 * `SignalMultiSelect`'s `filtered` memo + the `useSignals` cache-then-network fold, plus the shared freshness
 * envelope the sibling surfaces use.
 */
object SignalQueryControlsProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Folds the available-signals [state] (the genuine async dependency) into the render-ready
     * [SignalPickerDisplay]. A hard failure with no cache → [SignalPickerPhase.Error]; a first load with
     * nothing cached → [Loading]; a resolved-empty feed → [Empty]; otherwise the selectable [Content]. The
     * stale/offline envelope honours the ADR-013 freshness contract so cached options shown after a failed
     * refresh are flagged rather than presented as live.
     */
    fun project(state: UiState<List<String>>): SignalPickerDisplay {
        val names = state.data ?: emptyList()
        val phase =
            when {
                state.isError -> SignalPickerPhase.Error
                state.isLoading -> SignalPickerPhase.Loading
                names.isEmpty() -> SignalPickerPhase.Empty
                else -> SignalPickerPhase.Content
            }
        return SignalPickerDisplay(
            phase = phase,
            names = if (phase == SignalPickerPhase.Content) names else emptyList(),
            stale = state.stale && state.errorKind == null,
            offline = state.stale && state.hasData && state.errorKind != null,
            refreshing = state.refreshing,
            errorKind = state.errorKind,
            httpStatus = state.httpStatus,
            freshnessStamp = state.fetchedAt,
        )
    }

    /**
     * The combobox options for the resolved feed — every available signal mapped to a [ComboOption], enabled
     * when it is already selected (so it can be removed) or the [max] cap has not been reached. The native
     * analogue of the web `maxSignals` guard that stops further additions once the cap is hit.
     */
    fun comboOptions(
        names: List<String>,
        selected: List<String>,
        max: Int?,
    ): List<ComboOption> {
        val atCap = atSignalCap(selected, max)
        val selectedSet = selected.toSet()
        return names.map { name ->
            ComboOption(value = name, label = name, enabled = name in selectedSet || !atCap)
        }
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface shows
     * the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure → [Network]; a 401/403
     * → [Unauthorized]; a 404 → [NotFound]; every other failure → [ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: SignalPickerDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}

// ── results-table pagination math (the web SignalDataTable `totalPages` gate) ──

/** The 1-based total page count for [total] rows at [perPage] — the web `pagination.total_pages`. */
fun totalPages(
    total: Int,
    perPage: Int,
): Int = if (perPage <= 0 || total <= 0) 1 else (total + perPage - 1) / perPage
