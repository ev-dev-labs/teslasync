// Pure, framework-free model + projection for the Vampire Drain dashboard widget — the native analogue
// of everything the web component derives (the `avgDrainPctPerDay` derivation, the `eventItems`/
// `sparklineData` `useMemo`s, and the `drainColor`/`formatDuration` helpers) before it returns JSX
// (web/src/features/dashboard/widgets/VampireDrainWidget.tsx). No Compose, no Android framework, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable
// a thin render layer.
//
// The phantom-drain figures the widget renders are plain percentages + hours (battery % lost, idle hours,
// % per hour / per day) — not SI-meter/watt-hour quantities — so there is NO unit conversion at this layer;
// the only formatting is en-US-style locale number grouping (web `fmtNumber`) and the localized relative
// time the feed folds in. Field names mirror the web `VampireDrainStats` / `VampireDrainEvent` shapes
// (web/src/types/energy.ts) restricted to the subset the widget actually renders, exactly as the sibling
// Regen / SentryEventLog models keep only their rendered fields.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/VampireDrainWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling Regen / SentryEventLog widgets do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vampiredrain

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

/** Em dash shown for an absent / unparseable relative time — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

// Separator between the title fragments — the web `% · …` middle dot (space-U+00B7-space).
private const val DOT_SEPARATOR = " \u00b7 "

// ── Wire (`/vampire-drain/stats` + `/vampire-drain`) field names — snake_case, matching the web types ──
private const val FIELD_AVG_DRAIN_RATE = "avg_drain_rate"
private const val FIELD_TOTAL_HOURS = "total_hours"
private const val FIELD_EVENT_COUNT = "event_count"
private const val FIELD_ID = "id"
private const val FIELD_START_DATE = "start_date"
private const val FIELD_DURATION_HOURS = "duration_hours"
private const val FIELD_BATTERY_LOST = "battery_lost"
private const val FIELD_DRAIN_RATE_PER_HOUR = "drain_rate_pct_per_hour"
private const val FIELD_SENTRY_MODE = "sentry_mode"

/**
 * One decoded `GET /vampire-drain/stats` body — the native mirror of the web `VampireDrainStats` type
 * restricted to the three fields this widget reads (`avg_drain_rate`, `total_hours`, `event_count`).
 * All reads mirror the web `stats?.x ?? 0` fallbacks so a partial body never throws; the snapshot's
 * non-null-ness (a present JSON object) is what the web `hasData` gate keys on, exactly as the sibling
 * Regen card does.
 */
data class VampireDrainStats(
    val avgDrainRate: Double,
    val totalHours: Double,
    val eventCount: Long,
) {
    companion object {
        /**
         * Decode a stats body into a tolerant snapshot, or `null` when the body is absent / not an object
         * (web parity: a missing object is falsy, so only the events can satisfy `hasData`). A present
         * object — including the all-zero body — decodes to a value so the avg-drain stat + event-count
         * sublabel render, mirroring the web `stats ?` truthiness check.
         */
        fun fromJson(element: JsonElement?): VampireDrainStats? {
            val obj = element as? JsonObject ?: return null
            return VampireDrainStats(
                avgDrainRate = obj.numberOrNull(FIELD_AVG_DRAIN_RATE) ?: 0.0,
                totalHours = obj.numberOrNull(FIELD_TOTAL_HOURS) ?: 0.0,
                eventCount = obj.longField(FIELD_EVENT_COUNT) ?: 0L,
            )
        }
    }
}

/**
 * One decoded `GET /vampire-drain` row — the native mirror of the web `VampireDrainEvent` type restricted
 * to the fields the widget renders. The `outside_temp_avg` field exists on the wire but the widget never
 * reads it, so (like the sibling models) it is not carried here. Every numeric read mirrors the web
 * `ev.x ?? 0` fallback; [sentryMode] mirrors the web truthiness (`ev.sentry_mode`).
 */
