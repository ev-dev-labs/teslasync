// Pure, framework-free model + projection for the StateTimeline feature view — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/system/components/state-machine/StateTimeline.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// StateTimeline is a purely presentational surface — the web component takes its pre-windowed `transitions`
// as a prop from the FSM debugger page that owns the buffer, the window length, and the selected id, so this
// surface binds NO data hook of its own. Its only web hooks are `useTranslation` (the i18n catalog, P1/S10)
// and `useDateFormat` (the browser locale/timezone boundary, mapped here to the injected [ZoneId] + [Locale]).
// The page hands down a list that may be empty; when it is, and a `lastTransition` exists outside the active
// window, the web surfaces an actionable "widen window / jump to last" hint rather than going silent — so
// this file owns those derivations: the per-tick horizontal placement (web `leftPct`), the destination-state
// accent resolution (web `getStateColor`), the window preset label (web `presetLabel`), the relative
// "last transition" label (web `formatRelative`), and the axis clock formatting (web `formatTime`).
//
// FSM accent parity: the web `getStateColor(fsmType, state)` resolves a state to a `StateStyle` whose `dot`
// class colors the tick. This file ports the full `@/types/fsm` registry (all eight machines) to a semantic
// [FsmAccent], honouring each state's variant AND its `dot` override (e.g. vehicle `charging` overrides to
// cyan, `offline` overrides to a muted gray rather than its danger variant). The composable maps each accent
// to a design token (never a raw hex in render code), so light / dark / high-contrast all stay correct.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/StateTimeline — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statetimeline

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown wherever a timestamp is absent or unparseable — the web `formatTime` invalid-date fallback. */
internal const val STATE_TIMELINE_EM_DASH: String = "\u2014"

/** Default window length in minutes — the web `windowMinutes = 10` prop default. */
const val STATE_TIMELINE_DEFAULT_WINDOW_MINUTES: Int = 10

private const val MILLIS_PER_MINUTE: Long = 60_000L
private const val MILLIS_PER_SECOND: Long = 1_000L
private const val SECONDS_PER_MINUTE: Long = 60L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L
private const val DAYS_PER_WEEK: Long = 7L
private const val MINUTES_PER_HOUR_INT: Int = 60
private const val MINUTES_PER_DAY_INT: Int = 1_440

// ── Wire model (web `FSMTransition`, web/src/types/fsm/ui-types.ts) ──

/**
 * One FSM transition row — the native mirror of the web `FSMTransition` interface the debugger feed returns.
 * Wire field names keep their snake_case via @SerialName (the Go `/fsm/transitions` JSON contract) and every
 * field defaults so a partial payload decodes without error (a decoder configured with `ignoreUnknownKeys`
 * ignores the `details` column and any peers). The composable reads [id], [ts], [fromState], and [toState];
 * the remaining fields complete the contract so the decoded row round-trips faithfully.
 *
 * @property ts the transition instant as an ISO-8601 string (the backend emits UTC); placed on the timeline
 *   by [StateTimelineProjection] and rendered as wall-clock time by the composable.
 * @property fromState the source state name (lower-cased for accent resolution).
 * @property toState the destination state name — the tick's accent is resolved from this (web `tr.to_state`).
 */
@Serializable
data class FsmTransition(
    @SerialName("id") val id: Long = 0,
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    @SerialName("ts") val ts: String = "",
    @SerialName("fsm_name") val fsmName: String = "",
    @SerialName("from_state") val fromState: String = "",
    @SerialName("to_state") val toState: String = "",
    @SerialName("trigger") val trigger: String = "",
)

// ── FSM accent resolution (web `getStateColor` over the `@/types/fsm` registry) ──

/**
 * The semantic accent a state's tick is painted with — the native analogue of the resolved web `StateStyle.dot`
 * class. The five base roles mirror the FSM `BadgeVariant` theme; [Cyan] and [Purple] capture the two `dot`
 * overrides that diverge from their variant's default hue enough to read as a distinct color in the token
 * palette (the remaining overrides — indigo, orange, the darker reds and grays — collapse onto the base role
 * whose token they already share). The composable maps each role to a design token.
 */
