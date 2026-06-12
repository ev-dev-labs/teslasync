// Pure, framework-free model + projection for the SnapshotInspector feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/state-machine/SnapshotInspector.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// SnapshotInspector is the FSM-debugger right-rail inspector. The web component is presentational — its parent
// (StateMachineDebuggerPage) owns the `useFSM` transition feed and the `useSignalSnapshot` query and passes the
// selected transition, its signal snapshot, the previous snapshot (for diff mode), a `loading` hint, and the
// timeline's `lastTransition`/`inWindowCount`/`onJumpToLast` down as props. This file owns the parts the web
// component computes from those props: the `formatValue` value renderer, the sorted signal rows with their
// `changed`/`previous` diff derivation, the pretty-printed copy payload, the `from → to` state badges' color
// (the web `getStateColor` registry, collapsed to one semantic variant per state so the native Badge maps it
// to a design token), the `duration_in_state_ms` label, the `formatRelative` "last transition" age, and the
// surface classification for every render branch. It binds the shared P1/S8 telemetry snapshot wire model
// (`io.teslasync.shared.core.presentation.telemetry.SignalSnapshotResponse`) verbatim — no re-declaration — so
// the cached payload flows straight through; only the local `SnapshotTransition` (the web `FSMTransition`,
// which has no shared typed model) is declared here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SnapshotInspector — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.snapshotinspector

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotEntry
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotResponse
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
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

/** Em dash shown wherever a value/timestamp/duration is absent — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The unit suffix appended to the duration value — the web `{…} ms` literal (a locale-invariant SI symbol). */
internal const val MS_SUFFIX: String = " ms"

/** The `details` key the web reads for the duration cell (`transition.details?.duration_in_state_ms`). */
internal const val DURATION_KEY: String = "duration_in_state_ms"

/** Default vehicle FSM key — the web `getStateColor` fallback when an unknown `fsmType` is passed. */
internal const val FSM_VEHICLE: String = "vehicle"

private const val SECONDS_PER_MINUTE: Long = 60
private const val MINUTES_PER_HOUR: Long = 60
private const val HOURS_PER_DAY: Long = 24
private const val DAYS_PER_WEEK: Long = 7
private const val MILLIS_PER_SECOND: Long = 1_000

/** Compact (non-pretty) JSON, matching the web `JSON.stringify(value)` value preview with no spacing. */
private val COMPACT_JSON: Json = Json.Default

/** Pretty JSON for the clipboard payload — the web `JSON.stringify(payload, null, 2)` two-space indent. */
private val PRETTY_JSON: Json =
    Json {
        prettyPrint = true
        prettyPrintIndent = "  "
        encodeDefaults = true
        explicitNulls = false
    }

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SnapshotInspectorRegistration {
    /** Stable surface id. */
    const val ID: String = "snapshot-inspector"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); carries no transition payload. */
    const val SLUG: String = "SnapshotInspector"
}

/**
 * The web `t('debugger.inspector.*')` keys this surface reads, flattened to the generated Android catalog
 * names. Referencing them in one place documents the web → native key contract and keeps the composable and
 * the off-device test in lockstep with the catalog. Every key below resolves in res/values/strings.xml.
 */
object SnapshotInspectorKeys {
    /** Panel heading — web `t('debugger.inspector.title', 'Transition snapshot')`. */
    const val TITLE: String = "translation_debugger_inspector_title"

    /** Copy-button label — web `t('debugger.inspector.copy', 'Copy snapshot')`. */
    const val COPY: String = "translation_debugger_inspector_copy"

    /** "From" caption — web `t('debugger.inspector.from', 'From')`. */
    const val FROM: String = "translation_debugger_inspector_from"

    /** "To" caption — web `t('debugger.inspector.to', 'To')`. */
    const val TO: String = "translation_debugger_inspector_to"

    /** "Trigger" caption — web `t('debugger.inspector.trigger', 'Trigger')`. */
    const val TRIGGER: String = "translation_debugger_inspector_trigger"

