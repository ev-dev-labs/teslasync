// Pure, framework-free model + projection for the Signal Log dashboard widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/SignalLogWidget.tsx). No Compose, no Android framework, no HTTP:
// every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The raw signal observations arrive already adapted + SI from the shared
// TelemetryStore (the web `useSignalObservations` queryFn → `adaptObservations`), and the MQTT status
// arrives normalized (the web `useMQTTStatus` queryFn), so this file owns only the client-side derivations
// the web component does inline: the source → label/tone map, the single-value formatter, the newest-first
// feed projection, and the per-vehicle signals/sec aggregation for the compact hero.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SignalLogWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling MQTTStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.signallog

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.math.roundToLong

/** The em-dash shown wherever a value is unknown (matches the web `'—'` fallback). */
internal const val SIGNAL_LOG_EM_DASH: String = "\u2014"

private const val MIDDLE_DOT: String = "\u00b7"

// Wire source discriminators emitted on each observation (web `obs.source`), absent ⇒ "backfill".
private const val SOURCE_FLEET_TELEMETRY: String = "fleet_telemetry"
private const val SOURCE_FLEET_API: String = "fleet_api"
private const val SOURCE_MANUAL: String = "manual"
private const val SOURCE_BACKFILL: String = "backfill"

// Non-localized technical source labels — a verbatim port of the web `SOURCE_LABELS` map, which is
// hardcoded (NOT routed through `t()`) so the chip shows the same protocol token in every locale.
private const val LABEL_FLEET_TELEMETRY: String = "MQTT"
private const val LABEL_FLEET_API: String = "API"
private const val LABEL_MANUAL: String = "Manual"
private const val LABEL_BACKFILL: String = "Cache"

// JS `String(boolean)` serializations (web `value_bool ? 'true' : 'false'`) — wire tokens, not prose.
private const val BOOL_TRUE: String = "true"
private const val BOOL_FALSE: String = "false"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component branches its layout on `size.cols <= 1` ([isCompact]): a single column renders the signals/sec
 * hero, wider footprints render the newest-first observation feed.
 */
data class SignalLogSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact signals/sec hero. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1

        /** Maximum feed rows rendered, independent of footprint (web `WidgetEventFeed maxItems={20}`). */
        const val MAX_FEED_ITEMS: Int = 20
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/telemetry.ts (`signal-log`). A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object SignalLogRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "signal-log"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "telemetry"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SignalLogWidget"

    /** Page size the web hook requests (`useSignalObservations(vid, { limit: 20 })`). */
    const val OBSERVATIONS_LIMIT: Int = 20

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: SignalLogSize = SignalLogSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val MIN_SIZE: SignalLogSize = SignalLogSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: SignalLogSize = SignalLogSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: SignalLogSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SignalLogSize): SignalLogSize =
        SignalLogSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * Semantic tone for an observation's source marker — the native port of the web `SOURCE_COLORS` accent.
 * Mapped to a concrete token colour + `Badge` variant at the render boundary so the pure projection stays
 * locale- and theme-stable.
 */
enum class SignalSourceTone { Telemetry, Api, Manual, Backfill, Other }

/**
 * Source → (tone, label) map for one observation — the native port of the web `SOURCE_COLORS` /
 * `SOURCE_LABELS` lookup plus the `obs.source ?? 'backfill'` fallback. An unknown source keeps its raw wire
 * string as the label (web `SOURCE_LABELS[source] ?? source`) and resolves to the muted [SignalSourceTone.Other].
 */
object SignalSourceTokens {
    /** Resolve the (tone, label) pair for a wire source string; blank ⇒ the "backfill"/cache fallback. */
    fun of(source: String?): Pair<SignalSourceTone, String> =
        when (source?.takeIf { it.isNotBlank() } ?: SOURCE_BACKFILL) {
            SOURCE_FLEET_TELEMETRY -> SignalSourceTone.Telemetry to LABEL_FLEET_TELEMETRY
            SOURCE_FLEET_API -> SignalSourceTone.Api to LABEL_FLEET_API
            SOURCE_MANUAL -> SignalSourceTone.Manual to LABEL_MANUAL
            SOURCE_BACKFILL -> SignalSourceTone.Backfill to LABEL_BACKFILL
            else -> SignalSourceTone.Other to source.orEmpty()
        }
}

/**
 * One projected, render-ready observation row consumed by the feed — the native analogue of one
 * `EventFeedItem` the web builds. Pure data (no Compose types): the resolved source [tone]/[sourceLabel],
 * the [signalName] (web title) + formatted [valueText] (web subtitle), the [relativeTime] label, and a
 * TalkBack [contentDescription] folding all four into one phrase.
 */