enum class FsmAccent {
    Success,
    Warning,
    Danger,
    Info,
    Neutral,
    Cyan,
    Purple,
}

/**
 * Pure port of the web `getStateColor(fsmType, state)` resolver (web/src/types/fsm/registry.ts). Resolves a
 * `(fsmType, state)` pair to its [FsmAccent] by looking the lower-cased state up in the per-machine table,
 * defaulting to the vehicle machine for an unknown `fsmType` (web `FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle`)
 * and to [FsmAccent.Neutral] for an unknown state (web `DEFAULT_STATE`). The tables encode each state's resolved
 * `dot` hue — variant default unless the registry entry overrides `dot`.
 */
object FsmStateAccents {
    private val VEHICLE: Map<String, FsmAccent> =
        mapOf(
            "online" to FsmAccent.Success,
            "driving" to FsmAccent.Success,
            "charging" to FsmAccent.Cyan,
            "parked" to FsmAccent.Purple,
            "updating" to FsmAccent.Info,
            "asleep" to FsmAccent.Neutral,
            "offline" to FsmAccent.Neutral,
        )

    private val TELEMETRY_CONNECTION: Map<String, FsmAccent> =
        mapOf(
            "unknown" to FsmAccent.Neutral,
            "connecting" to FsmAccent.Warning,
            "streaming" to FsmAccent.Success,
            "stale" to FsmAccent.Warning,
            "disconnected" to FsmAccent.Danger,
            "polling_only" to FsmAccent.Info,
        )

    private val DRIVE_SESSION: Map<String, FsmAccent> =
        mapOf(
            "pending" to FsmAccent.Warning,
            "active" to FsmAccent.Success,
            "ending" to FsmAccent.Warning,
            "completed" to FsmAccent.Info,
            "recovered" to FsmAccent.Purple,
        )

    private val CHARGE_SESSION: Map<String, FsmAccent> =
        mapOf(
            "pending" to FsmAccent.Warning,
            "active" to FsmAccent.Cyan,
            "completing" to FsmAccent.Info,
            "done" to FsmAccent.Success,
            "recovered" to FsmAccent.Purple,
        )

    private val COMMAND: Map<String, FsmAccent> =
        mapOf(
            "queued" to FsmAccent.Neutral,
            "waking" to FsmAccent.Warning,
            "wake_confirmed" to FsmAccent.Info,
            "wake_timeout" to FsmAccent.Warning,
            "sending" to FsmAccent.Info,
            "succeeded" to FsmAccent.Success,
            "failed" to FsmAccent.Danger,
            "timed_out" to FsmAccent.Warning,
            "retrying" to FsmAccent.Purple,
            "gave_up" to FsmAccent.Danger,
        )

    private val NOTIFICATION: Map<String, FsmAccent> =
        mapOf(
            "created" to FsmAccent.Neutral,
            "sending" to FsmAccent.Info,
            "delivered" to FsmAccent.Success,
            "partial" to FsmAccent.Warning,
            "failed" to FsmAccent.Danger,
            "retrying" to FsmAccent.Purple,
            "dead" to FsmAccent.Danger,
        )

    private val ALERT_COOLDOWN: Map<String, FsmAccent> =
        mapOf(
            "armed" to FsmAccent.Success,
            "fired" to FsmAccent.Danger,
            "suppressed" to FsmAccent.Warning,
        )

    private val AUTOMATION: Map<String, FsmAccent> =
        mapOf(
            "idle" to FsmAccent.Neutral,
            "evaluating" to FsmAccent.Cyan,
            "executing" to FsmAccent.Warning,
            "succeeded" to FsmAccent.Success,
            "partial" to FsmAccent.Warning,
            "failed" to FsmAccent.Danger,
            "retrying" to FsmAccent.Warning,
            "gave_up" to FsmAccent.Danger,
            "skipped" to FsmAccent.Neutral,
            "cooldown" to FsmAccent.Purple,
            "disabled" to FsmAccent.Danger,
        )

