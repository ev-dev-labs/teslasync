// Pure, framework-free model + projection for the AutopilotSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// The web component binds three reads for one vehicle and renders three KPI tiles inside a GlassPanel:
//   • Current Speed  — `useVehicleState(id).state.speed` (SI m/s, polled), displayed via the user's speed unit;
//   • Cruise Set Speed — the latest `CruiseSetSpeed` observation's numeric value (also SI m/s, NOT km/h —
//     see the web file's unit-policy note: VehicleSpeed and CruiseSetSpeed are the two m/s-canonical fields);
//   • Follow Distance — the latest `CruiseFollowDistance` observation, a proto enum string
//     (e.g. "FollowDistance7") whose trailing digit is the only useful bit (web `parseFollowDistance`).
// When none of the three is present the surface shows a friendly empty state, never a blank box (web
// `hasAny ? grid : <EmptyState/>`).
//
// Speeds convert SI -> display at this boundary (shared `convertSpeedFromSI`) and format to 0 fraction digits
// with en-US grouping (web `fmtNumber(value, 0)`); the follow-distance string is rendered verbatim after the
// prefix is peeled. Every derivation flows through [AutopilotSectionProjection]; the composable only renders.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AutopilotSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.autopilotsection

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import java.util.Locale
import kotlin.math.floor

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AutopilotSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "autopilot-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN / vehicle data. */
    const val SLUG: String = "AutopilotSection"
}

/** The em dash the web renders for any null/absent value (`'—'`). */
internal const val EM_DASH: String = "\u2014"

/** Default fraction digits for the speed tiles — the web `fmtNumber(value, 0)` second argument. */
private const val SPEED_FRACTION_DIGITS: Int = 0

/**
 * The three SI readings the surface needs, decoupled from any display unit — the native analogue of the web
 * `speedMps` / `cruiseSetMps` / `followDistanceRaw` locals. Values stay SI (Phase-42 stores everything as SI);
 * conversion is the projection's job at the render boundary.
 *
 * @property speedMps current vehicle speed in m/s, or `null` (web `vehicleState?.speed ?? null`).
 * @property cruiseSetMps latest cruise set-speed in m/s, or `null` (web `latestNumeric(cruiseSetObs)`).
 * @property followDistanceRaw latest follow-distance enum string (e.g. "FollowDistance7"), or `null`
 *   (web `latestText(followObs) ?? String(latestNumeric(followObs))`). Parsed to its bar count at display.
 */
data class AutopilotSnapshot(
    val speedMps: Double? = null,
    val cruiseSetMps: Double? = null,
    val followDistanceRaw: String? = null,
) {
    /**
     * Whether any of the three readings is present — the web `hasAny` content/empty boundary. A non-null
     * [followDistanceRaw] always yields a non-null parsed value, so it stands in for the web `followDistance`.
     */
    val hasAny: Boolean get() = speedMps != null || cruiseSetMps != null || followDistanceRaw != null
}

/**
 * The fully projected, render-ready tile values — everything the web component computes before handing the
 * three `<StatCard>`s their props. Pure strings (no Compose types) so the projection is unit-tested without a
 * UI host; the view supplies each tile's localized label + glyph.
 *
 * @property currentSpeedValue formatted current speed, or [EM_DASH] (web `fmtNumber(currentSpeedDisplay, 0)`).
 * @property cruiseSetValue formatted cruise set speed, or [EM_DASH] (web `fmtNumber(cruiseSetDisplay, 0)`).
 * @property followDistanceValue the parsed follow-distance bar count, or [EM_DASH] (web `followDistance ?? '—'`).
 * @property speedUnit the user's speed unit label shown beside the two speed tiles (web `speedUnit`).
 */
