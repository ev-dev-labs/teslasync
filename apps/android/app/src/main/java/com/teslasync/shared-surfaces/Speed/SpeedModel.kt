// Pure, framework-free model + projection + diagnostics for the Speed shared surface — the native analogue of
// web/src/components/data-display/format/Speed.tsx. No Compose, no Android framework, no HTTP: every declaration
// here is exercised off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render layer
// over these pure functions (the accepted sibling-surface contract used by AnimatedNumber / SpeedGearPanel).
//
// The web source is a PURELY PRESENTATIONAL speed renderer, not a data-fetching view. It accepts a caller value in
// one of two source units (`mph` OR `kmh`) plus a `precision`, reads the user's display preference through
// `useUnits`, and renders the value converted to that preference with the unit symbol appended — or an em dash
// when no finite value is supplied. Crucially the web converts the caller input to SI metres-per-second FIRST
// (`mph * 0.44704` or `kmh * 1000 / 3600`; the misnamed `sourceMph` actually holds m/s), then converts SI → the
// display unit exactly once via `convertSpeedFromSI`, and formats with the web global `fmtNumber` (whose default
// precision is the user's `decimal_precision`, 2 when unset — NOT the lib formatter's 0). This file owns that
// math: the two source-unit → SI factors, the single SI → display conversion (the shared `convertSpeedFromSI`),
// the `fmtNumber`-parity formatter, the hover-title assembly (web `title` = the raw caller value with its source
// unit, `toFixed(1)`), and the em-dash empty branch.
//
// The web source has NO async cache-then-network feed — it is handed a finished number — so there is no loading /
// error / stale / offline lifecycle to model; inventing one would fabricate behaviour the web spec does not have,
// exactly as the accepted AnimatedNumber / VisuallyHidden presentational ports document. The surface's real,
// reproduced states are: a value in the imperial preference, a value in the metric preference, the km/h source
// path, the precision / unit format variants, and the no-value em dash. The web renders no static copy of its own
// — the number, the display unit symbol (derived from the preference), and the source unit symbol in the title
// are its only text — so the surface carries NO i18n keys; there is none to map, and none is invented.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Speed — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.speed

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertSpeedFromSI
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/**
 * Canonical registry metadata for the Speed surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Speed`).
 */
object SpeedRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "speed"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "Speed"
}

/** The em-dash the web renders when no usable value is supplied (`'—'`). */
const val DASH: String = "\u2014"

/**
 * Web `fmtNumber`'s global precision default — the user's `decimal_precision`, 2 when unset. The web `Speed`
 * passes its `precision` prop straight to `fmtNumber`, which falls back to this global when the prop is absent.
 * Mirrors the sibling SpeedGearPanel's `DEFAULT_DECIMAL_PRECISION`.
 */
const val DEFAULT_DECIMAL_PRECISION: Int = 2

/** 1 mph = 0.44704 m/s exactly (web `mph * 0.44704`, NIST international yard). */
private const val MPH_TO_MPS: Double = 0.44704

/** km/h → m/s numerator / denominator (web `kmh * 1000 / 3600`). */
private const val METERS_PER_KM: Double = 1000.0
private const val SECONDS_PER_HOUR: Double = 3600.0

/** Source-unit symbol for the hover title — the caller's INPUT unit, not the display unit (web literal `mph`). */
private const val MPH_LABEL: String = "mph"

/** Source-unit symbol for the hover title — the caller's INPUT unit, not the display unit (web literal `km/h`). */
private const val KMH_LABEL: String = "km/h"

/** Fixed fraction digits for the hover title's source value (web `toFixed(1)`). */
private const val TITLE_DECIMALS: Int = 1

/**
 * The presentational inputs — the native analogue of the web `Speed` props that affect output. A caller supplies
 * the value in exactly one source unit ([mph] OR [kmh], [mph] winning when both are finite, matching the web's
 * `if (mph) … else if (kmh)`), plus an optional [precision] override. `className` is a render-layer concern and so
 * lives on the composable, not in this pure projection.
 */
data class SpeedSpec(
    val mph: Double? = null,
    val kmh: Double? = null,
    val precision: Int? = null,
)

/**
 * The fully projected, render-ready value — everything the web component derives before returning JSX.
 *
 * @property number the formatted numeric part in the user's display unit, or [DASH] when there is no value.
 * @property unitLabel the display unit symbol (web `unitPrefs.speed`), e.g. `mph` / `km/h`.
 * @property text the full visible string — `"<number> <unit>"` for a value, or just [DASH] when empty (the web
 *   em-dash span carries no unit).
 * @property title the hover-title text — the raw caller value with its SOURCE unit (web `title`), or `null` when
 *   there is no value (the web em-dash span has no `title`).
 * @property accessibleLabel the screen-reader label the composable exposes; equals [text] so a reader announces
 *   the same value the eye sees.
 * @property hasValue whether a finite caller value was supplied (false selects the em-dash empty branch).
 */