    private val REGISTRY: Map<String, Map<String, FsmAccent>> =
        mapOf(
            "vehicle" to VEHICLE,
            "telemetry_connection" to TELEMETRY_CONNECTION,
            "drive_session" to DRIVE_SESSION,
            "charge_session" to CHARGE_SESSION,
            "command" to COMMAND,
            "notification" to NOTIFICATION,
            "alert_cooldown" to ALERT_COOLDOWN,
            "automation" to AUTOMATION,
        )

    /** Resolves the destination-state accent for a tick, mirroring the web `getStateColor` fallbacks exactly. */
    fun accentFor(
        fsmType: String,
        state: String,
    ): FsmAccent {
        val table = REGISTRY[fsmType] ?: VEHICLE
        return table[state.trim().lowercase(Locale.ROOT)] ?: FsmAccent.Neutral
    }
}

// ── Window + tick projection (web `useMemo` { ticks, start, end }) ──

/** One placed tick — a [transition] and its horizontal position as a 0..1 fraction of the window width. */
data class StateTimelineTick(
    val transition: FsmTransition,
    val leftFraction: Float,
)

/**
 * The fully projected timeline window — the render-ready result of the web `useMemo`: the [ticks] sorted by
 * time with their horizontal placement, plus the window's [startMillis] / [endMillis] anchors used for the
 * axis labels. Empty [ticks] drives the composable's empty-window branch (web `ticks.length === 0`).
 */
data class StateTimelineWindow(
    val ticks: List<StateTimelineTick>,
    val startMillis: Long,
    val endMillis: Long,
)

/**
 * Pure projection from a pre-windowed transition list (+ the anchor and window length) to its render-ready
 * [StateTimelineWindow] — a 1:1 port of the web `useMemo`. Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate.
 */
object StateTimelineProjection {
    /**
     * Places [transitions] on the `[anchorMillis - windowMinutes, anchorMillis]` window. Mirrors the web
     * verbatim: the end is the anchor, the start is `windowMinutes` earlier, the span is guarded at a minimum
     * of 1 ms (web `endTs - startTs || 1`), the list is sorted ascending by timestamp, and each tick's
     * [StateTimelineTick.leftFraction] is `(ts - start) / span` (web `leftPct / 100`). An unparseable timestamp
     * sorts to the front and places at the window start, never throwing.
     */
    fun project(
        transitions: List<FsmTransition>,
        anchorMillis: Long,
        windowMinutes: Int,
    ): StateTimelineWindow {
        val end = anchorMillis
        val start = end - windowMinutes.toLong() * MILLIS_PER_MINUTE
        val span = (end - start).coerceAtLeast(1L)
        val ticks =
            transitions
                .sortedBy { StateTimelineTime.parseMillis(it.ts) ?: Long.MIN_VALUE }
                .map { transition ->
                    val ts = StateTimelineTime.parseMillis(transition.ts)
                    val fraction = if (ts == null) 0f else ((ts - start) * 1.0 / span).toFloat()
                    StateTimelineTick(transition = transition, leftFraction = fraction)
                }
        return StateTimelineWindow(ticks = ticks, startMillis = start, endMillis = end)
    }
}

// ── Window preset label (web `presetLabel`) ──

/**
 * The localized window-preset bucket the empty-state "Widen window to …" button names — the native analogue
 * of the web `presetLabel(min)` switch. The composable maps each case to its i18n key.
 */
sealed interface StateTimelineWindowPreset {
    /** Web `t('debugger.window.minutes', { n })` — a sub-hour preset rendered as "{n} min". */
    data class Minutes(
        val value: Int,
    ) : StateTimelineWindowPreset

    /** Web `t('debugger.window.hours', { n })` — a sub-day preset rendered as "{n} h". */
    data class Hours(
        val value: Int,
    ) : StateTimelineWindowPreset

    /** Web `t('debugger.window.day')` — the day preset rendered as "24 h". */
    data object Day : StateTimelineWindowPreset
}

