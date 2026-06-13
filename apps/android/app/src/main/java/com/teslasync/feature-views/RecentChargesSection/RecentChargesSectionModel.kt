// Pure, framework-free model + projection for the RecentChargesSection feature view — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/vehicles/components/vehicle-detail/RecentChargesSection.tsx together with the `durationStr`
// helper in its sibling `helpers.ts`). No Compose, no Android framework, no HTTP: every declaration here is
// exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer
// over these pure functions.
//
// The web component is purely presentational: its parent (the vehicle-detail page) owns the
// `ChargingSession[]` and passes it down through the `sessions` prop, and the component renders a GlassPanel
// header (a charging icon + "Recent Charges" title + a "View all" link to /charging) over either a five-column
// DataTable (date / energy / duration / cost / battery) or, when there are no sessions, an EmptyState. Its
// three web hooks are `useChargeColumns` (the column header labels + per-cell renderers, ported here as the
// row projection + formatters), `useTranslation` (the i18n labels, resolved at the Compose boundary, P1/S10),
// and `useFormatting` (the currency symbol + decimal precision, read from the shared settings store, P1/S8).
//
// This file owns exactly the data derivations the web expresses inline in `useChargeColumns`: the per-row
// projection (the localized date, the SI-watt-hours → kWh energy label, the "Xh Ym" duration label, the
// currency-formatted cost with its em-dash fallback, and the "start% → end%" battery label) and the empty
// guard (web `sessions && sessions.length > 0`). `fmtNumber` mirrors the web `Intl.NumberFormat` half-away-
// from-zero rounding rather than Java's default banker's rounding; the date formatting is injected as a seam so
// the row projection is deterministic off-device, with the real localized formatter living in
// [RecentChargesTimeFormatting].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RecentChargesSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.recentchargessection

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.floor

/** Em dash shown for an absent value — the web `'—'` fallback (cost null, unparseable date). */
internal const val EM_DASH: String = "\u2014"

/** Rightwards arrow joining the start→end SoC in the battery cell — the web `→` literal. */
internal const val SOC_ARROW: String = "\u2192"

/** Percent sign suffix on each SoC value — the web `%` literal. */
internal const val PERCENT_SIGN: String = "%"

/** Default currency symbol when the settings document has none — the web `useFormatting` `'$'` fallback. */
internal const val DEFAULT_CURRENCY: String = "$"

/** Energy unit symbol — the web literal `kWh` (a unit symbol, never translated). */
internal const val UNIT_KWH: String = "kWh"

/** Hour unit symbol in the duration label — the web `durationStr` literal `h`. */
internal const val UNIT_HOUR: String = "h"

/** Minute unit symbol in the duration label — the web `durationStr` literal `m`. */
internal const val UNIT_MINUTE: String = "m"

/** Default decimal precision — the web `useSettings` `decimal_precision` fallback (`2`). */
internal const val DEFAULT_DECIMALS: Int = 2

private const val WH_PER_KWH: Double = 1000.0
private const val MINUTES_PER_HOUR: Int = 60
private const val MAX_DECIMALS: Int = 20
private const val KEY_CURRENCY_SYMBOL: String = "currency_symbol"
private const val KEY_DECIMAL_PRECISION: String = "decimal_precision"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object RecentChargesSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "recent-charges-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RecentChargesSection"
}

/**
 * One charging session — the native mirror of the web `ChargingSession` fields this surface reads. All values
 * are SI canonical or already-resolved scalars; nothing is converted in this layer except at projection time.
 * [startTs] is the raw ISO-8601 start stamp (web `start_ts`, optional), [energyAddedWh] the SI watt-hours
 * added (web `total_energy_added_wh`), [durationMinutes] the elapsed minutes (web `duration_min`), [cost] the
 * already-resolved monetary amount or `null` (web `cost`), and [startSocPct] / [endSocPct] the battery range
 * (web `start_soc_pct` / `end_soc_pct`, the latter nullable).
 */
data class ChargeSession(
    val id: Long,
    val startTs: String?,
    val energyAddedWh: Double,
    val durationMinutes: Double,
    val cost: Double?,
    val startSocPct: Double,
    val endSocPct: Double?,
)

