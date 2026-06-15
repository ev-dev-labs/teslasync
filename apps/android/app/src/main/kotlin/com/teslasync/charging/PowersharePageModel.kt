// Pure, framework-free model + projection for the PowersharePage charging surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/charging/pages/PowersharePage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the shared-core
// SignalObservation DTO, the shared Resource envelope, and the framework-free BadgeVariant enum), so the
// composable stays a thin render layer and the whole derivation can be asserted off-device.
//
// The web page binds five `useSignalObservations` reads (one per Powershare signal field) for the globally
// selected vehicle and folds their latest values into one `hasData` snapshot rendered across two GlassPanels:
//   • GlassPanel 1 (status) — a status Badge plus, when any value is present, a three-tile grid (Type /
//     Output Power / Hours Remaining); otherwise a friendly empty state.
//   • GlassPanel 5 (stop reason) — a stop-reason Badge + help line, or a friendly empty state.
// The two `*Variant` helpers map a status / stop-reason string onto a Badge tone exactly as the web
// `statusVariant` / `stopReasonVariant` do (including the web's substring ordering), and the numeric tiles
// format through the en-US `fmtNumber` port.
//
// SI boundary: Powershare telemetry arrives as raw `signal_observations` rows (signal_log values stored
// verbatim from Tesla). The page performs NO unit conversion — the web reads `value_numeric` and renders it
// directly (`PowershareInstantaneousPowerKW` ⇒ kW to 2 dp, `PowershareHoursLeft` ⇒ h to 1 dp), so this port
// renders the same raw figures verbatim. Power (kW) and runtime (h) are not user-preference units, so there is
// no SI converter at this boundary — parity with the web is the contract.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.powershare

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `PowersharePage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("powershare", "/powershare", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface
 * to that destination (and its `/powershare` deep link) without the nav module depending on it.
 */
object PowersharePageRegistration {
    /** The navigation destination id (Destinations.kt `page("powershare", "/powershare", …)`). */
    const val ROUTE_ID: String = "powershare"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/powershare"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "PowersharePage"
}

/**
 * The five Powershare signal fields the page reads, one `useSignalObservations` per field (web `signal_name`).
 * Per ADR-005 these are cold signals served from `signal_observations`, not the typed hot schema.
 */
object PowershareSignals {
    /** `PowershareStatus` — the status string driving the section Badge (web `signal_name: 'PowershareStatus'`). */
    const val STATUS: String = "PowershareStatus"

    /** `PowershareType` — the destination string for the Type tile (web `'PowershareType'`). */
    const val TYPE: String = "PowershareType"

    /** `PowershareStopReason` — the last stop-reason string (web `'PowershareStopReason'`). */
    const val STOP_REASON: String = "PowershareStopReason"

    /** `PowershareHoursLeft` — estimated remaining runtime in hours (web `'PowershareHoursLeft'`). */
    const val HOURS_LEFT: String = "PowershareHoursLeft"

    /** `PowershareInstantaneousPowerKW` — instantaneous output power in kW (web `'PowershareInstantaneousPowerKW'`). */
    const val INSTANTANEOUS_POWER_KW: String = "PowershareInstantaneousPowerKW"

    /** Each observation feed requests only the most recent row (web `{ limit: 1 }`). */
    const val OBSERVATION_LIMIT: Int = 1
}

/** The em dash the web renders for any null/absent value (`'—'`). */
internal const val EM_DASH: String = "\u2014"

/** Fraction digits for the Output Power tile — the web `fmtNumber(powerKw, 2)` second argument. */
private const val POWER_FRACTION_DIGITS: Int = 2

/** Fraction digits for the Hours Remaining tile — the web `fmtNumber(hoursLeft, 1)` second argument. */
private const val HOURS_FRACTION_DIGITS: Int = 1

/**
 * The five latest Powershare readings the surface needs, decoupled from any display widget — the native
 * analogue of the web `status` / `shareType` / `stopReason` / `hoursLeft` / `powerKw` locals. Text fields are
 * the verbatim observation strings; the two numeric fields stay in their raw units (kW, hours) exactly as the
 * backend serves them (the web performs no conversion here either).
 *
 * @property status the latest `PowershareStatus` text, or `null` (web `latestText(statusObs)`).
 * @property shareType the latest `PowershareType` text, or `null` (web `latestText(typeObs)`).
 * @property stopReason the latest `PowershareStopReason` text, or `null` (web `latestText(stopObs)`).
 * @property hoursLeftH the latest `PowershareHoursLeft` value in hours, or `null` (web `latestNumeric(hoursObs)`).
 * @property powerKw the latest `PowershareInstantaneousPowerKW` value in kW, or `null` (web `latestNumeric(powerObs)`).
 */
data class PowershareReadings(
    val status: String? = null,
    val shareType: String? = null,
    val stopReason: String? = null,
    val hoursLeftH: Double? = null,
    val powerKw: Double? = null,
) {
    /**
     * Whether any of the five readings is present — the web `hasData` content/empty boundary for GlassPanel 1.
     * The status row's three-tile grid renders when this is true, the friendly empty state when it is false.
     */
    val hasData: Boolean
        get() = status != null || shareType != null || stopReason != null || hoursLeftH != null || powerKw != null

    /** Whether a stop reason is present — the web `stopReason ? … : <EmptyState/>` boundary for GlassPanel 5. */
    val hasStopReason: Boolean get() = stopReason != null
}

/**
 * Extract the latest numeric value from a signal-observations result — the native port of web
 * `signalObservation.ts::latestNumeric` (`data?.[0]?.value_numeric ?? null`). The list arrives newest-first
 * (the backend orders descending and the web reads index 0).
 */
fun latestNumeric(observations: List<SignalObservation>?): Double? = observations?.firstOrNull()?.valueNumeric

/**
 * Extract the latest text value from a signal-observations result — the native port of web
 * `signalObservation.ts::latestText` (`data?.[0]?.value_text ?? null`).
 */
fun latestText(observations: List<SignalObservation>?): String? = observations?.firstOrNull()?.valueText

/**
 * Map a Powershare status string onto a Badge tone — a 1:1 port of the web `statusVariant`, including its
 * substring-match ordering (e.g. an "inactive" status matches the `'active'` branch first, exactly as the web
 * `includes('active')` does). A `null` status is neutral (the web `if (!status) return 'neutral'`).
 */
fun statusVariant(status: String?): BadgeVariant {
    if (status == null) return BadgeVariant.Neutral
    val s = status.lowercase(Locale.ROOT)
    return when {
        s.contains("active") || s.contains("on") -> BadgeVariant.Success
        s.contains("error") || s.contains("fail") -> BadgeVariant.Danger
        s.contains("inactive") || s.contains("off") -> BadgeVariant.Neutral
        else -> BadgeVariant.Warning
    }
}

/**
 * Map a Powershare stop-reason string onto a Badge tone — a 1:1 port of the web `stopReasonVariant`. A `null`
 * or `"none"`/empty reason is neutral; a user-initiated reason is a warning; an error/fault/low reason is a
 * danger; anything else is a warning (web's final fallthrough).
 */
fun stopReasonVariant(reason: String?): BadgeVariant {
    if (reason == null) return BadgeVariant.Neutral
    val r = reason.lowercase(Locale.ROOT)
    return when {
        r == "none" || r == "" -> BadgeVariant.Neutral
        r.contains("user") -> BadgeVariant.Warning
        r.contains("error") || r.contains("fault") || r.contains("low") -> BadgeVariant.Danger
        else -> BadgeVariant.Warning
    }
}

/**
 * Locale-aware number formatting reproducing the web `numberFormat` helper (`fmtNumber`,
 * web/src/lib/numberFormat.ts) the two numeric tiles use. Pure (JVM-tested): a non-finite value is coerced to
 * `0` exactly as the web `safeNumber`, and grouping/precision follow `Intl.NumberFormat('en-US')` with equal
 * min/max fraction digits (`String.format`'s `HALF_UP` matches ECMAScript `halfExpand`).
 */
object PowershareFormat {
    /** Web `fmtNumber(powerKw, 2)` — the Output Power tile's value (kW, 2 dp). */
    fun power(
        value: Double,
        locale: Locale = Locale.US,
    ): String = fmtNumber(value, POWER_FRACTION_DIGITS, locale)

    /** Web `fmtNumber(hoursLeft, 1)` — the Hours Remaining tile's value (h, 1 dp). */
    fun hours(
        value: Double,
        locale: Locale = Locale.US,
    ): String = fmtNumber(value, HOURS_FRACTION_DIGITS, locale)

    private fun fmtNumber(
        value: Double,
        digits: Int,
        locale: Locale,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return String.format(locale, "%,.${digits}f", safe)
    }
}

/**
 * Folds the five Powershare observation feeds' best-available values into one [PowershareReadings] resource —
 * the native analogue of the web component evaluating its five independent `useSignalObservations` queries and
 * computing `hasData`. Each feed contributes its newest cached value (a terminal `Success`'s `cached` is its
 * data), so a tile shows as soon as any feed resolves; an all-empty snapshot is collapsed to `null` cache so
 * the surface shows its loading skeleton or hard error rather than a populated grid.
 *
 * Aggregate phase, mirroring the web's "render whatever resolved" behaviour: any feed `Success` ⇒ overall
 * `Success` (then `hasData` chooses content vs the friendly empty state); else any feed still `Loading` ⇒
 * overall `Loading`; else all failed ⇒ overall `Error` (retry surface).
 */
fun combinePowershareReadings(
    status: Resource<List<SignalObservation>>,
    type: Resource<List<SignalObservation>>,
    stop: Resource<List<SignalObservation>>,
    hours: Resource<List<SignalObservation>>,
    power: Resource<List<SignalObservation>>,
): Resource<PowershareReadings> {
    val feeds = listOf(status, type, stop, hours, power)
    val readings =
        PowershareReadings(
            status = latestText(status.cached),
            shareType = latestText(type.cached),
            stopReason = latestText(stop.cached),
            hoursLeftH = latestNumeric(hours.cached),
            powerKw = latestNumeric(power.cached),
        )
    val present = readings.takeIf { it.hasData }
    val fetchedAt = feeds.mapNotNull { it.fetchedAtOrNull() }.maxOrNull()
    val stale = feeds.any { it.stale }
    return when {
        feeds.any { it is Resource.Success<*> } ->
            Resource.Success(readings, fetchedAt = fetchedAt ?: 0L, stale = stale)
        feeds.any { it is Resource.Loading<*> } ->
            Resource.Loading(cached = present, fetchedAt = fetchedAt, stale = stale)
        else ->
            Resource.Error(cached = present, fetchedAt = fetchedAt, stale = stale, error = firstError(feeds))
    }
}

/** The fetched-at stamp a [Resource] carries, regardless of variant (`Success`/`Loading`/`Error`). */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

/** The first feed error in the folded set, or a generic cause when every feed failed without one attached. */
private fun firstError(feeds: List<Resource<*>>): Throwable =
    feeds.filterIsInstance<Resource.Error<*>>().firstOrNull()?.error
        ?: IllegalStateException("powershare observations unavailable")

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PowersharePageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, status, or power figure.
 */
fun recordPowersharePageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PowersharePageRegistration.SLUG))
}