/**
 * Buckets a preset's [minutes] into its label form, mirroring the web `presetLabel`: under 60 → minutes, under
 * a day → hours (rounded half-up like `Math.round(min / 60)`), else the day label.
 */
fun stateTimelineWindowPreset(minutes: Int): StateTimelineWindowPreset =
    when {
        minutes < MINUTES_PER_HOUR_INT -> StateTimelineWindowPreset.Minutes(minutes)
        minutes < MINUTES_PER_DAY_INT -> StateTimelineWindowPreset.Hours(roundHalfUp(minutes, MINUTES_PER_HOUR_INT))
        else -> StateTimelineWindowPreset.Day
    }

// Rounds `value / divisor` half-up to match JavaScript `Math.round` (ties toward +∞).
private fun roundHalfUp(
    value: Int,
    divisor: Int,
): Int = Math.floorDiv(2 * value + divisor, 2 * divisor)

// ── Relative "last transition" label (web `formatRelative`) ──

/**
 * The relative-age bucket for the empty-state "Last transition {rel}" hint — the native analogue of the web
 * `formatRelative` cutoffs (<60s just now, <60m minutes, <24h hours, <7d days, else an absolute date). The
 * composable maps each bucket to a localized string; [Unknown] suppresses the hint for a blank/unparseable
 * timestamp (web `'—'`).
 */
sealed interface StateTimelineLastSeen {
    data object Unknown : StateTimelineLastSeen

    data object JustNow : StateTimelineLastSeen

    data class Minutes(
        val value: Long,
    ) : StateTimelineLastSeen

    data class Hours(
        val value: Long,
    ) : StateTimelineLastSeen

    data class Days(
        val value: Long,
    ) : StateTimelineLastSeen

    /** Older than a week — the composable renders [millis] as a localized medium date (web `formatDate`). */
    data class AbsoluteDate(
        val millis: Long,
    ) : StateTimelineLastSeen
}

/**
 * Buckets the age of [timestampMillis] relative to [nowMillis] exactly like the web `formatRelative`. A null
 * timestamp yields [StateTimelineLastSeen.Unknown]; a future timestamp folds into [StateTimelineLastSeen.JustNow]
 * (web's negative-delta `seconds < 60` branch).
 */
fun stateTimelineLastSeen(
    timestampMillis: Long?,
    nowMillis: Long,
): StateTimelineLastSeen {
    if (timestampMillis == null) return StateTimelineLastSeen.Unknown
    val seconds = Math.floorDiv(nowMillis - timestampMillis, MILLIS_PER_SECOND)
    val minutes = seconds / SECONDS_PER_MINUTE
    val hours = minutes / MINUTES_PER_HOUR
    val days = hours / HOURS_PER_DAY
    return when {
        seconds < SECONDS_PER_MINUTE -> StateTimelineLastSeen.JustNow
        minutes < MINUTES_PER_HOUR -> StateTimelineLastSeen.Minutes(minutes)
        hours < HOURS_PER_DAY -> StateTimelineLastSeen.Hours(hours)
        days < DAYS_PER_WEEK -> StateTimelineLastSeen.Days(days)
        else -> StateTimelineLastSeen.AbsoluteDate(timestampMillis)
    }
}

// ── Lifecycle classifier (per-state coverage around the web branches) ──

/**
 * The mutually-exclusive top-level surface the composable switches on — the native lifecycle chrome the host's
 * cache-then-network feed (P1/S8) implies around the web component's presentational branches. [Ready] then
 * internally renders the tick track or the empty-window hint; [Loading]/[Error] render the first-load skeleton
 * and the retry surface. Loading takes precedence over error so a refresh-with-skeleton never flashes the error
 * surface.
 */
enum class StateTimelineSurface {
    Loading,
    Error,
    Ready,
}

/** Classifies the lifecycle flags of a `UiState` into the surface to render. */
fun stateTimelineSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): StateTimelineSurface =
    when {
        isLoading -> StateTimelineSurface.Loading
        isError -> StateTimelineSurface.Error
        else -> StateTimelineSurface.Ready
    }

