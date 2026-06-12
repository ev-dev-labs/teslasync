// Pure, framework-free model + projection for the WhyEndedPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// WhyEndedPanel is the drive-detail "Why did this drive end?" diagnostic. The web component is collapsed by
// default and only fires its `useDriveWhyEnded` query when expanded (the lazy `enabled` gate); once expanded
// it shows a Spinner while loading, an EmptyState (title + message + Retry) on error, or two sections — the
// FSM transition history (a Timeline) and the raw signal window around the drive end (a paginated DataTable)
// — each with its own empty state. The diagnostic response is carried by the shared DrivingRepository as a
// raw SI [JsonElement] (no generated DTO), so [WhyEndedPanelProjection.decode] narrows it to the two arrays
// the web reads (`fsm_transitions`, `signal_window`); any malformed payload decodes to `null` rather than
// throwing. The lifecycle mapping is delegated to the canonical [io.teslasync.android.data.toUiState] so the
// cache-then-network contract (loading / content / error / stale-offline) is interpreted in exactly one place
// (DRY) — this surface adds only the collapsed (lazy) gate and the never-top-level-empty rule on top, so the
// per-section empty states (not a blank panel) cover the no-rows case exactly as the web does.
//
// Timestamps stay ISO-8601 UTC on the wire (the backend contract); rendering them as the viewer's wall-clock
// time is the projection's job through the injected zone/locale (the web `<TimeStamp absolute>` /
// `toLocaleString()` browser boundary). Window tokens (30s/60s/5m/15m) are locale-invariant identifiers and
// carry no `windowOption.*` catalog key (the web `t(key, w)` falls back to the literal token), so each window
// is its own label — exactly the web's rendered output.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/WhyEndedPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.whyendedpanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
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
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no drive id, FSM state, or
 * signal value, so a diagnostics line can never leak why or when a drive ended.
 */
const val WHY_ENDED_PANEL_SLUG: String = "WhyEndedPanel"

/** Em dash shown wherever a value/timestamp is absent — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** The web transition title arrow (`from → to`). */
internal const val STATE_ARROW: String = "\u2192"

/** The web `DataTable pagination={{ defaultPageSize: 25 }}` page size for the signal window. */
const val WHY_ENDED_SIGNAL_PAGE_SIZE: Int = 25

/**
 * The four server-validated diagnostic windows — the native mirror of the web `DriveDiagnosticWindow`
 * (`'30s' | '60s' | '5m' | '15m'`) and the `WINDOWS` array. [wire] is the exact `?window=` query token the
 * backend validates (anything else → 400), and is ALSO the option's display label: the web reads
 * `t('driveDetail.whyEnded.windowOption.{w}', w)`, but that key is absent from the P1/S10 catalog so the web
 * falls back to the literal token `w` — which is locale-invariant, so the native option renders the token too.
 */
enum class WhyEndedWindow(
    val wire: String,
) {
    Sec30("30s"),
    Sec60("60s"),
    Min5("5m"),
    Min15("15m"),
    ;

    public companion object {
        /** The web `useState<DriveDiagnosticWindow>('60s')` default. */
        val DEFAULT: WhyEndedWindow = Sec60

        /** Resolves a wire token back to its window, defaulting to [DEFAULT] for an unknown token. */
        fun fromWire(wire: String): WhyEndedWindow = entries.firstOrNull { it.wire == wire } ?: DEFAULT
    }
}

// ── Wire model (the cached `/drives/{id}/why-ended` payload, narrowed) ──

/**
 * One FSM transition row — the native mirror of the web `DriveDiagnosticTransition`
 * (`internal/database/drive_diagnostic_repo.go`). Only the fields the web component renders are modelled;
 * a decoder must ignore unknown keys (e.g. `details_json`) when reading the cached API JSON. Every field
 * defaults so a partial payload decodes without error.
 */
@Serializable
data class DriveDiagnosticTransition(
    @SerialName("id") val id: Long = 0,
    @SerialName("ts") val ts: String = "",
    @SerialName("fsm_name") val fsmName: String = "",
    @SerialName("from_state") val fromState: String = "",
    @SerialName("to_state") val toState: String = "",
    @SerialName("trigger") val trigger: String = "",
)

/**
 * One raw-signal row in the window — the native mirror of the web `DriveDiagnosticSignal`. [value] is the
 * server-pre-rendered string (`typed_value` via `renderTypedValue`), carried verbatim. Every field defaults
 * so a partial payload decodes without error.
 */
@Serializable
data class DriveDiagnosticSignal(
    @SerialName("ts") val ts: String = "",
    @SerialName("field") val field: String = "",
    @SerialName("value") val value: String = "",
)

/**
 * The narrowed `/drives/{id}/why-ended` response — only the two arrays the web component reads
 * (`why.data?.fsm_transitions` / `why.data?.signal_window`). The endpoint returns more context columns
 * (`drive_id`, `vehicle_id`, `start_ts`, `end_ts`, `ended_status`, `window`); they are ignored by the
 * lenient decoder. Both arrays default to empty so a partial payload decodes without error.
 */