data class VampireDrainEvent(
    val id: Long,
    val startDate: String,
    val durationHours: Double,
    val batteryLost: Double,
    val drainRatePctPerHour: Double,
    val sentryMode: Boolean,
) {
    companion object {
        /** Decode one `/vampire-drain` [JsonObject] into an event, tolerating missing / null fields. */
        fun fromJson(obj: JsonObject): VampireDrainEvent =
            VampireDrainEvent(
                id = obj.longField(FIELD_ID) ?: 0L,
                startDate = obj.stringField(FIELD_START_DATE) ?: "",
                durationHours = obj.numberOrNull(FIELD_DURATION_HOURS) ?: 0.0,
                batteryLost = obj.numberOrNull(FIELD_BATTERY_LOST) ?: 0.0,
                drainRatePctPerHour = obj.numberOrNull(FIELD_DRAIN_RATE_PER_HOUR) ?: 0.0,
                sentryMode = obj.booleanField(FIELD_SENTRY_MODE) ?: false,
            )

        /** Decode a `/vampire-drain` array (the web `safeArray` guard) into rows, tolerating non-arrays. */
        fun parseList(element: JsonElement?): List<VampireDrainEvent> =
            (element as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::fromJson) } ?: emptyList()
    }
}

/**
 * The parsed payload backing the widget: the optional `/vampire-drain/stats` [stats] card plus the decoded
 * `/vampire-drain` [events]. The web composes these from two independent queries; keeping them un-projected
 * here lets the deriving + sorting + capping live in the pure [VampireDrainProjection]. [hasData] mirrors
 * the web `stats != null || events.length > 0` content gate.
 */
data class VampireDrainSnapshot(
    val stats: VampireDrainStats?,
    val events: List<VampireDrainEvent>,
) {
    /** True when either the stats card or at least one drain event resolved (web `hasData`). */
    val hasData: Boolean get() = stats != null || events.isNotEmpty()

    companion object {
        /** The empty payload (no vehicle / no stats / no events) — drives the "No vampire drain data" state. */
        val EMPTY: VampireDrainSnapshot = VampireDrainSnapshot(stats = null, events = emptyList())

        /** Decode the two raw bodies (stats object + events array) into a snapshot, tolerating nulls. */
        fun fromJson(
            statsElement: JsonElement?,
            eventsElement: JsonElement?,
        ): VampireDrainSnapshot =
            VampireDrainSnapshot(
                stats = VampireDrainStats.fromJson(statsElement),
                events = VampireDrainEvent.parseList(eventsElement),
            )
    }
}

/**
 * The widget's grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size` plus the
 * `isCompact = size.cols <= 1` and `isWide = size.cols >= 3` branches the web source switches on (the
 * compact single-stat layout, and whether the wide sparkline is shown).
 */
data class VampireDrainSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at one column or narrower (web `isCompact = size.cols <= 1`): the single big-stat layout. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): the daily-drain sparkline is shown. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val WIDE_MIN_COLS = 3
        private const val DEFAULT_COLS = 2
        private const val DEFAULT_ROWS = 4
        private const val MIN_COLS = 1
        private const val MIN_ROWS = 2
        private const val MAX_COLS = 4
        private const val MAX_ROWS = 40

        /** Registry default footprint (2×4). */
        val Default: VampireDrainSize = VampireDrainSize(cols = DEFAULT_COLS, rows = DEFAULT_ROWS)

        /** Registry minimum footprint (1×2). */
        val MinSize: VampireDrainSize = VampireDrainSize(cols = MIN_COLS, rows = MIN_ROWS)

        /** Registry maximum footprint (4×40). */
        val MaxSize: VampireDrainSize = VampireDrainSize(cols = MAX_COLS, rows = MAX_ROWS)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: VampireDrainSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: VampireDrainSize): VampireDrainSize =
            VampireDrainSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/energy.ts (`vampire-drain`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object VampireDrainRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "vampire-drain"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "energy"

    /** Display name (matches the web registry). */
    const val NAME: String = "Vampire Drain"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION: String = "Phantom drain rate: avg %/day, recent drain events"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VampireDrainWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: VampireDrainSize get() = VampireDrainSize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: VampireDrainSize get() = VampireDrainSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: VampireDrainSize get() = VampireDrainSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: VampireDrainSize): Boolean = VampireDrainSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: VampireDrainSize): VampireDrainSize = VampireDrainSize.clamp(size)
}

/**
 * The drain-severity band a `%/day` figure falls into — the native analogue of the web `drainColor`
 * buckets (`< 1` ⇒ green, `< 3` ⇒ amber, else red). Mapped to a concrete semantic color at the render
 * boundary (Low → success, Medium → warning, High → danger) so no hex literal leaks into the view.
 */
enum class DrainBand { Low, Medium, High }