// ── Timestamp parsing + formatting (web `formatTime` / `formatDate`) ──

/**
 * Tolerant ISO-8601 parsing + localized formatting — the native analogue of the web `useDateFormat` boundary.
 * Pure (java.time only) so it is unit-tested deterministically with a fixed zone/locale.
 */
object StateTimelineTime {
    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    /** Parses [raw] to epoch milliseconds, or `null` when blank/unparseable. */
    fun parseMillis(raw: String): Long? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }?.toEpochMilli()

    /**
     * Renders [raw] as the viewer's short wall-clock time (web `formatTime`, `{ hour: '2-digit', minute:
     * '2-digit' }`). A blank/unparseable input yields [STATE_TIMELINE_EM_DASH], like the web invalid-date guard.
     */
    fun formatClock(
        raw: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val millis = parseMillis(raw) ?: return STATE_TIMELINE_EM_DASH
        return formatClock(millis, zone, locale)
    }

    /** Renders an epoch-[millis] instant as the viewer's short wall-clock time. */
    fun formatClock(
        millis: Long,
        zone: ZoneId,
        locale: Locale,
    ): String =
        DateTimeFormatter
            .ofLocalizedTime(FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(millis))

    /**
     * Renders an epoch-[millis] instant as the viewer's localized medium date (web `formatDate`,
     * `{ year: 'numeric', month: 'short', day: 'numeric' }`) — the relative-hint fallback past a week.
     */
    fun formatDate(
        millis: Long,
        zone: ZoneId,
        locale: Locale,
    ): String =
        DateTimeFormatter
            .ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(millis))

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

// ── Diagnostics (P1/S11) ──

/**
 * The one PII-safe diagnostic this surface emits. Carries only the surface [SLUG] — never a vehicle id or a
 * transition timestamp — so a diagnostics line can never leak a vehicle's activity.
 */
object StateTimelineDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StateTimeline"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

// ── i18n key mirrors (P1/S10) ──
// The web `t('debugger.*')` keys, flattened to the generated Android catalog names. Referencing these in one
// place keeps the composable and the off-device test in lockstep with the catalog and documents the web →
// native key contract.

/** Empty-window copy — web `t('debugger.timeline.empty', 'No transitions in window')`. */
const val KEY_TIMELINE_EMPTY: String = "translation_debugger_timeline_empty"

/** Relative hint — web `t('debugger.timeline.lastSeen', 'Last transition {{rel}}')`. */
const val KEY_TIMELINE_LAST_SEEN: String = "translation_debugger_timeline_lastSeen"

/** Widen button — web `t('debugger.timeline.widenTo', 'Widen window to {{label}}')`. */
const val KEY_TIMELINE_WIDEN_TO: String = "translation_debugger_timeline_widenTo"

/** Jump button — web `t('debugger.timeline.jumpToLast', 'Jump to last transition')`. */
const val KEY_TIMELINE_JUMP_TO_LAST: String = "translation_debugger_timeline_jumpToLast"

/** Axis center label — web `t('debugger.timeline.windowLabel', 'Window: {{minutes}} min')`. */
const val KEY_TIMELINE_WINDOW_LABEL: String = "translation_debugger_timeline_windowLabel"

/** Tick accessibility label — web `t('debugger.timeline.tickAria', '{{from}} to {{to}}')`. */
const val KEY_TIMELINE_TICK_ARIA: String = "translation_debugger_timeline_tickAria"

/** Sub-hour preset — web `t('debugger.window.minutes', '{{n}} min')`. */
const val KEY_WINDOW_MINUTES: String = "translation_debugger_window_minutes"

/** Sub-day preset — web `t('debugger.window.hours', '{{n}} h')`. */
const val KEY_WINDOW_HOURS: String = "translation_debugger_window_hours"

/** Day preset — web `t('debugger.window.day', '24 h')`. */
const val KEY_WINDOW_DAY: String = "translation_debugger_window_day"
