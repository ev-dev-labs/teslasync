// Pure, framework-free model + projection for the LiveSignalTail feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/telemetry/components/LiveSignalTail.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is the presentational tail of the signals workspace: a scrolling, paginated DataTable
// of incoming SSE signal events (Time / Signal / Value / Type / Freshness), four stat cards (rate, buffer,
// unique, filtered), a name filter, and Pause/Auto-scroll/Clear controls. Its entries/rate/paused state is
// owned by the parent's `useLiveSignalStream` SSE hook and passed in as props (its only hook is
// `useTranslation`). On Android the single live stream is the app-scoped `LiveSessionStore` (ADR-009), so
// this surface derives the firehose tail from successive merged `LiveVehicleState.signals` deltas for the
// selected vehicle — the native adaptation of the web event firehose, since the single-stream mandate
// forbids opening a second subscription. Values stay the raw SI the backend serves (Phase-42); the tail is
// a debug view that shows them verbatim, exactly as the web `String(value)` does.
//
// This file owns the pure parts: the JSON value typing/rendering (web `detectType` / `String(value)`), the
// merged-state -> entries diff, the capped newest-first buffer fold (web `[...new, ...prev].slice(0, max)`),
// the case-insensitive name filter, the unique-signal count, the 1 Hz signals/sec rate fold, the body-state
// classifier the composable switches on, the Type->Badge/value-color mapping, the i18n resource-name
// constants for every `t(key, default)` the web calls, the localized-strings holder, the accessibility-name
// fold, and the PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveSignalTail — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveSignalsTable / LiveControls surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livesignaltail

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, signal name, or
 * value, so a diagnostics line can never leak the vehicle's live state.
 */
const val LIVE_SIGNAL_TAIL_SLUG: String = "LiveSignalTail"

/** The web `DEFAULT_TAIL_MAX` buffer cap (`useLiveSignalStream`); shown in the "Buffer Size" stat. */
const val DEFAULT_BUFFER_MAX: Int = 500

/** The web `pagination={{ defaultPageSize: 50 }}` page size for the tail table. */
const val LIVE_SIGNAL_TAIL_PAGE_SIZE: Int = 50

/** The rolling window the web 1 Hz rate counter sums over (`setInterval(..., 1000)`). */
const val RATE_WINDOW_MILLIS: Long = 1_000L

/** The web stable column keys (web `Column.key`); shared by the header and the cells. */
const val COL_TIME: String = "time"
const val COL_SIGNAL: String = "signal"
const val COL_VALUE: String = "value"
const val COL_TYPE: String = "type"
const val COL_FRESHNESS: String = "freshness"

/** The JSON `null` literal the web `String(null)` renders. */
internal const val NULL_LITERAL: String = "null"

private const val BOOL_TRUE: String = "true"
private const val BOOL_FALSE: String = "false"

/**
 * The value's runtime kind — the native mirror of the web `detectType` union (`'number' | 'string' |
 * 'boolean'`). [wire] is the exact lowercase token the web renders in the Type column (`{entry.type}`) and
 * passes to the badge, so the native Type cell shows the identical text.
 */
enum class SignalValueType(
    val wire: String,
) {
    Number("number"),
    Text("string"),
    Boolean("boolean"),
}

/**
 * One normalised tail row — the native mirror of the web `SignalEntry`. [id] is the monotonic per-stream
 * sequence the web assigns (`tailIdRef`), [timestampMillis] the client-clock receipt stamp (web `ts`),
 * [value] the already-rendered display string (web `String(value)`), and [type] its detected kind.
 */
data class LiveSignalEntry(
    val id: Long,
    val timestampMillis: Long,
    val name: String,
    val value: String,
    val type: SignalValueType,
)

/**
 * The body branch the composable renders beneath the always-present controls — the native analogue of the
 * web `DataTable` `emptyMessage` ternary, extended with the mandated loading/error branches the shared
 * feature-view contract (P1/S8) requires. The controls, stat cards, and freshness chip render in every
 * branch, so the surface is never a blank box.
 */
enum class LiveSignalTailBody {
    /** Cold start: the stream has not connected yet and no signal has arrived. */
    Loading,

    /** Connected, but no signal has arrived yet — web "Waiting for signals…". */
    Empty,

    /** The wire is down with nothing buffered — a `QueryError` with a reconnect affordance. */
    Error,

