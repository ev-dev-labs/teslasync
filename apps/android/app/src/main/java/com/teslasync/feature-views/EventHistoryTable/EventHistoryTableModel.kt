// Pure, framework-free model + projection for the EventHistoryTable feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/admin/components/security-access/EventHistoryTable.tsx) together with the shared
// `./helpers.ts` predicates it leans on (doorClosed / parseWindowState / allWindowsClosed / windowSummary).
// No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — its parent (`SecurityAccessPage` via `useSecurityEvents`)
// loads the `SecurityEvent[]` and passes it down with an `isLoading` flag; it performs no fetching. This
// file owns the per-row decisions that component + its helpers make: the lock / sentry badge tone (raw JS
// truthiness over the `string | boolean | null` union, exactly as the JSX `row.sentryMode ? …`), the door
// label + closed test, the window summary, and the occurred-at timestamp formatting.
//
// Two strings are reproduced as verbatim web literals — the window summary "All Closed" and
// "<n> Open/Venting". The web source builds them in `helpers.ts::windowSummary` with plain template
// strings and never a `t()` call, so no `admin.security.*` i18n key exists for them (verified against
// apps/shared/i18n/catalog/en.json); reproducing the exact text keeps the observable output identical
// (ADR-004 parity), exactly as the sibling SentryEventLog widget does for its own `deriveEvent` literals.
// Every string the component DOES resolve via `t('admin.security.*')` is passed in already-localized
// through [EventHistoryStrings] (P1/S10), so the projection itself stays locale-stable and pure.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EventHistoryTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.eventhistorytable

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown when a value is missing — the web `'—'` fallback (`windowSummary`, door cell, TimeStamp). */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no event data. */
const val EVENT_HISTORY_TABLE_SLUG: String = "EventHistoryTable"

/** The single sortable column key — the web `createdAt` column (`sortable: true`). */
const val SORT_KEY_TIME: String = "createdAt"

/** Web `pagination={{ defaultPageSize: 50 }}`. */
const val EVENT_HISTORY_PAGE_SIZE: Int = 50

// ── windowSummary literals (web helpers.ts literals, reproduced verbatim for parity — see file header) ──
private const val WINDOW_SUMMARY_ALL_CLOSED: String = "All Closed"
private const val WINDOW_SUMMARY_OPEN_VENTING: String = "Open/Venting"

// ── token matches (web helpers.ts lower-cased comparisons) ──────────────────────────────────────────────
private const val CLOSED_TOKEN: String = "closed"
private const val ZERO_TOKEN: String = "0"
private const val VENT_TOKEN: String = "vent"
private const val JSON_OBJECT_PREFIX: Char = '{'

/** The lower-cased strings `doorClosed` treats as a closed door (web `'closed'`/`'closedall'`/`'0'`/`'false'`). */
private val CLOSED_DOOR_TOKENS: Set<String> = setOf(CLOSED_TOKEN, "closedall", ZERO_TOKEN, "false")

/** Compact JSON decoder for the `doorClosed` `{…}` object-string fallback (web `JSON.parse(raw)`). */
private val COMPACT_JSON: Json = Json

/**
 * A loosely-typed `/security` field value — the native mirror of the web `string | boolean | null` union
 * that `signal.SignalValue` serializes to (see `web/src/lib/typeGuards.ts`). Modeled explicitly (rather
 * than coercing to `String?`) so the JS-truthiness + `asNonEmptyString` semantics the component relies on
 * are reproduced exactly: a boolean `false` must NEVER be treated as the string `"false"`.
 */
sealed interface SignalValue {
    /** The wire value was `null` / absent. */
    data object Absent : SignalValue

    /** The wire value was a JSON boolean. */
    data class BoolValue(
        val value: Boolean,
    ) : SignalValue

    /** The wire value was a JSON string (possibly empty, possibly a `{…}` JSON object string). */
    data class StringValue(
        val value: String,
    ) : SignalValue
}

/**
 * The web `asNonEmptyString(v)` guard: the contained string when this is a non-empty
 * [SignalValue.StringValue], else `null` (a boolean or absent value is never coerced to text).
 */
fun SignalValue.asNonEmptyString(): String? = (this as? SignalValue.StringValue)?.value?.takeIf { it.isNotEmpty() }

/**
 * JavaScript truthiness of the union — the semantics the JSX `row.sentryMode ? … : …` relies on: a boolean
 * is itself, a non-empty string is truthy (yes, even `"Off"` — the web does not special-case it here), and
 * an empty string / absent value is falsy.
 */
fun SignalValue.isTruthy(): Boolean =
    when (this) {
        is SignalValue.Absent -> false
        is SignalValue.BoolValue -> value
        is SignalValue.StringValue -> value.isNotEmpty()
    }