    /** "Duration" caption — web `t('debugger.inspector.duration', 'Duration')`. */
    const val DURATION: String = "translation_debugger_inspector_duration"

    /** Signals section heading — web `t('debugger.inspector.signalsTitle', 'Signals at transition')`. */
    const val SIGNALS_TITLE: String = "translation_debugger_inspector_signalsTitle"

    /** Diff-mode toggle label — web `t('debugger.inspector.diffMode', 'Diff vs previous')`. */
    const val DIFF_MODE: String = "translation_debugger_inspector_diffMode"

    /** Empty signals message — web `t('debugger.inspector.noSignals', 'No signals captured for this transition')`. */
    const val NO_SIGNALS: String = "translation_debugger_inspector_noSignals"

    /** No-selection prompt — web `t('debugger.inspector.empty', 'Select a transition to inspect its snapshot')`. */
    const val EMPTY: String = "translation_debugger_inspector_empty"

    /** Outside-window hint — web `t('debugger.inspector.emptyOutsideWindow', 'Nothing in the current window. …')`. */
    const val EMPTY_OUTSIDE_WINDOW: String = "translation_debugger_inspector_emptyOutsideWindow"

    /** Jump CTA — web `t('debugger.inspector.jumpToLast', 'Jump to last transition')`. */
    const val JUMP_TO_LAST: String = "translation_debugger_inspector_jumpToLast"

    /** Loading hint — web `t('debugger.inspector.loading', 'Loading…')`. */
    const val LOADING: String = "translation_debugger_inspector_loading"
}

// ── Wire model (the FSM transition prop, narrowed) ──

/**
 * One FSM transition — the native mirror of the web `FSMTransition` (`@/types/fsm`), which has no shared typed
 * model (the shared `FsmStore` emits raw `JsonElement`). Only the fields the web component renders or copies
 * are modelled; a decoder must ignore unknown keys. Every field defaults so a partial payload decodes without
 * error. [details] is the open `Record<string, unknown>` the web reads `duration_in_state_ms` from.
 */
@Serializable
data class SnapshotTransition(
    @SerialName("id") val id: Long = 0,
    @SerialName("vehicle_id") val vehicleId: Long = 0,
    @SerialName("ts") val ts: String = "",
    @SerialName("fsm_name") val fsmName: String = "",
    @SerialName("from_state") val fromState: String = "",
    @SerialName("to_state") val toState: String = "",
    @SerialName("trigger") val trigger: String = "",
    @SerialName("details") val details: JsonObject? = null,
)

// ── Semantic state color (the web getStateColor registry) ──

/**
 * The semantic badge tone of an FSM state — the native analogue of the web `BadgeVariant`
 * (`success | warning | danger | info | neutral`) that `getStateColor` resolves. The composable maps each
 * case to a [io.teslasync.android.components.ui.BadgeVariant] / design token, so the per-state Tailwind
 * `overrides` (custom hex) collapse to one role and light / dark / high-contrast all stay correct.
 */
enum class FsmBadgeVariant {
    Success,
    Warning,
    Danger,
    Info,
    Neutral,
}

// ── Render-ready rows + views ──

/**
 * One fully projected signal row — the native analogue of a single web `<li>` in the snapshot list. [value]
 * and [previous] are already run through [formatValue]; [previous] is non-null only when the previous snapshot
 * carried an entry for this name (the web `row.previous !== undefined` gate). [changed] drives the diff
 * highlight/dim. [source]/[ageMs] feed the `SourceLayerBadge`.
 */
data class SnapshotSignalRow(
    val name: String,
    val value: String,
    val source: String?,
    val ageMs: Long?,
    val changed: Boolean,
    val previous: String?,
)

/**
 * The fully projected transition header/grid — everything the web component reads off the `transition` prop
 * (not the snapshot). [fromVariant]/[toVariant] are the resolved state-badge tones; [trigger] carries the web
 * `trigger || '—'` fallback; [durationLabel] is the `{fmtInt(ms) ?? '—'} ms` cell.
 */