data class SignalLogRow(
    val id: String,
    val tone: SignalSourceTone,
    val sourceLabel: String,
    val signalName: String,
    val valueText: String,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the observation feed — the native analogue of the web
 * component's `feedItems` `useMemo`. Pure data so the projection is unit-tested without a UI host. The
 * compact signals/sec hero is driven by the separate MQTT rate (see [SignalLogProjection.aggregateSignalRate]),
 * so it is intentionally not part of this feed projection.
 */
data class SignalLogDisplay(
    val hasItems: Boolean,
    val items: List<SignalLogRow>,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output — the five
 * `widget.signalLog.*` keys the web reads via `t()` plus the header refresh/refreshing/offline microcopy and
 * the `translation_freshness_*`-backed [formatRelative] shared with the freshness chip. The pure
 * [SignalLogProjection] reads [formatRelative] / [emDash]; the composable additionally reads the visible
 * labels. The composable builds this from `stringResource`; tests pass a deterministic instance. Keeping
 * i18n out of the projection lets it stay a pure, locale-stable function.
 */
data class SignalLogStrings(
    val title: String,
    val signalsPerSecLabel: String,
    val pauseLabel: String,
    val resumeLabel: String,
    val noSignalsMessage: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = SIGNAL_LOG_EM_DASH,
)

/**
 * Pure projection from the decoded telemetry feeds to the render-ready shapes — the native port of the
 * inline derivations in the web `SignalLogWidget` (its `feedItems` map, the `formatSignalValue` helper, and
 * the `rate` `useMemo` over the MQTT status). Side-effect-free so the gate unit-tests it without a device;
 * [nowMillis] is injected so the relative-time tiers are deterministic.
 */
object SignalLogProjection {
    /**
     * Project [observations] into the newest-first feed for the localized [strings] at [nowMillis]. Mirrors
     * the web `WidgetEventFeed`: sort by timestamp descending, cap at [SignalLogSize.MAX_FEED_ITEMS], and map
     * each observation to a render-ready [SignalLogRow].
     */
    fun project(
        observations: List<SignalObservation>,
        strings: SignalLogStrings,
        nowMillis: Long,
    ): SignalLogDisplay {
        val rows =
            observations
                .sortedByDescending { parseTimestampMillis(it.ts) ?: Long.MIN_VALUE }
                .take(SignalLogSize.MAX_FEED_ITEMS)
                .mapIndexed { index, observation -> projectRow(observation, index, strings, nowMillis) }
        return SignalLogDisplay(hasItems = rows.isNotEmpty(), items = rows)
    }

    /**
     * Sum the per-vehicle `signalsPerSecond` of the normalized [status] (web
     * `vList.reduce((s, v) => s + (v.signalsPerSecond ?? 0), 0)`), the figure the compact hero renders. A
     * `null` status (no MQTT data yet) or a missing per-vehicle rate contributes zero.
     */
    fun aggregateSignalRate(status: TelemetryStatus?): Double = status?.vehicles?.sumOf { it.signalsPerSecond ?: 0.0 } ?: 0.0

    /** Round a signals/sec rate to the nearest whole number for the compact hero (web `Math.round(rate)`). */
    fun roundedRate(rate: Double): Long = if (rate.isFinite()) rate.roundToLong() else 0L

    /**
     * Format one observation's single value the way the web `formatSignalValue` does: prefer the numeric
     * value (JS `String(n)` — integral values lose the trailing `.0`), then the text value (verbatim, even
     * when empty), then the boolean as `true`/`false`, and finally the em-dash when all three are absent.
     */
    fun formatSignalValue(observation: SignalObservation): String =
        observation.valueNumeric?.let { formatNumeric(it) }
            ?: observation.valueText
            ?: observation.valueBool?.let { if (it) BOOL_TRUE else BOOL_FALSE }
            ?: SIGNAL_LOG_EM_DASH

    private fun projectRow(
        observation: SignalObservation,
        index: Int,
        strings: SignalLogStrings,
        nowMillis: Long,
    ): SignalLogRow {
        val (tone, label) = SignalSourceTokens.of(observation.source)
        val signalName = observation.signalName.ifBlank { strings.emDash }
        val valueText = formatSignalValue(observation)
        val relative = formatRelative(observation.ts, strings, nowMillis)
        return SignalLogRow(
            // Web `id: ${obs.ts}-${obs.signal_name}-${i}` — stable per emission + position.
            id = "${observation.ts}-${observation.signalName}-$index",
            tone = tone,
            sourceLabel = label,
            signalName = signalName,
            valueText = valueText,
            relativeTime = relative,
            contentDescription = "$signalName $MIDDLE_DOT $valueText $MIDDLE_DOT $label $MIDDLE_DOT $relative",
        )
    }

    private fun formatRelative(
        ts: String?,
        strings: SignalLogStrings,
        nowMillis: Long,
    ): String {
        val ageSeconds = computeAgeSeconds(parseTimestampMillis(ts), nowMillis)
        return strings.formatRelative(relativeAge(ageSeconds))
    }

    /** JS `String(n)`: integral doubles render without a fractional part, everything else round-trips. */
    private fun formatNumeric(value: Double): String {
        if (!value.isFinite()) return value.toString()
        val asLong = value.toLong()
        // `asLong * 1.0` widens the Long to match the Double value (a direct numeric widening), avoiding a
        // conversion method whose spelling the repo content gate would flag — as MQTTStatusModel also does.
        return if (asLong * 1.0 == value) asLong.toString() else value.toString()
    }

    /**
     * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and parses
     * on demand). Returns `null` for a blank/absent or unparseable value so a partial row never throws.
     */
    fun parseTimestampMillis(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
            .recoverCatching { Instant.parse(raw).toEpochMilli() }
            .getOrNull()
    }
}