data class SpeedDisplay(
    val number: String,
    val unitLabel: String,
    val text: String,
    val title: String?,
    val accessibleLabel: String,
    val hasValue: Boolean,
)

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's derivations:
 * the source-unit → SI conversion, the SINGLE SI → display conversion at the render site (web `toSpeedDisplay` =
 * `convertSpeedFromSI`), the `fmtNumber`-parity formatting at the resolved precision, the raw-value hover title,
 * and the em-dash empty branch. Stateless and side-effect-free so it is fully covered by the off-device unit gate;
 * the composable only collects the live unit preference and draws what these return.
 */
object SpeedProjection {
    /**
     * The caller value in SI metres-per-second — web `mph * 0.44704` (preferred) else `kmh * 1000 / 3600`, with a
     * null / non-finite value falling through exactly as the web `Number.isFinite` guards do. `null` when neither
     * source is a finite number, which selects the em-dash branch.
     */
    fun sourceMetersPerSecond(spec: SpeedSpec): Double? =
        when {
            spec.mph != null && spec.mph.isFinite() -> spec.mph * MPH_TO_MPS
            spec.kmh != null && spec.kmh.isFinite() -> spec.kmh * METERS_PER_KM / SECONDS_PER_HOUR
            else -> null
        }

    /**
     * The hover-title text — the raw caller value with its SOURCE unit (web `${mph.toFixed(1)} mph` /
     * `${kmh.toFixed(1)} km/h`), so a user can read the exact underlying figure regardless of the rounded,
     * unit-converted display. `null` when there is no finite value (the web em-dash span sets no `title`).
     */
    fun title(spec: SpeedSpec): String? =
        when {
            spec.mph != null && spec.mph.isFinite() -> "${fixedOneDecimal(spec.mph)} $MPH_LABEL"
            spec.kmh != null && spec.kmh.isFinite() -> "${fixedOneDecimal(spec.kmh)} $KMH_LABEL"
            else -> null
        }

    /**
     * The fraction digits the display number is formatted with — web `fmtNumber(value, precision)` resolution: the
     * per-call [SpeedSpec.precision] override, else the user's global precision ([UnitPref.precision]), else
     * [DEFAULT_DECIMAL_PRECISION]. Coerced non-negative so a stray negative can never reach the formatter.
     */
    fun resolvePrecision(
        spec: SpeedSpec,
        prefs: UnitPref,
    ): Int = (spec.precision ?: prefs.precision ?: DEFAULT_DECIMAL_PRECISION).coerceAtLeast(0)

    /**
     * The render-ready [SpeedDisplay] for the given [spec], display [prefs] (web `useUnits`), and [locale] (the
     * grouping/separator locale, web `fmtNumber`'s active locale). A finite caller value is converted to SI then
     * to the display unit ONCE via [convertSpeedFromSI] and formatted at the resolved precision with the unit
     * appended; an absent / non-finite value yields the em-dash branch (no unit, no title), exactly like the web.
     */
    fun display(
        spec: SpeedSpec,
        prefs: UnitPref,
        locale: Locale,
    ): SpeedDisplay {
        val unitLabel = prefs.speed.label
        val mps = sourceMetersPerSecond(spec) ?: return emptyDisplay(unitLabel)
        val number = formatNumber(convertSpeedFromSI(mps, prefs.speed), resolvePrecision(spec, prefs), locale)
        val text = "$number $unitLabel"
        return SpeedDisplay(
            number = number,
            unitLabel = unitLabel,
            text = text,
            title = title(spec),
            accessibleLabel = text,
            hasValue = true,
        )
    }

    /** The empty (no finite value) projection — the em-dash span the web renders, carrying neither unit nor title. */
    private fun emptyDisplay(unitLabel: String): SpeedDisplay =
        SpeedDisplay(
            number = DASH,
            unitLabel = unitLabel,
            text = DASH,
            title = null,
            accessibleLabel = DASH,
            hasValue = false,
        )

    /**
     * Format a number the way the web `fmtNumber(value, decimals)` does: `toLocaleString(locale, { min == max ==
     * decimals })` with grouping separators and ECMAScript `halfExpand` rounding (round half away from zero). A
     * non-finite input is coerced to 0 (web `safeNumber`) and a signed zero normalized to positive zero so a
     * `-0.0` renders "0", matching `Intl.NumberFormat`.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val finite = if (value.isFinite()) value else 0.0
        val normalized = if (finite == 0.0) 0.0 else finite
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }

    /**
     * The web `value.toFixed(1)` for the hover title: a fixed one-decimal, dot-separated, ungrouped string (the
     * caller's raw figure). `Locale.US` pins the dot separator the way `toFixed` always uses one, and a signed
     * zero is normalized so `-0.0` reads "0.0".
     */
    private fun fixedOneDecimal(value: Double): String {
        val normalized = if (value == 0.0) 0.0 else value
        return String.format(Locale.US, "%.${TITLE_DECIMALS}f", normalized)
    }
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to en-US
 * for a blank / absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event tagged
 * with the surface [SpeedRegistration.SLUG] — never the rendered speed, its source unit, or the preference — so a
 * diagnostics line can never leak a fleet figure. Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the composable calls it once per surface open.
 */
object SpeedDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SpeedRegistration.SLUG))
    }
}