/**
 * The localized strings the projection folds into its output, resolved from the P1/S10 i18n catalog at the
 * Compose boundary (`stringResource`) and passed in so [VampireDrainProjection.project] stays pure and
 * JVM-testable. Keys mirror the web `t('widget.vampireDrain.*')` calls verbatim; [formatRelative] reuses
 * the shared `relativeAge` buckets (the same the freshness chip uses). The title / "Avg Drain" / trend /
 * empty-state strings are render-only chrome and are resolved directly in the composable.
 */
data class VampireDrainLabels(
    val perDay: String,
    val sentry: String,
    val hour: String,
    val minute: String,
    val eventCountTemplate: String,
    val formatRelative: (FreshnessAge) -> String,
)

/**
 * One projected, render-ready feed row — the native analogue of a web `EventFeedItem`. Pure data (no
 * Compose types): the severity [band] (web `drainColor`), the web-parity [title] ("5.0% · 2.5h · Sentry"),
 * the [subtitle] ("61.2%/day"), the [relativeTime] label, and a TalkBack [contentDescription] folding the
 * visible fields into one phrase.
 */
data class VampireDrainEventRow(
    val id: Long,
    val band: DrainBand,
    val title: String,
    val subtitle: String,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of one payload for one footprint — the native analogue of
 * everything the web component computes before returning JSX (`avgDrainPctPerDay`, the `eventItems` /
 * `sparklineData` `useMemo`s, and the per-footprint layout switch). Pure data so the projection is
 * unit-tested without a Compose host.
 */
data class VampireDrainDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val avgBand: DrainBand,
    val avgPercentText: String,
    val avgValueText: String,
    val sublabel: String?,
    val sparkline: List<Double>,
    val showSparkline: Boolean,
    val events: List<VampireDrainEventRow>,
    val hasEvents: Boolean,
)

/**
 * Pure projection from a parsed [VampireDrainSnapshot] to the render-ready [VampireDrainDisplay] — the
 * native port of the web component's derivations: `avgDrainPctPerDay = (stats?.avg_drain_rate ?? 0) * 24`,
 * the `drainColor` band heuristic, `formatDuration`, the `eventItems` map (title + subtitle + severity),
 * the `sparklineData` reversal, and the shared `WidgetEventFeed` newest-first sort + 5-row cap. Percentages
 * + hours are formatted with locale grouping (web `fmtNumber`); [nowMillis] is injected so the relative
 * time tiers are unit-tested deterministically.
 */
object VampireDrainProjection {
    /** Hours used to scale a per-hour drain rate to a per-day rate (web `* 24`). */
    const val HOURS_PER_DAY: Double = 24.0

    /** A `%/day` figure below this is the low (green) band (web `drainColor`: `pctPerDay < 1`). */
    const val AMBER_MIN: Double = 1.0

    /** A `%/day` figure below this (and ≥ [AMBER_MIN]) is the medium (amber) band (web `< 3`). */
    const val RED_MIN: Double = 3.0

    /** Newest-first feed cap (web `WidgetEventFeed maxItems={5}`). */
    const val FEED_MAX_ITEMS: Int = 5

    private const val MINUTES_PER_HOUR = 60.0
    private const val DRAIN_DECIMALS = 1
    private const val BATTERY_DECIMALS = 1
    private const val HOURS_DECIMALS = 0
    private const val MINUTES_DECIMALS = 0
    private const val PERCENT = "%"
    private const val A11Y_SEPARATOR = ", "

    /** The average phantom-drain rate in `%/day` (web `avgDrainPctPerDay`); a null card collapses to 0. */
    fun avgDrainPctPerDay(stats: VampireDrainStats?): Double = (stats?.avgDrainRate ?: 0.0) * HOURS_PER_DAY

    /** The severity band for [pctPerDay] (web `drainColor` thresholds: 1 / 3, lower bounds exclusive). */
    fun drainBand(pctPerDay: Double): DrainBand =
        when {
            pctPerDay < AMBER_MIN -> DrainBand.Low
            pctPerDay < RED_MIN -> DrainBand.Medium
            else -> DrainBand.High
        }

    /**
     * The compact idle-window duration label (web `formatDuration`): under an hour renders as whole
     * minutes (`${fmtNumber(hours * 60, 0)}m`), otherwise one-decimal hours (`${fmtNumber(hours, 1)}h`).
     */
    fun formatDuration(
        hours: Double,
        labels: VampireDrainLabels,
        locale: Locale,
    ): String =
        if (hours < 1.0) {
            ChartFormat.number(hours * MINUTES_PER_HOUR, MINUTES_DECIMALS, locale) + labels.minute
        } else {
            ChartFormat.number(hours, DRAIN_DECIMALS, locale) + labels.hour
        }