/**
 * The recent-charges payload the host's shared state holder (P1/S8) carries inside the `UiState` — the native
 * analogue of the web `sessions` prop. [sessions] is empty when the vehicle has no recorded charges.
 */
data class RecentChargesData(
    val sessions: List<ChargeSession> = emptyList(),
)

/**
 * A fully projected, render-ready table row — the native analogue of one web `DataTable` row produced by
 * `useChargeColumns`. Pure data: the composable renders each label directly into a cell. Every string is
 * already localized/formatted so the render layer carries no formatting logic.
 */
data class ChargeRowProjection(
    val id: Long,
    val dateLabel: String,
    val energyLabel: String,
    val durationLabel: String,
    val costLabel: String,
    val batteryLabel: String,
)

/**
 * The fully projected inputs the composable renders — the native analogue of the data the web component
 * derives from `sessions`. [rows] is the projected session list and [isEmpty] is the web
 * `sessions && sessions.length > 0` guard inverted (drives the EmptyState branch).
 */
data class RecentChargesProjectionResult(
    val rows: List<ChargeRowProjection>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `useChargeColumns`
 * derivations. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object RecentChargesProjection {
    /**
     * Projects the [data] payload into render-ready rows. Each session is mapped to its localized date (via the
     * [formatTimestamp] seam), kWh energy label, "Xh Ym" duration label, currency-formatted cost (or the em
     * dash when absent), and "start% → end%" battery label, using the user's [currencySymbol] / [decimals] /
     * [locale]. A `null` payload or an empty list yields an empty result with [RecentChargesProjectionResult.isEmpty]
     * set, which drives the EmptyState branch (web `sessions && sessions.length > 0`).
     */
    fun project(
        data: RecentChargesData?,
        currencySymbol: String,
        decimals: Int,
        locale: Locale,
        formatTimestamp: (String?) -> String,
    ): RecentChargesProjectionResult {
        val sessions = data?.sessions.orEmpty()
        val rows =
            sessions.map { session ->
                ChargeRowProjection(
                    id = session.id,
                    dateLabel = formatTimestamp(session.startTs),
                    energyLabel = formatEnergy(session.energyAddedWh, decimals, locale),
                    durationLabel = formatDuration(session.durationMinutes, locale),
                    costLabel =
                        session.cost?.let { formatCurrency(it, currencySymbol, decimals, locale) } ?: EM_DASH,
                    batteryLabel = formatBattery(session.startSocPct, session.endSocPct),
                )
            }
        return RecentChargesProjectionResult(rows = rows, isEmpty = rows.isEmpty())
    }

    /**
     * Energy label — the web `` `${fmtNumber(convertEnergyFromSI(wh, 'kWh'))} kWh` ``. Converts SI watt-hours to
     * kWh (`/1000`) and formats with the user's [decimals], appending the `kWh` unit symbol.
     */
    fun formatEnergy(
        energyAddedWh: Double,
        decimals: Int,
        locale: Locale,
    ): String = "${fmtNumber(energyAddedWh / WH_PER_KWH, decimals, locale)} $UNIT_KWH"

    /**
     * Elapsed-minutes label — a faithful port of the web `durationStr`: `h = Math.floor(minutes / 60)` rendered
     * verbatim (no grouping), `m = fmtInt(minutes % 60)`, joined as `"{h}h {m}m"` when there is an hour or
     * `"{m}m"` otherwise. A non-finite input is coerced to `0` (web `safeNumber` via `fmtInt`).
     */
    fun formatDuration(
        minutes: Double,
        locale: Locale,
    ): String {
        val safeMinutes = if (minutes.isFinite()) minutes else 0.0
        val hours = floor(safeMinutes / MINUTES_PER_HOUR).toLong()
        val mins = fmtNumber(safeMinutes % MINUTES_PER_HOUR, 0, locale)
        return if (hours > 0) "$hours$UNIT_HOUR $mins$UNIT_MINUTE" else "$mins$UNIT_MINUTE"
    }

    /**
     * Currency label — the web `useFormatting` `currencySymbol + fmtNumber(amount, decimals)` contract. A blank
     * symbol falls back to `$`; a non-finite amount normalizes to `0`.
     */
    fun formatCurrency(
        amount: Double,
        symbol: String,
        decimals: Int,
        locale: Locale,
    ): String = "${symbol.ifBlank { DEFAULT_CURRENCY }}${fmtNumber(amount, decimals, locale)}"

    /**
     * Battery range label — the web `` end != null ? `${start}% → ${end}%` : `${start}%` ``. The SoC values are
     * rendered like the web's raw interpolation (an integer when whole, otherwise a trimmed decimal), never
     * locale-grouped, so the cell matches the web string exactly.
     */
    fun formatBattery(
        startSocPct: Double,
        endSocPct: Double?,
    ): String {
        val start = "${socString(startSocPct)}$PERCENT_SIGN"
        return if (endSocPct != null) "$start $SOC_ARROW ${socString(endSocPct)}$PERCENT_SIGN" else start
    }

    /**
     * Locale-aware fixed-precision formatting — the native mirror of the web `fmtNumber(value, decimals)`
     * (`Intl.NumberFormat` with equal min/max fraction digits, grouped thousands, half away from zero). A
     * non-finite value is coerced to `0` (web `safeNumber`).
     */
    fun fmtNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safeDecimals = decimals.coerceIn(0, MAX_DECIMALS)
        val pattern = if (safeDecimals > 0) "#,##0." + "0".repeat(safeDecimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(if (value.isFinite()) value else 0.0)
    }

    /**
     * Resolves the user's currency symbol from the raw `/settings` document — the native port of the web
     * `useFormatting` read (defaulting to `$` before settings load or when the field is blank).
     */
    fun currencySymbol(settings: JsonElement?): String {
        val raw = (settings as? JsonObject)?.get(KEY_CURRENCY_SYMBOL) as? JsonPrimitive
        val symbol = raw?.contentOrNull?.trim()
        return if (!symbol.isNullOrEmpty()) symbol else DEFAULT_CURRENCY
    }

    /**
     * Resolves the user's decimal precision from the raw `/settings` document — the native port of the web
     * `useFormatting` `userPrecision` (floor of `decimal_precision`, clamped to `[0, 20]`, defaulting to `2`
     * when absent, non-finite, or negative).
     */
    fun decimalPrecision(settings: JsonElement?): Int {
        val value = ((settings as? JsonObject)?.get(KEY_DECIMAL_PRECISION) as? JsonPrimitive)?.doubleOrNull
        return if (value == null || !value.isFinite() || value < 0.0) {
            DEFAULT_DECIMALS
        } else {
            floor(value).toInt().coerceIn(0, MAX_DECIMALS)
        }
    }

    /** Renders a SoC percentage like the web's raw `${value}` interpolation: an integer when whole, else trimmed. */
    private fun socString(value: Double): String =
        when {
            !value.isFinite() -> EM_DASH
            value % 1.0 == 0.0 -> value.toLong().toString()
            else -> DecimalFormat("0.###", DecimalFormatSymbols(Locale.ROOT)).format(value)
        }
}

/**
 * Localized date+time formatting for the table's date cell — the native analogue of the web
 * `formatDateTime(start_ts)`. Kept framework-free (java.time) so it is unit-testable off-device with a fixed
 * zone + locale, and supplied to [RecentChargesProjection.project] as the `formatTimestamp` seam at the render
 * boundary.
 */
object RecentChargesTimeFormatting {
    /** Formats an ISO-8601 instant as a localized medium-date + short-time in [zoneId], or the em dash when absent. */
    fun format(
        iso: String?,
        zoneId: ZoneId,
        locale: Locale,
    ): String {
        val instant = iso?.takeIf { it.isNotBlank() }?.let { runCatching { Instant.parse(it) }.getOrNull() }
        return instant?.let {
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(locale)
                .withZone(zoneId)
                .format(it)
        } ?: EM_DASH
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [RecentChargesSectionRegistration.SLUG] — never a vehicle id, energy, cost, or session id — so a diagnostics
 * line can never leak the fleet's charging habits.
 */
object RecentChargesSectionDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to RecentChargesSectionRegistration.SLUG))
    }
}