/** A single window's resolved position — the web `helpers.ts::WindowState`. */
enum class WindowState { Closed, Venting, Open, Unknown }

/**
 * Port of the web `parseWindowState(val)`: an absent/empty value is [WindowState.Unknown]; `"closed"`/`"0"`
 * is [WindowState.Closed]; anything containing `"vent"` is [WindowState.Venting]; any other non-empty,
 * non-`"0"` token is [WindowState.Open] (the web's final `Unknown` branch is unreachable once `"0"` has been
 * classified as closed, so it folds into the `Open` arm with identical behavior).
 */
fun parseWindowState(value: SignalValue): WindowState {
    val lower = value.asNonEmptyString()?.lowercase() ?: return WindowState.Unknown
    return when {
        lower == CLOSED_TOKEN || lower == ZERO_TOKEN -> WindowState.Closed
        lower.contains(VENT_TOKEN) -> WindowState.Venting
        else -> WindowState.Open
    }
}

/**
 * Port of the web `doorClosed(state)`: an absent value is "closed" (secure default), a boolean is closed when
 * it is `false`, and a string is closed when it is blank, one of [CLOSED_DOOR_TOKENS], or a `{…}` JSON object
 * whose every value is JSON `false`/`null`. Any other string is open; a malformed object string falls through
 * to open, matching the web `catch` arm.
 */
fun doorClosed(state: SignalValue): Boolean =
    when (state) {
        is SignalValue.Absent -> true
        is SignalValue.BoolValue -> !state.value
        is SignalValue.StringValue -> doorStringClosed(state.value)
    }

private fun doorStringClosed(value: String): Boolean {
    val raw = value.takeIf { it.isNotEmpty() } ?: return true
    val lower = raw.trim().lowercase()
    return when {
        lower.isEmpty() || lower in CLOSED_DOOR_TOKENS -> true
        lower.firstOrNull() == JSON_OBJECT_PREFIX -> jsonObjectAllFalseOrNull(raw) ?: false
        else -> false
    }
}

/**
 * True when [raw] decodes to a JSON object whose every value is JSON `false` or `null` (web
 * `Object.values(parsed).every(v => v === false || v == null)`). Returns `null` when [raw] is not a decodable
 * JSON object so the caller can fall through to "open"; a JSON string `"false"` is intentionally NOT counted
 * as `false` (the web uses strict `=== false`).
 */
private fun jsonObjectAllFalseOrNull(raw: String): Boolean? =
    runCatching {
        (COMPACT_JSON.parseToJsonElement(raw) as? JsonObject)
            ?.values
            ?.all { it is JsonNull || (it is JsonPrimitive && !it.isString && it.booleanOrNull == false) }
    }.getOrNull()

/**
 * One `/security` row — the native analogue of the web `SecurityEvent`, narrowed to the fields the five
 * EventHistoryTable columns actually read. [locked] is a tri-state boolean (`null` = not reported, treated as
 * not-locked by the JSX `row.locked ?` truthiness); the remaining flag fields keep the [SignalValue] union so
 * the door/window/sentry helpers see the true wire shape.
 */
data class SecurityEvent(
    val id: String,
    val createdAt: String,
    val locked: Boolean?,
    val sentryMode: SignalValue,
    val doorState: SignalValue,
    val fdWindow: SignalValue,
    val fpWindow: SignalValue,
    val rdWindow: SignalValue,
    val rpWindow: SignalValue,
) {
    /** The four window positions, in web order (front-driver, front-passenger, rear-driver, rear-passenger). */
    fun windowStates(): List<WindowState> = listOf(fdWindow, fpWindow, rdWindow, rpWindow).map(::parseWindowState)
}

/** True when every window is [WindowState.Closed] — the web `allWindowsClosed(ev)`. */
fun allWindowsClosed(event: SecurityEvent): Boolean = event.windowStates().all { it == WindowState.Closed }

/**
 * The web `windowSummary(ev)`: "All Closed" when every window is closed, otherwise "<n> Open/Venting" where
 * `n` is the count of non-closed windows. Both strings are verbatim web literals (see the file header).
 */
fun windowSummary(event: SecurityEvent): String {
    val states = event.windowStates()
    if (states.all { it == WindowState.Closed }) return WINDOW_SUMMARY_ALL_CLOSED
    val openCount = states.count { it != WindowState.Closed }
    return "$openCount $WINDOW_SUMMARY_OPEN_VENTING"
}

/**
 * The Doors cell text — the web `asNonEmptyString(row.doorState) ?? (doorClosed(...) ? t('closed') : '—')`:
 * a non-empty raw door string is shown verbatim, otherwise a closed door reads the localized [closedLabel]
 * and an open one reads the em dash.
 */