    /**
     * Project [snapshot] for [size] using the localized [labels] and [locale] (grouping/separators; tests
     * pin [Locale.US]). [nowMillis] drives the feed's relative-time tier. The average stat, the event-count
     * sublabel (only when a stats card resolved — web `stats ? … : undefined`), the daily-drain sparkline
     * (web: events reversed × 24, shown only on a wide footprint with > 1 point), and the newest-first,
     * 5-row event feed are all reproduced from the web source.
     */
    fun project(
        snapshot: VampireDrainSnapshot,
        size: VampireDrainSize,
        labels: VampireDrainLabels,
        nowMillis: Long,
        locale: Locale = Locale.US,
    ): VampireDrainDisplay {
        val avg = avgDrainPctPerDay(snapshot.stats)
        val avgPercentText = ChartFormat.number(avg, DRAIN_DECIMALS, locale) + PERCENT
        val sparkline = snapshot.events.reversed().map { it.drainRatePctPerHour * HOURS_PER_DAY }
        val rows =
            snapshot.events
                .sortedByDescending { parseEpochMillis(it.startDate) ?: Long.MIN_VALUE }
                .take(FEED_MAX_ITEMS)
                .map { projectRow(it, labels, nowMillis, locale) }
        return VampireDrainDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            avgBand = drainBand(avg),
            avgPercentText = avgPercentText,
            avgValueText = avgPercentText + labels.perDay,
            sublabel = snapshot.stats?.let { eventCountSublabel(it, labels, locale) },
            sparkline = sparkline,
            showSparkline = size.isWide && sparkline.size > 1,
            events = rows,
            hasEvents = rows.isNotEmpty(),
        )
    }

    // web: t('eventCount', '{{count}} events · {{hours}}h total', { count, hours }) — count is the raw
    // integer; hours is fmtNumber(total_hours, 0). The catalog string carries the positional format args.
    private fun eventCountSublabel(
        stats: VampireDrainStats,
        labels: VampireDrainLabels,
        locale: Locale,
    ): String =
        labels.eventCountTemplate.format(
            stats.eventCount.toString(),
            ChartFormat.number(stats.totalHours, HOURS_DECIMALS, locale),
        )

    private fun projectRow(
        event: VampireDrainEvent,
        labels: VampireDrainLabels,
        nowMillis: Long,
        locale: Locale,
    ): VampireDrainEventRow {
        val drainDay = event.drainRatePctPerHour * HOURS_PER_DAY
        val title =
            buildString {
                append(ChartFormat.number(event.batteryLost, BATTERY_DECIMALS, locale))
                append(PERCENT)
                append(DOT_SEPARATOR)
                append(formatDuration(event.durationHours, labels, locale))
                if (event.sentryMode) {
                    append(DOT_SEPARATOR)
                    append(labels.sentry)
                }
            }
        // web subtitle: `${fmtNumber(drainDay, 1)}%/${perDay.replace('/', '')}` ⇒ e.g. "61.2%/day".
        val subtitle = ChartFormat.number(drainDay, DRAIN_DECIMALS, locale) + PERCENT + "/" + labels.perDay.replace("/", "")
        val relative = labels.formatRelative(relativeAge(computeAgeSeconds(parseEpochMillis(event.startDate), nowMillis)))
        return VampireDrainEventRow(
            id = event.id,
            band = drainBand(drainDay),
            title = title,
            subtitle = subtitle,
            relativeTime = relative,
            contentDescription = listOf(title, subtitle, relative).joinToString(A11Y_SEPARATOR),
        )
    }
}

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and parses on
 * demand). Returns `null` for a blank / absent or unparseable value so a partial row never throws.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}

/** Read a numeric (or numeric-string) property, or `null` when absent / non-numeric / JSON null. */
private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON integer field, or `null` when absent / JSON null / not a JSON number. */
private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

/** Read a JSON string field, or `null` when absent / JSON null / not a quoted string. */
private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.let { if (it.isString) it.content else null }

/** Read a JSON boolean field, or `null` when absent / JSON null / not a JSON boolean. */
private fun JsonObject.booleanField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