data class SnapshotTransitionView(
    val fromState: String,
    val toState: String,
    val fromVariant: FsmBadgeVariant,
    val toVariant: FsmBadgeVariant,
    val trigger: String,
    val durationLabel: String,
)

/**
 * The relative age of the last transition — the native analogue of the web `formatRelative(lastTransition.ts)`
 * used in the outside-window hint. The composable resolves each case to the localized `freshness.*` catalog
 * string (justNow / minutes / hours / days) or, beyond a week, to an absolute date — keeping the phrasing out
 * of the pure model.
 */
sealed interface SnapshotRelativeAge {
    /** Null/unparseable timestamp — the web `'—'` invalid-date guard. */
    data object Unknown : SnapshotRelativeAge

    /** Under a minute — web `'just now'`. */
    data object JustNow : SnapshotRelativeAge

    /** Under an hour — web `${minutes}m ago`. */
    data class Minutes(
        val value: Long,
    ) : SnapshotRelativeAge

    /** Under a day — web `${hours}h ago`. */
    data class Hours(
        val value: Long,
    ) : SnapshotRelativeAge

    /** Under a week — web `${days}d ago`. */
    data class Days(
        val value: Long,
    ) : SnapshotRelativeAge

    /** A week or older — web falls back to the absolute `formatDate(iso)`. */
    data class Absolute(
        val epochMillis: Long,
    ) : SnapshotRelativeAge
}

/**
 * The mutually-exclusive top-level surface the composable switches on — a faithful map of the web component's
 * render branches plus the lifecycle chrome the snapshot feed implies (sibling-surface pattern). The three
 * `NoSelection*` cases are the web `if (!transition)` branches; the three `Selected*` cases all draw the
 * always-on transition header + grid and differ only in the signals body (loading skeleton / hard error+retry
 * / the rows-or-empty ready state, the last possibly with a stale/offline freshness chip).
 */
enum class SnapshotSurface {
    NoSelectionLoading,
    NoSelectionOutsideWindow,
    NoSelectionPrompt,
    SelectedLoading,
    SelectedError,
    SelectedReady,
}