data class AutopilotDisplay(
    val currentSpeedValue: String,
    val cruiseSetValue: String,
    val followDistanceValue: String,
    val speedUnit: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's display derivation.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate. Both speed tiles convert
 * SI m/s straight through [convertSpeedFromSI] (there is NO km/h intermediate — see the web file's unit-policy
 * note) and format to [SPEED_FRACTION_DIGITS] fraction digits; the follow-distance tile peels the proto-enum
 * prefix via [parseFollowDistance].
 */
object AutopilotSectionProjection {
    /** Projects the [snapshot] into render-ready tile strings for the user's [units] and [locale]. */
    fun project(
        snapshot: AutopilotSnapshot,
        units: UnitPref,
        locale: Locale = Locale.US,
    ): AutopilotDisplay =
        AutopilotDisplay(
            currentSpeedValue = speedValue(snapshot.speedMps, units, locale),
            cruiseSetValue = speedValue(snapshot.cruiseSetMps, units, locale),
            followDistanceValue = parseFollowDistance(snapshot.followDistanceRaw) ?: EM_DASH,
            speedUnit = units.speed.label,
        )

    /** SI m/s → display string (web `toSpeedDisplay` then `fmtNumber(_, 0)`), or [EM_DASH] when absent. */
    private fun speedValue(
        mps: Double?,
        units: UnitPref,
        locale: Locale,
    ): String = mps?.let { AutopilotFormat.speed(convertSpeedFromSI(it, units.speed), locale) } ?: EM_DASH
}

/**
 * Locale-aware number formatting reproducing the web `numberFormat` helper (`fmtNumber`,
 * web/src/lib/numberFormat.ts) the speed tiles use. Pure (JVM-tested): a non-finite value is coerced to `0`
 * exactly as the web `safeNumber`, and grouping/precision follow `Intl.NumberFormat` with equal min/max
 * fraction digits (`String.format`'s `HALF_UP` matches ECMAScript `halfExpand`).
 */
object AutopilotFormat {
    /** Web `fmtNumber(value, 0)` — `safeNumber` then locale grouping at zero fraction digits. */
    fun speed(
        value: Double,
        locale: Locale = Locale.US,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return String.format(locale, "%,.${SPEED_FRACTION_DIGITS}f", safe)
    }
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
 * The raw follow-distance string from a `CruiseFollowDistance` observations result — the native port of the
 * web `latestText(followObs) ?? (latestNumeric(followObs) != null ? String(latestNumeric(followObs)) : null)`.
 * `ValueKindEnum` lands in `value_text`; the numeric branch covers a future backend that re-encodes the
 * bar-count as `ValueKindInt32`, rendered with JS `String(n)` semantics (an integral value drops its `.0`).
 */
fun followDistanceRawFrom(observations: List<SignalObservation>?): String? =
    latestText(observations) ?: latestNumeric(observations)?.let { jsNumberString(it) }

/**
 * Tesla emits `CruiseFollowDistance` as a proto enum, e.g. "FollowDistance7" / "FollowDistance3" — meaning a
 * 7-bar / 3-bar follow gap. The signal_log encoder preserves that string verbatim. The trailing number is the
 * only useful bit for display, so peel it off rather than rendering "FollowDistance7" raw; fall back to
 * whatever the backend gave us if the enum schema ever changes. The native port of web `parseFollowDistance`.
 */
fun parseFollowDistance(raw: String?): String? {
    if (raw == null) return null
    val match = Regex("(\\d+)\\s*$").find(raw)
    return match?.groupValues?.get(1) ?: raw
}

/** JS `String(n)`: an integral finite value drops its fractional part, otherwise the shortest decimal form. */
private fun jsNumberString(value: Double): String =
    if (value.isFinite() && value == floor(value)) value.toLong().toString() else value.toString()

/**
 * By-name resource key for the one i18n string the catalog does not define — the web
 * `t('dynamics.autopilotNoData', '…')`. The four visible keys (`dynamics.autopilot`, `dynamics.currentSpeed`,
 * `dynamics.cruiseSetSpeed`, `dynamics.followDistance`) exist in the catalog (P1/S10) and resolve at compile
 * time; this one is absent, so the view resolves it by-name and falls back to [AutopilotSectionDefaults.NO_DATA].
 */
const val KEY_NO_DATA: String = "translation_dynamics_autopilotNoData"

/**
 * Native fallback microcopy. Backs the one string the i18n catalog (P1/S10) does not define: the empty-state
 * message (web `t('dynamics.autopilotNoData', 'No cruise / autopilot telemetry received yet')`). Reproduces
 * i18next's "return the default when the key is absent" behaviour, so the surface still carries the web's
 * English fallback verbatim while routing through the i18n facade.
 */
object AutopilotSectionDefaults {
    /** Web `t('dynamics.autopilotNoData', '…')` default — the empty-state message. */
    const val NO_DATA: String = "No cruise / autopilot telemetry received yet"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AutopilotSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the composable's first-composition effect. Carries only the slug — never a speed or vehicle value.
 */
fun recordAutopilotSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AutopilotSectionRegistration.SLUG))
}
