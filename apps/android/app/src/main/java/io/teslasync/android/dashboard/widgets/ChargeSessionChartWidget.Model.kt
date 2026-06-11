@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.api.generated.ChargingSession
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The charger-type bucket a session is colour-coded into — the native union of the web
 * `classifyChargerType` return values (web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx).
 * [Home] is the green "Home / AC" default, [Supercharger] the red Tesla/Supercharger bucket, and [Dc]
 * the amber third-party DC-fast bucket.
 */
enum class ChargerKind { Home, Supercharger, Dc }

/**
 * Classify a raw `charger_type` string into a [ChargerKind] — a verbatim port of the web
 * `classifyChargerType`: lower-cased, a value containing `supercharger`/`tesla` is a
 * [ChargerKind.Supercharger]; any other non-empty value that is not the sentinel `<invalid>` is a
 * [ChargerKind.Dc]; everything else (empty / `<invalid>` / null) falls back to [ChargerKind.Home].
 */
fun classifyChargerKind(chargerType: String?): ChargerKind {
    val ft = (chargerType ?: "").lowercase()
    return when {
        ft.contains("supercharger") || ft.contains("tesla") -> ChargerKind.Supercharger
        ft.isNotEmpty() && ft != INVALID_CHARGER_TYPE -> ChargerKind.Dc
        else -> ChargerKind.Home
    }
}

private const val INVALID_CHARGER_TYPE = "<invalid>"

/**
 * One projected, render-ready bar — the native analogue of the web `ChartDatum`. Holds the already
 * date-formatted x [label], the converted [energyKwh] (kWh, from SI watt-hours at projection time),
 * and the [kind] that drives the bar colour + which legend bucket it belongs to.
 */