@Serializable
data class DriveDiagnosticResponse(
    @SerialName("fsm_transitions") val fsmTransitions: List<DriveDiagnosticTransition> = emptyList(),
    @SerialName("signal_window") val signalWindow: List<DriveDiagnosticSignal> = emptyList(),
)

// ── Render-ready rows + display ──

/**
 * One fully projected FSM transition — the native analogue of a single web `Timeline` item. [title] is the
 * web `{fsm_name}: {from} → {to}` line; [trigger] is the raw trigger with the web `tx.trigger || '—'`
 * fallback (the composable wraps it with the localized `trigger: {{trigger}}` template); [timeLabel] is the
 * wall-clock `toLocaleString()` render of `ts`. [key] keeps list reconciliation stable.
 */
data class WhyEndedTransitionRow(
    val key: String,
    val title: String,
    val trigger: String,
    val timeLabel: String,
)

/**
 * One fully projected signal row — the native analogue of a web `DataTable` row. [timeLabel] is the absolute
 * wall-clock render of `ts` (web `<TimeStamp format="absolute" />`); [field]/[value] are carried verbatim.
 * [key] mirrors the web `keyExtractor` `${ts}-${field}-${idx}` (ts+field is not unique on busy vehicles).
 */
data class WhyEndedSignalRow(
    val key: String,
    val timeLabel: String,
    val field: String,
    val value: String,
)

/**
 * The mutually-exclusive top-level surface the composable switches on. [Collapsed] is the lazy default (only
 * the header renders, no query); [Loading] the first fetch with nothing cached (Spinner); [Error] a hard
 * failure with no cached fallback (the web `EmptyState` with Retry); [Ready] the expanded body — the FSM
 * timeline + signal table, each with its own per-section empty state, plus a freshness chip over cached rows.
 */
enum class WhyEndedStatus {
    Collapsed,
    Loading,
    Error,
    Ready,
}

/**
 * The fully projected, render-ready panel view — everything the web component computes before returning JSX,
 * plus the ADR-013 freshness flags. Pure data (no Compose types) so the projection is unit-tested without a
 * UI host.
 *
 * @property status the primary surface to render.
 * @property transitions the projected FSM rows (empty for every non-[WhyEndedStatus.Ready] status).
 * @property signals the projected signal rows (empty for every non-[WhyEndedStatus.Ready] status).
 * @property stale whether the shown rows are flagged stale/offline (never presented as live).
 * @property refreshing whether a refresh is running over already-shown rows.
 * @property offline whether cached rows are shown because the network was unreachable.
 * @property canRetry whether a retry affordance should be offered (hard error, or stale/offline cache).
 * @property fetchedAtMillis the freshness stamp of the shown rows (web `dataUpdatedAt`), or `null`.
 * @property errorKind the classification of the most recent failure, or `null` when there is none.
 */
data class WhyEndedDisplay(
    val status: WhyEndedStatus,
    val transitions: List<WhyEndedTransitionRow> = emptyList(),
    val signals: List<WhyEndedSignalRow> = emptyList(),
    val stale: Boolean = false,
    val refreshing: Boolean = false,
    val offline: Boolean = false,
    val canRetry: Boolean = false,
    val fetchedAtMillis: Long? = null,
    val errorKind: ErrorKind? = null,
)

/**
 * The already-localized microcopy the composable folds into the surface — every string the web component
 * reads via `t('driveDetail.whyEnded.…')` / `t('common.retry')`. On Android they arrive through the P1/S10
 * i18n facade (`stringResource`) at the Compose boundary and are passed in, keeping the projection
 * locale-stable and free of any English literal. The `trigger: {{trigger}}` template and the pagination
 * labels carry format args, so they are resolved with `getString(...)` in the composable instead.
 */
data class WhyEndedPanelStrings(
    val title: String,
    val windowAria: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
    val fsmTitle: String,
    val fsmEmptyTitle: String,
    val fsmEmptyMessage: String,
    val signalTitle: String,
    val signalColTs: String,
    val signalColField: String,
    val signalColValue: String,
    val signalEmpty: String,
)

/**
 * Pure projection from the surface inputs (expanded flag + the shared why-ended [Resource]) to the
 * render-ready [WhyEndedDisplay] — a 1:1 port of the derivations the web component performs before returning
 * JSX, with the cache-then-network lifecycle interpreted by the shared [toUiState] so it is honoured
 * identically here and on every other native surface. Stateless and side-effect-free, so it is fully covered
 * by the off-device unit gate.
 */
object WhyEndedPanelProjection {
    private val lenientJson: Json =
        Json {
            ignoreUnknownKeys = true
            isLenient = true
        }