fun doorLabel(
    event: SecurityEvent,
    closedLabel: String,
): String = event.doorState.asNonEmptyString() ?: if (doorClosed(event.doorState)) closedLabel else EM_DASH

/** Semantic badge tone for the Lock / Sentry cells, mapped to a concrete `BadgeVariant` at the render boundary. */
enum class BadgeTone { Success, Danger, Neutral }

/** A render-ready status chip — the localized [label] plus the [tone] the composable maps to a `BadgeVariant`. */
data class BadgeCell(
    val label: String,
    val tone: BadgeTone,
)

/** A render-ready Doors/Windows cell — the [text] plus whether it represents a [closed] (safe) state. */
data class StatusText(
    val text: String,
    val closed: Boolean,
)

/**
 * One fully projected, render-ready table row — the native analogue of a single web `data[]` entry after the
 * `render` callbacks run. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 */
data class EventHistoryRow(
    val id: String,
    val time: String,
    val lock: BadgeCell,
    val sentry: BadgeCell,
    val door: StatusText,
    val window: StatusText,
)

/**
 * The already-localized column microcopy the projection folds in — the web `t('admin.security.*')` strings the
 * JSX resolves inline. The composable builds this from `stringResource`; tests pass a deterministic instance.
 */
data class EventHistoryStrings(
    val locked: String,
    val unlocked: String,
    val on: String,
    val off: String,
    val closed: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-row `render`
 * callbacks. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object EventHistoryProjection {
    /**
     * Projects each [event] into a render-ready [EventHistoryRow]. [formatTime] formats `createdAt`; injecting
     * it keeps this function locale/zone-deterministic for tests (the composable supplies the real formatter).
     */
    fun project(
        events: List<SecurityEvent>,
        strings: EventHistoryStrings,
        formatTime: (createdAt: String) -> String,
    ): List<EventHistoryRow> =
        events.map { event ->
            val locked = event.locked == true
            val sentryOn = event.sentryMode.isTruthy()
            EventHistoryRow(
                id = event.id,
                time = formatTime(event.createdAt),
                lock =
                    BadgeCell(
                        label = if (locked) strings.locked else strings.unlocked,
                        tone = if (locked) BadgeTone.Success else BadgeTone.Danger,
                    ),
                sentry =
                    BadgeCell(
                        label = if (sentryOn) strings.on else strings.off,
                        tone = if (sentryOn) BadgeTone.Success else BadgeTone.Neutral,
                    ),
                door = StatusText(text = doorLabel(event, strings.closed), closed = doorClosed(event.doorState)),
                window = StatusText(text = windowSummary(event), closed = allWindowsClosed(event)),
            )
        }
}

/**
 * Orders the rows for display — a port of the web `DataTable` sort over the lone sortable `createdAt` column:
 * when the active sort key is [SORT_KEY_TIME] the events are ordered by parsed timestamp (ascending or
 * descending per [SortState.direction], unparseable stamps sinking to the bottom); any other / absent key
 * preserves the incoming server order (newest-first), matching the web's pre-interaction render.
 */
fun sortEvents(
    events: List<SecurityEvent>,
    sortState: SortState,
): List<SecurityEvent> {
    if (sortState.key != SORT_KEY_TIME) return events
    val ascending = events.sortedBy { parseEpochMillis(it.createdAt) ?: Long.MIN_VALUE }
    return if (sortState.direction == SortDirection.Asc) ascending else ascending.reversed()
}

/**
 * Tolerant ISO-8601 → localized "medium date, short time" timestamp formatter — the native analogue of the web
 * `<TimeStamp>` absolute rendering. Pure (java.time only) so it is unit-tested deterministically with a fixed
 * zone/locale; a blank or unparseable input yields [EM_DASH], like the web component's invalid-date guard.
 */
object EventHistoryTimeFormatting {
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

/** Epoch milliseconds for an ISO timestamp, or `null` when blank/unparseable — backs the time sort. */
fun parseEpochMillis(createdAt: String): Long? = parseInstant(createdAt)?.toEpochMilli()

// Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
// date-time treated as UTC. The first that parses wins; none parsing yields null.
private val INSTANT_PARSERS: List<(String) -> Instant?> =
    listOf(
        { raw -> tryParse { Instant.parse(raw) } },
        { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
        { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
    )

private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else INSTANT_PARSERS.firstNotNullOfOrNull { it(raw) }

private fun tryParse(block: () -> Instant): Instant? =
    try {
        block()
    } catch (_: DateTimeParseException) {
        null
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [EVENT_HISTORY_TABLE_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from first composition.
 */
fun recordEventHistoryTableOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to EVENT_HISTORY_TABLE_SLUG))
}