data class ChargeSessionBar(
    val label: String,
    val energyKwh: Double,
    val kind: ChargerKind,
)

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` logic in the web source: compact (stats-only, no chart/title) requires BOTH
 * a single column AND a single row (web `size.cols <= 1 && size.rows <= 1`), and wide is three or more
 * columns (web `size.cols >= 3`).
 */
data class ChargeSessionChartSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column AND row (web `isCompact`): show only the stat row, no chart or title. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS && rows <= COMPACT_MAX_ROWS

    /** True at three or more columns (web `isWide`): wider axis ticks. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val COMPACT_MAX_ROWS = 1
        private const val WIDE_MIN_COLS = 3

        /** The registry default footprint (2×4). */
        val Default: ChargeSessionChartSize = ChargeSessionChartSize(2, 4)

        /** Minimum footprint (1×2) from the web registry. */
        val MinSize: ChargeSessionChartSize = ChargeSessionChartSize(1, 2)

        /** Maximum footprint (4×40) from the web registry. */
        val MaxSize: ChargeSessionChartSize = ChargeSessionChartSize(4, 40)

        /** True when [size] falls within the min/max footprint constraints. */
        fun withinBounds(size: ChargeSessionChartSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: ChargeSessionChartSize): ChargeSessionChartSize =
            ChargeSessionChartSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/** One projected summary statistic for the header row — the native analogue of a web `ChartSummaryStat`. */
data class ChargeSummaryStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The localized strings the surface needs, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the projection stays framework-free and JVM-testable. The stat labels
 * map to the `widget.chargeSessionChart.*` keys; the [typeHome]/[typeSupercharger]/[typeDc] legend
 * labels reuse the shared `chargerTypes.*` keys (identical copy to the web `CHARGER_TYPE_LABEL`).
 */
@Suppress("LongParameterList")
data class ChargeSessionChartStrings(
    val title: String,
    val total: String,
    val avg: String,
    val sessions: String,
    val empty: String,
    val typeHome: String,
    val typeSupercharger: String,
    val typeDc: String,
)

/**
 * The fully projected, render-ready view of the charge sessions for one footprint — the native
 * analogue of everything the web component computes via `useMemo` (the `chartData` map+reverse and
 * the `stats` rollup) before returning JSX. Pure data so the projection is unit-tested without a
 * Compose host.
 */
data class ChargeSessionChartDisplay(
    val bars: List<ChargeSessionBar>,
    val stats: List<ChargeSummaryStat>,
    val isCompact: Boolean,
    val isWide: Boolean,
) {
    /** True when there is at least one session to chart (web `hasData = chartData.length > 0`). */
    val hasData: Boolean get() = bars.isNotEmpty()
}

/**
 * Pure projection from the SI [ChargingSession] rows to the display model — the native port of the
 * `chartData` and `stats` `useMemo`s in the web source. Energy is converted from SI watt-hours to
 * kWh exactly as the web `convertEnergyFromSI(wh, 'kWh')` does (the web widget always shows kWh,
 * regardless of the user's energy-unit preference), and dates are formatted like the web
 * `formatDateShort` (month-short + day-numeric). Every label is supplied already-localized.
 */
object ChargeSessionChartProjection {
    private const val WH_PER_KWH = 1000.0
    private const val ENERGY_DECIMALS = 1
    private const val LABEL_PATTERN = "MMM d"

    /** The fixed kWh display unit shown on the stat row + chart (web hard-codes `'kWh'`). */
    const val KWH_UNIT: String = "kWh"

    /** Convert SI watt-hours to kilowatt-hours (web `convertEnergyFromSI(wh, 'kWh')`). */
    fun energyKwh(wh: Double?): Double = (wh ?: 0.0) / WH_PER_KWH

    /**
     * Project [sessions] for [size] using [strings] for the stat labels, formatting dates in [zone]
     * and numbers with [locale]. The bars are reversed so the oldest session reads left-to-right,
     * matching the web `.reverse()`.
     */
    fun project(
        sessions: List<ChargingSession>,
        size: ChargeSessionChartSize,
        strings: ChargeSessionChartStrings,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): ChargeSessionChartDisplay {
        val formatter = DateTimeFormatter.ofPattern(LABEL_PATTERN, locale).withZone(zone)
        val bars =
            sessions
                .mapIndexed { index, session ->
                    ChargeSessionBar(
                        label = labelFor(session, index, formatter),
                        energyKwh = energyKwh(session.totalEnergyAddedWh),
                        kind = classifyChargerKind(session.chargerType),
                    )
                }.reversed()
        return ChargeSessionChartDisplay(
            bars = bars,
            stats = stats(bars, strings, locale),
            isCompact = size.isCompact,
            isWide = size.isWide,
        )
    }

    private fun labelFor(
        session: ChargingSession,
        index: Int,
        formatter: DateTimeFormatter,
    ): String =
        runCatching { formatter.format(Instant.ofEpochMilli(session.startedAt.toEpochMilliseconds())) }
            .getOrNull() ?: "#${index + 1}"

    private fun stats(
        bars: List<ChargeSessionBar>,
        strings: ChargeSessionChartStrings,
        locale: Locale,
    ): List<ChargeSummaryStat> {
        if (bars.isEmpty()) return emptyList()
        val total = bars.sumOf { it.energyKwh }
        val avg = total / bars.size
        return listOf(
            ChargeSummaryStat(strings.total, ChartFormat.number(total, ENERGY_DECIMALS, locale), KWH_UNIT),
            ChargeSummaryStat(strings.avg, ChartFormat.number(avg, ENERGY_DECIMALS, locale), KWH_UNIT),
            ChargeSummaryStat(strings.sessions, bars.size.toString(), null),
        )
    }
}

/**
 * Canonical registry metadata for the Charge Session Chart surface — the native mirror of the web
 * registry entry (`web/src/features/dashboard/widgets/registry/charging.ts`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint constraints.
 */
object ChargeSessionChartRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "charge-session-chart"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "charging"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ChargeSessionChartWidget"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION: String =
        "Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)"

    /** Number of recent sessions fetched (web `request('/charging?vehicle_id=&limit=10')`). */
    const val SESSION_LIMIT: Int = 10

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: ChargeSessionChartSize get() = ChargeSessionChartSize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: ChargeSessionChartSize get() = ChargeSessionChartSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: ChargeSessionChartSize get() = ChargeSessionChartSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: ChargeSessionChartSize): Boolean = ChargeSessionChartSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ChargeSessionChartSize): ChargeSessionChartSize = ChargeSessionChartSize.clamp(size)
}