    /**
     * Selects the surface + rows for the [expanded] state and its [resource] (the shared why-ended feed, or
     * `null` when collapsed or when the lazy query is disabled). Collapsed renders only the header; an
     * expanded-but-feedless state (the web disabled-query branch) is [WhyEndedStatus.Ready] with empty rows so
     * the per-section empty states show — never a blank body. Timestamps render in the viewer's [zone]/[locale].
     */
    fun project(
        expanded: Boolean,
        resource: Resource<JsonElement>?,
        zone: ZoneId,
        locale: Locale,
    ): WhyEndedDisplay =
        when {
            // Collapsed renders only the header (web lazy default); expanded-but-feedless is the web
            // disabled-query branch (no id) — Ready with empty rows so the per-section empties show.
            !expanded -> WhyEndedDisplay(WhyEndedStatus.Collapsed)
            resource == null -> WhyEndedDisplay(WhyEndedStatus.Ready)
            else -> projectFeed(resource, zone, locale)
        }

    /**
     * Projects a present cache-then-network [resource] onto the expanded body. `isEmpty = { false }`: the
     * panel never shows a single top-level empty state (the two sections own their own empties), so a
     * resolved response is always Content — exactly the web `else` branch.
     */
    private fun projectFeed(
        resource: Resource<JsonElement>,
        zone: ZoneId,
        locale: Locale,
    ): WhyEndedDisplay {
        val ui = resource.toUiState { false }
        val response = decode(ui.data)
        val status =
            when (ui.phase) {
                UiPhase.Loading -> WhyEndedStatus.Loading
                UiPhase.Error -> WhyEndedStatus.Error
                UiPhase.Content, UiPhase.Empty -> WhyEndedStatus.Ready
            }
        return WhyEndedDisplay(
            status = status,
            transitions = projectTransitions(response, zone, locale),
            signals = projectSignals(response, zone, locale),
            stale = ui.stale,
            refreshing = ui.refreshing,
            offline = ui.isOffline,
            canRetry = ui.canRetry,
            fetchedAtMillis = ui.fetchedAt,
            errorKind = ui.errorKind,
        )
    }

    /**
     * Narrows the raw SI why-ended [JsonElement] to the two arrays the web reads, ignoring the response's
     * context columns and tolerating a malformed payload (returns `null` rather than throwing) — the native
     * analogue of the web `why.data?.…` optional chaining.
     */
    fun decode(json: JsonElement?): DriveDiagnosticResponse? =
        json?.let { element ->
            runCatching {
                lenientJson.decodeFromJsonElement(DriveDiagnosticResponse.serializer(), element)
            }.getOrNull()
        }

    /** Web `transitions.map(...)`: one Timeline row per transition, in server order. */
    fun projectTransitions(
        response: DriveDiagnosticResponse?,
        zone: ZoneId,
        locale: Locale,
    ): List<WhyEndedTransitionRow> =
        response?.fsmTransitions?.mapIndexed { index, transition ->
            transitionRow(index, transition, zone, locale)
        } ?: emptyList()

    /** Web `keyedSignals.map(...)`: one DataTable row per signal, in server order. */
    fun projectSignals(
        response: DriveDiagnosticResponse?,
        zone: ZoneId,
        locale: Locale,
    ): List<WhyEndedSignalRow> =
        response?.signalWindow?.mapIndexed { index, signal ->
            signalRow(index, signal, zone, locale)
        } ?: emptyList()

    /** Projects one transition: the web `{fsm}: {from} → {to}` title, the `trigger || '—'` value, the time. */
    fun transitionRow(
        index: Int,
        transition: DriveDiagnosticTransition,
        zone: ZoneId,
        locale: Locale,
    ): WhyEndedTransitionRow =
        WhyEndedTransitionRow(
            key = "${transition.id}-${transition.ts}-$index",
            title = "${transition.fsmName}: ${transition.fromState} $STATE_ARROW ${transition.toState}",
            trigger = transition.trigger.ifBlank { EM_DASH },
            timeLabel = formatAbsolute(transition.ts, zone, locale),
        )

    /** Projects one signal row, mirroring the web `keyExtractor` and the absolute timestamp render. */
    fun signalRow(
        index: Int,
        signal: DriveDiagnosticSignal,
        zone: ZoneId,
        locale: Locale,
    ): WhyEndedSignalRow =
        WhyEndedSignalRow(
            key = "${signal.ts}-${signal.field}-$index",
            timeLabel = formatAbsolute(signal.ts, zone, locale),
            field = signal.field,
            value = signal.value,
        )

    /**
     * Tolerant ISO-8601 → localized absolute date-time formatter — the native analogue of the web
     * `<TimeStamp format="absolute" />` / `new Date(ts).toLocaleString()`. Pure (java.time only) so it is
     * unit-tested deterministically with a fixed [zone]/[locale]. A blank or unparseable [timestamp] yields
     * [EM_DASH], matching the web invalid-date guard.
     */
    fun formatAbsolute(
        timestamp: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(timestamp) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields the em-dash guard above.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the drive
 * id, FSM state, trigger, or any signal value — so a diagnostics line can never leak why or when a drive
 * ended. Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the composable's first-composition effect.
 */
object WhyEndedPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WHY_ENDED_PANEL_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