/**
 * The pure projection the composable renders — the native mirror of the web component's render-time
 * derivations. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object SnapshotInspectorProjection {
    // The eight FSM definitions' state → variant maps — a verbatim port of the per-FSM `STATE_ENTRIES`
    // `variant` fields the web `FSM_REGISTRY` assembles (web/src/types/fsm/*.ts). The Tailwind `overrides`
    // are intentionally not ported: they are custom hex the native layer expresses as design tokens via the
    // single semantic variant, so the badge stays theme-correct.
    private val FSM_STATE_VARIANTS: Map<String, Map<String, FsmBadgeVariant>> =
        mapOf(
            FSM_VEHICLE to
                mapOf(
                    "online" to FsmBadgeVariant.Success,
                    "driving" to FsmBadgeVariant.Success,
                    "charging" to FsmBadgeVariant.Warning,
                    "parked" to FsmBadgeVariant.Info,
                    "updating" to FsmBadgeVariant.Info,
                    "asleep" to FsmBadgeVariant.Neutral,
                    "offline" to FsmBadgeVariant.Danger,
                ),
            "drive_session" to
                mapOf(
                    "pending" to FsmBadgeVariant.Warning,
                    "active" to FsmBadgeVariant.Success,
                    "ending" to FsmBadgeVariant.Warning,
                    "completed" to FsmBadgeVariant.Info,
                    "recovered" to FsmBadgeVariant.Neutral,
                ),
            "charge_session" to
                mapOf(
                    "pending" to FsmBadgeVariant.Warning,
                    "active" to FsmBadgeVariant.Success,
                    "completing" to FsmBadgeVariant.Info,
                    "done" to FsmBadgeVariant.Success,
                    "recovered" to FsmBadgeVariant.Neutral,
                ),
            "command" to
                mapOf(
                    "queued" to FsmBadgeVariant.Neutral,
                    "waking" to FsmBadgeVariant.Warning,
                    "wake_confirmed" to FsmBadgeVariant.Info,
                    "wake_timeout" to FsmBadgeVariant.Warning,
                    "sending" to FsmBadgeVariant.Info,
                    "succeeded" to FsmBadgeVariant.Success,
                    "failed" to FsmBadgeVariant.Danger,
                    "timed_out" to FsmBadgeVariant.Warning,
                    "retrying" to FsmBadgeVariant.Neutral,
                    "gave_up" to FsmBadgeVariant.Danger,
                ),
            "notification" to
                mapOf(
                    "created" to FsmBadgeVariant.Neutral,
                    "sending" to FsmBadgeVariant.Info,
                    "delivered" to FsmBadgeVariant.Success,
                    "partial" to FsmBadgeVariant.Warning,
                    "failed" to FsmBadgeVariant.Danger,
                    "retrying" to FsmBadgeVariant.Neutral,
                    "dead" to FsmBadgeVariant.Danger,
                ),
            "alert_cooldown" to
                mapOf(
                    "armed" to FsmBadgeVariant.Success,
                    "fired" to FsmBadgeVariant.Danger,
                    "suppressed" to FsmBadgeVariant.Warning,
                ),
            "automation" to
                mapOf(
                    "idle" to FsmBadgeVariant.Neutral,
                    "evaluating" to FsmBadgeVariant.Info,
                    "executing" to FsmBadgeVariant.Warning,
                    "succeeded" to FsmBadgeVariant.Success,
                    "partial" to FsmBadgeVariant.Warning,
                    "failed" to FsmBadgeVariant.Danger,
                    "retrying" to FsmBadgeVariant.Warning,
                    "gave_up" to FsmBadgeVariant.Danger,
                    "skipped" to FsmBadgeVariant.Neutral,
                    "cooldown" to FsmBadgeVariant.Neutral,
                    "disabled" to FsmBadgeVariant.Danger,
                ),
            "telemetry_connection" to
                mapOf(
                    "unknown" to FsmBadgeVariant.Neutral,
                    "connecting" to FsmBadgeVariant.Warning,
                    "streaming" to FsmBadgeVariant.Success,
                    "stale" to FsmBadgeVariant.Warning,
                    "disconnected" to FsmBadgeVariant.Danger,
                    "polling_only" to FsmBadgeVariant.Info,
                ),
        )

    private val INSTANT_PARSERS: List<(String) -> Long?> =
        listOf(
            { raw -> tryParseMillis { Instant.parse(raw) } },
            { raw -> tryParseMillis { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParseMillis { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    /**
     * Resolves an FSM [state] (within [fsmType]) to its badge variant — a 1:1 port of the web
     * `getStateColor`: an unknown [fsmType] falls back to the vehicle FSM, the lookup is case-insensitive, and
     * a state absent from that FSM is the neutral `DEFAULT_STATE`.
     */
    fun variantFor(
        fsmType: String,
        state: String,
    ): FsmBadgeVariant {
        val states = FSM_STATE_VARIANTS[fsmType] ?: FSM_STATE_VARIANTS.getValue(FSM_VEHICLE)
        return states[state.lowercase(Locale.ROOT)] ?: FsmBadgeVariant.Neutral
    }

    /**
     * Renders a wire [value] to its display string — a 1:1 port of the web `formatValue`: `null` / JSON null is
     * the em dash, a boolean is `true`/`false`, a finite number is its literal (a non-finite number the em
     * dash), a string is verbatim, and an object/array is its compact `JSON.stringify`.
     */
    fun formatValue(value: JsonElement?): String =
        when (value) {
            null, JsonNull -> EM_DASH
            is JsonPrimitive -> formatPrimitive(value)
            else -> COMPACT_JSON.encodeToString(JsonElement.serializer(), value)
        }

    /**
     * Projects the (optional) snapshot + previous snapshot into the sorted signal rows — the web `rows` memo.
     * Each row's `changed` flag is the web's stringified-value comparison (only when a [previousSnapshot] is
     * supplied), `previous` is the prior formatted value when that name existed before, and the list is sorted
     * by signal name. A null/absent snapshot yields no rows so the composable shows the no-signals empty state.
     */
    fun rows(
        snapshot: SignalSnapshotResponse?,
        previousSnapshot: SignalSnapshotResponse?,
    ): List<SnapshotSignalRow> {
        val signals = snapshot?.signals ?: return emptyList()
        val previous = previousSnapshot?.signals ?: emptyMap()
        return signals.entries
            .map { (name, entry) -> signalRow(name, entry, previous[name], previousSnapshot != null) }
            .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })
    }

    /**
     * Builds the clipboard payload — the web `JSON.stringify({ transition, snapshot: snapshot.signals, at }, 2)`.
     * Returns an empty string when either the transition or the snapshot is absent (the web `if (!transition ||
     * !snapshot) return ''` guard that also hides the copy button).
     */
    fun copyPayload(
        transition: SnapshotTransition?,
        snapshot: SignalSnapshotResponse?,
    ): String =
        if (transition == null || snapshot == null) {
            ""
        } else {
            PRETTY_JSON.encodeToString(
                SnapshotCopyPayload.serializer(),
                SnapshotCopyPayload(transition, snapshot.signals, snapshot.at),
            )
        }

    /** Projects the transition header/grid — the web From/To badges, the `trigger || '—'`, and the duration. */
    fun transitionView(
        transition: SnapshotTransition,
        fsmType: String,
        locale: Locale,
    ): SnapshotTransitionView =
        SnapshotTransitionView(
            fromState = transition.fromState,
            toState = transition.toState,
            fromVariant = variantFor(fsmType, transition.fromState),
            toVariant = variantFor(fsmType, transition.toState),
            trigger = transition.trigger.ifBlank { EM_DASH },
            durationLabel = durationLabel(transition, locale),
        )

    /**
     * The numeric `duration_in_state_ms` from the transition details, or `null` — the web
     * `typeof transition.details?.duration_in_state_ms === 'number'` guard (a missing key, a string, or a
     * non-finite number all read as `null`).
     */
    fun durationInStateMs(transition: SnapshotTransition): Double? {
        val primitive = transition.details?.get(DURATION_KEY) as? JsonPrimitive
        return if (primitive == null || primitive.isString) {
            null
        } else {
            primitive.doubleOrNull?.takeIf { it.isFinite() }
        }
    }

    /** The `{fmtInt(ms) ?? '—'} ms` duration cell — grouped integer (web `fmtInt`) or the em dash, then ` ms`. */
    fun durationLabel(
        transition: SnapshotTransition,
        locale: Locale,
    ): String {
        val ms = durationInStateMs(transition)
        val number = if (ms == null) EM_DASH else NumberFormat.getIntegerInstance(locale).format(Math.round(ms))
        return "$number$MS_SUFFIX"
    }

    /**
     * Classifies the surface to render — the web `if (!transition) { … }` branches plus the snapshot-feed
     * lifecycle for a selected transition. Loading takes precedence over error so a refresh never flashes the
     * error surface; the outside-window branch requires both a last transition and a jump action (web
     * `inWindowCount === 0 && lastTransition && onJumpToLast`).
     */
    @Suppress("LongParameterList") // The six independent inputs mirror the web component's branch conditions.
    fun surfaceFor(
        hasTransition: Boolean,
        noSelectionLoading: Boolean,
        inWindowCount: Int,
        canJumpToLast: Boolean,
        snapshotLoading: Boolean,
        snapshotError: Boolean,
    ): SnapshotSurface =
        when {
            !hasTransition && noSelectionLoading -> SnapshotSurface.NoSelectionLoading
            !hasTransition && inWindowCount == 0 && canJumpToLast -> SnapshotSurface.NoSelectionOutsideWindow
            !hasTransition -> SnapshotSurface.NoSelectionPrompt
            snapshotLoading -> SnapshotSurface.SelectedLoading
            snapshotError -> SnapshotSurface.SelectedError
            else -> SnapshotSurface.SelectedReady
        }

    /**
     * The relative age bucket for the last transition's [tsIso] at [nowMillis] — a 1:1 port of the web
     * `formatRelative`: under a minute is just-now, then minute / hour / day buckets, and a week or more falls
     * back to the absolute date. A blank/unparseable timestamp is [SnapshotRelativeAge.Unknown].
     */
    fun relativeAge(
        tsIso: String,
        nowMillis: Long,
    ): SnapshotRelativeAge {
        val tsMillis = parseInstantMillis(tsIso) ?: return SnapshotRelativeAge.Unknown
        val seconds = Math.floorDiv(nowMillis - tsMillis, MILLIS_PER_SECOND)
        val minutes = Math.floorDiv(seconds, SECONDS_PER_MINUTE)
        val hours = Math.floorDiv(minutes, MINUTES_PER_HOUR)
        val days = Math.floorDiv(hours, HOURS_PER_DAY)
        return when {
            seconds < SECONDS_PER_MINUTE -> SnapshotRelativeAge.JustNow
            minutes < MINUTES_PER_HOUR -> SnapshotRelativeAge.Minutes(minutes)
            hours < HOURS_PER_DAY -> SnapshotRelativeAge.Hours(hours)
            days < DAYS_PER_WEEK -> SnapshotRelativeAge.Days(days)
            else -> SnapshotRelativeAge.Absolute(tsMillis)
        }
    }

    /**
     * Tolerant ISO-8601 → localized medium date-time formatter for the [SnapshotRelativeAge.Absolute] fallback
     * — the web `formatDate(iso)` boundary. Pure (java.time only) so it is unit-tested deterministically with a
     * fixed [zone]/[locale].
     */
    fun formatAbsolute(
        epochMillis: Long,
        zone: ZoneId,
        locale: Locale,
    ): String =
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(epochMillis))

    /** Tolerant RFC-3339 → epoch-millis parser; a blank or unparseable input yields `null`. */
    fun parseInstantMillis(raw: String): Long? = if (raw.isBlank()) null else INSTANT_PARSERS.firstNotNullOfOrNull { it(raw) }

    private fun signalRow(
        name: String,
        entry: SignalSnapshotEntry,
        previousEntry: SignalSnapshotEntry?,
        hasPrevious: Boolean,
    ): SnapshotSignalRow =
        SnapshotSignalRow(
            name = name,
            value = formatValue(entry.value),
            source = entry.source,
            ageMs = entry.ageMs,
            changed = hasPrevious && canon(previousEntry?.value) != canon(entry.value),
            previous = previousEntry?.let { formatValue(it.value) },
        )

    private fun formatPrimitive(primitive: JsonPrimitive): String =
        when {
            primitive.isString -> primitive.content
            primitive.booleanOrNull != null -> primitive.booleanOrNull.toString()
            primitive.doubleOrNull?.isFinite() == true -> primitive.content
            else -> EM_DASH
        }

    // Web `JSON.stringify(value ?? null)` — the canonical form used to detect a changed value.
    private fun canon(value: JsonElement?): String = COMPACT_JSON.encodeToString(JsonElement.serializer(), value ?: JsonNull)

    private fun tryParseMillis(block: () -> Instant): Long? =
        try {
            block().toEpochMilli()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * The clipboard payload shape — the web `{ transition, snapshot: snapshot.signals, at }` object that
 * `JSON.stringify` serializes. Kept private to the model; [at] is omitted when absent (web `undefined`).
 */
@Serializable
private data class SnapshotCopyPayload(
    val transition: SnapshotTransition,
    val snapshot: Map<String, SignalSnapshotEntry>,
    val at: String? = null,
)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a state,
 * trigger, signal name, or value — so a diagnostics line can never leak the vehicle's posture. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the composable calls it from its first-composition
 * effect.
 */
object SnapshotInspectorDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = SnapshotInspectorRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