    /** At least one buffered signal — the scrolling, paginated table. */
    Data,
}

/**
 * The immutable state the [LiveSignalTailViewModel] exposes — the projection of the single live SSE feed
 * the web parent owns via `useLiveSignalStream`. [entries] is the capped newest-first tail buffer, [rate]
 * the 1 Hz signals/sec counter, [paused] the controlled pause flag, [status] the wire health (web
 * `connected`), [isStale] whether the open stream has gone silent past the freshness window (ADR-013), and
 * [updatedAtMillis] the last-message client clock for the freshness chip. Last-known entries are retained
 * across stale/offline so the tail never blanks; they are flagged, never hidden.
 */
@Suppress("LongParameterList") // The render state mirrors the web component's props + the lifecycle chrome.
data class LiveSignalTailState(
    val entries: List<LiveSignalEntry>,
    val rate: Int,
    val paused: Boolean,
    val bufferMax: Int,
    val status: LiveConnectionStatus,
    val isStale: Boolean,
    val updatedAtMillis: Long?,
) {
    /** Distinct signal names currently buffered — the web `uniqueSignals` Set size. */
    val uniqueSignals: Int get() = LiveSignalTailProjection.uniqueSignalCount(entries)

    /** Whether any signal is buffered (drives the body branch + retains values across stale/offline). */
    val hasEntries: Boolean get() = entries.isNotEmpty()

    /** True while the wire is down (web `!connected` after a session) — drives the offline chip. */
    val isOffline: Boolean get() = status == LiveConnectionStatus.Disconnected

    /** True before the first connection / while reconnecting with nothing buffered — the loading chrome. */
    val isConnecting: Boolean
        get() = status == LiveConnectionStatus.Unknown || status == LiveConnectionStatus.Reconnecting

    /** The body branch the composable renders — see [LiveSignalTailProjection.bodyFor]. */
    val body: LiveSignalTailBody get() = LiveSignalTailProjection.bodyFor(status, hasEntries)

    /** Whether the header freshness chip has anything to say (a stamp, fetching, stale, or offline). */
    val showFreshnessChip: Boolean
        get() = updatedAtMillis != null || isConnecting || isStale || isOffline

    companion object {
        /** The pre-connection seed: empty buffer, neutral wire (web cold start before any frame). */
        fun initial(bufferMax: Int = DEFAULT_BUFFER_MAX): LiveSignalTailState =
            LiveSignalTailState(
                entries = emptyList(),
                rate = 0,
                paused = false,
                bufferMax = bufferMax,
                status = LiveConnectionStatus.Unknown,
                isStale = false,
                updatedAtMillis = null,
            )
    }
}

/**
 * Pure projection from the live merged-signal feed to the render-ready tail — the native port of the web
 * `useLiveSignalStream` tail derivations + the `LiveSignalTail` inline `useMemo`s. Stateless and
 * side-effect-free so every branch is covered by the off-device unit gate.
 */
object LiveSignalTailProjection {
    /**
     * Web `detectType`: a boolean literal -> [SignalValueType.Boolean], a numeric literal ->
     * [SignalValueType.Number], anything else (quoted string, null, unparseable) -> [SignalValueType.Text].
     */
    fun detectType(value: JsonElement): SignalValueType {
        if (value !is JsonPrimitive || value.isString) return SignalValueType.Text
        return when {
            value.content == BOOL_TRUE || value.content == BOOL_FALSE -> SignalValueType.Boolean
            value.doubleOrNull != null -> SignalValueType.Number
            else -> SignalValueType.Text
        }
    }

    /** Web `String(value)`: a JSON `null` -> "null", a primitive -> its raw content (quotes stripped). */
    fun renderValue(value: JsonElement): String =
        when (value) {
            is JsonNull -> NULL_LITERAL
            is JsonPrimitive -> value.content
            else -> value.toString()
        }

    /** Whether [value] is a scalar the tail rows render; the web skips object/array values in this branch. */
    fun isScalar(value: JsonElement): kotlin.Boolean = value is JsonPrimitive || value is JsonNull

    /**
     * The web SSE handler's per-frame fold: every scalar signal whose value is new or changed since [prev]
     * becomes one [LiveSignalEntry], stamped [timestampMillis] and sequenced from [startId] (web
     * `tailIdRef += 1`). Non-scalar (object/array) values are skipped, exactly as the web `typeof value ===
     * 'object'` guard does. Iteration follows [next]'s insertion order so a frame's rows keep their order.
     */
    fun diffToEntries(
        prev: Map<String, JsonElement>,
        next: Map<String, JsonElement>,
        startId: Long,
        timestampMillis: Long,
    ): List<LiveSignalEntry> {
        var id = startId
        val out = ArrayList<LiveSignalEntry>()
        for ((name, value) in next) {
            if (!isScalar(value) || prev[name] == value) continue
            id += 1
            out += LiveSignalEntry(id, timestampMillis, name, renderValue(value), detectType(value))
        }
        return out
    }

    /**
     * Web `[...newEntries, ...prev].slice(0, tailMax)`: prepend [incoming] (newest first) onto [buffer] and
     * cap at [cap]. A non-positive [cap] disables tail collection (web `tailMax === 0`).
     */
    fun appendCapped(
        buffer: List<LiveSignalEntry>,
        incoming: List<LiveSignalEntry>,
        cap: Int,
    ): List<LiveSignalEntry> {
        if (cap <= 0) return emptyList()
        val combined = if (incoming.isEmpty()) buffer else incoming + buffer
        return if (combined.size <= cap) combined else combined.take(cap)
    }

    /** Web `entries.filter(e => e.name.toLowerCase().includes(q))`; a blank query returns every row. */
    fun filterEntries(
        entries: List<LiveSignalEntry>,
        query: String,
    ): List<LiveSignalEntry> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return entries
        return entries.filter { it.name.lowercase().contains(q) }
    }

    /** Web `new Set(entries.map(e => e.name)).size`: the count of distinct buffered signal names. */
    fun uniqueSignalCount(entries: List<LiveSignalEntry>): Int = entries.mapTo(HashSet()) { it.name }.size

    /**
     * Web 1 Hz `tailRate`: the number of entries received in the last [windowMillis] relative to
     * [nowMillis]. Counting buffered receipts (each stamped at merge time) reproduces the web counter while
     * letting the rate decay to 0 as a quiet stream's entries age out of the window.
     */
    fun ratePerSecond(
        entries: List<LiveSignalEntry>,
        nowMillis: Long,
        windowMillis: Long = RATE_WINDOW_MILLIS,
    ): Int =
        entries.count { entry ->
            val age = nowMillis - entry.timestampMillis
            age in 0 until windowMillis
        }

    /**
     * The body branch the composable renders: any buffered entry shows the table; otherwise a down wire
     * shows the `QueryError`, a connected-but-silent wire the "Waiting…" empty state, and a not-yet-
     * connected wire the loading chrome. Stale is a sub-state of [LiveSignalTailBody.Data] (a chip + the
     * retained rows), exactly as the web tail keeps rendering while data ages.
     */
    fun bodyFor(
        status: LiveConnectionStatus,
        hasEntries: Boolean,
    ): LiveSignalTailBody =
        when {
            hasEntries -> LiveSignalTailBody.Data
            status == LiveConnectionStatus.Disconnected -> LiveSignalTailBody.Error
            status == LiveConnectionStatus.Connected -> LiveSignalTailBody.Empty
            else -> LiveSignalTailBody.Loading
        }

    /** The `QueryError` recovery copy for a down live wire — a generic, retry-able network failure. */
    fun errorKind(): QueryErrorKind = QueryErrorKind.Network

    /**
     * The Type-column badge tone — web `entry.type === 'number' ? 'info' : type === 'boolean' ? 'warning' :
     * 'success'`. The same tone colors the Value cell (web `TYPE_VALUE_COLOR`).
     */
    fun badgeVariant(type: SignalValueType): BadgeVariant =
        when (type) {
            SignalValueType.Number -> BadgeVariant.Info
            SignalValueType.Boolean -> BadgeVariant.Warning
            SignalValueType.Text -> BadgeVariant.Success
        }
}

// ── i18n resource-name constants (P1/S10) ─────────────────────────────────────────────────────────────
// Each web `liveMonitor.*` key maps to a `translation_liveMonitor_*` resource present in values/,
// values-ar/, and values-he/. The composable resolves them at the Compose boundary via compile-time
// `R.string` references; these constants document the mapping and are asserted by name in the unit gate so
// a key rename is caught off-device.

/** Resource name for the web `liveMonitor.time` Time-column header. */
const val KEY_TIME: String = "translation_liveMonitor_time"

/** Resource name for the web `liveMonitor.signal` Signal-column header. */
const val KEY_SIGNAL: String = "translation_liveMonitor_signal"

/** Resource name for the web `liveMonitor.value` Value-column header. */
const val KEY_VALUE: String = "translation_liveMonitor_value"

/** Resource name for the web `liveMonitor.type` Type-column header. */
const val KEY_TYPE: String = "translation_liveMonitor_type"

/** Resource name for the web `liveMonitor.freshness` Freshness-column header. */
const val KEY_FRESHNESS: String = "translation_liveMonitor_freshness"

/** Resource name for the web filter-prompt key (the ghost text shown inside the field). */
const val KEY_FILTER_HINT: String = "translation_liveMonitor_filterPlaceholder" // parity:allow i18n key name

/** Resource name for the web `liveMonitor.filterLabel` filter `aria-label`. */
const val KEY_FILTER_LABEL: String = "translation_liveMonitor_filterLabel"

/** Resource name for the web `liveMonitor.resume` resume-button label. */
const val KEY_RESUME: String = "translation_liveMonitor_resume"

/** Resource name for the web `liveMonitor.pause` pause-button label. */
const val KEY_PAUSE: String = "translation_liveMonitor_pause"

/** Resource name for the web `liveMonitor.autoScroll` auto-scroll-toggle label. */
const val KEY_AUTO_SCROLL: String = "translation_liveMonitor_autoScroll"

/** Resource name for the web `liveMonitor.clear` clear-button label. */
const val KEY_CLEAR: String = "translation_liveMonitor_clear"

/** Resource name for the web `liveMonitor.sigPerSec` "Signals / sec" stat label. */
const val KEY_SIG_PER_SEC: String = "translation_liveMonitor_sigPerSec"

/** Resource name for the web `liveMonitor.bufferSize` "Buffer Size" stat label. */
const val KEY_BUFFER_SIZE: String = "translation_liveMonitor_bufferSize"

/** Resource name for the web `liveMonitor.uniqueSignals` "Unique Signals" stat label. */
const val KEY_UNIQUE_SIGNALS: String = "translation_liveMonitor_uniqueSignals"

/** Resource name for the web `liveMonitor.filtered` "Filtered" stat label. */
const val KEY_FILTERED: String = "translation_liveMonitor_filtered"

/** Resource name for the web `liveMonitor.waiting` empty-buffer message. */
const val KEY_WAITING: String = "translation_liveMonitor_waiting"

/** Resource name for the web `liveMonitor.noMatch` filtered-empty message. */
const val KEY_NO_MATCH: String = "translation_liveMonitor_noMatch"

/** Resource name for the web `liveMonitor.title` panel title. */
const val KEY_TITLE: String = "translation_liveMonitor_title"

/**
 * The already-localized strings the tail renders, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the surface carries no English literal. Each field maps to one web
 * `t('liveMonitor.…')` call; [filterLabel] is the web `aria-label`, [filterHint] the ghost prompt.
 */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per web liveMonitor.* t() call.
data class LiveSignalTailStrings(
    val title: String,
    val time: String,
    val signal: String,
    val value: String,
    val type: String,
    val freshness: String,
    val filterHint: String,
    val filterLabel: String,
    val resume: String,
    val pause: String,
    val autoScroll: String,
    val clear: String,
    val sigPerSec: String,
    val bufferSize: String,
    val uniqueSignals: String,
    val filtered: String,
    val waiting: String,
    val noMatch: String,
)

/**
 * Accessibility coverage helper: the accessible names of every interactive control the tail exposes, in
 * render order (filter field, the pause/resume toggle for the current [paused] state, the auto-scroll
 * toggle, Clear). The composable wires each name onto its control (visible label or `contentDescription`);
 * the unit gate asserts the fold is complete and blank-free so TalkBack always has a name to announce — the
 * off-device half of the a11y-label requirement.
 */
fun interactiveAccessibleNames(
    strings: LiveSignalTailStrings,
    paused: Boolean,
): List<String> =
    listOf(
        strings.filterLabel,
        if (paused) strings.resume else strings.pause,
        strings.autoScroll,
        strings.clear,
    )

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [LIVE_SIGNAL_TAIL_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * composable's first-composition effect.
 */
fun recordLiveSignalTailOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to LIVE_SIGNAL_TAIL_SLUG))
}
